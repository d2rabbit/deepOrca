import { useEffect, useState, type JSX } from "react";
import type { EditableSettings, PermissionDecision, PermissionScope, ReasoningEffort } from "../../shared/ipc";
import {
  collectAllModelKeys,
  parseModelKey,
  resolveModelCapability,
  type EndpointConfig,
  type ModelRegistration,
} from "@deeporca/core";
import { api } from "../api";
import { useI18n, type Locale, type MessageKey } from "../i18n";
import { Button, Checkbox, Field, Input, Select } from "../ui/index";
import { availableThemes, type Theme } from "../lib/appearance";

type Props = {
  initial: EditableSettings;
  initialTab?: string;
  onSave: (next: EditableSettings) => void;
  onClose: () => void;
  /** Platform string (e.g. "win32") — scopes which themes are offered. */
  platform: string;
  /** Currently active theme. */
  theme: Theme;
  /** Called when the user picks a theme in the Appearance tab. */
  onSelectTheme: (theme: Theme) => void;
};

type Tab = "endpoints" | "model" | "appearance" | "memory" | "permissions" | "about";

const TABS: { id: Tab; labelKey: MessageKey }[] = [
  { id: "endpoints", labelKey: "settings.tab.endpoints" },
  { id: "model", labelKey: "settings.tab.model" },
  { id: "appearance", labelKey: "settings.tab.appearance" },
  { id: "memory", labelKey: "settings.tab.memory" },
  { id: "permissions", labelKey: "settings.tab.permissions" },
  { id: "about", labelKey: "settings.tab.about" },
];

const TAB_ICONS: Record<Tab, string> = {
  endpoints: "⌁",
  model: "✦",
  appearance: "◐",
  memory: "❍",
  permissions: "⊘",
  about: "ℹ",
};

const PERMISSION_SCOPES: PermissionScope[] = [
  "read-in-cwd",
  "read-out-cwd",
  "write-in-cwd",
  "write-out-cwd",
  "delete-in-cwd",
  "delete-out-cwd",
  "query-git-log",
  "mutate-git-log",
  "network",
  "mcp",
];

const DECISIONS: PermissionDecision[] = ["default", "allow", "ask", "deny"];

const REASONING_OPTIONS_FULL: ReasoningEffort[] = ["max", "high"];
const REASONING_OPTIONS_OFF: ReasoningEffort[] = [];

const LOCALE_OPTIONS: Locale[] = ["zh", "zh-TW", "zh-HK", "en", "ja", "ko"];

/** Memory gateway fixed port (read-only in the UI). */
const MEMORY_PORT = 8420;

/**
 * Built-in endpoint presets — fixed and immutable. Users add an apiKey to
 * enable a preset; they cannot edit the id/name/baseURL.
 */
const ENDPOINT_PRESETS: Array<Pick<EndpointConfig, "id" | "name" | "baseURL">> = [
  { id: "deepseek", name: "DeepSeek", baseURL: "https://api.deepseek.com" },
  { id: "opencode-go", name: "OpenCodeGo", baseURL: "https://opencode.ai/zen/go" },
  { id: "opencode-zen", name: "OpenCodeZen", baseURL: "https://opencode.ai/zen" },
];

/** DeepOrca desktop changelog. */
const CHANGELOG: { version: string; date: string; changes: string[] }[] = [
  {
    version: "v0.1.0",
    date: "2026-07",
    changes: [
      "基于 DeepOrca 核心引擎构建的 Electron 桌面客户端。",
      "新增 Aqua(macOS 原生)、Metro/Fluent(Windows 8 磁贴骨架)双主题体系。",
      "建立语义化 design-token 系统(--ui-* 变量),为后续主题切换奠定基础。",
    ],
  },
  {
    version: "v0.2.0",
    date: "2026-07",
    changes: [
      "CLI 能力全面移植到桌面端,新增进程输出面板、文件提及菜单。",
      "消息渲染现代化:支持思考过程、代码高亮、diff 覆盖层、可折叠工具卡。",
      "新增 Token 消耗分析面板(工作区维度统计 + bento 网格)。",
    ],
  },
  {
    version: "v0.3.0",
    date: "2026-07",
    changes: [
      "重塑品牌为 Orca,新增内置插件系统(BrowserSkill 等),与 Skills/MCP 并列的第三扩展类型。",
      "新增毛玻璃(Glass)主题,Linux 默认、macOS 可选。",
    ],
  },
  {
    version: "v0.4.0",
    date: "2026-07",
    changes: [
      "新增 Fusion 主题:融合 Win8 磁贴多彩配色 × Win11 玻璃呼吸色 × 磁铁按钮质感,Windows 专属。",
      "设置面板新增「常规」Tab,内置平台感知的主题选择(Windows: Metro/Fusion)。",
      "索引库 rail 图标独立化(☷);启动不再将当前目录强行注入为空工作区。",
    ],
  },
  {
    version: "v0.5.0",
    date: "2026-07",
    changes: [
      "集成 Monaco Editor 代码编辑器:语法高亮、智能提示、内嵌文件编辑。",
      "新增本地 GitMCP 模块:SQLite FTS5 全文索引 + BM25 排序,内置文档/代码检索工具。",
      "集成 Open Code Review 代码审查面板与 Glass Prism 主题。",
      "仓库迁移至 GitHub 主仓库并以 master 为主干分支;上线 GitHub Pages 官网与 CI 工作流。",
    ],
  },
  {
    version: "v0.6.0",
    date: "2026-07",
    changes: [
      "性能自迭代:消息 Markdown 渲染结果缓存 + 消息组件 memo 化,长会话与空闲时 CPU 占用显著下降。",
      "加载动画心跳仅在任务进行中运行;流式输出期间侧边栏刷新节流至 1.5s/次,大幅减少 IPC 往返。",
      "稳定性加固:IPC 错误统一归一化为可读信息;启动/切换工作区失败不再静默卡死,错误直接展示在输入区。",
      "资源回收:代码审查/Wiki 后台进程随应用退出自动终止,不再残留。",
      "顶栏修复:模型与思考模式下拉框按内容自适应宽度,窄窗口下不再截断文案。",
    ],
  },
];

/** Settings surface rendered inline in the main area (no modal shell). */
export function SettingsPanel({
  initial,
  initialTab,
  onSave,
  onClose,
  platform,
  theme,
  onSelectTheme,
}: Props): JSX.Element {
  const { t, locale, setLocale } = useI18n();
  const [s, setS] = useState<EditableSettings>(initial);
  const isTab = (v: string | undefined): v is Tab => TABS.some((item) => item.id === v);
  const [tab, setTab] = useState<Tab>(isTab(initialTab) ? initialTab : "endpoints");
  /** Per-endpoint apiKey show/hide toggle (keyed by endpoint id). */
  const [showKeyByEndpoint, setShowKeyByEndpoint] = useState<Record<string, boolean>>({});
  /** Memory gateway availability probe result. */
  const [memoryAvailable, setMemoryAvailable] = useState<boolean | null>(null);

  // Probe the memory gateway whenever the memory tab is opened.
  useEffect(() => {
    if (tab !== "memory") return;
    let cancelled = false;
    setMemoryAvailable(null);
    void (async () => {
      try {
        const result = await api.memoryCheckAvailable();
        if (!cancelled) setMemoryAvailable(result.available);
      } catch {
        if (!cancelled) setMemoryAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  function patch(partial: Partial<EditableSettings>): void {
    setS((prev) => ({ ...prev, ...partial }));
  }

  /** Immutable update of a single endpoint by id. */
  function updateEndpoint(id: string, changes: Partial<EndpointConfig>): void {
    setS((prev) => ({
      ...prev,
      endpoints: prev.endpoints.map((ep) => (ep.id === id ? { ...ep, ...changes } : ep)),
    }));
  }

  /** Add a new model registration under an endpoint. */
  function addModel(endpointId: string): void {
    setS((prev) => ({
      ...prev,
      endpoints: prev.endpoints.map((ep) => {
        if (ep.id !== endpointId) return ep;
        const models = ep.models ? [...ep.models] : [];
        models.push({ id: "", thinking: false, vision: false });
        return { ...ep, models };
      }),
    }));
  }

  /** Update a model registration by endpoint id + index. */
  function updateModel(endpointId: string, index: number, changes: Partial<ModelRegistration>): void {
    setS((prev) => ({
      ...prev,
      endpoints: prev.endpoints.map((ep) => {
        if (ep.id !== endpointId) return ep;
        const models = (ep.models ?? []).map((m, i) => (i === index ? { ...m, ...changes } : m));
        return { ...ep, models };
      }),
    }));
  }

  /** Remove a model registration by endpoint id + index. */
  function removeModel(endpointId: string, index: number): void {
    setS((prev) => ({
      ...prev,
      endpoints: prev.endpoints.map((ep) => {
        if (ep.id !== endpointId) return ep;
        const models = (ep.models ?? []).filter((_, i) => i !== index);
        return { ...ep, models };
      }),
    }));
  }

  function setPermission(scope: PermissionScope, decision: PermissionDecision): void {
    setS((prev) => {
      const permissions = { ...prev.permissions };
      if (decision === "default") {
        delete permissions[scope];
      } else {
        permissions[scope] = decision;
      }
      return { ...prev, permissions };
    });
  }

  /** All model keys from endpoints that have registered models. */
  const allModelKeys = collectAllModelKeys(s.endpoints);

  /** Resolve display label for a model key: "endpointName/modelId". */
  function modelLabel(key: string): string {
    const parsed = parseModelKey(key);
    if (!parsed) return key;
    const ep = s.endpoints.find((e) => e.id === parsed.endpointId);
    const epName = ep?.name || parsed.endpointId;
    return `${epName}/${parsed.modelId}`;
  }

  /**
   * Extract the bare modelId from an endpointId/modelId key.
   * If the value has no "/" (legacy bare name), returns it as-is.
   */
  function bareModelId(key: string): string {
    const parsed = parseModelKey(key);
    return parsed ? parsed.modelId : key;
  }

  /**
   * Find the model key in allModelKeys that matches the current bare model name.
   * Used to set the <Select> value from the stored bare model name.
   */
  function findKeyForModel(modelName: string): string {
    if (!modelName) return "";
    // Exact key match first
    if (allModelKeys.includes(modelName)) return modelName;
    // Find by modelId part
    for (const key of allModelKeys) {
      if (bareModelId(key) === modelName) return key;
    }
    return "";
  }

  // ── Capability resolution for the primary model ──────────────────────
  const primaryModelKey = findKeyForModel(s.model);
  const primaryCaps = resolveModelCapability(s.endpoints, primaryModelKey || s.model);
  const primaryThinkingOptions = primaryCaps.thinking ? REASONING_OPTIONS_FULL : REASONING_OPTIONS_OFF;

  // ── Capability resolution for the secondary model (independent) ──────
  const secondaryModelKey = s.secondaryModel.trim() === "" ? "" : findKeyForModel(s.secondaryModel);
  const secondaryCaps =
    s.secondaryModel.trim() === ""
      ? null // inherit from primary
      : resolveModelCapability(s.endpoints, secondaryModelKey || s.secondaryModel);

  return (
    <div className="ui-settings-panel">
      <div className="ui-settings-panel-head">
        <span className="ui-settings-panel-title">{t("settings.title")}</span>
        <div className="ui-settings-panel-actions">
          <Button variant="primary" size="sm" onClick={() => onSave(s)}>
            {t("common.save")}
          </Button>
          <Button size="sm" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>

      <div className="ui-settings-layout">
        <nav className="ui-settings-nav" aria-label={t("settings.title")}>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ui-settings-nav-item${tab === item.id ? " active" : ""}`}
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => setTab(item.id)}
            >
              <span className="ui-settings-nav-icon" aria-hidden="true">
                {TAB_ICONS[item.id]}
              </span>
              <span>{t(item.labelKey)}</span>
            </button>
          ))}
        </nav>

        <div className="ui-settings-main">
          <div className="ui-settings-target">
            {t("settings.savingTo")} <code>{s.saveTargetPath}</code> (
            {s.saveTarget === "project" ? t("settings.target.project") : t("settings.target.user")})
          </div>

          <div className="ui-settings-body">
            {/* ── Section 1: Endpoints & Models ─────────────────────────── */}
            {tab === "endpoints" ? (
              <>
                <section className="ui-settings-section">
                  <div className="ui-settings-section-title">{t("settings.endpoint.title")}</div>

                  <div className="ui-endpoint-list">
                    {ENDPOINT_PRESETS.map((preset) => {
                      // Find the live endpoint config (if it exists in settings),
                      // otherwise treat apiKey as empty.
                      const ep = s.endpoints.find((e) => e.id === preset.id);
                      const apiKey = ep?.apiKey ?? "";
                      const models = ep?.models ?? [];
                      const visible = !!showKeyByEndpoint[preset.id];

                      const onApiKeyChange = (next: string): void => {
                        updateEndpoint(preset.id, { apiKey: next });
                      };

                      return (
                        <div className="ui-endpoint-row" key={preset.id}>
                          <div className="ui-endpoint-fields">
                            <div className="ui-endpoint-preset-name">
                              <strong>{preset.name}</strong>
                              <code className="ui-endpoint-preset-url">{preset.baseURL}</code>
                            </div>

                            <div className="ui-row-inline">
                              <Input
                                type={visible ? "text" : "password"}
                                value={apiKey}
                                placeholder={t("settings.endpoint.apiKey")}
                                aria-label={t("settings.endpoint.apiKey")}
                                autoComplete="off"
                                onChange={(e) => onApiKeyChange(e.target.value)}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setShowKeyByEndpoint((prev) => ({
                                    ...prev,
                                    [preset.id]: !prev[preset.id],
                                  }))
                                }
                              >
                                {visible ? t("common.hide") : t("common.show")}
                              </Button>
                            </div>

                            {/* Model list under this endpoint */}
                            <div className="ui-endpoint-models">
                              <div className="ui-endpoint-models-title">{t("settings.endpoint.models")}</div>
                              {models.length === 0 ? (
                                <div className="ui-field-hint">{t("settings.endpoint.noModels")}</div>
                              ) : (
                                models.map((model, index) => (
                                  <div className="ui-endpoint-model-row" key={index}>
                                    <Input
                                      type="text"
                                      value={model.id}
                                      placeholder={t("settings.endpoint.modelId")}
                                      aria-label={t("settings.endpoint.modelId")}
                                      onChange={(e) => updateModel(preset.id, index, { id: e.target.value })}
                                    />
                                    <Checkbox
                                      checked={!!model.thinking}
                                      onChange={(e) =>
                                        updateModel(preset.id, index, {
                                          thinking: e.target.checked,
                                        })
                                      }
                                      label={t("settings.endpoint.thinkingCap")}
                                    />
                                    <Checkbox
                                      checked={!!model.vision}
                                      onChange={(e) =>
                                        updateModel(preset.id, index, {
                                          vision: e.target.checked,
                                        })
                                      }
                                      label={t("settings.endpoint.visionCap")}
                                    />
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => removeModel(preset.id, index)}
                                      title={t("settings.endpoint.delete")}
                                    >
                                      {t("settings.endpoint.delete")}
                                    </Button>
                                  </div>
                                ))
                              )}
                              <Button variant="ghost" size="sm" onClick={() => addModel(preset.id)}>
                                {t("settings.endpoint.addModel")}
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="ui-settings-section">
                  <div className="ui-settings-section-title">{t("settings.tab.connection")}</div>

                  <div className="ui-endpoint-role">
                    <Field label={t("settings.endpoint.primary")}>
                      <Select
                        value={s.primaryEndpointId}
                        onChange={(e) => patch({ primaryEndpointId: e.target.value })}
                      >
                        {ENDPOINT_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.name}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <Field label={t("settings.endpoint.secondary")}>
                      <Select
                        value={s.secondaryEndpointId}
                        onChange={(e) => patch({ secondaryEndpointId: e.target.value })}
                      >
                        {ENDPOINT_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                </section>
              </>
            ) : null}

            {/* ── Section 2: Model Capabilities ─────────────────────────── */}
            {tab === "model" ? (
              <section className="ui-settings-section">
                <div className="ui-settings-section-title">{t("settings.tab.model")}</div>

                {/* Primary model */}
                <div className="ui-endpoint-role">
                  <div className="ui-capabilities-group-title">{t("settings.capabilities.primary")}</div>

                  <Field label={t("settings.model")}>
                    <Select value={primaryModelKey} onChange={(e) => patch({ model: bareModelId(e.target.value) })}>
                      <option value="">{t("settings.endpoint.noModels")}</option>
                      {allModelKeys.map((key) => (
                        <option key={key} value={key}>
                          {modelLabel(key)}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label={t("settings.reasoningEffort")}>
                    <Select
                      value={s.thinkingEnabled ? s.reasoningEffort : ""}
                      disabled={primaryThinkingOptions.length === 0}
                      onChange={(e) => {
                        const value = e.target.value as ReasoningEffort | "";
                        if (value === "") {
                          patch({ thinkingEnabled: false });
                        } else {
                          patch({ thinkingEnabled: true, reasoningEffort: value });
                        }
                      }}
                    >
                      <option value="">{t("settings.capabilities.thinkingOff")}</option>
                      {primaryThinkingOptions.map((r) => (
                        <option key={r} value={r}>
                          {r === "max" ? t("model.thinkingMax") : t("model.thinkingHigh")}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label={t("settings.capabilities.vision")}>
                    <Checkbox
                      checked={primaryCaps.vision}
                      disabled={!primaryCaps.vision}
                      onChange={(e) => {
                        // Vision is derived from model capability; the toggle is
                        // informational. We keep it in settings as telemetryEnabled
                        // style flag if needed in future, but capability drives it.
                        // No-op: controlled by model registration.
                        void e;
                      }}
                      label={t("settings.capabilities.vision")}
                    />
                  </Field>

                  <Field label={t("settings.temperature")} hint={t("settings.temperatureHint")}>
                    <Input
                      type="text"
                      value={s.temperature}
                      placeholder={t("settings.temperaturePlaceholder")}
                      onChange={(e) => patch({ temperature: e.target.value })}
                    />
                  </Field>

                  <Field>
                    <Checkbox
                      checked={s.telemetryEnabled}
                      onChange={(e) => patch({ telemetryEnabled: e.target.checked })}
                      label={t("settings.telemetry")}
                    />
                  </Field>

                  <Field>
                    <Checkbox
                      checked={s.debugLogEnabled}
                      onChange={(e) => patch({ debugLogEnabled: e.target.checked })}
                      label={t("settings.debugLog")}
                    />
                  </Field>
                </div>

                {/* Secondary model (capabilities inherited from primary if not set) */}
                <div className="ui-endpoint-role">
                  <div className="ui-capabilities-group-title">{t("settings.capabilities.secondary")}</div>

                  <Field label={t("settings.secondaryModel")} hint={t("settings.secondaryModelHint")}>
                    <Select
                      value={secondaryModelKey}
                      onChange={(e) => patch({ secondaryModel: bareModelId(e.target.value) })}
                    >
                      <option value="">{t("settings.capabilities.inherit")}</option>
                      {allModelKeys.map((key) => (
                        <option key={key} value={key}>
                          {modelLabel(key)}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  {/* Secondary capability info (read-only — derived from endpoint registration) */}
                  {s.secondaryModel.trim() !== "" && secondaryCaps ? (
                    <Field label={t("settings.capabilities.vision")}>
                      <div className="ui-field-hint">
                        {t("settings.endpoint.thinkingCap")}: {secondaryCaps.thinking ? "✓" : "✗"} ·{" "}
                        {t("settings.capabilities.vision")}: {secondaryCaps.vision ? "✓" : "✗"}
                      </div>
                    </Field>
                  ) : s.secondaryModel.trim() === "" ? (
                    <div className="ui-field-hint">{t("settings.capabilities.inherit")}</div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* ── Section 3: Appearance & Theme ─────────────────────────── */}
            {tab === "appearance" ? (
              <>
                <section className="ui-settings-section">
                  <div className="ui-settings-section-title">{t("settings.appearance.theme")}</div>
                  <div className="ui-lang-grid" role="radiogroup" aria-label={t("settings.theme")}>
                    {availableThemes(platform).map((id) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={theme === id}
                        className={`ui-lang-chip${theme === id ? " active" : ""}`}
                        onClick={() => onSelectTheme(id)}
                      >
                        {t(`theme.${id}` as MessageKey)}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="ui-settings-section">
                  <div className="ui-settings-section-title">{t("settings.appearance.locale")}</div>
                  <div className="ui-lang-grid" role="radiogroup" aria-label={t("settings.language")}>
                    {LOCALE_OPTIONS.map((code) => (
                      <button
                        key={code}
                        type="button"
                        role="radio"
                        aria-checked={locale === code}
                        className={`ui-lang-chip${locale === code ? " active" : ""}`}
                        onClick={() => setLocale(code)}
                      >
                        {t(`lang.${code}` as MessageKey)}
                      </button>
                    ))}
                  </div>
                </section>
              </>
            ) : null}

            {/* ── Section 4: Memory System ──────────────────────────────── */}
            {tab === "memory" ? (
              <section className="ui-settings-section">
                <div className="ui-settings-section-title">{t("settings.tab.memory")}</div>

                <Field hint={t("settings.memory.hint")}>
                  <Checkbox
                    checked={s.memory.enabled}
                    onChange={(e) => patch({ memory: { ...s.memory, enabled: e.target.checked } })}
                    label={t("settings.memory.enable")}
                  />
                </Field>

                <Field label={t("settings.memory.port")}>
                  <Input type="text" value={String(MEMORY_PORT)} readOnly disabled />
                </Field>

                <div className="ui-field-hint ui-memory-status">
                  {memoryAvailable === null
                    ? t("settings.memory.checking")
                    : memoryAvailable
                      ? t("settings.memory.available")
                      : t("settings.memory.unavailable")}
                </div>
              </section>
            ) : null}

            {/* ── Section 5: Permission Rules ───────────────────────────── */}
            {tab === "permissions" ? (
              <section className="ui-settings-section">
                <div className="ui-settings-section-title">{t("settings.tab.permissions")}</div>
                <Field label={t("settings.defaultMode")} hint={t("settings.permHint")}>
                  <Select
                    value={s.permissionDefaultMode}
                    onChange={(e) =>
                      patch({
                        permissionDefaultMode: e.target.value as EditableSettings["permissionDefaultMode"],
                      })
                    }
                  >
                    <option value="allowAll">{t("settings.allowAll")}</option>
                    <option value="askAll">{t("settings.askAll")}</option>
                  </Select>
                </Field>

                <div className="ui-perm-list">
                  {PERMISSION_SCOPES.map((scope) => (
                    <div className="ui-perm-row" key={scope}>
                      <div className="ui-perm-label">
                        <div>{t(`permScope.${scope}.label` as MessageKey)}</div>
                        <div className="ui-field-hint">{t(`permScope.${scope}.hint` as MessageKey)}</div>
                      </div>
                      <Select
                        value={s.permissions[scope] ?? "default"}
                        onChange={(e) => setPermission(scope, e.target.value as PermissionDecision)}
                      >
                        {DECISIONS.map((d) => (
                          <option key={d} value={d}>
                            {t(`decision.${d}` as MessageKey)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {/* ── Section 6: About ──────────────────────────────────────── */}
            {tab === "about" ? (
              <>
                <section className="ui-settings-section">
                  <div className="ui-settings-section-title">{t("about.title")}</div>
                  <p className="ui-about-desc">{t("about.intro")}</p>
                  <p className="ui-about-desc">{t("about.detail")}</p>
                </section>

                <section className="ui-settings-section">
                  <div className="ui-settings-section-title">{t("about.changelog")}</div>
                  <div className="ui-changelog">
                    {/* Newest release first — the latest changes are what users came to read. */}
                    {[...CHANGELOG].reverse().map((entry) => (
                      <div key={entry.version} className="ui-changelog-entry">
                        <div className="ui-changelog-head">
                          <span className="ui-changelog-version">{entry.version}</span>
                          <span className="ui-changelog-date">{entry.date}</span>
                        </div>
                        <ul className="ui-changelog-list">
                          {entry.changes.map((change, idx) => (
                            <li key={idx}>{change}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
