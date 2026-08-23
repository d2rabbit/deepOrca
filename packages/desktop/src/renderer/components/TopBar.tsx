import { memo, useMemo, type JSX } from "react";
import type { ModelConfigSelection, ReasoningEffort, SettingsSummary } from "../../shared/ipc";
import { api } from "../api";
import { useI18n, type MessageKey } from "../i18n";
import { DropdownSelect, Pill, Select, type DropdownOption } from "../ui/index";
import { formatTokens, compactTokenThreshold } from "../lib/token-usage";
import { collectAllModelKeys, parseModelKey, resolveModelCapability, thinkingLabelKey } from "../lib/model-utils";
import { familyThinkLevels, resolveModelSpec } from "@deeporca/core/capabilities";

type Props = {
  platform: string;
  projectRoot: string;
  /** True when the engine is on its home-dir fallback (no real workspace yet). */
  isHomeRoot?: boolean;
  /** Open the folder picker to choose a real workspace. */
  onPickFolder?: () => void;
  settings: SettingsSummary | null;
  branch: string;
  branches: string[];
  onSwitchBranch: (branch: string) => void;
  onSetModel: (selection: ModelConfigSelection) => void;
  /** Hot thinking-mode switch (settings-only; falls back to onSetModel). */
  onSetThinking?: (selection: { thinkingEnabled: boolean; reasoningEffort: ReasoningEffort }) => void;
  onOpenSettings: () => void;
  onOpenTokens: () => void;
  activeTokens: number;
  totalTokens: number;
  /** Workspace-wide cache hit rate (0-100). */
  cacheRate?: number;
  /** Total API requests across workspace sessions. */
  totalReqs?: number;
  /** Active session summary/title for center display. */
  sessionTitle?: string | null;
  /** Active session status for the status dot indicator. */
  sessionStatus?: string | null;
  /** Whether the LLM is currently streaming a response. */
  streaming?: boolean;
  /** Elapsed seconds since streaming started (for live counter). */
  streamElapsedSecs?: number;
};

/** Default model lineup (DeepSeek V4 family) used when no endpoint models are
 * configured — mirrors the registry's registered deepseek models. */
const FALLBACK_MODELS = ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"];

/** Sentinel option value: opens the settings panel's model pool (endpoints
 * tab). Selecting it never changes the model — the controlled value stays
 * put and the menu simply closes. */
const POOL_CONFIG_VALUE = "__configure_model_pool__";

type ThinkingOption = {
  key: string;
  labelKey: MessageKey;
  thinkingEnabled: boolean;
  reasoningEffort?: ReasoningEffort;
};

function thinkingOptionsForFamily(familyId: string): ThinkingOption[] {
  // Tiers the family actually serves (common/think-level.ts) — deepseek shows
  // its real low/high/max; unknown families fall back to the generic visible
  // scale. "Off" always terminates the list.
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

function projectName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : path;
}

function currentThinkingKey(s: SettingsSummary, options: ThinkingOption[]): string {
  if (!s.thinkingEnabled) return "off";
  // Settings may hold a tier the current family doesn't serve (e.g. medium
  // stored earlier — deepseek folds it to high): snap to the exact tier if
  // offered, else the family's high, else its first tier.
  if (options.some((o) => o.key === s.reasoningEffort && o.thinkingEnabled)) return s.reasoningEffort;
  return options.find((o) => o.key === "high")?.key ?? options.find((o) => o.thinkingEnabled)?.key ?? "off";
}

// Window caption glyphs as inline SVG (Windows 11 Fluent style). 1.5px stroke
// at 12px render size gives a crisp 1.5px line; `currentColor` lets the
// theme dictate the foreground via the existing --ui-text-dim / --ui-text /
// --ui-danger palette.
const ICON_MIN = (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
    <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const ICON_MAX_RESTORE = (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
    <rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);
const ICON_CLOSE = (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
    <line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/** Slim draggable window bar: window controls + project/branch + dual model selectors + token mini. */
// Memoized: all props are primitives or stable references from App.
export const TopBar = memo(function TopBar({
  platform,
  projectRoot,
  isHomeRoot = false,
  onPickFolder,
  settings,
  branch,
  branches,
  onSwitchBranch,
  onSetModel,
  onSetThinking,
  onOpenSettings,
  onOpenTokens,
  activeTokens,
  totalTokens,
  cacheRate,
  totalReqs,
  sessionTitle,
  sessionStatus,
  streaming = false,
  streamElapsedSecs = 0,
}: Props): JSX.Element {
  const { t } = useI18n();
  const isMac = platform === "darwin";

  // macOS traffic-light gumdrops sit at the far left (system convention).
  const macControls = (
    <div className="ui-window-controls mac">
      <button
        className="ui-gumdrop close"
        aria-label={t("window.close")}
        title={t("window.close")}
        onClick={() => void api.closeWindow()}
      />
      <button
        className="ui-gumdrop min"
        aria-label={t("window.minimize")}
        title={t("window.minimize")}
        onClick={() => void api.minimizeWindow()}
      />
      <button
        className="ui-gumdrop zoom"
        aria-label={t("window.zoom")}
        title={t("window.zoom")}
        onClick={() => void api.toggleMaximizeWindow()}
      />
    </div>
  );

  // Windows controls sit at the far right (system convention): min / max / close.
  const winControls = (
    <div className="ui-window-controls win">
      <button
        className="ui-win-ctrl min"
        aria-label={t("window.minimize")}
        title={t("window.minimize")}
        onClick={() => void api.minimizeWindow()}
      >
        {ICON_MIN}
      </button>
      <button
        className="ui-win-ctrl max"
        aria-label={t("window.zoom")}
        title={t("window.zoom")}
        onClick={() => void api.toggleMaximizeWindow()}
      >
        {ICON_MAX_RESTORE}
      </button>
      <button
        className="ui-win-ctrl close"
        aria-label={t("window.close")}
        title={t("window.close")}
        onClick={() => void api.closeWindow()}
      >
        {ICON_CLOSE}
      </button>
    </div>
  );

  // Build the model list from settings endpoints. Falls back to hardcoded
  // list when endpoints have no registered models (backward compat).
  // Selection values are endpointId/modelId keys (so selecting a model also
  // selects its endpoint) — except in the fallback case, where bare model
  // names are used (no endpoints configured).
  const availableModels = useMemo(() => {
    if (!settings?.endpoints?.length) return FALLBACK_MODELS;
    const keys = collectAllModelKeys(settings.endpoints);
    return keys.length === 0 ? FALLBACK_MODELS : keys;
  }, [settings?.endpoints]);

  // Check if current model supports thinking (for the thinking dropdown gating).
  const currentModel = settings?.model || FALLBACK_MODELS[0]!;
  // Resolve capability against the primary endpoint's registration when the
  // current model is registered there; falls back to the hardcoded tables.
  const currentKey = useMemo(() => {
    if (!settings?.endpoints?.length) return currentModel;
    const primaryId = settings.primaryEndpointId;
    const keys = collectAllModelKeys(settings.endpoints);
    // Prefer the key on the primary endpoint; else any key whose modelId matches.
    const onPrimary = keys.find((k) => {
      const p = parseModelKey(k);
      return p?.endpointId === primaryId && p.modelId === currentModel;
    });
    if (onPrimary) return onPrimary;
    return keys.find((k) => parseModelKey(k)?.modelId === currentModel) ?? currentModel;
  }, [settings?.endpoints, settings?.primaryEndpointId, currentModel]);
  const modelCap = settings
    ? resolveModelCapability(settings.endpoints, currentKey)
    : { thinking: true, vision: false };
  // Thinking tiers follow the CURRENT model's family capability — menus never
  // offer a tier the family doesn't actually serve.
  const thinkingOptions = useMemo(() => {
    const familyOptions = thinkingOptionsForFamily(resolveModelSpec({ model: currentModel }).id);
    return modelCap.thinking ? familyOptions : familyOptions.filter((o) => o.key === "off");
  }, [currentModel, modelCap.thinking]);

  const modelSelectValue = availableModels.includes(currentKey)
    ? currentKey
    : (availableModels[0] ?? FALLBACK_MODELS[0]!);

  return (
    <div className="ui-window-bar">
      {isMac ? macControls : null}

      {/* Project / branch: "项目名 / 分支名" — wrapped in a unified pill so
         the control surface reads as one cohesive accent-tinted group. On the
         home-dir fallback (fresh install) the pill becomes a "pick a project
         folder" call-to-action instead of masquerading home as a workspace. */}
      {isHomeRoot ? (
        <button
          className="ui-topbar-pill ui-topbar-project ui-topbar-pickfolder"
          title={t("topbar.pickFolderHint")}
          onClick={onPickFolder}
        >
          <span className="ui-topbar-project-name">{t("topbar.pickFolder")}</span>
        </button>
      ) : (
        <div className="ui-topbar-pill ui-topbar-project" title={projectRoot}>
          <span className="ui-topbar-project-name">{projectName(projectRoot) || t("topbar.desktop")}</span>
          {branches.length > 0 ? (
            <>
              <span className="ui-topbar-sep">/</span>
              <Select
                className="ui-topbar-branch"
                value={branch}
                title={t("topbar.branch")}
                onChange={(e) => onSwitchBranch(e.target.value)}
              >
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </>
          ) : branch ? (
            <>
              <span className="ui-topbar-sep">/</span>
              <span className="ui-topbar-branch-static">{branch}</span>
            </>
          ) : null}
        </div>
      )}

      <div className="ui-window-bar-spacer">
        {streaming ? (
          <span className="ui-topbar-streaming" aria-label="streaming">
            <span className="ui-topbar-streaming-dot" />
            <span className="ui-topbar-streaming-dot" />
            <span className="ui-topbar-streaming-dot" />
            {streamElapsedSecs >= 3 ? <span className="ui-topbar-streaming-time">{streamElapsedSecs}s</span> : null}
          </span>
        ) : sessionTitle ? (
          <span className="ui-topbar-session-status">
            {sessionStatus ? <span className={`ui-status-dot ui-status-dot--${sessionStatus}`} /> : null}
            <span className="ui-topbar-session-title">{sessionTitle}</span>
          </span>
        ) : null}
      </div>

      {/* Dual model selectors: model + thinking mode, paired inside one pill.
         The model list is derived from the endpoint configuration in settings.
         Both use the animated DropdownSelect — same interaction as the old
         native selects, smooth expansion (specs: rail/topbar polish). */}
      {settings ? (
        <div className="ui-topbar-pill ui-topbar-models">
          <DropdownSelect
            triggerClassName="ui-topbar-model"
            value={modelSelectValue}
            title={t("topbar.model")}
            options={[
              ...availableModels.map((m): DropdownOption => {
                const parsed = parseModelKey(m);
                const label = parsed
                  ? `${settings?.endpoints?.find((e) => e.id === parsed.endpointId)?.name ?? parsed.endpointId} / ${parsed.modelId}`
                  : m;
                return { value: m, label };
              }),
              // Pool entry point: one click from the top bar to the model pool
              // (endpoints tab). Makes the pool the visible source of truth —
              // especially when it is empty and the list above is the hardcoded
              // fallback pair. The controlled value never moves; the menu just
              // closes and the settings panel opens.
              { value: POOL_CONFIG_VALUE, label: `⚙ ${t("topbar.configureModelPool")}` },
            ]}
            onSelect={(val) => {
              if (val === POOL_CONFIG_VALUE) {
                onOpenSettings();
                return;
              }
              const parsed = parseModelKey(val);
              const modelId = parsed?.modelId ?? val;
              // Resolve capability of the newly selected model so we never send
              // thinking options to a model that declares it unsupported.
              const cap = settings ? resolveModelCapability(settings.endpoints, val) : { thinking: true };
              const wantThinking = cap.thinking && settings.thinkingEnabled;
              onSetModel({
                model: modelId,
                endpointId: parsed?.endpointId,
                thinkingEnabled: wantThinking,
                reasoningEffort: settings.reasoningEffort,
              });
            }}
          />
          <span className="ui-topbar-divider" aria-hidden="true" />
          <DropdownSelect
            triggerClassName="ui-topbar-thinking"
            value={currentThinkingKey(settings, thinkingOptions)}
            title={t("topbar.thinkingModel")}
            options={thinkingOptions.map((o): DropdownOption => ({ value: o.key, label: t(o.labelKey) }))}
            onSelect={(key) => {
              const opt = thinkingOptions.find((o) => o.key === key) ?? thinkingOptions[0]!;
              const selection = {
                thinkingEnabled: opt.thinkingEnabled,
                reasoningEffort: opt.reasoningEffort ?? settings.reasoningEffort,
              };
              // Hot path: settings-only patch, no model-switch bookkeeping.
              if (onSetThinking) onSetThinking(selection);
              else onSetModel({ model: settings.model, ...selection });
            }}
          />
        </div>
      ) : null}

      {/* Compact token mini-panel — also wrapped in the unified pill. */}
      <button
        className="ui-topbar-pill ui-topbar-tokens"
        onClick={onOpenTokens}
        title={`${t("topbar.tokenPanelTitle")}${cacheRate != null && cacheRate > 0 ? ` · cache ${cacheRate}%` : ""}${totalReqs ? ` · ${totalReqs} reqs` : ""}`}
      >
        <span className="ui-topbar-token-part">
          <span className="ui-topbar-token-label">{t("topbar.contextTokens")}</span>
          <span className="ui-topbar-token-value">{formatTokens(activeTokens)}</span>
        </span>
        {/* Mini context usage bar — visual gauge of compaction proximity. */}
        {activeTokens > 0 && settings ? (
          <span className="ui-topbar-token-bar">
            <span
              className={`ui-topbar-token-bar-fill${
                activeTokens / compactTokenThreshold(settings.model, settings.compactTokenThreshold) >= 0.8
                  ? " near"
                  : ""
              }`}
              style={{
                width: `${Math.min(100, (activeTokens / compactTokenThreshold(settings.model, settings.compactTokenThreshold)) * 100)}%`,
              }}
            />
          </span>
        ) : null}
        <span className="ui-topbar-token-part">
          <span className="ui-topbar-token-label">{t("topbar.workspaceTokens")}</span>
          <span className="ui-topbar-token-value">{formatTokens(totalTokens)}</span>
        </span>
      </button>

      {settings && !settings.hasApiKey ? (
        <Pill warn onClick={onOpenSettings} title={t("topbar.configureApiKey")}>
          {t("topbar.noApiKey")}
        </Pill>
      ) : null}

      {isMac ? null : winControls}
    </div>
  );
});
