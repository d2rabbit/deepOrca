// Shared IPC contract between the Electron main process and the renderer.
// Kept dependency-free (type-only imports) so it can be bundled into both sides.

import type {
  BuiltinPluginGroup,
  BuiltinPluginInfo,
  EndpointConfig,
  ModelConfigSelection,
  ModelUsage,
  PermissionDefaultMode,
  PermissionScope,
  ReasoningEffort,
  SessionEntry,
  SessionMessage,
  SkillInfo,
  UndoTarget,
  UserPromptContent,
} from "@deeporca/core";

/** Per-model token usage accounting, re-exported for renderer consumers. */
export type { ModelUsage };
import type { McpServerStatus } from "@deeporca/core";
import type { TaskNode, TaskReflogEntry, TaskTreeIndex, TaskTreeSummary } from "@deeporca/core";
import type { AskPermissionRequest, UserToolPermission } from "@deeporca/core";

/** Request/response channels (renderer -> main via ipcRenderer.invoke). */
/** Thinking-mode-only hot update (no model change, no session system message). */
export type ThinkingModeSelection = Pick<ModelConfigSelection, "thinkingEnabled" | "reasoningEffort">;

export const IpcRequest = {
  Ready: "app:ready",
  PickFolder: "app:pickFolder",
  SetProjectRoot: "app:setProjectRoot",
  GetProjectRoot: "app:getProjectRoot",

  WindowMinimize: "window:minimize",
  WindowToggleMaximize: "window:toggleMaximize",
  WindowClose: "window:close",

  SessionList: "session:list",
  SessionGet: "session:get",
  SessionMessages: "session:messages",
  SessionSetActive: "session:setActive",
  SessionGetActive: "session:getActive",
  SessionDelete: "session:delete",
  SessionRename: "session:rename",

  PromptSend: "prompt:send",
  PromptInterrupt: "prompt:interrupt",
  PromptPause: "prompt:pause",
  PromptResume: "prompt:resume",
  PromptEnhance: "prompt:enhance",
  PermissionDeny: "permission:deny",
  AdjustBashTimeout: "prompt:adjustBashTimeout",

  SkillsList: "skills:list",
  SettingsGet: "settings:get",
  SettingsGetEditable: "settings:getEditable",
  SettingsUpdate: "settings:update",
  WorkspaceTrustGet: "workspace:getTrust",
  WorkspaceTrustSet: "workspace:setTrust",
  ModelSet: "model:set",
  ThinkingModeSet: "thinkingMode:set",
  SessionLocaleSet: "sessionLocale:set",

  McpStatus: "mcp:status",
  McpReconnect: "mcp:reconnect",

  UndoList: "undo:list",
  UndoRestore: "undo:restore",

  // Plugin channels
  PluginSearchSkills: "plugin:searchSkills",
  PluginRefreshSkills: "plugin:refreshSkills",
  PluginReadSkillDoc: "plugin:readSkillDoc",
  PluginUpsertMcpServer: "plugin:upsertMcpServer",
  PluginRemoveMcpServer: "plugin:removeMcpServer",
  PluginBuiltinList: "plugin:builtinList",
  PluginBuiltinReadDoc: "plugin:builtinReadDoc",
  PluginBuiltinGroups: "plugin:builtinGroups",

  /** Scan workspace files for @file mentions */
  ScanFiles: "app:scanFiles",

  // Workspace-grouped sessions + archive
  WorkspaceListSessions: "workspace:listSessions",
  SessionArchive: "session:archive",
  SessionUnarchive: "session:unarchive",

  // Git source control
  GitStatus: "git:status",
  GitStage: "git:stage",
  GitUnstage: "git:unstage",
  GitDiscard: "git:discard",
  GitCommit: "git:commit",
  GitCurrentBranch: "git:currentBranch",
  GitListBranches: "git:listBranches",
  GitCheckout: "git:checkout",
  GitStashCheckout: "git:stashCheckout",
  GitDiff: "git:diff",
  GitLog: "git:log",
  GitCommitDiff: "git:commitDiff",
  GitCommitFiles: "git:commitFiles",

  // Agent changes (write/edit files in a session)
  AgentChangesList: "agent:changesList",
  AgentChangesDiff: "agent:changesDiff",

  // Session export
  SessionExport: "session:export",

  // CodeGraph index library
  CodegraphList: "codegraph:list",

  // code-review-graph (CRG — analysis-layer: risk, impact, architecture)
  CrgCheckAvailable: "crg:checkAvailable",
  CrgList: "crg:list",
  CrgReindex: "crg:reindex",

  // Code review — report history + simplified in-app risk map
  ReviewListReports: "review:listReports",
  ReviewReadReport: "review:readReport",
  ReviewRiskGraph: "review:riskGraph",

  // Wiki knowledge graph (openwiki CLI)
  WikiCheckAvailable: "wiki:checkAvailable",
  WikiInit: "wiki:init",
  WikiUpdate: "wiki:update",
  WikiListPages: "wiki:listPages",
  WikiReadPage: "wiki:readPage",

  // MCP management (moved out of settings into the plugin module)
  PluginMcpList: "plugin:mcpList",
  PluginSetMcpEnabled: "plugin:setMcpEnabled",

  // GitMCP module (repository-scoped local documentation MCP servers)
  GitmcpList: "gitmcp:list",
  GitmcpAdd: "gitmcp:add",
  GitmcpRemove: "gitmcp:remove",
  GitmcpReindex: "gitmcp:reindex",

  // Editor module (Monaco code editor)
  EditorReadFile: "editor:readFile",
  EditorWriteFile: "editor:writeFile",
  EditorListFiles: "editor:listFiles",

  // Memory (in-process L0-L3 pipeline)
  MemoryCheckAvailable: "memory:checkAvailable",
  MemorySetEnabled: "memory:setEnabled",
  MemorySearch: "memory:search",
  MemoryStats: "memory:stats",
  MemoryClear: "memory:clear",

  // Knowledge dashboard — aggregated status of all knowledge sources
  KnowledgeStatus: "knowledge:status",
  EndpointQuota: "endpoint:quota",
  EndpointTest: "endpoint:test",
  MemoryRoutingStatus: "memoryRouting:status",
  KnowledgeArchRender: "knowledge:archRender",
  KnowledgeArchReadJson: "knowledge:archReadJson",
  KnowledgeOpenArchHtml: "knowledge:archOpenHtml",
  KnowledgeBuild: "knowledge:build",
  KnowledgeBuildStatus: "knowledge:buildStatus",
  KnowledgeGitPreflight: "knowledge:gitPreflight",
  KnowledgeGitBootstrap: "knowledge:gitBootstrap",
  KnowledgeReadAgents: "knowledge:readAgents",
  KnowledgeListSymbols: "knowledge:listSymbols",
  KnowledgeSymbolGraph: "knowledge:symbolGraph",

  // Designer — design artifact management (PM-Design + UI-Design)
  DesignList: "design:list",
  DesignRead: "design:read",
  DesignDelete: "design:delete",
  DesignSaveFormState: "design:saveFormState",
  DesignReadFormState: "design:readFormState",
  DesignExportPackage: "design:exportPackage",

  // Task trajectory (specs/task-tree) — panel surface (workspace-scoped)
  TaskTreeList: "tasktree:list",
  TaskTreeGet: "tasktree:get",
  TaskTreeReflog: "tasktree:reflog",
  TaskTreeTrajectory: "tasktree:trajectory",
  TaskTreeArchive: "tasktree:archive",
  TaskTreeUnarchive: "tasktree:unarchive",
  TaskTreeSnapshotRestore: "tasktree:snapshotRestore",
  TaskTreeCreate: "tasktree:create",
  TaskTreeFork: "tasktree:fork",
  TaskTreeSwitch: "tasktree:switch",
  TaskTreeAbandon: "tasktree:abandon",
  TaskTreeMerge: "tasktree:merge",

  // A2UI (Surface user interaction → agent)
  A2uiAction: "a2ui:action",
  A2uiOpenWindow: "a2ui:openWindow",
  /** Pull the initial payload for a prototype window on mount (handshake that
   *  avoids the did-finish-load race — the renderer requests its payload by the
   *  window token it was opened with). */
  A2uiRequestPayload: "a2ui:requestPayload",

  // defineAction primitive — "define once, surface everywhere" (Phase 0).
  // ActionList: introspect registered actions; ActionRun: dispatch + progress.
  ActionList: "action:list",
  ActionRun: "action:run",
} as const;

/** Event channels (main -> renderer via webContents.send). */
export const IpcEvent = {
  AssistantMessage: "event:assistantMessage",
  SessionEntryUpdated: "event:sessionEntryUpdated",
  LlmStreamProgress: "event:llmStreamProgress",
  McpStatusChanged: "event:mcpStatusChanged",
  ProcessStdout: "event:processStdout",
  ProjectRootChanged: "event:projectRootChanged",
  PluginEvent: "event:pluginEvent",
  CrgProgress: "event:crgProgress",
  WikiProgress: "event:wikiProgress",
  A2uiSurfaceUpdate: "event:a2uiSurfaceUpdate",
  A2uiWindowPayload: "event:a2uiWindowPayload",
  /** defineAction progress stream (unified; payload carries actionId). */
  ActionProgress: "event:actionProgress",
  /** Sandbox backend selection outcome per session (degradation is never silent). */
  SandboxStatusChanged: "event:sandboxStatusChanged",
  /** design-store artifact saved/deleted (payload: { root }) — panels refresh live. */
  DesignChanged: "event:designChanged",
} as const;

/** Payload for A2UI surface update event (pushed after a2ui_action mutates state). */
export type A2uiSurfaceUpdateEvent = {
  /** Updated A2UI JSON messages to re-process in the renderer. */
  a2uiJson: string;
  /** Surface ID that was updated. */
  surfaceId: string;
};

/** Payload for the initial A2UI payload sent to a popout prototype window. */
export type A2uiWindowPayloadEvent = {
  /** Initial A2UI JSON messages for the prototype window. */
  a2uiJson: string;
  /** Display title for the prototype window. */
  title: string;
};

/** A single review comment parsed from ocr JSON output. */
export type ReviewComment = {
  file: string;
  line: number;
  severity: "critical" | "warning" | "info" | string;
  message: string;
  suggestion?: string;
};

/** Payload for the WikiProgress event (streamed openwiki output). */
export type WikiProgressEvent = {
  /** The workspace root the wiki agent is running in. */
  root: string;
  /** A chunk of process output. */
  chunk: string;
  /** Which stream produced the chunk. */
  stream: "stdout" | "stderr";
  /** True when the process has exited. */
  done: boolean;
  /** Exit code, present only when done=true. */
  exitCode?: number;
};

/** A single wiki page entry from the deepwiki/ store. */
export type WikiPageEntry = {
  /** Relative path within the deepwiki/ store. */
  path: string;
  /** Display title derived from filename or first heading. */
  title: string;
  /** Last modified time (ISO) — freshness label. */
  mtime?: string;
};

/** Payload for the CrgProgress event (streamed CRG build/analysis output). */
export type CrgProgressEvent = {
  /** The workspace root being processed. */
  root: string;
  /** A chunk of process output. */
  chunk: string;
  /** Which stream produced the chunk. */
  stream: "stdout" | "stderr";
  /** True when the process has exited. */
  done: boolean;
  /** Exit code, present only when done=true. */
  exitCode?: number;
};

/** A workspace entry for the CRG index library panel. */
export type ReviewReportMeta = {
  id: string;
  generatedAt: string;
  status: string;
  filesReviewed: number;
  comments: number;
  statusNote: string;
  scopeLabel?: string;
  excludedByPolicy?: number;
  unsupportedFiles?: number;
  /** Full findings — the native report view renders these directly. */
  findings?: Array<Record<string, unknown>>;
};

export type CrgIndexEntry = {
  /** Workspace root path. */
  root: string;
  /** Display label (directory basename). */
  label: string;
  /** True when the workspace already contains a `.code-review-graph/` directory. */
  hasGraph: boolean;
};

export type UndoRestoreMode = "conversation" | "code-and-conversation";

/** A JSON-safe SessionEntry: the `processes` Map is flattened to an array. */
export type SerializableProcess = {
  pid: string;
  startTime: string;
  command: string;
  timeoutMs?: number;
  deadlineAt?: string;
};

export type SerializableSessionEntry = Omit<SessionEntry, "processes"> & {
  processes: SerializableProcess[];
  /** Desktop-only: archive state, merged from the sidecar store (never in core). */
  archived?: boolean;
  /** Desktop-only: the workspace root this session belongs to. */
  workspaceRoot?: string;
};

/** A workspace directory node grouping its (non-archived) sessions. */
export type WorkspaceGroup = {
  root: string;
  label: string;
  projectCode: string;
  sessions: SerializableSessionEntry[];
};

/** Cross-workspace session listing plus a flat archived bucket. */
export type WorkspaceSessions = {
  workspaces: WorkspaceGroup[];
  archived: Array<{ root: string; session: SerializableSessionEntry }>;
};

/** A single changed file from `git status --porcelain`. */
export type GitStatusFile = {
  path: string;
  /** Index (staged) status char, e.g. "M", "A", "D", "?". */
  index: string;
  /** Working-tree status char. */
  work: string;
  staged: boolean;
};

/** Parsed git working-tree status for a workspace. */
export type GitStatus = {
  isRepo: boolean;
  branch: string;
  files: GitStatusFile[];
};

/** A unified diff payload for one file. */
export type DiffPayload = {
  file: string;
  diff: string;
  binary: boolean;
};

/** A file mutated by the agent (write/edit) within a session. */
export type AgentChangeFile = {
  path: string;
};

/** A single commit from `git log`. */
export type GitLogEntry = {
  hash: string;
  shortHash: string;
  author: string;
  /** Short (relative) date string. */
  date: string;
  subject: string;
};

/** One file touched by a commit (`git show --name-status`). */
export type GitCommitFileEntry = {
  path: string;
  /** Git status letter: M / A / D / R… */
  status: string;
};

/** One workspace's CodeGraph index status for the index-library list. */
export type CodegraphIndexEntry = {
  root: string;
  label: string;
  /** True when the workspace already contains a `.codegraph/` directory. */
  initialized: boolean;
};

/** A managed MCP server surfaced to the plugin MCP module. */
export type PluginMcpServer = {
  name: string;
  command: string;
  /** Whitespace-separated argv tokens. */
  args: string;
  /** One KEY=VALUE per line. */
  env: string;
  /** Disabled servers are not launched by the engine. */
  enabled: boolean;
  /** Built-in servers (e.g. codegraph) may be disabled but never removed. */
  builtin: boolean;
  /** Live runtime status, when the server is connected/known to the engine. */
  status?: McpServerStatus;
};

/**
 * One GitMCP-managed repository, derived from the `gitmcp:` prefixed entries
 * in `settings.mcpServers` (which are the single source of truth) merged with
 * the disable sidecar, runtime status and local index metadata.
 */
export type GitmcpRepoEntry = {
  /** "owner/repo" */
  slug: string;
  /** "gitmcp:owner/repo" — the MCP server name (used for enable/disable). */
  serverName: string;
  enabled: boolean;
  /** Live runtime status, when the server is connected/known to the engine. */
  status?: McpServerStatus;
  /** True when the local index holds chunks for this repository. */
  indexed: boolean;
  chunkCount: number;
  /** Unix ms of the last successful fetch+index. */
  fetchedAt?: number;
};

/** Result of adding a repository to the GitMCP module. */
export type GitmcpAddResult = {
  ok: boolean;
  slug?: string;
  error?: "invalid" | "exists";
};

/**
 * Memory-pipeline LLM consumption (Phase 2, specs/memory-remediation).
 * Structurally mirrors @deeporca/memory's MemoryUsageStats — kept inline so
 * this contract file stays dependency-free.
 */
export type MemoryUsageSnapshot = {
  /** Total LLM run() invocations (successful + failed). */
  calls: number;
  failedCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  byLayer: Record<"l1" | "l2" | "l3" | "other", { calls: number; totalTokens: number }>;
};

/** L0-L3 memory pipeline counts for the knowledge dashboard. */
export type MemoryPipelineStats = {
  /** L0 — raw conversation files. */
  l0: number;
  /** L1 — extracted atomic facts. */
  l1: number;
  /** L2 — scene segments. */
  l2: number;
  /** L3 — whether the user persona has been generated. */
  l3: boolean;
  /** Secondary-model consumption of this process (undefined pre-Phase-2 hosts). */
  usage?: MemoryUsageSnapshot;
};

/** Status of a single knowledge source in the dashboard. */
export type KnowledgeSourceStatus = {
  /** indexed = ready · empty = present but no content · disabled = off · stale = needs re-sync */
  state: "indexed" | "empty" | "disabled" | "stale";
  /** Content count (symbols / pages / memories / lines). */
  count?: number;
  /** Unit label for the count ("符号" / "页" / "条" / "行"). */
  unit?: string;
  /** ISO timestamp of the last successful sync. */
  lastSync?: string;
  /** Extra detail line (e.g. "arch+modules"). */
  detail?: string;
};

/** Aggregated status of every knowledge source. */
/** One indexed symbol (R2-4): row in the symbols sub-tab. */
export type KnowledgeSymbol = {
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  signature?: string;
};

/** Display-only symbol graph (R3-6): nodes + relationships for human
 * viewing in the knowledge tab. Read straight from the CodeGraph index —
 * the MCP/agent-facing CodeGraph tools are untouched. */
export type KnowledgeSymbolGraphNode = {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  /** "focus" (query match / hub), "caller" (edge into focus), "callee" (edge out). */
  role: "focus" | "caller" | "callee";
};

export type KnowledgeSymbolGraphEdge = {
  source: string;
  target: string;
  kind: "calls" | "references" | "instantiates" | "implements";
};

export type KnowledgeSymbolGraph = {
  nodes: KnowledgeSymbolGraphNode[];
  edges: KnowledgeSymbolGraphEdge[];
  truncated: boolean;
};

/** One agent operation extracted from a task's bound sessions (task-record
 * view): tool name, ok, first-line param summary, touched files.
 * Deliberately NOT conversation content — only the operational trace. */
export type TaskTrajectoryOp = {
  at: string;
  tool: string;
  ok: boolean;
  summary?: string;
  files?: string[];
};

export type TaskTrajectory = {
  operations: TaskTrajectoryOp[];
  toolCounts: Record<string, number>;
  filesTouched: string[];
  sessionCount: number;
};

/** One pipeline stage inside a build job (symbol → wiki → arch map). */
export type KnowledgeBuildStageState = {
  /** Stable id: "codegraph" | "wiki" | "arch-scan" (echoed by the action). */
  id: string;
  /** i18n label key index ("codegraph" | "wiki" | "arch"). */
  labelKey: "codegraph" | "wiki" | "arch";
  status: "pending" | "running" | "done" | "failed" | "skipped";
  /** Last progress detail for this stage (live console line). */
  detail?: string;
  error?: string;
  startedAt?: string;
  endedAt?: string;
};

/** Main-process build job snapshot (R2-1) — rows render from these.
 * R3-5: carries structured per-stage state and a console log ring buffer so
 * the UI can show exactly WHERE a build is (the wiki stage has no progress
 * stream and used to freeze the percent at 36% for minutes). */
export type KnowledgeBuildJobSnapshot = {
  root: string;
  mode: "init" | "update";
  stage: string;
  percent: number | null;
  error: string | null;
  startedAt: string;
  /** Last activity (any progress line) — powers elapsed/liveness display. */
  updatedAt: string;
  running: boolean;
  stages: KnowledgeBuildStageState[];
  /** Console lines ("[HH:MM:SS] message", newest last); capped ring buffer. */
  logs: string[];
};

/**
 * Persisted architecture-map artifacts under `.deeporca/prototypes/`:
 * - legacy A2UI surface JSON (`arch-*.json`)
 * - Mermaid diagram documents (`arch-*.md`) — the current arch-scan output
 *   format (diagram-first; the A2UI variant rendered as a flat document).
 */

/** Git state of a workspace root, checked before a build: the wiki generator
 *  leans on commit history (its update pass diffs gitHead..HEAD), so a
 *  non-repo or an unborn HEAD needs the user's decision first — in practice
 *  the generator writes only a bare skeleton there (real-machine 2026-08-28). */
export type KnowledgeGitPreflight = { isRepo: boolean; hasCommits: boolean };

/** knowledgeGitBootstrap result — `commit` is the created HEAD (short hash). */
export type KnowledgeGitBootstrapResult = { ok: true; commit: string } | { ok: false; error: string };

/**
 * Per-workspace knowledge assets (specs/index-knowledge-rework): UI-facing
 * keys are neutral (openwiki → "Wiki"); memory/routing moved out of this
 * module. archmaps counts architecture-map artifacts.
 */
/** Per-endpoint quota surface (subscription/prepaid providers).
 *  kind=stepfun-account: live balance (GET /v1/accounts, cached 60s).
 *  kind=opencode-subscription: plan rolling limits (no balance API exists —
 *  anomalyco/opencode#10448 is still open; only the web dashboard shows it). */
export type EndpointQuotaResponse = {
  ok: boolean;
  error?: string;
  kind?: "stepfun-account" | "opencode-subscription";
  /** stepfun: prepaid | postpaid. */
  type?: "prepaid" | "postpaid";
  /** stepfun: 可用余额（元）— cash + voucher. */
  balance?: number;
  /** stepfun: 累计充值（元）. */
  totalCashBalance?: number;
  /** stepfun: 累计赠送（元）. */
  totalVoucherBalance?: number;
  /** stepfun: ISO timestamp of the probe. */
  fetchedAt?: string;
  /** opencode: rolling usage limits (USD). */
  limits?: { fiveHourUsd: number; weeklyUsd: number; monthlyUsd: number };
};

/** Endpoint connectivity probe (settings → model pool): reachability = the
 *  server answered at all; API usability = GET {baseURL}/models accepted the
 *  key (OpenAI-compatible surface). status=no-models-route means the host is
 *  reachable but exposes no /models, so API usability stays unverified. */
export type EndpointTestResponse = {
  /** Any HTTP response proves the transport path works. */
  reachable: boolean;
  /** 200 from /models — the key works and the API surface responds. */
  apiOk: boolean;
  status: "ok" | "auth-failed" | "http-error" | "no-models-route" | "network-error";
  /** HTTP status when the server answered. */
  httpStatus?: number;
  /** Round-trip milliseconds. */
  latencyMs: number;
  /** Models advertised by /models (OpenAI shape {data:[…]}), when parseable. */
  modelsCount?: number;
  /** Raw transport error for network-error (timeout / DNS / refused). */
  error?: string;
};

export type KnowledgeStatusResponse = {
  codegraph: KnowledgeSourceStatus;
  openwiki: KnowledgeSourceStatus;
  agents: KnowledgeSourceStatus;
  archmaps: KnowledgeSourceStatus & {
    files?: Array<{
      name: string;
      path: string;
      mtime: string;
      /** archify diagram type parsed from the `.<type>.json` suffix. */
      type?: string;
      /** Sibling delivered HTML (archify's validated render), when present. */
      htmlPath?: string;
    }>;
  };
};

/** Legacy shape kept for the memory/routing observability surfaces. */
export type MemoryRoutingStatus = {
  memory: KnowledgeSourceStatus & { stats?: MemoryPipelineStats };
  routing: KnowledgeSourceStatus;
  serena: KnowledgeSourceStatus;
};

// ── Task trajectory (specs/task-tree P0) ─────────────────────────────────────
export type { TaskNode, TaskReflogEntry, TaskTreeIndex, TaskTreeSummary } from "@deeporca/core";

/** Designer artifact pipeline: openui = PM-Design prototype, design = UI-Design .dd document. */
export type DesignPipeline = "openui" | "design" | "spec";

/** A stored design artifact's metadata (index entry). */
export type DesignArtifactMeta = {
  id: string;
  title: string;
  pipeline: DesignPipeline;
  createdAt: string;
  updatedAt: string;
};

/** A design artifact with full content. */
export type DesignArtifact = DesignArtifactMeta & {
  content: string;
};

/** Workspace trust level (specs/sandbox/design.md §10.3), project-level setting. */
export type WorkspaceTrustLevel = "trusted" | "quarantine";

/** Trust state as seen by the UI: `explicit: false` means never asked (first open). */
export type WorkspaceTrustStatus = {
  level: WorkspaceTrustLevel;
  explicit: boolean;
};

/** Sandbox backend outcome for one session (mirrors core SandboxBackendStatus). */
export type SandboxStatusEvent = {
  sessionId: string;
  backend: string;
  outcome: "active" | "degraded";
  detail: string;
};

/** Resolved settings summary surfaced to the renderer (never leaks the API key). */
export type SettingsSummary = {
  model: string;
  baseURL: string;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  hasApiKey: boolean;
  statusSeparator: string;
  /** Endpoint display info (no apiKey — renderer never sees keys via summary). */
  endpoints: Array<Pick<EndpointConfig, "id" | "name" | "baseURL" | "models">>;
  primaryEndpointId: string;
  secondaryModel: string;
  secondaryEndpointId: string;
  visionModel: string;
  visionEndpointId: string;
  workspaceTrust: WorkspaceTrustLevel;
  /** User override for the compaction trigger (tokens); undefined = model-family default. */
  compactTokenThreshold?: number;
};

/** A per-scope permission decision as edited in the GUI. */
export type PermissionDecision = "allow" | "ask" | "deny" | "default";

/** A single MCP server as edited in the GUI (strings are parsed on save). */
export type EditableMcpServer = {
  name: string;
  command: string;
  /** Whitespace/newline separated argv tokens. */
  args: string;
  /** One KEY=VALUE per line. */
  env: string;
};

/**
 * The raw, editable settings surfaced to the GUI config panel. Read directly from
 * the target settings file (never the env-resolved values), so saving cannot bake
 * environment-provided secrets into the file.
 */
export type EditableSettings = {
  /** Which file the panel reads from and writes to (project if it exists, else user). */
  saveTarget: "user" | "project";
  saveTargetPath: string;
  /** True when an API key is provided via environment and would override the file value. */
  hasEnvApiKey: boolean;
  apiKey: string;
  /** Primary model ID (bare name, e.g. "deepseek-v4-pro"). */
  model: string;
  /** Empty string means "unset". */
  temperature: string;
  /** Compaction trigger override in tokens, as edited ("" = unset → family default). */
  compactTokenThreshold: string;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  debugLogEnabled: boolean;
  permissionDefaultMode: PermissionDefaultMode;
  permissions: Partial<Record<PermissionScope, PermissionDecision>>;
  mcpServers: EditableMcpServer[];
  /** Multi-endpoint list (each carries its own apiKey + models for editing). */
  endpoints: EndpointConfig[];
  /** Which endpoint the primary model uses. */
  primaryEndpointId: string;
  /** Secondary model ID (bare name). Empty = inherit primary model. */
  secondaryModel: string;
  /** Which endpoint the secondary model uses. */
  secondaryEndpointId: string;
  /** Vision model ID (bare name). Empty = disabled. */
  visionModel: string;
  /** Which endpoint the vision model uses. */
  visionEndpointId: string;
  /** Memory system settings (TencentDB-Agent-Memory sidecar). */
  memory: {
    enabled: boolean;
    port: number;
    embedding: "none" | "local-onnx";
    /** Days to retain memory shards (0 = never clean). Phase 4 / T4.2. */
    retentionDays: number;
    /** Conversations per L1 extraction batch. Phase 4 / T4.5. */
    everyNConversations: number;
  };
};

export type ProcessStdoutEvent = { pid: number; chunk: string };

/** A file or directory entry for the editor file explorer. */
export type EditorFileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  /** File size in bytes (0 for directories). */
  size: number;
};

/** A file match for @file mention autocomplete. */
export type FileMatch = {
  path: string;
  type: "file" | "directory";
};

/** defineAction surface (spec §六). A registered action's introspection entry. */
export type ActionListItem = {
  id: string;
  description: string;
  category?: string;
};

/** Result of an ActionRun IPC call — success carries the action's output. */
export type ActionRunResult = { ok: true; output: unknown } | { ok: false; error: string; code: string };

/** Unified action progress event (replaces the per-tool event:*Progress family). */
export type ActionProgressEvent = {
  actionId: string;
  message: string;
  percent?: number;
  data?: unknown;
};

/** The typed surface exposed on `window.deeporca` from the preload script. */
export type DesktopApi = {
  ready(): Promise<{ projectRoot: string; platform: NodeJS.Platform; homeDir: string }>;
  pickFolder(): Promise<string | null>;
  setProjectRoot(root: string): Promise<{ projectRoot: string }>;
  getProjectRoot(): Promise<string>;

  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;

  listSessions(): Promise<SerializableSessionEntry[]>;
  getSession(id: string): Promise<SerializableSessionEntry | null>;
  listMessages(id: string): Promise<SessionMessage[]>;
  setActiveSession(id: string | null): Promise<void>;
  getActiveSession(): Promise<string | null>;
  deleteSession(id: string): Promise<boolean>;
  renameSession(id: string, summary: string): Promise<boolean>;

  sendPrompt(prompt: UserPromptContent): Promise<{ ok: boolean; error?: string }>;
  interrupt(): Promise<void>;
  /** Gracefully pause the running session at the next loop checkpoint. */
  pausePrompt(): Promise<{ sessionId: string | null }>;
  /** Resume a paused/interrupted session; resolves when the loop exits again. */
  resumePrompt(sessionId: string): Promise<{ ok: boolean; error?: string }>;
  /** Rewrite a draft prompt via the flash model (prompt enhancement). */
  enhancePrompt(text: string): Promise<{ ok: boolean; text?: string; error?: string }>;
  denyPermission(reason?: string): Promise<void>;
  adjustBashTimeout(deltaMs: number): Promise<{ timeoutMs: number } | null>;

  listSkills(sessionId?: string): Promise<SkillInfo[]>;
  getSettings(): Promise<SettingsSummary>;
  getEditableSettings(): Promise<EditableSettings>;
  updateSettings(patch: EditableSettings): Promise<{ summary: SettingsSummary; editable: EditableSettings }>;
  setModel(selection: ModelConfigSelection): Promise<SettingsSummary>;
  /** Hot-swap thinking mode — patches settings only, no model-switch bookkeeping. */
  setThinkingMode(selection: ThinkingModeSelection): Promise<SettingsSummary>;
  /** Sync the session-prompt catalog locale (core side, zh/en). */
  setSessionLocale(locale: string): void;

  mcpStatus(): Promise<McpServerStatus[]>;
  mcpReconnect(name: string): Promise<void>;

  getWorkspaceTrust(): Promise<WorkspaceTrustStatus>;
  setWorkspaceTrust(level: WorkspaceTrustLevel): Promise<void>;

  listUndoTargets(sessionId: string): Promise<UndoTarget[]>;
  restoreUndo(sessionId: string, messageId: string, mode: UndoRestoreMode): Promise<{ ok: boolean; error?: string }>;

  // ── Plugin API ────────────────────────────────────────────────────────────
  /** Search skills by keyword (name/description, case-insensitive). */
  pluginSearchSkills(query: string, sessionId?: string): Promise<SkillInfo[]>;
  /** Force-refresh skills from disk. */
  pluginRefreshSkills(sessionId?: string): Promise<SkillInfo[]>;
  /** Read a skill's raw SKILL.md markdown by its display path. */
  pluginReadSkillDoc(path: string, locale?: string): Promise<string>;
  /** Add or update an MCP server config (instant reconnect). */
  pluginUpsertMcpServer(name: string, command: string, args?: string[], env?: Record<string, string>): Promise<void>;
  /** Remove an MCP server. */
  pluginRemoveMcpServer(name: string): Promise<void>;
  /** List all built-in plugins (non-removable). */
  pluginBuiltinList(): Promise<BuiltinPluginInfo[]>;
  /** Read a built-in plugin's PLUGIN.md document by name. */
  pluginBuiltinReadDoc(name: string, locale?: string): Promise<string>;
  /** List built-in plugin groups — related skills/MCP/plugins bundled into one card. */
  pluginBuiltinGroups(): Promise<BuiltinPluginGroup[]>;

  // ── Events ────────────────────────────────────────────────────────────────
  onAssistantMessage(cb: (message: SessionMessage) => void): () => void;
  onSessionEntryUpdated(cb: (entry: SerializableSessionEntry) => void): () => void;
  onLlmStreamProgress(cb: (progress: unknown) => void): () => void;
  onMcpStatusChanged(cb: () => void): () => void;
  onProcessStdout(cb: (event: ProcessStdoutEvent) => void): () => void;
  onProjectRootChanged(cb: (root: string) => void): () => void;
  onPluginEvent(cb: (event: PluginEventPayload) => void): () => void;
  onSandboxStatusChanged(cb: (event: SandboxStatusEvent) => void): () => void;

  // ── File scanning (for @file mentions) ──────────────────────────────────
  /** Scan workspace files matching a query. Returns up to 20 results. */
  scanFiles(query: string): Promise<FileMatch[]>;

  // ── Workspace-grouped sessions + archive ────────────────────────────────
  /** List all sessions across every known workspace, grouped and with archived split out. */
  listWorkspaceSessions(): Promise<WorkspaceSessions>;
  /** Mark a session archived (hidden from the main tree). */
  archiveSession(id: string, workspaceRoot?: string): Promise<void>;
  /** Restore a session from the archive. */
  unarchiveSession(id: string): Promise<void>;

  // ── Git source control ──────────────────────────────────────────────────
  gitStatus(): Promise<GitStatus>;
  gitStage(file: string): Promise<{ ok: boolean; error?: string }>;
  gitUnstage(file: string): Promise<{ ok: boolean; error?: string }>;
  /** Discard working-tree changes for a file (`git checkout -- <file>`). */
  gitDiscard(file: string): Promise<{ ok: boolean; error?: string }>;
  gitCommit(message: string): Promise<{ ok: boolean; error?: string }>;
  gitCurrentBranch(): Promise<string>;
  gitListBranches(): Promise<string[]>;
  /** Switch branch. `conflict: true` means local changes block the checkout (commit/stash first). */
  gitCheckout(branch: string): Promise<{ ok: boolean; error?: string; conflict?: boolean }>;
  /**
   * Auto-stash local changes (incl. untracked), then switch branch. The stash is
   * popped back after a successful switch; if the pop fails, `stashWarning`
   * explains how to recover via `git stash pop` (the switch itself succeeded).
   */
  gitStashCheckout(branch: string): Promise<{ ok: boolean; error?: string; stashWarning?: string }>;
  gitDiff(file: string, staged: boolean): Promise<DiffPayload>;
  /** Recent commits (newest first), capped by `limit` (default 50). */
  gitLog(limit?: number): Promise<GitLogEntry[]>;
  /** Diff for a single commit (`git show`), optionally narrowed to one file. */
  gitCommitDiff(hash: string, file?: string): Promise<DiffPayload>;
  /** Files touched by a commit (second-level history expansion). */
  gitCommitFiles(hash: string): Promise<GitCommitFileEntry[]>;

  // ── Agent changes ───────────────────────────────────────────────────────
  agentChangesList(sessionId: string): Promise<AgentChangeFile[]>;
  agentChangesDiff(sessionId: string, file: string): Promise<DiffPayload>;

  // ── Session export ────────────────────────────────────────────────────────
  /** Export a session's messages as a Markdown file (save dialog). */
  exportSession(sessionId: string): Promise<{ ok: boolean; path?: string; error?: string }>;

  // ── CodeGraph index library ─────────────────────────────────────────────
  /** List every known workspace with its CodeGraph initialization state. */
  codegraphList(): Promise<CodegraphIndexEntry[]>;

  // ── code-review-graph (CRG — analysis-layer) ──────────────────────────────
  /** Check whether `uv`/`uvx` and code-review-graph are available. */
  crgCheckAvailable(): Promise<{ available: boolean; version?: string }>;
  /** List every known workspace with its CRG graph state. */
  crgList(): Promise<CrgIndexEntry[]>;
  /** Build (or rebuild) the CRG graph for a workspace, streaming via onCrgProgress. */
  crgReindex(root: string): Promise<{ ok: boolean; action: "reset"; error?: string }>;
  /** List a workspace's persisted review reports (newest first). */
  reviewListReports(root: string): Promise<ReviewReportMeta[]>;
  /** Read one persisted report: structured meta (with findings) + export HTML. */
  reviewReadReport(
    root: string,
    id: string
  ): Promise<{ ok: boolean; meta?: ReviewReportMeta; html?: string; error?: string }>;
  /** Build the simplified in-app risk map (self-contained HTML) for a workspace. */
  reviewRiskGraph(root: string, theme: "light" | "dark"): Promise<{ html: string | null; error?: string }>;
  /** Subscribe to streaming CRG build output. Returns unsubscribe fn. */
  onCrgProgress(cb: (event: CrgProgressEvent) => void): () => void;

  // ── Wiki knowledge graph (openwiki) ─────────────────────────────────────────
  /** Check whether the built-in (vendored) or PATH `openwiki` CLI is available. */
  wikiCheckAvailable(): Promise<{ available: boolean; version?: string }>;
  /** Generate the project wiki (openwiki --init), streaming via onWikiProgress. */
  wikiInit(): Promise<{ ok: boolean; error?: string }>;
  /** Incrementally update the project wiki (openwiki --update). */
  wikiUpdate(): Promise<{ ok: boolean; error?: string }>;
  /** List all wiki pages in the project's openwiki/ directory. */
  wikiListPages(root?: string): Promise<WikiPageEntry[]>;
  /** Read the markdown content of a wiki page. */
  wikiReadPage(path: string): Promise<string>;
  /** Subscribe to streaming wiki generation output. Returns unsubscribe fn. */
  onWikiProgress(cb: (event: WikiProgressEvent) => void): () => void;

  // ── MCP management (plugin module) ──────────────────────────────────────
  /** List all MCP servers (user + built-in) with enable/runtime state. */
  pluginMcpList(): Promise<PluginMcpServer[]>;
  /** Enable or disable a server (built-ins may be disabled, never removed). */
  pluginSetMcpEnabled(name: string, enabled: boolean): Promise<void>;

  // ── GitMCP module ──────────────────────────────────────────────────
  /** List the GitMCP-managed repositories with index + runtime state. */
  gitmcpList(): Promise<GitmcpRepoEntry[]>;
  /** Register a repository (URL or owner/repo) and activate its MCP server. */
  gitmcpAdd(input: string): Promise<GitmcpAddResult>;
  /** Remove a repository: MCP entry and its local index data. */
  gitmcpRemove(slug: string): Promise<void>;
  /** Re-fetch the repository documentation and rebuild its index. */
  gitmcpReindex(slug: string): Promise<{ ok: boolean; error?: string }>;

  // ── Editor module ─────────────────────────────────────────────────────
  /** Read a file's text content from the project root. */
  editorReadFile(filePath: string): Promise<{ ok: boolean; content?: string; error?: string; binary?: boolean }>;
  /** Write text content to a file within the project root. */
  editorWriteFile(filePath: string, content: string): Promise<{ ok: boolean; error?: string }>;
  /** List files and directories under a path within the project root. */
  editorListFiles(dirPath: string): Promise<{ ok: boolean; entries?: EditorFileEntry[]; error?: string }>;

  // ── Memory (in-process L0-L3 pipeline) ─────────────────────────────────
  /** Check whether the memory pipeline is available and healthy. */
  memoryCheckAvailable(): Promise<{ available: boolean; healthy: boolean }>;
  /** Enable or disable cross-session memory (starts/stops the in-process pipeline). */
  memorySetEnabled(enabled: boolean): Promise<{ ok: boolean; error?: string }>;
  /** Search stored memories by free-text query. */
  memorySearch(query: string, limit?: number): Promise<{ text: string; total: number }>;
  /** L0-L3 pipeline statistics for the knowledge dashboard. */
  memoryStats(): Promise<MemoryPipelineStats | null>;
  /** Clear all stored memory data for the current project (L0-L3). */
  memoryClear(): Promise<{ ok: boolean; error?: string }>;

  // ── Knowledge dashboard ────────────────────────────────────────────────
  /** Aggregated status of every knowledge source (codegraph/wiki/serena/agents/memory). */
  knowledgeStatus(root?: string): Promise<KnowledgeStatusResponse>;
  /** 端点额度查询（额度跟随端点；无额度面的端点返回 ok:false）. */
  endpointQuota(endpointId: string): Promise<EndpointQuotaResponse>;
  /** 端点连通性探测：可达性（任何 HTTP 应答）+ API 可用性（/models 鉴权）。 */
  endpointTest(baseURL: string, apiKey?: string): Promise<EndpointTestResponse>;
  /** Enumerate a workspace's wiki pages (name/path/mtime). */
  /** Deterministic archify render gate for one typed-IR artifact. */
  knowledgeArchRender(jsonPath: string): Promise<{ ok: boolean; htmlPath?: string; error?: string }>;
  /** Read a typed-IR artifact's JSON (for the in-pane dynamic map), under the
   *  same registered-root + prototypes containment as the render/open channels. */
  knowledgeArchReadJson(jsonPath: string): Promise<{ ok: boolean; json?: string; error?: string }>;
  /** Open a delivered archify HTML in the sandboxed preview window. `theme`
   *  syncs the viewer's color mode to the app appearance (2026-08-30). */
  knowledgeOpenArchHtml(htmlPath: string, theme?: "light" | "dark"): Promise<{ ok: boolean; error?: string }>;
  /** Start (or return the in-flight) background build for a root — idempotent. */
  knowledgeBuild(root: string): Promise<KnowledgeBuildJobSnapshot>;
  /** Live snapshots of all build jobs (rows render from this). */
  knowledgeBuildStatus(): Promise<KnowledgeBuildJobSnapshot[]>;
  /** Git preflight before a build: the wiki generator leans on commit history,
   *  so the panel asks before building in a repo that can't supply it. */
  knowledgeGitPreflight(root: string): Promise<KnowledgeGitPreflight>;
  /** Make the root buildable: `git init` (when absent) + stage everything +
   *  first commit. Runs ONLY on the user's explicit confirmation. */
  knowledgeGitBootstrap(root: string): Promise<KnowledgeGitBootstrapResult>;
  /** Read a workspace's AGENTS.md (root-scoped) for in-place rendering. */
  knowledgeReadAgents(root: string): Promise<{ ok: true; content: string } | { ok: false; error: string }>;
  /** Search a workspace's symbol index (kind/name/file/line), query optional. */
  knowledgeListSymbols(root: string, query?: string): Promise<Array<KnowledgeSymbol>>;
  /** Display-only symbol relationship graph (callers/callees around a focus). */
  knowledgeSymbolGraph(root: string, query?: string): Promise<KnowledgeSymbolGraph>;
  /** Memory/routing observability (moved out of the knowledge module, T4). */
  memoryRoutingStatus(): Promise<MemoryRoutingStatus>;

  // ── Designer (design artifacts) ────────────────────────────────────────
  /** List all design artifacts (PM-Design prototypes + UI-Design documents). */
  designList(): Promise<DesignArtifactMeta[]>;
  /** Read a single design artifact's full content. */
  designRead(id: string): Promise<DesignArtifact | null>;
  /** Delete a design artifact. */
  designDelete(id: string): Promise<boolean>;
  /** Persist the live prototype's form state (caller throttles). Main resolves the latest artifact of the pipeline. */
  designSaveFormState(pipeline: "openui" | "design", state: Record<string, unknown>): Promise<boolean>;
  /** Read the persisted form state for hydration; null when none. */
  designReadFormState(pipeline: "openui" | "design"): Promise<Record<string, unknown> | null>;
  /**
   * Export an artifact as a `.ddp` / `.ddu` package (P4-1 format decision
   * 2026-08-18): special ZIP archives — pm-design prototypes → `.ddp`
   * (manifest + OpenUI source + viewer stub), ui-design documents → `.ddu`
   * (manifest + `.dd` source + standalone compiled HTML). Native save dialog;
   * `ok:false` without `error` = user canceled.
   */
  designExportPackage(id: string): Promise<{ ok: boolean; path?: string; error?: string }>;

  // ── Task trajectory (read-only panel surface) ────────────────────────────
  /** List task trees (id, title, active branch, counts). */
  /** Task trees of a workspace (defaults to the ACTIVE workspace). */
  taskTreeList(workspaceRoot?: string): Promise<TaskTreeSummary[]>;
  /** Read one tree (index + all nodes) for the panel view. */
  taskTreeGet(treeId: string, workspaceRoot?: string): Promise<{ index: TaskTreeIndex; nodes: TaskNode[] } | null>;
  /** Read the tree's append-only operation journal (newest last). */
  taskTreeReflog(treeId: string, workspaceRoot?: string): Promise<TaskReflogEntry[]>;
  /** Operation trajectory extracted from the task's bound sessions. */
  taskTreeTrajectory(treeId: string, workspaceRoot?: string): Promise<TaskTrajectory | null>;
  /**
   * Archive a whole tree (never a delete — files/reflog stay). Falls back to
   * the current workspace when `workspaceRoot` is omitted.
   */
  taskTreeArchive(treeId: string, workspaceRoot?: string): Promise<boolean>;
  /** Lift a whole-tree archive (manual, from the panel). */
  taskTreeUnarchive(treeId: string, workspaceRoot?: string): Promise<boolean>;
  /**
   * Restore the working tree's artifact files to a node's snapshot (P2
   * file-history reuse). Structured `{ok, error?}` — never throws.
   */
  taskTreeSnapshotRestore(
    treeId: string,
    nodeId: string,
    workspaceRoot?: string
  ): Promise<{ ok: boolean; restored?: number; error?: string }>;
  /** Create a tree in the CURRENT workspace (prompt + why are required). */
  taskTreeCreate(prompt: string, why: string, branchName?: string): Promise<{ treeId: string } | { error: string }>;
  /** Fork a branch (why is the human-facing story; required). */
  taskTreeFork(
    treeId: string,
    why: string,
    opts?: { name?: string; fromBranch?: string },
    workspaceRoot?: string
  ): Promise<{ nodeId: string; branch: string } | { error: string }>;
  /** Switch the tree's active branch. */
  taskTreeSwitch(treeId: string, branch: string, workspaceRoot?: string): Promise<{ ok: boolean; error?: string }>;
  /** Abandon a non-active branch. */
  taskTreeAbandon(treeId: string, branch: string, workspaceRoot?: string): Promise<{ ok: boolean; error?: string }>;
  /** Merge a whole branch (all its lineage-unique nodes) onto the active branch. */
  taskTreeMerge(
    treeId: string,
    srcBranch: string,
    workspaceRoot?: string
  ): Promise<
    | { ok: true; mergeNodeId: string; conflicts: Array<{ artifactRef: string; targetTitle: string }> }
    | { ok: false; error: string }
  >;

  // ── A2UI (Surface interaction) ─────────────────────────────────────────
  /** Send a user interaction from an AUI Surface back to the agent.
   *  Returns { ok, error } so the renderer can surface failures (missing MCP
   *  server, stale surface, tool error) instead of silently doing nothing. */
  a2uiAction(
    surfaceId: string,
    actionName: string,
    context: Record<string, unknown>
  ): Promise<{ ok: boolean; error?: string }>;
  /** Open a standalone prototype preview window. */
  a2uiOpenWindow(a2uiJson: string, title: string): Promise<void>;
  /** Subscribe to A2UI surface updates (pushed after a2ui_action mutations). */
  onA2uiSurfaceUpdate(cb: (event: A2uiSurfaceUpdateEvent) => void): () => void;
  // ── defineAction surface (spec §六 — "define once, surface everywhere") ──
  /** List registered actions (introspection for a future actions panel). */
  actionList(): Promise<ActionListItem[]>;
  /** Execute an action by id; streams progress via onActionProgress. */
  actionRun(id: string, input?: unknown): Promise<ActionRunResult>;
  /** Subscribe to the unified action progress stream. Returns unsubscribe fn. */
  onActionProgress(cb: (event: ActionProgressEvent) => void): () => void;
  /** Design artifacts changed (a2ui tool saved mid-run / deleted) — live refresh. */
  onDesignChanged(cb: (event: { root: string }) => void): () => void;
  /** Subscribe to the initial payload sent to a popout prototype window. */
  onA2uiWindowPayload(cb: (event: A2uiWindowPayloadEvent) => void): () => void;
  /** Pull the initial prototype-window payload by token (race-free handshake,
   *  preferred over the push subscription). Returns null when unknown/consumed. */
  getPrototypePayload(token: string): Promise<{ a2uiJson: string; title: string } | null>;
};

/** A unified plugin event payload (mirrors PluginEvent from plugin-manager.ts). */
export type PluginEventPayload =
  | { type: "mcp:status-changed"; payload: McpServerStatus[] }
  | { type: "mcp:server-error"; payload: { name: string; error: string } }
  | { type: "skills:changed"; payload: SkillInfo[] }
  | { type: "plugin:error"; payload: { source: string; error: string } };

export type {
  AskPermissionRequest,
  BuiltinPluginGroup,
  BuiltinPluginInfo,
  McpServerStatus,
  ModelConfigSelection,
  PermissionDefaultMode,
  PermissionScope,
  ReasoningEffort,
  SessionMessage,
  SkillInfo,
  UndoTarget,
  UserPromptContent,
  UserToolPermission,
};
