// Model & thinking-mode capsules (E15): the control-center counterpart of the
// classic top bar's two dropdowns, so the Deck can hot-swap model and thinking
// tier mid-session without leaving the experimental layout. Data sources are
// the same as classic: the endpoint/model registry summary plus
// @deeporca/core/capabilities' family think levels — the menus never offer a
// tier the current model's family doesn't actually serve.
import { useMemo, type JSX } from "react";
import type { ReasoningEffort, SettingsSummary } from "../../../shared/ipc";
import { collectAllModelKeys, parseModelKey, resolveModelCapability, thinkingLabelKey } from "../../lib/model-utils";
import { familyThinkLevels, resolveModelSpec } from "@deeporca/core/capabilities";
import { useI18n } from "../../i18n";
import { useDeckSettings } from "../hooks/use-deck-settings";

/** Mirrors the registry's deepseek lineup when no endpoint models exist. */
const FALLBACK_MODELS = ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"];

type ThinkingOption = {
  key: string;
  labelKey: ReturnType<typeof thinkingLabelKey>;
  thinkingEnabled: boolean;
  reasoningEffort?: ReasoningEffort;
};

function thinkingOptionsForFamily(familyId: string): ThinkingOption[] {
  // Tiers the family serves (common/think-level.ts); unknown families fall
  // back to the generic visible scale. "Off" always terminates the list.
  return [
    ...familyThinkLevels(familyId).map(
      (level): ThinkingOption => ({
        key: level.id,
        labelKey: thinkingLabelKey(level.id),
        thinkingEnabled: true,
        reasoningEffort: level.id,
      })
    ),
    { key: "off", labelKey: "model.noThinking", thinkingEnabled: false },
  ];
}

function currentThinkingKey(settings: SettingsSummary, options: ThinkingOption[]): string {
  if (!settings.thinkingEnabled) return "off";
  // Settings may hold a tier the current family folds away — snap to it if
  // still offered, else the family's high, else its first enabled tier.
  if (options.some((o) => o.key === settings.reasoningEffort && o.thinkingEnabled)) return settings.reasoningEffort;
  return options.find((o) => o.key === "high")?.key ?? options.find((o) => o.thinkingEnabled)?.key ?? "off";
}

/** The model key currently active in settings ("endpointId/modelId|model"). */
function activeModelKey(settings: SettingsSummary): string {
  const keys = collectAllModelKeys(settings.endpoints);
  return keys.find((k) => parseModelKey(k)?.modelId === settings.model) ?? settings.model ?? "";
}

export function ModelCapsule(props: { busy?: boolean }): JSX.Element {
  const { t } = useI18n();
  const { settings, selectModel, applyThinking } = useDeckSettings();

  const modelKeys = useMemo(() => {
    if (!settings) return [];
    const keys = collectAllModelKeys(settings.endpoints);
    if (keys.length > 0) return keys;
    return FALLBACK_MODELS;
  }, [settings]);

  const thinkingOptions = useMemo(() => {
    if (!settings) return [] as ThinkingOption[];
    const familyOptions = thinkingOptionsForFamily(resolveModelSpec({ model: settings.model }).id);
    const cap = resolveModelCapability(settings.endpoints, activeModelKey(settings));
    return cap.thinking ? familyOptions : familyOptions.filter((o) => o.key === "off");
  }, [settings]);

  if (!settings) return <div className="deck-cc-config" aria-hidden="true" />;

  return (
    <div className="deck-cc-config">
      <select
        className="deck-cc-model"
        value={activeModelKey(settings)}
        disabled={props.busy}
        title={t("deck.cc.modelHint")}
        onChange={(e) => {
          const val = e.target.value;
          const parsed = parseModelKey(val);
          // Capability of the newly selected model decides whether thinking
          // survives the switch (same rule as the classic top bar).
          const cap = resolveModelCapability(settings.endpoints, val);
          void selectModel({
            model: parsed?.modelId ?? val,
            ...(parsed ? { endpointId: parsed.endpointId } : {}),
            thinkingEnabled: cap.thinking && settings.thinkingEnabled,
            reasoningEffort: settings.reasoningEffort,
          });
        }}
      >
        {modelKeys.map((key) => (
          <option key={key} value={key}>
            {parseModelKey(key)?.modelId ?? key}
          </option>
        ))}
      </select>
      <select
        className="deck-cc-think"
        value={thinkingOptions.length > 0 ? currentThinkingKey(settings, thinkingOptions) : ""}
        disabled={props.busy || thinkingOptions.length === 0}
        title={t("deck.cc.thinkHint")}
        onChange={(e) => {
          const opt = thinkingOptions.find((o) => o.key === e.target.value) ?? thinkingOptions[0]!;
          void applyThinking({
            thinkingEnabled: opt.thinkingEnabled,
            reasoningEffort: opt.reasoningEffort ?? settings.reasoningEffort,
          });
        }}
      >
        {thinkingOptions.map((o) => (
          <option key={o.key} value={o.key}>
            {t(o.labelKey)}
          </option>
        ))}
      </select>
    </div>
  );
}
