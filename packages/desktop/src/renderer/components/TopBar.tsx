import { memo, useMemo, type JSX } from "react";
import type { ModelConfigSelection, ReasoningEffort, SettingsSummary } from "../../shared/ipc";
import { api } from "../api";
import { useI18n, type MessageKey } from "../i18n";
import { Pill, Select } from "../ui/index";
import { formatTokens, compactTokenThreshold } from "../lib/token-usage";
import { collectAllModelKeys, parseModelKey, resolveModelCapability } from "../lib/model-utils";

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

const FALLBACK_MODELS = ["deepseek-v4-pro", "deepseek-v4-flash"];

/** Sentinel option value: opens the settings panel's model pool (endpoints
 * tab). Selecting it never changes the model — the DOM select is snapped back
 * to the current value because no state change triggers a re-render. */
const POOL_CONFIG_VALUE = "__configure_model_pool__";

type ThinkingOption = {
  key: string;
  labelKey: MessageKey;
  thinkingEnabled: boolean;
  reasoningEffort?: ReasoningEffort;
};
const THINKING_OPTIONS: ThinkingOption[] = [
  { key: "max", labelKey: "model.thinkingMax", thinkingEnabled: true, reasoningEffort: "max" },
  { key: "high", labelKey: "model.thinkingHigh", thinkingEnabled: true, reasoningEffort: "high" },
  { key: "off", labelKey: "model.noThinking", thinkingEnabled: false },
];

function projectName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : path;
}

function currentThinkingKey(s: SettingsSummary): string {
  if (!s.thinkingEnabled) return "off";
  return s.reasoningEffort === "high" ? "high" : "max";
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
  const thinkingOptions = modelCap.thinking ? THINKING_OPTIONS : THINKING_OPTIONS.filter((o) => o.key === "off");

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
         The model list is derived from the endpoint configuration in settings. */}
      {settings ? (
        <div className="ui-topbar-pill ui-topbar-models">
          <Select
            className="ui-topbar-model"
            value={modelSelectValue}
            title={t("topbar.model")}
            onChange={(e) => {
              const val = e.target.value;
              if (val === POOL_CONFIG_VALUE) {
                // Snap the DOM select back — the controlled value never moved.
                e.target.value = modelSelectValue;
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
          >
            {availableModels.map((m) => {
              const parsed = parseModelKey(m);
              const label = parsed
                ? `${settings?.endpoints?.find((e) => e.id === parsed.endpointId)?.name ?? parsed.endpointId} / ${parsed.modelId}`
                : m;
              return (
                <option key={m} value={m}>
                  {label}
                </option>
              );
            })}
            {/* Pool entry point: one click from the top bar to the model pool
                (endpoints tab). Makes the pool the visible source of truth —
                especially when it is empty and the list above is the hardcoded
                fallback pair. */}
            <option value={POOL_CONFIG_VALUE}>{`⚙ ${t("topbar.configureModelPool")}`}</option>
          </Select>
          <span className="ui-topbar-divider" aria-hidden="true" />
          <Select
            className="ui-topbar-thinking"
            value={currentThinkingKey(settings)}
            title={t("topbar.thinkingModel")}
            onChange={(e) => {
              const opt = thinkingOptions.find((o) => o.key === e.target.value) ?? thinkingOptions[0]!;
              onSetModel({
                model: settings.model,
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
          </Select>
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
              className={`ui-topbar-token-bar-fill${activeTokens / compactTokenThreshold(settings.model) >= 0.8 ? " near" : ""}`}
              style={{ width: `${Math.min(100, (activeTokens / compactTokenThreshold(settings.model)) * 100)}%` }}
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
