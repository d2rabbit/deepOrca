// Session type vocabulary — extracted from session.ts (file-length limit).
// session.ts re-exports this surface verbatim; import from there externally.
import {
  type AlwaysAllowPaths,
  type AskPermissionRequest,
  type MessageToolPermission,
  type UserToolPermission,
} from "./common/permissions";
import { type CreateOpenAIClient, type CreateSecondaryClient } from "./tools/executor";
import { type ToolDefinition } from "./prompt";
import type { McpServerConfig, PermissionScope, PermissionSettings, RoutingSettings } from "./settings";
import type { SandboxBackendStatus } from "./sandbox/backend/interface";
import type { WebPageFetcher } from "./common/tool-types";

/** Memory provider interface — implemented by @deeporca/memory or any compatible provider. */
export interface MemoryProvider {
  recall(
    query: string,
    sessionKey: string
  ): Promise<{ prependContext?: string; appendSystemContext?: string; recallStrategy?: string } | null>;
  capture(turn: {
    userText: string;
    assistantText: string;
    sessionKey: string;
    sessionId?: string;
    /** Last user + assistant messages, so the provider can persist them to L0.
     * Each entry: { role: "user"|"assistant"|"system", content: string, id?: string, timestamp?: number(epoch-ms) }.
     * "system" entries are internal hints (task lineage / recall hints) — kept
     * in L0 for search, excluded from L1 extraction (Phase 4 / T4.3).
     * Provider falls back to synthesizing two messages from userText/assistantText when omitted. */
    messages?: Array<{ role: "user" | "assistant" | "system"; content: string; id?: string; timestamp?: number }>;
  }): Promise<unknown>;
  searchMemories(query: string, limit?: number): Promise<{ text: string; total: number } | null>;
  /**
   * Agent-callable read-only retrieval tools contributed to the LLM tool
   * surface (tdai_memory_search / tdai_conversation_search — Phase 4 / T4.1,
   * specs/memory-remediation). Optional so minimal providers keep working.
   */
  getToolDefinitions?(): ToolDefinition[];
  /** Execute one tool call from {@link getToolDefinitions}. Throws on misuse. */
  executeTool?(name: string, args: Record<string, unknown>): Promise<string>;
  isAvailable(): boolean;
}

export type ChatCompletionDebugOptions = {
  enabled?: boolean;
  location: string;
  baseURL?: string;
  params?: Record<string, unknown>;
};

export type SessionStatus =
  | "failed"
  | "pending"
  | "processing"
  | "waiting_for_user"
  | "completed"
  | "interrupted"
  | "paused"
  | "ask_permission"
  | "permission_denied";

export type ModelUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  completion_tokens_details?: Record<string, unknown>;
  prompt_tokens_details?: Record<string, unknown>;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  total_reqs?: number;
};

export type SessionProcessEntry = {
  startTime: string;
  command: string;
  timeoutMs?: number;
  deadlineAt?: string;
  timedOut?: boolean;
};

export type BashTimeoutAdjustment = {
  processId: string;
  timeoutMs: number;
  deadlineAt: string;
  timedOut: boolean;
};

export type SessionEntry = {
  id: string;
  summary: string | null;
  assistantReply: string | null;
  assistantThinking: string | null;
  assistantRefusal: string | null;
  toolCalls: unknown[] | null;
  status: SessionStatus;
  failReason: string | null;
  usage: ModelUsage | null;
  usagePerModel: Record<string, ModelUsage> | null;
  activeTokens: number;
  createTime: string;
  updateTime: string;
  processes: Map<string, SessionProcessEntry> | null; // {pid: process info}
  askPermissions?: AskPermissionRequest[];
  planMode?: boolean;
  /** Task trajectory binding (specs/task-tree P1): reverse pointer to the branch this session executes. */
  taskRef?: { treeId: string; branch: string; nodeId: string };
  /**
   * True for silent-subagent sessions (specs/index-knowledge-rework T2):
   * excluded from the session list and their messages never surface in the
   * user's conversation view — background pipelines (index.build-all
   * arch-scan) use these so workspace building leaks zero chat behavior.
   */
  isSilentSubagent?: boolean;
};

export type SessionsIndex = {
  version: 1;
  entries: SessionEntry[];
  originalPath: string;
};

export type SessionMessageRole = "system" | "user" | "assistant" | "tool";

export type MessageMeta = {
  function?: unknown;
  paramsMd?: string;
  resultMd?: string;
  asThinking?: boolean;
  isSummary?: boolean;
  isModelChange?: boolean;
  skill?: SkillInfo;
  permissions?: MessageToolPermission[];
  userPrompt?: UserPromptContent;
};

export type SessionMessage = {
  id: string;
  sessionId: string;
  role: SessionMessageRole;
  content: string | null;
  contentParams: unknown | null;
  messageParams: unknown | null;
  compacted: boolean;
  visible: boolean;
  createTime: string;
  updateTime: string;
  meta?: MessageMeta;
  html?: string;
  checkpointHash?: string;
};

export type UndoTarget = {
  message: SessionMessage;
  index: number;
  canRestoreCode: boolean;
};

export type UserPromptContent = {
  text?: string;
  imageUrls?: string[];
  skills?: SkillInfo[];
  permissions?: UserToolPermission[];
  alwaysAllows?: PermissionScope[];
  /** Path-level "always allow" (task 14): narrow grants, persisted per-path. */
  alwaysAllowPaths?: AlwaysAllowPaths;
  planMode?: boolean;
};

export type SkillInfo = {
  name: string;
  path: string;
  description: string;
  isLoaded?: boolean;
  allowImplicitInvocation?: boolean;
  /** True when this skill lives inside a plugin package (hidden from Skills tab). */
  pluginOwned?: boolean;
  /**
   * Optional compositional-routing metadata (R2 contract). All may be absent —
   * skills without them route exactly as before. Consumed by G3's Compose stage
   * (ioTypeCoercion / categoryJaccard in routing/composer.ts).
   */
  categories?: string[];
  /** Input types this skill consumes (e.g. ["markdown", "file-list"]). */
  inputs?: string[];
  /** Output types this skill produces (e.g. ["html", "pdf"]). */
  outputs?: string[];
};

/**
 * Orca built-in plugin descriptor. Built-in plugins are a first-class extension
 * type parallel to Skills and MCP servers. They ship inside the core package
 * (`templates/plugins/<name>/`) and can never be uninstalled or disabled.
 *
 * Plugin directory layout:
 *   templates/plugins/<name>/plugin.json   – manifest (name, version, category…)
 *   templates/plugins/<name>/PLUGIN.md     – instruction document injected into prompts
 */
export type BuiltinPluginInfo = {
  name: string;
  version: string;
  description: string;
  category: string;
  /** Built-in plugins are never removable. */
  removable: false;
  /** Display path, e.g. "builtin-plugin:browser-skill". */
  path: string;
};

/**
 * A built-in plugin group — the user-facing "plugin card" in the plugin center.
 * Groups unify related skills, MCP servers, and plugin descriptors that belong
 * to the same tool/service into a single displayable unit. The manifest lives
 * at `templates/builtin-plugins.json` (shipped with the product, read-only);
 * this type carries the manifest plus the *resolved* members matched at call
 * time against the live skill/MCP/plugin lists.
 */
export type BuiltinPluginGroup = {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Optional icon identifier (e.g. "flutter"); the renderer maps it to an icon. */
  icon?: string;
  /** When set, the group only loads on the matching OS. The renderer shows it
   * greyed-out on other platforms so users know the capability exists. */
  platform?: "darwin" | "linux";
  /** Skills matched into this group (from the bundled + user skill lists). */
  skills: SkillInfo[];
  /** MCP servers matched into this group (by name or `prefix:*` glob). */
  mcpServers: McpServerConfigEntry[];
  /** Built-in plugin descriptors matched into this group (by name). */
  plugins: BuiltinPluginInfo[];
  /** Actions matched into this group (by id prefix, e.g. "review.*" or "browser.*"). */
  actions: Array<{ id: string; description: string }>;
};

/** Minimal MCP server shape needed for group resolution (name + enabled). */
export type McpServerConfigEntry = {
  name: string;
  config: McpServerConfig;
  builtin?: boolean;
  /** Whether the server is enabled (not in the disabled set). For display in group cards. */
  enabled?: boolean;
  /** Connection status summary (ready/failed/connecting), if known. */
  status?: string;
};

/** Raw manifest entry in `builtin-plugins.json` (before resolution). */
export type BuiltinPluginGroupManifest = {
  id: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  platform?: "darwin" | "linux";
  skills?: string[];
  mcp?: string[];
  plugins?: string[];
  actions?: string[];
};

/**
 * The settings slice SessionManager consumes (host-injected, narrow structural
 * type — desktop passes the full resolveCurrentSettings result; tests pass the
 * minimum their fakes need).
 */
export type SessionResolvedSettings = {
  model: string;
  /** Configured endpoints (primary-family + lightweight availability checks). */
  endpoints?: ReadonlyArray<{
    id?: string;
    baseURL?: string;
    apiKey?: string;
    models?: ReadonlyArray<{ id: string }>;
  }>;
  primaryEndpointId?: string;
  /** Explicit user-configured secondary model + resolved credentials. */
  secondaryModel?: string;
  secondaryApiKey?: string;
  secondaryBaseURL?: string;
  /** User override for the compaction trigger (tokens); undefined = registry default. */
  compactTokenThreshold?: number;
  webSearchTool?: string;
  mcpServers?: Record<string, McpServerConfig>;
  permissions?: Required<PermissionSettings>;
  workspaceTrust?: "trusted" | "quarantine";
  enabledSkills?: Record<string, boolean>;
  routing?: RoutingSettings;
  visionModel?: string;
  visionApiKey?: string;
  streamIdleTimeoutMs?: number;
};

export type SessionManagerOptions = {
  projectRoot: string;
  createOpenAIClient: CreateOpenAIClient;
  /**
   * Secondary-model client factory — tier-2 fallback for background LLM tasks
   * when the primary family has no lightweight model. Defaults to the real
   * factory from openai-client; injectable for tests.
   */
  createSecondaryClient?: CreateSecondaryClient;
  /** Host-injected rendered-page fetcher for the built-in WebFetch tool. */
  fetchWebPage?: WebPageFetcher;
  getResolvedSettings: () => SessionResolvedSettings;
  renderMarkdown: (text: string) => string;
  onAssistantMessage: (message: SessionMessage, shouldConnect: boolean) => void;
  onSessionEntryUpdated?: (entry: SessionEntry) => void;
  onLlmStreamProgress?: (progress: LlmStreamProgress) => void;
  /** Behavioral-memory provider (activity-frames pipeline B, host-injected). Returns a compact context block or null. */
  buildBehaviorContext?: () => string | null;
  onMcpStatusChanged?: () => void;
  /** Sandbox backend selection outcome per session (active or degraded). */
  onSandboxStatusChanged?: (status: SandboxBackendStatus) => void;
  onProcessStdout?: (pid: number, chunk: string) => void;
};

export type LlmStreamProgress = {
  requestId: string;
  sessionId?: string;
  startedAt: string;
  estimatedTokens: number;
  formattedTokens: string;
  phase: "start" | "update" | "end";
};
