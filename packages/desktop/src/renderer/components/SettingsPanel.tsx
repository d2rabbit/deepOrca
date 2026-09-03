import { useCallback, useEffect, useState, type JSX } from "react";
import type {
  EditableSettings,
  MemoryPipelineStats,
  PermissionDecision,
  PermissionScope,
  ReasoningEffort,
  EndpointQuotaResponse,
  EndpointTestResponse,
} from "../../shared/ipc";
import { collectAllModelKeys, parseModelKey, resolveModelCapability, thinkingLabelKey } from "../lib/model-utils";
import type { EndpointConfig, ModelRegistration } from "@deeporca/core";
import {
  endpointModelFamily,
  endpointQuotaKind,
  familyThinkLevels,
  resolveModelSpec,
  FAMILY_MODEL_SUGGESTIONS,
} from "@deeporca/core/capabilities";
import type { ModelFamilyId } from "@deeporca/core/capabilities";
import { api } from "../api";
import { useI18n, type Locale, type MessageKey, type Translate } from "../i18n";
import {
  Button,
  Checkbox,
  Field,
  IconBolt,
  IconBook,
  IconBot,
  IconCheck,
  IconExternal,
  IconInfo,
  IconLock,
  IconPalette,
  IconSettings,
  IconShield,
  IconSparkle,
  IconWarn,
  Input,
  Modal,
  Select,
} from "../ui/index";
import { availableThemes, type Theme } from "../lib/appearance";
import { ActionsPanel } from "./ActionsPanel";

type Props = {
  initial: EditableSettings;
  initialTab?: string;
  onSave: (next: EditableSettings) => void | Promise<void>;
  onClose: () => void;
  /** Platform string (e.g. "win32") — scopes which themes are offered. */
  platform: string;
  /** Currently active theme. */
  theme: Theme;
  /** Called when the user picks a theme in the Appearance tab. */
  onSelectTheme: (theme: Theme) => void;
  /** Reports unsaved edits upward — the HOST owns the unsaved-changes
   *  confirm so every close path (panel button, tab ✕, Esc, scrim) is
   *  guarded by the same dialog instead of only the button. */
  onDirtyChange?: (dirty: boolean) => void;
};

type Tab = "endpoints" | "model" | "entities" | "appearance" | "memory" | "permissions" | "actions" | "about";

const TABS: { id: Tab; labelKey: MessageKey }[] = [
  { id: "endpoints", labelKey: "settings.tab.endpoints" },
  { id: "model", labelKey: "settings.tab.model" },
  { id: "entities", labelKey: "settings.tab.entities" },
  { id: "appearance", labelKey: "settings.tab.appearance" },
  { id: "memory", labelKey: "settings.tab.memory" },
  { id: "permissions", labelKey: "settings.tab.permissions" },
  { id: "actions", labelKey: "settings.tab.actions" },
  { id: "about", labelKey: "settings.tab.about" },
];

const TAB_ICONS: Record<Tab, JSX.Element> = {
  endpoints: <IconBolt />,
  model: <IconSparkle />,
  entities: <IconBot />,
  appearance: <IconPalette />,
  memory: <IconBook />,
  permissions: <IconLock />,
  actions: <IconSettings />,
  about: <IconInfo />,
};

/** Human label for one endpoint probe result (model-pool 测试 button). */
function endpointTestLabel(result: EndpointTestResponse, t: Translate): string {
  switch (result.status) {
    case "ok": {
      const base = t("settings.endpoint.testOk", { ms: result.latencyMs });
      return result.modelsCount === undefined
        ? base
        : base + t("settings.endpoint.testModels", { n: result.modelsCount });
    }
    case "auth-failed":
      return t("settings.endpoint.testAuthFailed", { code: result.httpStatus ?? 0 });
    case "http-error":
      return t("settings.endpoint.testHttpError", { code: result.httpStatus ?? 0 });
    case "no-models-route":
      return t("settings.endpoint.testNoModels");
    default:
      return t("settings.endpoint.testUnreachable", { error: result.error ?? "" });
  }
}

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

/** Thinking tiers for a model — the family's actually-served scale
 * (common/think-level.ts familyThinkLevels); empty = model can't think. */
function reasoningOptionsFor(model: string, thinkingCapable: boolean): ReasoningEffort[] {
  if (!thinkingCapable) return [];
  return familyThinkLevels(resolveModelSpec({ model }).id).map((l) => l.id);
}

const LOCALE_OPTIONS: Locale[] = ["zh", "zh-TW", "zh-HK", "en", "ja", "ko"];

/**
 * Built-in endpoint presets — fixed and immutable. Users add an apiKey to
 * enable a preset; they cannot edit the id/name/baseURL. Mirrors core's
 * ENDPOINT_PRESETS (settings.ts) — keep the two in sync.
 */
const ENDPOINT_PRESETS: Array<Pick<EndpointConfig, "id" | "name" | "baseURL">> = [
  { id: "deepseek", name: "DeepSeek", baseURL: "https://api.deepseek.com" },
  // /v1 is REQUIRED by StepFun and the opencode gateways (see core settings.ts).
  { id: "stepfun", name: "StepFun", baseURL: "https://api.stepfun.com/v1" },
  { id: "stepfun-plan", name: "StepFun Plan", baseURL: "https://api.stepfun.com/step_plan/v1" },
  { id: "opencode-go", name: "OpenCodeGo", baseURL: "https://opencode.ai/zen/go/v1" },
  { id: "opencode-zen", name: "OpenCodeZen", baseURL: "https://opencode.ai/zen/v1" },
];

/**
 * Preset → family fallback for gateways whose baseURL host is not in core's
 * registry (OpenCode's zen gateways serve DeepSeek models); consumed by
 * endpointModelFamily when neither a registered model nor a host hint binds
 * the endpoint. Presets on registry hosts (deepseek/stepfun) resolve without
 * this map and are omitted.
 */
const ENDPOINT_PRESET_FAMILY: Partial<Record<string, ModelFamilyId>> = {
  "opencode-go": "deepseek",
  "opencode-zen": "deepseek",
};

/**
 * The add-model suggestion list for one endpoint — bound to the endpoint's
 * MODEL FAMILY (core's registry): StepFun endpoints suggest step-* ids,
 * DeepSeek/zen-gateway endpoints suggest deepseek-* ids. A family that can't
 * be determined (custom endpoint, no models, unknown host) falls back to the
 * union so nothing is ever un-suggestable.
 */
function modelSuggestionsFor(ep: EndpointConfig): string[] {
  const family = endpointModelFamily({
    baseURL: ep.baseURL,
    registeredModelIds: (ep.models ?? []).map((m) => m.id),
    fallback: ENDPOINT_PRESET_FAMILY[ep.id],
  });
  const known = FAMILY_MODEL_SUGGESTIONS[family];
  if (known.length > 0) return [...known];
  return [...new Set(Object.values(FAMILY_MODEL_SUGGESTIONS).flat())];
}

/**
 * DeepOrca desktop changelog — bilingual, mirroring OPEN_SOURCE_CREDITS below:
 * `changes` is zh, `en` is the English rendering; other locales fall back to
 * English.
 */
const CHANGELOG: { version: string; date: string; changes: string[]; en: string[] }[] = [
  {
    version: "v0.1.0",
    date: "2026-07",
    changes: [
      "基于 DeepCode 核心引擎构建的 Electron 桌面客户端。",
      "新增 Aqua(macOS 原生)、Metro/Fluent(Windows 8 磁贴骨架)双主题体系。",
      "建立语义化 design-token 系统(--ui-* 变量),为后续主题切换奠定基础。",
    ],
    en: [
      "Electron desktop client built on the DeepCode core engine.",
      "Dual theme system: Aqua (macOS native) and Metro/Fluent (Windows 8 tile skeleton).",
      "Semantic design-token system (--ui-* variables) as the foundation for future theming.",
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
    en: [
      "Full CLI capability port to the desktop, plus the process output panel and file mention menu.",
      "Modernized message rendering: thinking blocks, syntax highlighting, diff overlay, collapsible tool cards.",
      "Token consumption analytics panel (per-workspace stats + bento grid).",
    ],
  },
  {
    version: "v0.3.0",
    date: "2026-07",
    changes: [
      "重塑品牌为 Orca,新增内置插件系统(BrowserSkill 等),与 Skills/MCP 并列的第三扩展类型。",
      "新增毛玻璃(Glass)主题,Linux 默认、macOS 可选。",
    ],
    en: [
      "Rebranded to Orca; built-in plugin system (BrowserSkill etc.) as a third extension type beside Skills/MCP.",
      "New glassmorphism (Glass) theme — default on Linux, optional on macOS.",
    ],
  },
  {
    version: "v0.4.0",
    date: "2026-07",
    changes: [
      "新增 Fusion 主题:融合 Win8 磁贴多彩配色 × Win11 玻璃呼吸色 × 磁铁按钮质感,Windows 专属。",
      "设置面板新增「常规」Tab,内置平台感知的主题选择(Windows: Metro/Fusion)。",
      "索引库 rail 图标独立化;启动不再将当前目录强行注入为空工作区。",
    ],
    en: [
      "New Fusion theme: Win8 tile colors × Win11 glass breathing tints × magnet button feel, Windows-only.",
      "Settings gains a General tab with platform-aware theme picks (Windows: Metro/Fusion).",
      "Dedicated index-library rail icon; startup no longer injects the cwd as an empty workspace.",
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
    en: [
      "Integrated Monaco Editor: syntax highlighting, IntelliSense, in-place file editing.",
      "New local GitMCP module: SQLite FTS5 full-text index + BM25 ranking with built-in doc/code search tools.",
      "Integrated Open Code Review panel and the Glass Prism theme.",
      "Repository moved to the GitHub main repo with master as mainline; GitHub Pages site and CI workflows launched.",
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
    en: [
      "Performance self-iteration: cached markdown renders + memoized message components — much lower CPU in long sessions and at idle.",
      "Loading heartbeat only runs while a task is active; sidebar refresh throttled to 1.5s during streaming, cutting IPC round-trips.",
      "Stability hardening: normalized IPC error messages; boot/workspace-switch failures surface in the composer instead of hanging silently.",
      "Resource cleanup: review/wiki background processes terminate on app exit.",
      "Top bar fixes: model & thinking dropdowns size to content — no more truncation in narrow windows.",
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
    en: [
      "Plugin system rebuild: 7 plugin packages (meta-skills/browser/design/code/knowledge/memory/work) with skill.plugin.md as the uniform format.",
      "Memory integrated at source level: TDAI Core (L0–L3) moved from an HTTP sidecar into the in-process @deeporca/memory workspace — zero HTTP overhead.",
      "Unified index & knowledge panel: CodeGraph + OpenWiki run sequentially with a single progress-driven state and no internal tool names exposed.",
      "Settings rebuild: endpoint & model onboarding (presets + capability checkboxes), capability config (thinking/vision per endpoint), memory UI.",
      "Code review: smart-code-review skill orchestrating CRG risk analysis + OCR semantic review; architecture graphs rendered with D3.js.",
      "Vendoring unified: CodeGraph via npm, proxy fallbacks for GitHub downloads, pinned versions for BrowserSkill/Serena/CRG/Bento.",
      "Cleanup: 412 lines of dead code removed (WikiPanel/MermaidDiagram/mermaid); 15+ bugs fixed across three deep review passes.",
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
    en: [
      "DeepSeek prefix-cache hardening (Reasonix cache-first principles): day-varying date/model info moved out of the system prefix into a transient per-turn tail; system messages reordered by stability (AGENTS.md first); MCP tool definitions sorted deterministically by name. Cross-day/cross-session cache hit rates improved markedly.",
      "SkillSpector background install failures are no longer silent: diagnostic logging via the host-injected logger makes network-restricted MCP breakage tractable.",
      "Editor fixes: lazy-chunk CSS now loads (fixes the white box on CJK input); file tree switched to vector icons in VSCode style.",
      "Settings model pool redesign: flat model table + endpoint API key reuse + session action tooltips.",
      "Startup white-screen fix: SkillSpector installs asynchronously in the background; workspace list filters stale/temp dirs; 5s watchdog on quit.",
    ],
  },
  {
    version: "v0.9.0",
    date: "2026-08",
    changes: [
      "架构图模块全面重建（Archify 引擎）:五类图（架构/流程/时序/数据流/生命周期）由类型化 JSON 经确定性校验门禁（9 项 showcase 检查 + 原子提交 + 篡改回执防护）编译为自包含交互式 HTML。",
      "架构图交互与呈现:语义护照浮窗跟随所选节点;演示舞台常驻（放大铺满,不可退出）;画板跟随应用明暗实时切换;引导章节叙事、结论卡、信任边界、品牌图标（Archify/PostgreSQL/Redis 等内置标志）。",
      "架构图生成质量:扫描技能升级完整表现面（精确语义类型定配色、双行标签、grid 布局）,修复新项目首次构建崩溃、空跑覆盖好图、回执可伪造、路径穿越等 12 类问题（红蓝对抗审查）。",
      "任务式会话渲染重设计:会话以任务为单位组织展示,过程与结论层次分明。",
      "模型池端点化改造:端点卡片化管理 + 实时额度监听（StepFun 余额 / 订阅额度）,模型/思考选择修复,标题栏下拉不再被遮挡。",
      "索引构建可靠性:新项目首次构建崩溃修复;wiki 空跑自动重试且辅助模型正确继承主模型（不再落入未配置的默认模型）;失败阶段如实标注 failed/skipped,不再出现失败后仍打印完成字样的误导日志。",
      "模型故障弹窗:网络中断、鉴权失败、402 余额不足等传输类构建错误主动弹出可操作的修复指引（充值/更换模型）,不再只躺在控制台里。",
      "Wiki 能力:文档存储事务化迁移（deepwiki,坏运行不可损好文档）;每个小节的 Index 页固定排在首位;生成内容双语化;网关内容审查自动重试。",
      "后台任务安全加固:文件写入全部收口到授权目录,bash 变更命令执行前拦截,产物检查点回滚——坏一次运行结构上不可能毁掉已有成果。",
      "界面细节:工作区阅读面宽度自适应主窗口;插件详情 Markdown 补全;流程进度行双语化。",
    ],
    en: [
      "Architecture-diagram module rebuilt on the Archify engine: five diagram types (architecture/workflow/sequence/dataflow/lifecycle) compiled from typed JSON through a deterministic validation gate (9 showcase checks + atomic commit + tamper-proof receipts) into self-contained interactive HTML.",
      "Diagram interaction & presentation: the semantic passport floats beside the selected node; presentation stage stays locked (zoomed, no exit); the board follows the app light/dark live; guided chapter narratives, conclusion cards, trust boundaries and brand marks (Archify/PostgreSQL/Redis built-ins).",
      "Diagram generation quality: the scan skill now authors the full showcase surface (accurate semantic types, two-line labels, grid placement); 12 defect classes fixed via red/blue review (first-build crash, hollow-run overwrites, forgeable receipts, path traversal).",
      "Task-style session rendering redesign: sessions are organized around tasks, with process and conclusion clearly layered.",
      "Endpoint-based model pool: endpoint cards with live quota monitoring (StepFun balance / subscription limits), model & reasoning picker fixes, top-bar dropdowns no longer clipped.",
      "Index-build reliability: fixed the first-build crash on brand-new workspaces; hollow wiki runs auto-retry with the auxiliary model now correctly INHERITING the primary (no more falling into an unconfigured default); failed stages are honestly labeled failed/skipped — no success wording over failures.",
      "Model-fault dialog: transport-class build errors (network drops, auth failures, 402 insufficient balance) proactively surface an actionable fix dialog (top up / switch models) instead of hiding in the console.",
      "Wiki capability: transactional document store migration (deepwiki — a bad run can never damage good docs); every section's Index page pinned first; bilingual generation; automatic retry on gateway content moderation.",
      "Background-task security hardening: all file writes scoped to granted dirs, mutating bash commands intercepted pre-execution, artifact checkpoint rollback — a bad run is structurally unable to destroy prior results.",
      "UI details: workspace reading pane width adapts to the main window; plugin details markdown completed; build progress lines bilingualized.",
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
  {
    name: "Archify",
    zh: "架构图引擎 —— 类型化 IR 经确定性校验门禁生成自包含交互式图表(架构/流程/时序/数据流/生命周期)。",
    en: "Diagram engine — typed-IR specs compiled through a deterministic validation gate into self-contained interactive charts (architecture/workflow/sequence/dataflow/lifecycle).",
    license: "MIT",
    url: "https://github.com/tt-a1i/archify",
  },
  {
    name: "Granite Embedding",
    zh: "IBM Granite 多语言嵌入模型(97M) —— 本地语义路由与向量召回。",
    en: "IBM Granite multilingual embedding (97M) — local semantic routing and vector recall.",
    license: "Apache-2.0",
    url: "https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2",
  },
  {
    name: "dembrandt",
    zh: "品牌设计系统摄取(设计 token / 品牌规范提取)。",
    en: "Brand design-system ingestion (design tokens / brand spec extraction).",
    license: "MIT",
    url: "https://www.npmjs.com/package/dembrandt",
  },
];

/**
 * Endpoint-card quota line — quota follows the ENDPOINT. StepFun endpoints
 * show a live account balance (main probes /v1/accounts); OpenCode Go shows
 * the subscription's rolling limits (the platform has no balance API —
 * anomalyco/opencode#10448 — so static plan info is the honest surface).
 * Endpoints without a quota probe render nothing.
 */
function EndpointQuotaLine({
  baseURL,
  apiKey,
  quota,
  onRefresh,
  t,
}: {
  baseURL: string;
  apiKey: string;
  quota: EndpointQuotaResponse | "loading" | undefined;
  onRefresh: () => void;
  t: Translate;
}): JSX.Element | null {
  const kind = endpointQuotaKind(baseURL);
  if (kind === "opencode-subscription") {
    if (!quota || quota === "loading" || !quota.ok || quota.kind !== "opencode-subscription") {
      return <div className="ui-field-hint">{t("settings.opencode.quotaLoading")}</div>;
    }
    const limits = quota.limits ?? { fiveHourUsd: 12, weeklyUsd: 30, monthlyUsd: 60 };
    return (
      <div className="ui-field-hint ui-endpoint-quota">
        {t("settings.opencode.limitsLine", {
          fiveHour: `$${limits.fiveHourUsd}`,
          weekly: `$${limits.weeklyUsd}`,
          monthly: `$${limits.monthlyUsd}`,
        })}
        <span className="ui-endpoint-quota-note">{t("settings.opencode.noBalanceApi")}</span>
      </div>
    );
  }
  if (kind !== "stepfun-account") return null;
  if (!apiKey.trim()) {
    return <div className="ui-field-hint">{t("settings.stepfun.quotaNeedsKey")}</div>;
  }
  if (quota === undefined || quota === "loading") {
    return <div className="ui-field-hint">{t("settings.stepfun.quotaLoading")}</div>;
  }
  if (!quota.ok) {
    return (
      <div className="ui-field-hint warn">
        {t("settings.stepfun.quotaError")}
        {quota.error ? ` — ${quota.error}` : ""}
      </div>
    );
  }
  const time = quota.fetchedAt ? quota.fetchedAt.slice(11, 16) : "";
  return (
    <div className="ui-field-hint ui-endpoint-quota">
      {t("settings.stepfun.quotaLine", {
        balance: `¥${(quota.balance ?? 0).toFixed(2)}`,
        cash: `¥${(quota.totalCashBalance ?? 0).toFixed(2)}`,
        voucher: `¥${(quota.totalVoucherBalance ?? 0).toFixed(2)}`,
        time,
      })}
      <Button variant="ghost" size="sm" onClick={onRefresh} title={t("settings.stepfun.quotaRefresh")}>
        {t("settings.stepfun.quotaRefresh")}
      </Button>
    </div>
  );
}

export function SettingsPanel({
  initial,
  initialTab,
  onSave,
  onClose,
  platform,
  theme,
  onSelectTheme,
  onDirtyChange,
}: Props): JSX.Element {
  const { t, locale, setLocale } = useI18n();
  const [s, setS] = useState<EditableSettings>(initial);
  const isTab = (v: string | undefined): v is Tab => TABS.some((item) => item.id === v);
  const [tab, setTab] = useState<Tab>(isTab(initialTab) ? initialTab : "endpoints");
  /** Per-endpoint apiKey show/hide toggle (keyed by endpoint id). */
  const [showKeyByEndpoint, setShowKeyByEndpoint] = useState<Record<string, boolean>>({});
  // Endpoint quota (subscription/prepaid providers — quota follows the
  // ENDPOINT): refreshed whenever endpoints/keys change and every 60s while
  // the panel is open; neither provider offers a push, so polling IS the
  // "listen". StepFun probes need the endpoint's saved key; OpenCode's plan
  // limits are static and fetched once per endpoint.
  const [quotaByEndpoint, setQuotaByEndpoint] = useState<Record<string, EndpointQuotaResponse | "loading">>({});
  /** Memory gateway availability probe result. */
  const [memoryAvailable, setMemoryAvailable] = useState<boolean | null>(null);
  // Observability for the L0-L3 pipeline (channels existed with no UI):
  const [memoryStats, setMemoryStats] = useState<MemoryPipelineStats | null>(null);
  /** Pending destructive-op confirm (themed modal) — replaces the native
   *  window.confirm dialogs that rendered OS-styled and broke the theme. */
  const [confirmRemove, setConfirmRemove] = useState<{ kind: "endpoint"; id: string } | { kind: "memory" } | null>(
    null
  );
  /** Model-pool 测试 probe results, keyed by endpoint id (busy in flight). */
  const [endpointTests, setEndpointTests] = useState<
    Record<string, { busy: true } | { busy: false; result: EndpointTestResponse }>
  >({});
  const [memoryClearState, setMemoryClearState] = useState<"idle" | "busy" | "ok" | "fail">("idle");

  // ── Endpoint-first model config (conventional layout) ───────────────────
  /** Per-endpoint add-model drafts: { modelId, thinking, vision }. */
  const [addModelDrafts, setAddModelDrafts] = useState<
    Record<string, { id: string; thinking: boolean; vision: boolean }>
  >({});
  /** Per-endpoint add-model validation errors (keyed by endpoint id). */
  const [addModelErrors, setAddModelErrors] = useState<Record<string, string>>({});
  // ── Collapsible per-endpoint model list ───────────────────────────────────
  /** Model list sections start COLLAPSED; the toggle row expands them. */
  const [modelsOpenByEndpoint, setModelsOpenByEndpoint] = useState<Record<string, boolean>>({});
  /** The empty add-model form is not rendered by default — only after the
   *  header's 添加模型 button asks for it (no placeholder row otherwise). */
  const [addingModelByEndpoint, setAddingModelByEndpoint] = useState<Record<string, boolean>>({});
  // ── Add-endpoint row ──────────────────────────────────────────────────────
  const [addEpChoice, setAddEpChoice] = useState<string>(ENDPOINT_PRESETS[0].id);
  const [addEpName, setAddEpName] = useState("");
  const [addEpBase, setAddEpBase] = useState("");
  const [addEpError, setAddEpError] = useState("");

  // ── Save/close hardening ──────────────────────────────────────────────────
  // A failed updateSettings used to reject into an unhandled promise (no
  // feedback at all). Unsaved-changes confirmation is owned by the HOST via
  // onDirtyChange — see requestCloseSettings in App.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  // Report dirty-ness upward so every close path is guarded uniformly.
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(s);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [onSave, s, saving]);

  // Probe the memory gateway whenever the memory tab is opened.
  useEffect(() => {
    if (tab !== "memory") return;
    let cancelled = false;
    setMemoryAvailable(null);
    setMemoryStats(null);
    setMemoryClearState("idle");
    void (async () => {
      try {
        const result = await api.memoryCheckAvailable();
        if (!cancelled) setMemoryAvailable(result.available);
      } catch {
        if (!cancelled) setMemoryAvailable(false);
      }
      try {
        const stats = await api.memoryStats();
        if (!cancelled) setMemoryStats(stats);
      } catch {
        // stats are observability-only; absence renders nothing
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

  /** Append a model registration to one endpoint (endpoint-first cards). */
  function submitAddModelTo(endpointId: string): void {
    const draft = addModelDrafts[endpointId] ?? { id: "", thinking: true, vision: false };
    const modelId = draft.id.trim();
    const fail = (message: string): void => setAddModelErrors((prev) => ({ ...prev, [endpointId]: message }));
    if (!modelId) {
      fail(t("settings.pool.modelIdRequired"));
      return;
    }
    if (s.endpoints.find((ep) => ep.id === endpointId)?.models?.some((m) => m.id === modelId)) {
      fail(t("settings.pool.duplicateModel"));
      return;
    }
    setS((prev) => ({
      ...prev,
      endpoints: prev.endpoints.map((ep) =>
        ep.id === endpointId
          ? { ...ep, models: [...(ep.models ?? []), { id: modelId, thinking: draft.thinking, vision: draft.vision }] }
          : ep
      ),
    }));
    setAddModelDrafts((prev) => ({ ...prev, [endpointId]: { id: "", thinking: true, vision: false } }));
    setAddModelErrors((prev) => ({ ...prev, [endpointId]: "" }));
    // Success dismisses the form — the fresh row in the list is the feedback.
    setAddingModelByEndpoint((prev) => ({ ...prev, [endpointId]: false }));
  }

  /** Expand a card's model list (toggle row in the card body). */
  function toggleModels(endpointId: string): void {
    setModelsOpenByEndpoint((prev) => ({ ...prev, [endpointId]: !prev[endpointId] }));
  }

  /** Header 添加模型 button: expand the section and reveal the add-model form
   *  (clicking again while the form is open acts as its cancel). */
  function openAddModel(endpointId: string): void {
    setModelsOpenByEndpoint((prev) => ({ ...prev, [endpointId]: true }));
    setAddingModelByEndpoint((prev) => ({ ...prev, [endpointId]: !prev[endpointId] }));
    setAddModelErrors((prev) => ({ ...prev, [endpointId]: "" }));
  }

  /** Drop an endpoint card entirely (its models go with it; presets can be
   *  re-added from the add-endpoint row — updateEndpoint re-materializes).
   *  Gated by the themed confirm modal: one click removes the saved apiKey
   *  too, and unlike the sessions list there is no undo for settings edits. */
  function askRemoveEndpoint(endpointId: string): void {
    setConfirmRemove({ kind: "endpoint", id: endpointId });
  }

  /** Memory clear (L0–L3) body — also gated by the themed confirm modal. */
  async function performMemoryClear(): Promise<void> {
    setMemoryClearState("busy");
    try {
      const res = await api.memoryClear();
      setMemoryClearState(res.ok ? "ok" : "fail");
      setMemoryStats(await api.memoryStats());
    } catch {
      setMemoryClearState("fail");
    }
  }

  /** Model-pool 测试 button: probe reachability + API usability. The probe
   *  folds every failure into a typed envelope, so this never rejects. */
  const runEndpointTest = useCallback(async (endpointId: string, baseURL: string, apiKey: string): Promise<void> => {
    setEndpointTests((prev) => ({ ...prev, [endpointId]: { busy: true } }));
    const result = await api.endpointTest(baseURL, apiKey);
    setEndpointTests((prev) => ({ ...prev, [endpointId]: { busy: false, result } }));
  }, []);

  function removeEndpoint(endpointId: string): void {
    setS((prev) => ({ ...prev, endpoints: prev.endpoints.filter((ep) => ep.id !== endpointId) }));
    setAddModelDrafts((prev) => {
      const next = { ...prev };
      delete next[endpointId];
      return next;
    });
    setAddModelErrors((prev) => {
      const next = { ...prev };
      delete next[endpointId];
      return next;
    });
    setModelsOpenByEndpoint((prev) => {
      const next = { ...prev };
      delete next[endpointId];
      return next;
    });
    setAddingModelByEndpoint((prev) => {
      const next = { ...prev };
      delete next[endpointId];
      return next;
    });
    setShowKeyByEndpoint((prev) => {
      const next = { ...prev };
      delete next[endpointId];
      return next;
    });
    setQuotaByEndpoint((prev) => {
      const next = { ...prev };
      delete next[endpointId];
      return next;
    });
  }

  /** Materialize an endpoint card from a preset or a custom name+baseURL. */
  function submitAddEndpoint(): void {
    const fail = (message: string): void => setAddEpError(message);
    if (addEpChoice === "__custom") {
      const name = addEpName.trim();
      const baseURL = addEpBase.trim();
      if (!name) {
        fail(t("settings.endpoint.nameRequired"));
        return;
      }
      if (!/^https?:\/\/.+/.test(baseURL)) {
        fail(t("settings.endpoint.baseUrlInvalid"));
        return;
      }
      const slug =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "custom";
      let id = `custom-${slug}`;
      let suffix = 2;
      const taken = new Set(s.endpoints.map((ep) => ep.id));
      while (taken.has(id)) {
        id = `custom-${slug}-${suffix++}`;
      }
      // Prepend + auto-expand: the add row lives at the TOP of the section, so
      // an appended, collapsed card at the list tail reads as "nothing happened".
      setS((prev) => ({ ...prev, endpoints: [{ id, name, baseURL, apiKey: "", models: [] }, ...prev.endpoints] }));
      setModelsOpenByEndpoint((prev) => ({ ...prev, [id]: true }));
      setAddEpName("");
      setAddEpBase("");
      setAddEpError("");
      return;
    }
    if (s.endpoints.some((ep) => ep.id === addEpChoice)) {
      fail(t("settings.endpoint.exists"));
      return;
    }
    const preset = presetFor(addEpChoice);
    if (!preset) return;
    setS((prev) => ({ ...prev, endpoints: [{ ...preset, apiKey: "", models: [] }, ...prev.endpoints] }));
    setModelsOpenByEndpoint((prev) => ({ ...prev, [addEpChoice]: true }));
    setAddEpError("");
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
  const primaryThinkingOptions = reasoningOptionsFor(s.model, primaryCaps.thinking);

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

  const refreshQuota = (endpointIds: string[]): void => {
    for (const id of endpointIds) {
      setQuotaByEndpoint((prev) => (prev[id] ? prev : { ...prev, [id]: "loading" }));
      void api
        .endpointQuota(id)
        .then((res) => setQuotaByEndpoint((prev) => ({ ...prev, [id]: res })))
        .catch(() => setQuotaByEndpoint((prev) => ({ ...prev, [id]: { ok: false, error: "unreachable" } })));
    }
  };
  useEffect(() => {
    // Quota follows the endpoint: stepfun probes its account API (needs the
    // endpoint's saved key); opencode's plan limits are static, so the 60s
    // interval only re-probes stepfun entries.
    const withKind = s.endpoints.filter((ep) => {
      const kind = endpointQuotaKind(ep.baseURL);
      return kind === "stepfun-account" ? ep.apiKey.trim() !== "" : kind === "opencode-subscription";
    });
    if (withKind.length === 0) return;
    // Debounced initial probe: this effect re-runs on EVERY apiKey keystroke
    // (s.endpoints identity changes), so an immediate probe fires a request
    // per character with a partial key — surface "余额查询失败" noise while
    // the user is still typing. Wait for typing to settle instead.
    const probe = setTimeout(() => refreshQuota(withKind.map((ep) => ep.id)), 500);
    const liveIds = withKind.filter((ep) => endpointQuotaKind(ep.baseURL) === "stepfun-account").map((ep) => ep.id);
    const timer = setInterval(() => {
      if (liveIds.length > 0) refreshQuota(liveIds);
    }, 60_000);
    return () => {
      clearTimeout(probe);
      clearInterval(timer);
    };
  }, [s.endpoints]);

  const confirmRemoveTarget =
    confirmRemove?.kind === "endpoint" ? (s.endpoints.find((ep) => ep.id === confirmRemove.id) ?? null) : null;

  return (
    <div className="ui-settings-panel">
      {/* Themed destructive-op confirms — the shared Modal overlay (z100)
          layers correctly above this settings card; window.confirm rendered
          OS-styled and ignored the app theme entirely. */}
      {confirmRemoveTarget ? (
        <Modal
          onClose={() => setConfirmRemove(null)}
          title={t("settings.endpoint.deleteEndpoint")}
          subtitle={t("settings.endpoint.deleteEndpointConfirm", {
            name: confirmRemoveTarget.name || confirmRemoveTarget.id,
            count: confirmRemoveTarget.models?.length ?? 0,
          })}
          actions={
            <>
              <Button variant="subtle" size="sm" onClick={() => setConfirmRemove(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  removeEndpoint(confirmRemoveTarget.id);
                  setConfirmRemove(null);
                }}
              >
                {t("settings.endpoint.delete")}
              </Button>
            </>
          }
        />
      ) : confirmRemove?.kind === "memory" ? (
        <Modal
          onClose={() => setConfirmRemove(null)}
          title={t("settings.memory.clear")}
          subtitle={t("settings.memory.clearConfirm")}
          actions={
            <>
              <Button variant="subtle" size="sm" onClick={() => setConfirmRemove(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setConfirmRemove(null);
                  void performMemoryClear();
                }}
              >
                {t("settings.memory.clear")}
              </Button>
            </>
          }
        />
      ) : null}
      <div className="ui-settings-panel-head">
        <span className="ui-settings-panel-title">{t("settings.title")}</span>
        <div className="ui-settings-panel-actions">
          <Button variant="primary" size="sm" disabled={saving} onClick={() => void handleSave()}>
            {saving ? t("settings.saving") : t("common.save")}
          </Button>
          <Button size="sm" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
      {saveError ? <div className="ui-scm-error">{saveError}</div> : null}

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
            {/* ── Section 1: Endpoints & models (endpoint-first, conventional) ── */}
            {tab === "endpoints" ? (
              <section className="ui-settings-section">
                <div className="ui-settings-section-title">{t("settings.pool.title")}</div>
                <div className="ui-field-hint" style={{ marginBottom: 8 }}>
                  {t("settings.pool.hint")}
                </div>

                {/* Add-endpoint row — pinned to the TOP of the section. */}
                <div className="ui-endpoint-add">
                  <Field label={t("settings.endpoint.addEndpoint")}>
                    <Select value={addEpChoice} onChange={(e) => setAddEpChoice(e.target.value)}>
                      {ENDPOINT_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}
                        </option>
                      ))}
                      <option value="__custom">{t("settings.endpoint.custom")}</option>
                    </Select>
                  </Field>
                  {addEpChoice === "__custom" ? (
                    <>
                      <Field label={t("settings.endpoint.nameLabel")}>
                        <Input
                          type="text"
                          value={addEpName}
                          placeholder={t("settings.endpoint.nameLabel")}
                          aria-label={t("settings.endpoint.nameLabel")}
                          onChange={(e) => setAddEpName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") submitAddEndpoint();
                          }}
                        />
                      </Field>
                      <Field label={t("settings.endpoint.baseUrlLabel")}>
                        <Input
                          type="text"
                          value={addEpBase}
                          placeholder="https://api.example.com/v1"
                          aria-label={t("settings.endpoint.baseUrlLabel")}
                          onChange={(e) => setAddEpBase(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") submitAddEndpoint();
                          }}
                        />
                      </Field>
                    </>
                  ) : null}
                  <Button variant="primary" size="sm" onClick={submitAddEndpoint}>
                    {t("settings.endpoint.addEndpoint")}
                  </Button>
                  {addEpError ? <div className="ui-field-hint warn">{addEpError}</div> : null}
                </div>

                {s.endpoints.length === 0 ? (
                  <div className="ui-field-hint">{t("settings.pool.empty")}</div>
                ) : (
                  <div className="ui-endpoint-cards">
                    {s.endpoints.map((ep) => {
                      const preset = presetFor(ep.id);
                      const keyVisible = !!showKeyByEndpoint[ep.id];
                      const models = ep.models ?? [];
                      const modelsOpen = !!modelsOpenByEndpoint[ep.id];
                      const addingModel = !!addingModelByEndpoint[ep.id];
                      const draft = addModelDrafts[ep.id] ?? { id: "", thinking: true, vision: false };
                      const draftError = addModelErrors[ep.id] ?? "";
                      const suggestions = modelSuggestionsFor(ep);
                      const endpointTest = endpointTests[ep.id];
                      return (
                        <div className="ui-endpoint-card" key={ep.id}>
                          <div className="ui-endpoint-card-head">
                            <strong className="ui-endpoint-card-name">{ep.name || ep.id}</strong>
                            {preset ? <span className="ui-endpoint-badge">{t("settings.endpoint.preset")}</span> : null}
                            <code className="ui-endpoint-baseurl" title={ep.baseURL}>
                              {ep.baseURL}
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={endpointTest?.busy}
                              onClick={() => void runEndpointTest(ep.id, ep.baseURL, ep.apiKey ?? "")}
                            >
                              {endpointTest?.busy ? t("settings.endpoint.testing") : t("settings.endpoint.test")}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => openAddModel(ep.id)}>
                              {t("settings.endpoint.addModel")}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => askRemoveEndpoint(ep.id)}>
                              {t("settings.endpoint.deleteEndpoint")}
                            </Button>
                          </div>
                          {endpointTest && !endpointTest.busy ? (
                            <div
                              className={`ui-endpoint-test ${
                                endpointTest.result.status === "ok"
                                  ? "ok"
                                  : endpointTest.result.status === "network-error" ||
                                      endpointTest.result.status === "auth-failed"
                                    ? "error"
                                    : "warn"
                              }`}
                            >
                              {endpointTestLabel(endpointTest.result, t)}
                            </div>
                          ) : null}

                          <div className="ui-row-inline">
                            <Input
                              type={keyVisible ? "text" : "password"}
                              value={ep.apiKey ?? ""}
                              placeholder={t("settings.endpoint.apiKey")}
                              aria-label={`${ep.name || ep.id} ${t("settings.endpoint.apiKey")}`}
                              autoComplete="off"
                              onChange={(e) => updateEndpoint(ep.id, { apiKey: e.target.value })}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setShowKeyByEndpoint((prev) => ({ ...prev, [ep.id]: !prev[ep.id] }))}
                            >
                              {keyVisible ? t("common.hide") : t("common.show")}
                            </Button>
                          </div>

                          {/* Quota follows the ENDPOINT card (outside the model
                              collapse): balance/plan limits stay visible. */}
                          <EndpointQuotaLine
                            baseURL={ep.baseURL}
                            apiKey={ep.apiKey ?? ""}
                            quota={quotaByEndpoint[ep.id]}
                            onRefresh={() => refreshQuota([ep.id])}
                            t={t}
                          />

                          <button
                            type="button"
                            className="ui-endpoint-models-toggle"
                            aria-expanded={modelsOpen}
                            aria-controls={`ui-endpoint-models-${ep.id}`}
                            onClick={() => toggleModels(ep.id)}
                          >
                            <span className="ui-endpoint-chevron" aria-hidden="true">
                              {modelsOpen ? "▾" : "▸"}
                            </span>
                            {t("settings.endpoint.models")} ({models.length})
                          </button>

                          {modelsOpen ? (
                            <div className="ui-endpoint-models" id={`ui-endpoint-models-${ep.id}`}>
                              {models.map((model, index) => (
                                <div className="ui-pool-row" key={model.id}>
                                  <code className="ui-pool-model-id">{model.id}</code>
                                  <Checkbox
                                    checked={!!model.thinking}
                                    onChange={(e) => updateModel(ep.id, index, { thinking: e.target.checked })}
                                    label={t("settings.endpoint.thinkingCap")}
                                  />
                                  <Checkbox
                                    checked={!!model.vision}
                                    onChange={(e) => updateModel(ep.id, index, { vision: e.target.checked })}
                                    label={t("settings.endpoint.visionCap")}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => removeModel(ep.id, index)}
                                    title={t("settings.endpoint.delete")}
                                  >
                                    {t("settings.endpoint.delete")}
                                  </Button>
                                </div>
                              ))}

                              {/* The empty form is on-demand only — never a
                                  standing placeholder row. */}
                              {addingModel ? (
                                <>
                                  <div className="ui-row-inline">
                                    <Input
                                      type="text"
                                      value={draft.id}
                                      placeholder={t("settings.endpoint.modelId")}
                                      aria-label={`${ep.name || ep.id} ${t("settings.endpoint.modelId")}`}
                                      list={`ui-pool-model-suggestions-${ep.id}`}
                                      autoFocus
                                      onChange={(e) =>
                                        setAddModelDrafts((prev) => ({
                                          ...prev,
                                          [ep.id]: { ...draft, id: e.target.value },
                                        }))
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") submitAddModelTo(ep.id);
                                      }}
                                    />
                                    <Checkbox
                                      checked={draft.thinking}
                                      onChange={(e) =>
                                        setAddModelDrafts((prev) => ({
                                          ...prev,
                                          [ep.id]: { ...draft, thinking: e.target.checked },
                                        }))
                                      }
                                      label={t("settings.endpoint.thinkingCap")}
                                    />
                                    <Checkbox
                                      checked={draft.vision}
                                      onChange={(e) =>
                                        setAddModelDrafts((prev) => ({
                                          ...prev,
                                          [ep.id]: { ...draft, vision: e.target.checked },
                                        }))
                                      }
                                      label={t("settings.endpoint.visionCap")}
                                    />
                                    <Button variant="primary" size="sm" onClick={() => submitAddModelTo(ep.id)}>
                                      {t("settings.endpoint.addModel")}
                                    </Button>
                                  </div>
                                  {draftError ? <div className="ui-field-hint warn">{draftError}</div> : null}
                                </>
                              ) : models.length === 0 ? (
                                <div className="ui-field-hint">{t("settings.endpoint.noModels")}</div>
                              ) : null}
                            </div>
                          ) : null}

                          {/* Family-bound suggestions: this endpoint's family
                              models only (modelSuggestionsFor). */}
                          <datalist id={`ui-pool-model-suggestions-${ep.id}`}>
                            {suggestions.map((modelId) => (
                              <option key={modelId} value={modelId} />
                            ))}
                          </datalist>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
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
                      {/* "none selected" — NOT settings.endpoint.noModels, which
                          would falsely read "no models registered" while the
                          pool has entries. */}
                      <option value="">{t("settings.capabilities.none")}</option>
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
                          {t(thinkingLabelKey(r))}
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

                  <Field label={t("settings.compactThreshold")} hint={t("settings.compactThresholdHint")}>
                    <Input
                      type="text"
                      /* Stored in tokens, edited in K: the field always renders
                         a trailing "K" so no mental math is needed ("512K").
                         Everything non-numeric is stripped on input. */
                      value={
                        s.compactTokenThreshold === "" || Number(s.compactTokenThreshold) <= 0
                          ? ""
                          : `${Math.round(Number(s.compactTokenThreshold) / 1000)}K`
                      }
                      placeholder={t("settings.compactThresholdPlaceholder")}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/[^0-9.]/g, "");
                        const n = Number.parseFloat(digits);
                        patch({
                          compactTokenThreshold:
                            digits === "" || !Number.isFinite(n) || n <= 0 ? "" : String(Math.round(n * 1000)),
                        });
                      }}
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

                <Field label={t("settings.memory.embedding")} hint={t("settings.memory.embeddingHint")}>
                  <Select
                    value={s.memory.embedding ?? "none"}
                    onChange={(e) =>
                      patch({ memory: { ...s.memory, embedding: e.target.value as "none" | "local-onnx" } })
                    }
                  >
                    <option value="none">{t("settings.memory.embeddingNone")}</option>
                    <option value="local-onnx">{t("settings.memory.embeddingLocal")}</option>
                  </Select>
                </Field>

                <Field label={t("settings.memory.everyN")} hint={t("settings.memory.everyNHint")}>
                  <input
                    className="ui-input"
                    type="number"
                    min={1}
                    max={100}
                    value={s.memory.everyNConversations ?? 10}
                    onChange={(e) =>
                      patch({
                        memory: {
                          ...s.memory,
                          everyNConversations: Math.max(1, Math.min(100, Number(e.target.value) || 10)),
                        },
                      })
                    }
                  />
                </Field>

                <Field label={t("settings.memory.retention")} hint={t("settings.memory.retentionHint")}>
                  <input
                    className="ui-input"
                    type="number"
                    min={0}
                    max={3650}
                    value={s.memory.retentionDays ?? 30}
                    onChange={(e) =>
                      patch({
                        memory: {
                          ...s.memory,
                          retentionDays: Math.max(0, Math.min(3650, Number(e.target.value) || 0)),
                        },
                      })
                    }
                  />
                </Field>

                <div className="ui-field-hint ui-memory-status">
                  {memoryAvailable === null
                    ? t("settings.memory.checking")
                    : memoryAvailable
                      ? t("settings.memory.available")
                      : t("settings.memory.unavailable")}
                </div>

                {memoryStats ? (
                  <div className="ui-memory-stats">
                    <span>L0 {memoryStats.l0}</span>
                    <span>·</span>
                    <span>L1 {memoryStats.l1}</span>
                    <span>·</span>
                    <span>L2 {memoryStats.l2}</span>
                    <span>·</span>
                    <span>L3 {memoryStats.l3 ? <IconCheck /> : "—"}</span>
                  </div>
                ) : null}
                <div className="ui-memory-clear-row">
                  <button
                    type="button"
                    className="ui-memory-clear"
                    disabled={memoryClearState === "busy"}
                    onClick={() => setConfirmRemove({ kind: "memory" })}
                  >
                    {t("settings.memory.clear")}
                  </button>
                  {memoryClearState === "ok" ? (
                    <span className="ui-field-hint">{t("settings.memory.clearedOk")}</span>
                  ) : null}
                  {memoryClearState === "fail" ? (
                    <span className="ui-field-hint">{t("settings.memory.clearedFail")}</span>
                  ) : null}
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
            {/* ── 数字体（user ask 2026-09-03 十二轮 B4）────────────────────
                数字体 = 产品内的智能体（刻意不用「智能体」这个词）。这里只读
                展示已存在的内置数字体 —— 对应真实的静默子代理管线与 define-
                action 控制器；自定义能力暂不开放。 */}
            {tab === "entities" ? (
              <>
                <section className="ui-settings-section">
                  <div className="ui-settings-section-title">{t("settings.entities.title")}</div>
                  <p className="ui-about-desc">{t("settings.entities.intro")}</p>
                </section>
                <section className="ui-settings-section">
                  <div className="ui-opt-row">
                    {(
                      [
                        { icon: <IconBot />, key: "arch" },
                        { icon: <IconShield />, key: "review" },
                        { icon: <IconBook />, key: "wiki" },
                        { icon: <IconWarn />, key: "risk" },
                        { icon: <IconExternal />, key: "web" },
                      ] as const
                    ).map((agent) => (
                      <div key={agent.key} className="ui-opt entities-agent">
                        <span className="ui-settings-nav-icon" aria-hidden="true">
                          {agent.icon}
                        </span>
                        <div className="ui-settings-entity-main">
                          <div className="ui-settings-entity-head">
                            <span className="ui-settings-entity-name">
                              {t(`settings.entities.${agent.key}.name` as never)}
                            </span>
                            <span className="ui-skill-card-badge bundled">{t("settings.entities.builtin")}</span>
                          </div>
                          <div className="ui-settings-entity-desc">
                            {t(`settings.entities.${agent.key}.desc` as never)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="ui-about-desc">{t("settings.entities.customSoon")}</p>
                </section>
              </>
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
                          {(locale.startsWith("zh") ? entry.changes : entry.en).map((change, idx) => (
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
