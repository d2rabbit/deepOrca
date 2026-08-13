import { useEffect, useState, type JSX } from "react";
import type { EditableSettings, PermissionDecision, PermissionScope, ReasoningEffort } from "../../shared/ipc";
import { collectAllModelKeys, parseModelKey, resolveModelCapability } from "../lib/model-utils";
import type { EndpointConfig, ModelRegistration } from "@deeporca/core";
import { api } from "../api";
import { useI18n, type Locale, type MessageKey } from "../i18n";
import { Button, Checkbox, Field, Input, Select } from "../ui/index";
import { availableThemes, type Theme } from "../lib/appearance";
import { ActionsPanel } from "./ActionsPanel";

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

type Tab = "endpoints" | "model" | "appearance" | "memory" | "permissions" | "actions" | "about";

const TABS: { id: Tab; labelKey: MessageKey }[] = [
  { id: "endpoints", labelKey: "settings.tab.endpoints" },
  { id: "model", labelKey: "settings.tab.model" },
  { id: "appearance", labelKey: "settings.tab.appearance" },
  { id: "memory", labelKey: "settings.tab.memory" },
  { id: "permissions", labelKey: "settings.tab.permissions" },
  { id: "actions", labelKey: "settings.tab.actions" },
  { id: "about", labelKey: "settings.tab.about" },
];

const TAB_ICONS: Record<Tab, string> = {
  endpoints: "⌁",
  model: "✦",
  appearance: "◐",
  memory: "❍",
  permissions: "⊘",
  actions: "⚙",
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
      "基于 DeepCode 核心引擎构建的 Electron 桌面客户端。",
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
  {
    version: "v0.7.0",
    date: "2026-08",
    changes: [
      "插件体系重构:7 个插件包目录(meta-skills/browser/design/code/knowledge/memory/work),skill.plugin.md 统一识别格式。",
      "记忆系统源码级集成:TDAI Core (L0-L3) 从 HTTP 侧车改为进程内 @deeporca/memory 工作区,零 HTTP 开销。",
      "索引与知识面板统一:CodeGraph + OpenWiki 顺序执行,单一状态,进度条驱动,不暴露内部工具名。",
      "设置面板重构:端点与模型引入(预设端点 + 模型能力勾选)、模型能力配置(思考/视觉受限于端点)、记忆系统 UI。",
      "代码审查:smart-code-review 技能编排 CRG 风险分析 + OCR 语义审查;架构图谱 D3.js 渲染。",
      "Vendor 统一:CodeGraph 改 npm 包,所有 GitHub 下载加代理兜底,BrowserSkill/Serena/CRG/Bento 版本锁定。",
      "清理:删除 WikiPanel/MermaidDiagram/mermaid 依赖等 412 行死代码;三遍深度审查修复 15+ Bug。",
    ],
  },
  {
    version: "v0.8.0",
    date: "2026-08",
    changes: [
      "DeepSeek 前缀缓存强化(借鉴 Reasonix cache-first 理念):将随天变化的日期/模型信息从系统提示前缀剥离,改为每轮瞬态注入到当前用户消息尾部;系统消息按稳定度重排序(AGENTS.md 前置);MCP 工具定义按名称确定序排序。跨天/跨会话的前缀缓存命中率显著提升。",
      "SkillSpector 后台安装失败不再静默:通过宿主注入的 logger 输出诊断日志,便于排查网络受限导致的 MCP 不可用。",
      "编辑器修复:加载懒加载 chunk 的 CSS(消除中文输入白色框);文件树改用矢量图标 + VSCode 风格。",
      "设置页模型池重设计:扁平模型表 + 端点 API Key 复用 + 会话操作 tooltip。",
      "启动白屏修复:SkillSpector 同步安装改为异步后台执行;工作区列表过滤失效/临时目录;退出增加 5s 看门狗。",
    ],
  },
];

/**
 * Open-source acknowledgements — bilingual (zh + en) with the upstream
 * repository URL for each third-party project. DeepCode is the kernel itself
 * (not third-party), so it carries no external URL.
 */
const OPEN_SOURCE_CREDITS: Array<{ name: string; zh: string; en: string; license: string; url?: string }> = [
  {
    name: "DeepCode",
    zh: "编码智能体内核 —— DeepOrca 在 DeepCode 之上衍生而来,特别致谢 DeepCode 项目。",
    en: "The coding-agent kernel DeepOrca is derived from. Special thanks to the DeepCode project.",
    license: "MIT",
  },
  {
    name: "DeepSeek-Reasonix",
    zh: "DeepSeek 原生代码智能体 —— 其 cache-first(前缀缓存优先)理念指导了 DeepOrca 的系统提示分层与缓存命中优化。",
    en: "A DeepSeek-native coding agent — its cache-first principles (stable prefix + transient turn tail) shaped DeepOrca's prompt layering and prefix-cache optimizations.",
    license: "MIT",
    url: "https://github.com/esengine/DeepSeek-Reasonix",
  },
  {
    name: "TDAI Core",
    zh: "TencentDB Agent Memory —— L0–L3 记忆管线。",
    en: "TencentDB Agent Memory — the L0–L3 memory pipeline.",
    license: "MIT",
    url: "https://github.com/TencentCloud/TencentDB-Agent-Memory",
  },
  {
    name: "CodeGraph",
    zh: "代码知识图谱与符号导航。",
    en: "Code knowledge graph & symbol navigation.",
    license: "MIT",
    url: "https://github.com/colbymchenry/codegraph",
  },
  {
    name: "Open Code Review",
    zh: "AI 驱动的代码审查(ocr CLI)。",
    en: "AI-powered code review (ocr CLI).",
    license: "Apache-2.0",
    url: "https://github.com/alibaba/open-code-review",
  },
  {
    name: "Code Review Graph",
    zh: "结构化风险分析。",
    en: "Structural risk analysis.",
    license: "MIT",
    url: "https://github.com/tirth8205/code-review-graph",
  },
  {
    name: "Serena",
    zh: "基于 SolidLSP 的语义级代码操作。",
    en: "Semantic code operations via SolidLSP.",
    license: "AGPL-3.0",
    url: "https://github.com/oraios/serena",
  },
  {
    name: "SkillSpector",
    zh: "AI Skill/MCP 安全扫描器。",
    en: "AI Skill/MCP security scanner.",
    license: "Apache-2.0",
    url: "https://github.com/NVIDIA/SkillSpector",
  },
  {
    name: "BrowserSkill",
    zh: "真实浏览器自动化。",
    en: "Real browser automation.",
    license: "Apache-2.0",
    url: "https://github.com/Tencent/BrowserSkill",
  },
  {
    name: "Bento",
    zh: "单文件办公套件。",
    en: "Single-file office suite.",
    license: "MIT",
    url: "https://github.com/nyblnet/bento",
  },
  {
    name: "uv",
    zh: "Python 包管理器。",
    en: "Python package manager.",
    license: "MIT",
    url: "https://github.com/astral-sh/uv",
  },
  {
    name: "OpenWiki",
    zh: "项目文档自动生成。",
    en: "Project documentation generation.",
    license: "MIT",
    url: "https://github.com/langchain-ai/openwiki",
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

  // ── Add-model form (model pool tab) ──────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addEndpointId, setAddEndpointId] = useState<string>(ENDPOINT_PRESETS[0].id);
  const [addModelId, setAddModelId] = useState("");
  const [addApiKey, setAddApiKey] = useState("");
  const [addThinking, setAddThinking] = useState(true);
  const [addVision, setAddVision] = useState(false);
  const [addError, setAddError] = useState("");

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

  /** Return the preset definition (id/name/baseURL) for an endpoint id, or null
   *  if it isn't one of the built-in presets. */
  function presetFor(id: string): Pick<EndpointConfig, "id" | "name" | "baseURL"> | null {
    return ENDPOINT_PRESETS.find((p) => p.id === id) ?? null;
  }

  /**
   * Immutable update of a single endpoint by id. Materializes a built-in preset
   * entry when the id does not yet exist in the list — without this, a fresh
   * install (endpoints: []) cannot add an API key or model because map() has
   * nothing to update.
   */
  function updateEndpoint(id: string, changes: Partial<EndpointConfig>): void {
    setS((prev) => {
      const exists = prev.endpoints.some((ep) => ep.id === id);
      if (exists) {
        return {
          ...prev,
          endpoints: prev.endpoints.map((ep) => (ep.id === id ? { ...ep, ...changes } : ep)),
        };
      }
      const preset = presetFor(id);
      if (!preset) {
        // Not a preset and not present — nothing to materialize.
        return prev;
      }
      const materialized: EndpointConfig = {
        ...preset,
        ...changes,
        apiKey: changes.apiKey ?? "",
        models: changes.models ?? [],
      };
      return { ...prev, endpoints: [...prev.endpoints, materialized] };
    });
  }

  /**
   * Submit the model-pool add form. The endpoint's saved key is reused — the
   * key field only appears (and is only applied) when the endpoint has none.
   */
  function submitAddModel(): void {
    const modelId = addModelId.trim();
    if (!modelId) {
      setAddError(t("settings.pool.modelIdRequired"));
      return;
    }
    const existing = s.endpoints.find((ep) => ep.id === addEndpointId);
    if (existing?.models?.some((m) => m.id === modelId)) {
      setAddError(t("settings.pool.duplicateModel"));
      return;
    }
    setS((prev) => {
      const ep = prev.endpoints.find((e) => e.id === addEndpointId);
      const registration: ModelRegistration = { id: modelId, thinking: addThinking, vision: addVision };
      if (!ep) {
        const preset = presetFor(addEndpointId);
        if (!preset) return prev;
        const materialized: EndpointConfig = { ...preset, apiKey: addApiKey.trim(), models: [registration] };
        return { ...prev, endpoints: [...prev.endpoints, materialized] };
      }
      return {
        ...prev,
        endpoints: prev.endpoints.map((e) =>
          e.id === addEndpointId
            ? {
                ...e,
                apiKey: addApiKey.trim() ? addApiKey.trim() : e.apiKey,
                models: [...(e.models ?? []), registration],
              }
            : e
        ),
      };
    });
    setAddOpen(false);
    setAddModelId("");
    setAddApiKey("");
    setAddThinking(true);
    setAddVision(false);
    setAddError("");
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

  /** Flattened model-pool entries: every registered model + its source endpoint. */
  const poolEntries = s.endpoints.flatMap((ep) =>
    (ep.models ?? []).map((model, index) => ({
      endpointId: ep.id,
      endpointName: ep.name || ep.id,
      model,
      index,
    }))
  );

  /** Whether the endpoint currently selected in the add form already has a key. */
  const addEndpointHasKey = !!s.endpoints.find((ep) => ep.id === addEndpointId)?.apiKey?.trim();

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

  // ── Capability resolution for the secondary model ─────────────────────
  // (secondaryCaps no longer rendered — the secondary controls are disabled
  // pending the P1 rollout — but secondaryModelKey is still used for the
  // disabled dropdown's selected value.)
  const secondaryModelKey = s.secondaryModel.trim() === "" ? "" : findKeyForModel(s.secondaryModel);

  // ── Vision model: filtered to vision-capable models only ─────────────
  const visionModelKey = s.visionModel.trim() === "" ? "" : findKeyForModel(s.visionModel);
  const visionModelKeys = allModelKeys.filter((key) => {
    const parsed = parseModelKey(key);
    if (!parsed) return false;
    const ep = s.endpoints.find((e) => e.id === parsed.endpointId);
    return ep?.models?.some((m) => m.id === parsed.modelId && m.vision);
  });

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
            {/* ── Section 1: Model Pool ─────────────────────────────────── */}
            {tab === "endpoints" ? (
              <>
                <section className="ui-settings-section">
                  <div className="ui-settings-section-title">{t("settings.pool.title")}</div>
                  <div className="ui-field-hint" style={{ marginBottom: 8 }}>
                    {t("settings.pool.hint")}
                  </div>

                  {poolEntries.length === 0 ? (
                    <div className="ui-field-hint">{t("settings.pool.empty")}</div>
                  ) : (
                    <div className="ui-pool-table">
                      {poolEntries.map(({ endpointId, endpointName, model, index }) => (
                        <div className="ui-pool-row" key={`${endpointId}/${model.id}/${index}`}>
                          <code className="ui-pool-model-id">{model.id}</code>
                          <span className="ui-pool-endpoint">{endpointName}</span>
                          <Checkbox
                            checked={!!model.thinking}
                            onChange={(e) => updateModel(endpointId, index, { thinking: e.target.checked })}
                            label={t("settings.endpoint.thinkingCap")}
                          />
                          <Checkbox
                            checked={!!model.vision}
                            onChange={(e) => updateModel(endpointId, index, { vision: e.target.checked })}
                            label={t("settings.endpoint.visionCap")}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeModel(endpointId, index)}
                            title={t("settings.endpoint.delete")}
                          >
                            {t("settings.endpoint.delete")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {addOpen ? (
                    <div className="ui-pool-add-form">
                      <Field label={t("settings.pool.endpoint")}>
                        <Select value={addEndpointId} onChange={(e) => setAddEndpointId(e.target.value)}>
                          {ENDPOINT_PRESETS.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.name}
                            </option>
                          ))}
                        </Select>
                      </Field>

                      {/* The endpoint's saved key is reused automatically; only
                          ask for one when the endpoint has none yet. */}
                      {!addEndpointHasKey ? (
                        <Field label={t("settings.endpoint.apiKey")}>
                          <Input
                            type="password"
                            value={addApiKey}
                            placeholder={t("settings.endpoint.apiKey")}
                            aria-label={t("settings.endpoint.apiKey")}
                            autoComplete="off"
                            onChange={(e) => setAddApiKey(e.target.value)}
                          />
                        </Field>
                      ) : null}

                      <Field label={t("settings.endpoint.modelId")} hint={t("settings.pool.modelIdHint")}>
                        <Input
                          type="text"
                          value={addModelId}
                          placeholder="deepseek-v4-pro"
                          aria-label={t("settings.endpoint.modelId")}
                          list="ui-pool-model-suggestions"
                          onChange={(e) => setAddModelId(e.target.value)}
                        />
                        <datalist id="ui-pool-model-suggestions">
                          <option value="deepseek-v4-pro" />
                          <option value="deepseek-v4-flash" />
                        </datalist>
                      </Field>

                      <div className="ui-row-inline">
                        <Checkbox
                          checked={addThinking}
                          onChange={(e) => setAddThinking(e.target.checked)}
                          label={t("settings.endpoint.thinkingCap")}
                        />
                        <Checkbox
                          checked={addVision}
                          onChange={(e) => setAddVision(e.target.checked)}
                          label={t("settings.endpoint.visionCap")}
                        />
                      </div>

                      {addError ? <div className="ui-field-hint warn">{addError}</div> : null}

                      <div className="ui-row-inline">
                        <Button variant="primary" size="sm" onClick={submitAddModel}>
                          {t("settings.endpoint.addModel")}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setAddOpen(false);
                            setAddError("");
                          }}
                        >
                          {t("common.cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setAddOpen(true)}>
                      {t("settings.endpoint.addModel")}
                    </Button>
                  )}
                </section>

                <section className="ui-settings-section">
                  <div className="ui-settings-section-title">{t("settings.pool.keys")}</div>
                  <div className="ui-field-hint" style={{ marginBottom: 8 }}>
                    {t("settings.pool.keysHint")}
                  </div>

                  <div className="ui-endpoint-list">
                    {ENDPOINT_PRESETS.map((preset) => {
                      const ep = s.endpoints.find((e) => e.id === preset.id);
                      const apiKey = ep?.apiKey ?? "";
                      const visible = !!showKeyByEndpoint[preset.id];
                      return (
                        <div className="ui-endpoint-row" key={preset.id}>
                          <div className="ui-endpoint-fields">
                            <div className="ui-endpoint-preset-name">
                              <strong>{preset.name}</strong>
                            </div>
                            <div className="ui-row-inline">
                              <Input
                                type={visible ? "text" : "password"}
                                value={apiKey}
                                placeholder={t("settings.endpoint.apiKey")}
                                aria-label={t("settings.endpoint.apiKey")}
                                autoComplete="off"
                                onChange={(e) => updateEndpoint(preset.id, { apiKey: e.target.value })}
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
                          </div>
                        </div>
                      );
                    })}
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

                {/* Secondary model — picked from the same model pool. */}
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
                </div>

                {/* Vision model — only shows models with vision capability. */}
                <div className="ui-endpoint-role">
                  <div className="ui-capabilities-group-title">{t("settings.capabilities.vision")}</div>

                  <Field label={t("settings.visionModel")} hint={t("settings.visionModelHint")}>
                    <Select
                      value={visionModelKey}
                      onChange={(e) => patch({ visionModel: bareModelId(e.target.value) })}
                    >
                      <option value="">{t("settings.capabilities.disabled")}</option>
                      {visionModelKeys.map((key) => (
                        <option key={key} value={key}>
                          {modelLabel(key)}
                        </option>
                      ))}
                    </Select>
                  </Field>
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
            {tab === "actions" ? (
              <section className="ui-settings-section" style={{ maxWidth: "none", padding: 0 }}>
                <ActionsPanel />
              </section>
            ) : null}
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

                <section className="ui-settings-section">
                  <div className="ui-settings-section-title">Open Source Credits · 开源致谢</div>
                  <div className="ui-changelog">
                    <div className="ui-changelog-entry">
                      <p className="ui-about-desc">
                        DeepOrca 站在这些优秀开源项目的肩膀上，特此致谢。
                        <br />
                        DeepOrca is built on the shoulders of these outstanding open-source projects — thank you.
                      </p>
                      <ul className="ui-credit-list">
                        {OPEN_SOURCE_CREDITS.map((credit) => (
                          <li key={credit.name} className="ui-credit-item">
                            <div className="ui-credit-head">
                              <strong>{credit.name}</strong>
                              <span className="ui-credit-license">{credit.license}</span>
                            </div>
                            <div className="ui-credit-desc">
                              {credit.zh}
                              <br />
                              {credit.en}
                            </div>
                            {credit.url ? (
                              <a
                                className="ui-credit-url"
                                href={credit.url}
                                target="_blank"
                                rel="noreferrer"
                                title={credit.url}
                              >
                                {credit.url.replace(/^https:\/\//, "")}
                              </a>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
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
