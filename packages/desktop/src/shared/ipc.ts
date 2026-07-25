// Shared IPC contract between the Electron main process and the renderer.
// Kept dependency-free (type-only imports) so it can be bundled into both sides.

import type {
  BuiltinPluginInfo,
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
} from "@vegamo/deepcode-core";

/** Per-model token usage accounting, re-exported for renderer consumers. */
export type { ModelUsage };
import type { McpServerStatus } from "@vegamo/deepcode-core";
import type { AskPermissionRequest, UserToolPermission } from "@vegamo/deepcode-core";

/** Request/response channels (renderer -> main via ipcRenderer.invoke). */
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
  PermissionDeny: "permission:deny",
  AdjustBashTimeout: "prompt:adjustBashTimeout",

  SkillsList: "skills:list",
  SettingsGet: "settings:get",
  SettingsGetEditable: "settings:getEditable",
  SettingsUpdate: "settings:update",
  ModelSet: "model:set",

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
  GitDiff: "git:diff",
  GitLog: "git:log",
  GitCommitDiff: "git:commitDiff",

  // Agent changes (write/edit files in a session)
  AgentChangesList: "agent:changesList",
  AgentChangesDiff: "agent:changesDiff",

  // Session export
  SessionExport: "session:export",

  // CodeGraph index library
  CodegraphList: "codegraph:list",
  CodegraphReindex: "codegraph:reindex",

  // Code Review (Open Code Review / ocr CLI)
  ReviewRun: "review:run",
  ReviewCheckAvailable: "review:checkAvailable",

  // MCP management (moved out of settings into the plugin module)
  PluginMcpList: "plugin:mcpList",
  PluginSetMcpEnabled: "plugin:setMcpEnabled",
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
  CodegraphProgress: "event:codegraphProgress",
  ReviewProgress: "event:reviewProgress",
} as const;

/** Payload for the ReviewProgress event (streamed ocr output). */
export type ReviewProgressEvent = {
  /** A chunk of process output. */
  chunk: string;
  /** Which stream produced the chunk. */
  stream: "stdout" | "stderr";
  /** True when the process has exited. */
  done: boolean;
  /** Exit code, present only when done=true. */
  exitCode?: number;
};

/** A single review comment parsed from ocr JSON output. */
export type ReviewComment = {
  file: string;
  line: number;
  severity: "critical" | "warning" | "info" | string;
  message: string;
  suggestion?: string;
};

/** Options for launching a code review. */
export type ReviewOptions = {
  /** Review mode: workspace (default), branch range, or single commit. */
  mode: "workspace" | "branch" | "commit";
  /** Base ref for branch mode. */
  from?: string;
  /** Head ref for branch mode. */
  to?: string;
  /** Commit hash for commit mode. */
  commit?: string;
};

/** Payload for the CodegraphProgress event (streamed indexing output). */
export type CodegraphProgressEvent = {
  /** The workspace root being indexed. */
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

/** Resolved settings summary surfaced to the renderer (never leaks the API key). */
export type SettingsSummary = {
  model: string;
  baseURL: string;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  hasApiKey: boolean;
  statusSeparator: string;
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
  baseURL: string;
  model: string;
  /** Empty string means "unset". */
  temperature: string;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  telemetryEnabled: boolean;
  debugLogEnabled: boolean;
  permissionDefaultMode: PermissionDefaultMode;
  permissions: Partial<Record<PermissionScope, PermissionDecision>>;
  mcpServers: EditableMcpServer[];
};

export type ProcessStdoutEvent = { pid: number; chunk: string };

/** A file match for @file mention autocomplete. */
export type FileMatch = {
  path: string;
  type: "file" | "directory";
};

/** The typed surface exposed on `window.deepcode` from the preload script. */
export type DesktopApi = {
  ready(): Promise<{ projectRoot: string; platform: NodeJS.Platform }>;
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
  denyPermission(reason?: string): Promise<void>;
  adjustBashTimeout(deltaMs: number): Promise<{ timeoutMs: number } | null>;

  listSkills(sessionId?: string): Promise<SkillInfo[]>;
  getSettings(): Promise<SettingsSummary>;
  getEditableSettings(): Promise<EditableSettings>;
  updateSettings(patch: EditableSettings): Promise<{ summary: SettingsSummary; editable: EditableSettings }>;
  setModel(selection: ModelConfigSelection): Promise<SettingsSummary>;

  mcpStatus(): Promise<McpServerStatus[]>;
  mcpReconnect(name: string): Promise<void>;

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

  // ── Events ────────────────────────────────────────────────────────────────
  onAssistantMessage(cb: (message: SessionMessage) => void): () => void;
  onSessionEntryUpdated(cb: (entry: SerializableSessionEntry) => void): () => void;
  onLlmStreamProgress(cb: (progress: unknown) => void): () => void;
  onMcpStatusChanged(cb: () => void): () => void;
  onProcessStdout(cb: (event: ProcessStdoutEvent) => void): () => void;
  onProjectRootChanged(cb: (root: string) => void): () => void;
  onPluginEvent(cb: (event: PluginEventPayload) => void): () => void;

  // ── File scanning (for @file mentions) ──────────────────────────────────
  /** Scan workspace files matching a query. Returns up to 20 results. */
  scanFiles(query: string): Promise<FileMatch[]>;

  // ── Workspace-grouped sessions + archive ────────────────────────────────
  /** List all sessions across every known workspace, grouped and with archived split out. */
  listWorkspaceSessions(): Promise<WorkspaceSessions>;
  /** Mark a session archived (hidden from the main tree). */
  archiveSession(id: string): Promise<void>;
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
  gitCheckout(branch: string): Promise<{ ok: boolean; error?: string }>;
  gitDiff(file: string, staged: boolean): Promise<DiffPayload>;
  /** Recent commits (newest first), capped by `limit` (default 50). */
  gitLog(limit?: number): Promise<GitLogEntry[]>;
  /** Combined diff for a single commit (`git show`). */
  gitCommitDiff(hash: string): Promise<DiffPayload>;

  // ── Agent changes ───────────────────────────────────────────────────────
  agentChangesList(sessionId: string): Promise<AgentChangeFile[]>;
  agentChangesDiff(sessionId: string, file: string): Promise<DiffPayload>;

  // ── Session export ────────────────────────────────────────────────────────
  /** Export a session's messages as a Markdown file (save dialog). */
  exportSession(sessionId: string): Promise<{ ok: boolean; path?: string; error?: string }>;

  // ── CodeGraph index library ─────────────────────────────────────────────
  /** List every known workspace with its CodeGraph initialization state. */
  codegraphList(): Promise<CodegraphIndexEntry[]>;
  /** Re-index a workspace: removes `.codegraph/` and runs a fresh `init`. */
  codegraphReindex(root: string): Promise<{ ok: boolean; action: "reset"; error?: string }>;
  /** Subscribe to streaming codegraph indexing output. Returns unsubscribe fn. */
  onCodegraphProgress(cb: (event: CodegraphProgressEvent) => void): () => void;

  // ── Code Review (ocr) ─────────────────────────────────────────────────────
  /** Check whether the `ocr` CLI is available on PATH. */
  reviewCheckAvailable(): Promise<{ available: boolean; version?: string }>;
  /** Run a code review, streaming progress via onReviewProgress. */
  reviewRun(options: ReviewOptions): Promise<{ ok: boolean; error?: string }>;
  /** Subscribe to streaming review output. Returns unsubscribe fn. */
  onReviewProgress(cb: (event: ReviewProgressEvent) => void): () => void;

  // ── MCP management (plugin module) ──────────────────────────────────────
  /** List all MCP servers (user + built-in) with enable/runtime state. */
  pluginMcpList(): Promise<PluginMcpServer[]>;
  /** Enable or disable a server (built-ins may be disabled, never removed). */
  pluginSetMcpEnabled(name: string, enabled: boolean): Promise<void>;
};

/** A unified plugin event payload (mirrors PluginEvent from plugin-manager.ts). */
export type PluginEventPayload =
  | { type: "mcp:status-changed"; payload: McpServerStatus[] }
  | { type: "mcp:server-error"; payload: { name: string; error: string } }
  | { type: "skills:changed"; payload: SkillInfo[] }
  | { type: "plugin:error"; payload: { source: string; error: string } };

export type {
  AskPermissionRequest,
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
