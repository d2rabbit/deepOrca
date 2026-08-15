import * as fs from "fs";
import * as path from "path";
// Type-only: the fallbacks below deliberately use dynamic require() so they add
// no module-level dependency, but they still need these module shapes for typing.
import type * as NodePath from "node:path";
import type * as NodeUrl from "node:url";
import * as os from "os";
import * as crypto from "crypto";
import matter from "gray-matter";
import ejs from "ejs";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { launchNotifyScript } from "./common/notify";
import {
  buildCodegraphMcpServerConfig,
  CODEGRAPH_MCP_SERVER_NAME,
  hasCodegraphProject,
  isCodegraphDisabled,
} from "./common/codegraph";
import { getCodegraphController } from "./actions/codegraph-controller";
import { getWikiController } from "./actions/wiki-controller";
import { getCrgController } from "./actions/crg-controller";
import { configureCrgGraphQuery, createCrgGraphQuery } from "./actions/crg-query";
import { SERENA_MCP_SERVER_NAME, isSerenaDisabled } from "./common/serena-mcp";
import { getSerenaController } from "./actions/serena-controller";
import { SKILL_SPECTOR_MCP_SERVER_NAME, isSkillSpectorDisabled } from "./common/skill-spector";
import { getSkillSpectorController } from "./actions/skill-spector-controller";
import { A2UI_MCP_SERVER_NAME, isA2uiDisabled, getA2uiServerBuilder, type A2uiLifecycle } from "./mcp/a2ui-seam";
import { ACTIVITY_FRAMES_MCP_SERVER_NAME, getActivityFramesServerBuilder } from "./mcp/activity-frames-seam";
import { VISION_MCP_SERVER_NAME, getVisionServerBuilder } from "./mcp/vision-seam";
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
     * Each entry: { role: "user"|"assistant", content: string, id?: string, timestamp?: number(epoch-ms) }.
     * Provider falls back to synthesizing two messages from userText/assistantText when omitted. */
    messages?: Array<{ role: "user" | "assistant"; content: string; id?: string; timestamp?: number }>;
  }): Promise<unknown>;
  searchMemories(query: string, limit?: number): Promise<{ text: string; total: number } | null>;
  isAvailable(): boolean;
}
import { gitmcpSlugFromServerName, isGitmcpPlaceholderConfig, isGitmcpServerName } from "./gitmcp/resolve";
import { getGitmcpConfigBuilder } from "./mcp/gitmcp-seam";
import { buildThinkingRequestOptions } from "./common/openai-thinking";
import { DEEPSEEK_V4_MODELS, COMPACTION_MODEL, LIGHTWEIGHT_TASK_MODEL } from "./common/model-capabilities";
import { readTextFileWithMetadata } from "./common/file-utils";
import {
  buildSkillDocumentsPrompt,
  getCompactPrompt,
  getDefaultSkillPrompt,
  getExtensionRoot,
  getMemoryPrompt,
  getPlanModePrompt,
  getCurrentTurnTail,
  getStableRuntimeContext,
  getSystemPrompt,
  getTools,
  type ToolDefinition,
} from "./prompt";
import {
  ActionRegistry,
  getActionSpawner,
  pingDefinition,
  pingRun,
  reviewRunDefinition,
  reviewRun,
  reviewCheckAvailableDefinition,
  reviewCheckAvailableRun,
  reviewFullDefinition,
  reviewFullRun,
  crgReindexDefinition,
  crgReindexRun,
  crgVisualizeDefinition,
  crgVisualizeRun,
  codegraphReindexDefinition,
  codegraphReindexRun,
  codegraphListDefinition,
  codegraphListRun,
  wikiInitDefinition,
  wikiInitRun,
  wikiUpdateDefinition,
  wikiUpdateRun,
  wikiListPagesDefinition,
  wikiListPagesRun,
  wikiReadPageDefinition,
  wikiReadPageRun,
  indexBuildAllDefinition,
  indexBuildAllRun,
  archScanRunDefinition,
  archScanRunRun,
  browserSessionStartDefinition,
  browserSessionStartRun,
  browserCommandDefinition,
  browserCommandRun,
  browserSessionStopDefinition,
  browserSessionStopRun,
  bentoCreateDefinition,
  bentoCreateRun,
  designMaterializeDefinition,
  designMaterializeRun,
  taskCreateDefinition,
  taskCreateRun,
  taskStepDefinition,
  taskStepRun,
  taskForkDefinition,
  taskForkRun,
  taskSwitchDefinition,
  taskSwitchRun,
  taskAbandonDefinition,
  taskAbandonRun,
  taskListDefinition,
  taskListRun,
  taskMergeDefinition,
  taskMergeRun,
  taskRecallDefinition,
  taskRecallRun,
  type RunSubagentOptions,
} from "./actions";
import { TaskTreeService } from "./tasks/task-tree-service";
import {
  ToolExecutor,
  type CreateOpenAIClient,
  type ProcessTimeoutControl,
  type ProcessTimeoutInfo,
  type ToolCallExecution,
  type ToolExecutionHooks,
} from "./tools/executor";
import { McpManager } from "./mcp/mcp-manager";
import type { McpServerConfig, PermissionScope, PermissionSettings, RoutingSettings } from "./settings";
import { getProjectSettingsPath, getUserSettingsPath, DEFAULT_STREAM_IDLE_TIMEOUT_MS } from "./settings";
import { getUserConfigRoot } from "./common/app-dirs";
import { logApiError } from "./common/error-logger";
import { logOpenAIChatCompletionDebug, normalizeDebugError } from "./common/debug-logger";
import { describeLlmError, classifyLlmError, getLlmErrorDetails } from "./common/llm-error";
import { killProcessTree } from "./common/process-tree";
import { GitFileHistory, type FileHistoryCheckpointResult } from "./common/file-history";
import { clearSessionState, getSnippet, rebuildSessionStateFromHistory } from "./common/state";
import {
  appendProjectPermissionAllows,
  buildPermissionToolExecution,
  computeToolCallPermissions,
  hasUserPermissionReplies,
  normalizeAskPermissions,
  parseToolCallForPermissions,
  type AskPermissionRequest,
  type MessageToolPermission,
  type PermissionToolCall,
  type UserToolPermission,
} from "./common/permissions";
import { clearSessionWorkingDir } from "./tools/bash-handler";
import { reportNewPrompt } from "./common/telemetry";
import { OpenAIMessageConverter } from "./common/openai-message-converter";
import {
  DEFAULT_ROUTING_CONFIG,
  getEmbeddingLoadError,
  RoutingFacade,
  timedRoutingEvent,
  type RoutingConfig,
  type RoutableTool,
} from "./routing";
import { logRoutingEvent } from "./routing";
import { createRouters, getConfiguredRoutingModelDir, type RouterBundle } from "./routing";
import type { LLMDecomposer } from "./routing/types";

export type { PermissionScope } from "./settings";
export type {
  AskPermissionRequest,
  AskPermissionScope,
  BashPermissionScope,
  MessageToolPermission,
  PermissionDecision,
  UserToolPermission,
} from "./common/permissions";

const MAX_SESSION_ENTRIES = 50;
const MAX_PROJECT_CODE_LENGTH = 64;
const PROJECT_CODE_HASH_LENGTH = 16;
const BACKGROUND_FAILURE_LOG_TAIL_CHARS = 4000;
/** Retry window after a failed router/embedding load (R4 backoff). */
const ROUTING_LOAD_RETRY_BACKOFF_MS = 60_000;
/** Subagent nesting cap (deep review 2026-08-15, B6). */
const MAX_SUBAGENT_DEPTH = 4;
const DEFAULT_COMPACT_PROMPT_TOKEN_THRESHOLD = 128 * 1024;
const DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD = 512 * 1024;
// Compaction wants faithful, reproducible summaries — a fixed low temperature
// (instead of the user's conversational setting) keeps them deterministic.
const COMPACTION_TEMPERATURE = 0.3;
const PLAN_MODE_ON_STATUS_MESSAGE = "  └ Set Plan Mode on. Awaiting <proposed_plan>.";
const PLAN_MODE_OFF_STATUS_MESSAGE = "  └ Set Plan Mode off.";
const PLAN_MODE_FORCE_ASK_SCOPES = [
  "write-in-cwd",
  "write-out-cwd",
  "delete-in-cwd",
  "delete-out-cwd",
  "mutate-git-log",
] as const satisfies readonly PermissionScope[];

type ChatCompletionDebugOptions = {
  enabled?: boolean;
  location: string;
  baseURL?: string;
  params?: Record<string, unknown>;
};

export function getCompactPromptTokenThreshold(model: string): number {
  return DEEPSEEK_V4_MODELS.has(model)
    ? DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD
    : DEFAULT_COMPACT_PROMPT_TOKEN_THRESHOLD;
}

// Keep project storage paths short enough for Git's internal files on Windows.
export function getProjectCode(projectRoot: string): string {
  const legacyCode = getLegacyProjectCode(projectRoot);
  if (legacyCode.length <= MAX_PROJECT_CODE_LENGTH) {
    return legacyCode;
  }

  const normalizedRoot = path.resolve(projectRoot);
  const hashInput = process.platform === "win32" ? normalizedRoot.toLowerCase() : normalizedRoot;
  const hash = crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, PROJECT_CODE_HASH_LENGTH);
  const prefixLimit = MAX_PROJECT_CODE_LENGTH - PROJECT_CODE_HASH_LENGTH - 1;
  const basename = path.basename(normalizedRoot);
  const prefix =
    sanitizeProjectCodePart(basename)
      .slice(0, prefixLimit)
      .replace(/[-.]+$/g, "") || "project";
  return `${prefix}-${hash}`;
}

/**
 * Whether a UI locale string denotes a Chinese variant. Used by document readers
 * to prefer a sibling `.zh.md` localized doc when present. Kept in core (not the
 * desktop layer) so the locale decision is centralized and UI-agnostic.
 */
export function isChineseLocale(locale?: string): boolean {
  if (!locale) return false;
  const lower = locale.toLowerCase();
  return lower === "zh" || lower.startsWith("zh-");
}

function getLegacyProjectCode(projectRoot: string): string {
  return projectRoot.replace(/[\\/]/g, "-").replace(/:/g, "");
}

function sanitizeProjectCodePart(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

function isUsageRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function summarizeCompletionOptions(options?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!options) {
    return undefined;
  }
  return {
    ...options,
    signal: options.signal instanceof AbortSignal ? { aborted: options.signal.aborted } : options.signal,
  };
}

/**
 * Raised by the stream idle watchdog when a single read from the LLM stream
 * stays silent longer than the configured timeout. Classified as TIMEOUT by
 * classifyLlmError() and eligible for exactly one automatic retry.
 */
export class LlmStreamIdleTimeoutError extends Error {
  readonly idleTimeoutMs: number;

  constructor(idleTimeoutMs: number) {
    super(`LLM stream idle timeout: no data received for ${idleTimeoutMs}ms`);
    this.name = "LlmStreamIdleTimeoutError";
    this.idleTimeoutMs = idleTimeoutMs;
  }
}

/**
 * Wrap an async iterable so each individual next() must resolve within
 * `idleTimeoutMs`. Long thinking pauses and a genuinely dead connection are
 * indistinguishable from the caller's side; this watchdog turns the latter
 * into a classified TIMEOUT instead of a hung or silently-failed session.
 */
export function withStreamIdleTimeout<T>(stream: AsyncIterable<T>, idleTimeoutMs: number): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: () => {
      const iterator = stream[Symbol.asyncIterator]();
      const next = async (): Promise<IteratorResult<T>> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            iterator.next(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new LlmStreamIdleTimeoutError(idleTimeoutMs)), idleTimeoutMs);
              // A pending watchdog timer must not keep the process alive.
              timer.unref?.();
            }),
          ]);
        } finally {
          if (timer) {
            clearTimeout(timer);
          }
        }
      };
      const finish = async (): Promise<IteratorResult<T>> => {
        const terminate = (iterator as { return?: () => Promise<IteratorResult<T>> }).return;
        return terminate ? terminate.call(iterator) : { done: true, value: undefined as never };
      };
      return { next, return: finish };
    },
  };
}

function addUsageValue(current: unknown, next: unknown): unknown {
  if (typeof next === "number") {
    return (typeof current === "number" ? current : 0) + next;
  }

  if (isUsageRecord(next)) {
    const currentRecord = isUsageRecord(current) ? current : {};
    const result: Record<string, unknown> = { ...currentRecord };
    for (const [key, value] of Object.entries(next)) {
      result[key] = addUsageValue(currentRecord[key], value);
    }
    return result;
  }

  return next;
}

function accumulateUsage(current: ModelUsage | null, next: unknown | null | undefined): ModelUsage | null {
  if (next == null) {
    return current ?? null;
  }
  return addUsageValue(current, next) as ModelUsage;
}

function usageWithRequestCount(usage: ModelUsage): ModelUsage {
  const totalReqs = typeof usage.total_reqs === "number" ? usage.total_reqs + 1 : 1;
  return {
    ...usage,
    total_reqs: totalReqs,
  };
}

function accumulateUsagePerModel(
  current: Record<string, ModelUsage> | null | undefined,
  model: string,
  next: ModelUsage | null | undefined
): Record<string, ModelUsage> | null {
  if (next == null) {
    return current ?? null;
  }

  const usagePerModel = { ...(current ?? {}) };
  const modelName = model.trim() || "unknown";
  usagePerModel[modelName] = accumulateUsage(usagePerModel[modelName] ?? null, usageWithRequestCount(next))!;
  return usagePerModel;
}

/**
 * Prompt-side size of the most recent request: every token the model had to
 * ingest (cache hits included, since they still occupy the context window).
 * This — not cumulative total_tokens — is the right pressure reading for the
 * compaction threshold.
 */
export function getLastPromptTokens(usage: ModelUsage | null | undefined): number {
  if (!isUsageRecord(usage)) {
    return 0;
  }
  const promptTokens = usage.prompt_tokens;
  return typeof promptTokens === "number" ? promptTokens : 0;
}

function getCacheReadTokens(usage: ModelUsage | null | undefined): number {
  if (!isUsageRecord(usage)) {
    return 0;
  }
  const deepseekCacheHit = usage.prompt_cache_hit_tokens;
  if (typeof deepseekCacheHit === "number") {
    return deepseekCacheHit;
  }
  const details = isUsageRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : null;
  const openAiCached = details?.cached_tokens;
  return typeof openAiCached === "number" ? openAiCached : 0;
}

/**
 * Input tokens that actually hit the model fresh (prompt minus cache reads).
 * Mirrors dsh's mutually-exclusive conversion: cache hits are already paid for
 * at the cache-read rate and must not be double-counted as fresh input.
 */
export function getFreshInputTokens(usage: ModelUsage | null | undefined): number {
  const promptTokens = getLastPromptTokens(usage);
  return Math.max(0, promptTokens - getCacheReadTokens(usage));
}

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
type BuiltinPluginGroupManifest = {
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

type SessionManagerOptions = {
  projectRoot: string;
  createOpenAIClient: CreateOpenAIClient;
  getResolvedSettings: () => {
    model: string;
    webSearchTool?: string;
    mcpServers?: Record<string, McpServerConfig>;
    permissions?: Required<PermissionSettings>;
    enabledSkills?: Record<string, boolean>;
    routing?: RoutingSettings;
    visionModel?: string;
    visionApiKey?: string;
    streamIdleTimeoutMs?: number;
  };
  renderMarkdown: (text: string) => string;
  onAssistantMessage: (message: SessionMessage, shouldConnect: boolean) => void;
  onSessionEntryUpdated?: (entry: SessionEntry) => void;
  onLlmStreamProgress?: (progress: LlmStreamProgress) => void;
  /** Behavioral-memory provider (activity-frames pipeline B, host-injected). Returns a compact context block or null. */
  buildBehaviorContext?: () => string | null;
  onMcpStatusChanged?: () => void;
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

/**
 * Platform-conditional skill loading: skills with platform-specific prefixes
 * are only loaded on matching OS. Cross-platform skills load everywhere.
 *
 * Platform-specific prefixes:
 * - darwin: apple-, swift-, uikit-, swiftui-
 * - linux: deepin-, dde-, dtk-
 * - win32: (none currently)
 *
 * Cross-platform (no filtering): all other prefixes including
 * bento-, deeporca-, web-, openwiki-, skill-, a2ui-, codegraph-
 */
const DARWIN_PREFIXES = ["apple-", "swift-", "uikit-", "swiftui-"];
const LINUX_PREFIXES = ["deepin-", "dde-", "dtk-"];

/**
 * Extract error-level diagnostics from a Serena get_diagnostics_for_file result.
 * Serena returns diagnostics as an array of objects with severity, message, and range.
 * We only care about severity "error" (not "warning" or "hint") to avoid noise.
 */
function extractErrorDiagnostics(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];

  const errors: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text !== "string") continue;
    try {
      const parsed = JSON.parse(text);
      const diags = Array.isArray(parsed) ? parsed : (parsed.diagnostics ?? []);
      for (const d of diags) {
        const severity = (d.severity ?? "").toLowerCase();
        if (severity === "error" || severity === "1") {
          const msg = d.message ?? "Unknown error";
          const line = d.range?.start?.line ?? d.line;
          errors.push(line !== undefined ? `L${line}: ${msg}` : msg);
        }
      }
    } catch {
      // Not JSON — skip.
    }
  }
  return errors;
}

/** Serena tools that overlap with CodeGraph — add differentiating hints for G2 routing. */
const SERENA_TOOL_HINTS: Record<string, string> = {
  find_symbol: "（实时 LSP，适合精准单符号查询）",
  find_referencing_symbols: "（实时 LSP 引用，反映最新代码）",
  replace_symbol_body: "（LSP 语义级编辑，比文本替换更安全）",
  rename_symbol: "（跨文件原子重命名，内置工具无法做到）",
  get_diagnostics_for_file: "（实时 LSP 诊断，全栈唯一错误检查来源）",
};

/** CodeGraph tools — add differentiating hints for G2 routing. */
const CODEGRAPH_TOOL_HINTS: Record<string, string> = {
  codegraph_search: "（全代码图谱，适合批量/模糊搜索）",
  codegraph_impact: "（全代码图谱影响面分析，Serena 无法替代）",
  codegraph_callers: "（图谱级调用方分析，支持深度遍历）",
  codegraph_callees: "（图谱级被调用方分析）",
  codegraph_explore: "（图谱探索，语义+结构双路径）",
};

/**
 * Augment MCP tool descriptions with differentiating hints so G2 semantic
 * routing can better disambiguate overlapping Serena vs CodeGraph tools.
 */
function augmentMcpToolDescriptions(defs: ToolDefinition[]): ToolDefinition[] {
  return defs.map((def) => {
    const name = def.function?.name ?? "";
    // MCP tools are namespaced as mcp__<server>__<tool>.
    const parts = name.split("__");
    if (parts.length < 3) return def;
    const server = parts[1]!;
    const tool = parts.slice(2).join("__");

    let hint: string | undefined;
    if (server === SERENA_MCP_SERVER_NAME) {
      hint = SERENA_TOOL_HINTS[tool];
    } else if (server === CODEGRAPH_MCP_SERVER_NAME) {
      hint = CODEGRAPH_TOOL_HINTS[tool];
    }
    if (!hint) return def;

    const desc = def.function?.description;
    if (!desc || desc.includes(hint)) return def;
    return {
      ...def,
      function: { ...def.function, description: `${desc} ${hint}` },
    };
  });
}

function isSkillForCurrentPlatform(skillName: string): boolean {
  const name = skillName.toLowerCase();
  // Check macOS-only skills
  if (DARWIN_PREFIXES.some((p) => name.startsWith(p))) {
    return process.platform === "darwin";
  }
  // Check Linux-only skills
  if (LINUX_PREFIXES.some((p) => name.startsWith(p))) {
    return process.platform === "linux";
  }
  // All other skills are cross-platform
  return true;
}

export class SessionManager {
  private readonly projectRoot: string;
  private readonly createOpenAIClient: CreateOpenAIClient;
  private readonly getResolvedSettings: () => {
    model: string;
    webSearchTool?: string;
    mcpServers?: Record<string, McpServerConfig>;
    permissions?: Required<PermissionSettings>;
    enabledSkills?: Record<string, boolean>;
    routing?: RoutingSettings;
    visionModel?: string;
    visionApiKey?: string;
    streamIdleTimeoutMs?: number;
  };
  private readonly onAssistantMessage: (message: SessionMessage, shouldConnect: boolean) => void;
  private readonly onSessionEntryUpdated?: (entry: SessionEntry) => void;
  private readonly onLlmStreamProgress?: (progress: LlmStreamProgress) => void;
  private readonly buildBehaviorContext?: () => string | null;
  private readonly onMcpStatusChanged?: () => void;
  private readonly onProcessStdout?: (pid: number, chunk: string) => void;
  private activeSessionId: string | null = null;
  private activePromptController: AbortController | null = null;
  private readonly sessionControllers = new Map<string, AbortController>();
  /** Sessions with a graceful-pause request pending; honored at the next loop boundary. */
  private readonly pauseRequestedSessions = new Set<string>();
  private readonly processTimeoutControls = new Map<string, ProcessTimeoutControl>();
  private readonly liveProcessKeys = new Set<string>();
  private readonly toolExecutor: ToolExecutor;
  private readonly mcpManager = new McpManager();
  private mcpToolDefinitions: ToolDefinition[] = [];
  /** Server names declared (settings + builtins) — lazy-connect eligibility. */
  private declaredMcpServers = new Set<string>();
  /**
   * G2 session-frozen tool injection sets (R1): the routed tool set is decided
   * ONCE per session and then stays byte-identical — per-iteration re-routing
   * changed the request prefix every turn, killing DeepSeek's prefix cache and
   * occasionally dropping tools mid-task. Invalidated when the discovered tool
   * set changes (tools/list, reconnect) or the session is deleted.
   */
  private frozenToolRoutes = new Map<string, ToolDefinition[]>();
  /**
   * ActionRegistry — owns the defineAction primitive's registered actions for
   * this project. Constructed here (core) using the host-injected Spawner
   * (getActionSpawner); desktop's IPC bridge reaches this same instance via the
   * engine so IPC + LLM + MCP share one registry. Phase 0 ships system.ping.
   */
  private readonly actionRegistry: ActionRegistry;
  /** Skill/tool routers (lazy-initialized; null when routing disabled/unavailable). */
  private routerBundle: RouterBundle | null = null;
  private routerInitPromise: Promise<RouterBundle> | null = null;
  /** When the last router load FAILED (0 = never / success) — retry backoff (R4). */
  private routingLoadFailedAt = 0;
  /** Current subagent nesting depth (recursion cap, deep review 2026-08-15 B6). */
  private subagentDepth = 0;
  /** Task trajectory service (specs/task-tree P0) — single writer, lazily built. */
  private taskTreeServiceInstance: TaskTreeService | null = null;
  /** Sessions that mutated files during the current turn and need a CodeGraph index sync. */
  private readonly codegraphDirtySessions = new Set<string>();
  /** Sessions that mutated files during the current turn and need a CRG graph sync. */
  private readonly crgDirtySessions = new Set<string>();
  /** Sessions that mutated files during the current turn and need a wiki update. */
  private readonly wikiDirtySessions = new Set<string>();
  /** Files mutated during the current turn, per session, for post-edit diagnostics. */
  private readonly diagnosticsDirtyFiles = new Map<string, Set<string>>();
  /** Knowledge-source freshness timestamps (ISO) surfaced to the dashboard. */
  private knowledgeFreshness: {
    lastMutation?: string;
    codegraphSync?: string;
    wikiSync?: string;
    crgSync?: string;
  } = {};
  /** Memory Gateway client (null when memory is disabled or Gateway unavailable). */
  /** Memory provider (null when memory is disabled or not yet initialized). */
  private memoryProvider: MemoryProvider | null = null;
  /** A2UI lifecycle bundle (null when A2UI is disabled or builder not injected). */
  private currentA2uiLifecycle: A2uiLifecycle | null = null;
  private readonly messageConverter: OpenAIMessageConverter;

  /**
   * Per-session message cache. listSessionMessages is called multiple times
   * per loop iteration (×80000 max), each time re-reading and re-parsing the
   * entire JSONL file. This cache holds the parsed result so repeated reads
   * within a turn are O(1). Invalidated on append/save and cleared on session
   * switch or dispose.
   */
  private readonly messageCache = new Map<string, SessionMessage[]>();

  constructor(options: SessionManagerOptions) {
    this.projectRoot = options.projectRoot;
    this.createOpenAIClient = options.createOpenAIClient;
    this.getResolvedSettings = options.getResolvedSettings;
    this.onAssistantMessage = options.onAssistantMessage;
    this.onSessionEntryUpdated = options.onSessionEntryUpdated;
    this.onLlmStreamProgress = options.onLlmStreamProgress;
    this.onMcpStatusChanged = options.onMcpStatusChanged;
    this.buildBehaviorContext = options.buildBehaviorContext;
    this.onProcessStdout = options.onProcessStdout;
    // ActionRegistry must be constructed before ToolExecutor (which dispatches
    // action tool calls through it). Uses the host-injected Spawner so core
    // stays electron-free, and wires the MCP manager's dispatch so actions like
    // Actions can route to MCP tools via executeMcpTool. system.ping is the Phase-0 proof action.
    this.actionRegistry = new ActionRegistry({
      projectRoot: this.projectRoot,
      spawner: getActionSpawner(),
      executeMcpTool: (name, args) => this.mcpManager.executeMcpTool(name, args),
      // Minimal Subagent runtime (§十 P2): lets arch-scan.run dispatch an
      // isolated sub-session that force-loads+runs a skill. See runSubagent().
      runSubagent: (opts) => this.runSubagent(opts),
      // LLM single-choice judgment for classification-shaped actions
      // (design.materialize routing). Fail-open: null → caller's heuristic.
      judgeViaLlm: (prompt, choices) => this.judgeViaLlm(prompt, choices),
      // Task trajectory (specs/task-tree P0): the tree service is the single
      // writer of .deeporca/task-trees/** — actions receive it via context.
      taskTrees: () => this.getTaskTreeService(),
      // Session binding (P1): task.create/fork stamp the session entry's
      // taskRef reverse pointer and the branch head's sessionRef.
      activeSessionId: () => this.activeSessionId,
      setSessionTaskRef: (sessionId, ref) => this.setSessionTaskRef(sessionId, ref),
      getSessionTaskRef: (sessionId) => this.getSession(sessionId)?.taskRef ?? null,
      appendSessionSystemMessage: (sessionId, text) => this.appendSessionSystemMessage(sessionId, text),
    });
    this.actionRegistry.register(pingDefinition, pingRun);
    // ── Phase 1: code review actions ──────────────────────────────────────
    // review.run sinks ocr into core (MCP/LLM surface for the first time); the
    // ocr resolver is host-injected (desktop configureOcrResolver at boot).
    this.actionRegistry.register(reviewRunDefinition, reviewRun);
    this.actionRegistry.register(reviewCheckAvailableDefinition, reviewCheckAvailableRun);
    // review.full: the Code Review module's one-click composite (ocr + CRG risk).
    this.actionRegistry.register(reviewFullDefinition, reviewFullRun);
    // crg.reindex/visualize wrap the core crg.ts helpers (uv-resolved spawn);
    // Actions that need MCP tool routing use ctx.executeMcpTool.
    this.actionRegistry.register(crgReindexDefinition, crgReindexRun);
    this.actionRegistry.register(crgVisualizeDefinition, crgVisualizeRun);
    // ── Phase 2: knowledge index actions ──────────────────────────────────
    this.actionRegistry.register(codegraphReindexDefinition, codegraphReindexRun);
    this.actionRegistry.register(codegraphListDefinition, codegraphListRun);
    // wiki init/update need the host-injected wiki resolver (desktop configureWikiResolver).
    this.actionRegistry.register(wikiInitDefinition, wikiInitRun);
    this.actionRegistry.register(wikiUpdateDefinition, wikiUpdateRun);
    this.actionRegistry.register(wikiListPagesDefinition, wikiListPagesRun);
    this.actionRegistry.register(wikiReadPageDefinition, wikiReadPageRun);
    // The unified trio orchestrator (replaces the renderer promise chain).
    this.actionRegistry.register(indexBuildAllDefinition, indexBuildAllRun);
    // ── Phase 3: arch-scan (gated on runSubagent — §十 P2) ─────────────────
    this.actionRegistry.register(archScanRunDefinition, archScanRunRun);
    // ── Browser actions (BrowserSkill bsk CLI wrappers) ──────────────────────
    this.actionRegistry.register(browserSessionStartDefinition, browserSessionStartRun);
    this.actionRegistry.register(browserCommandDefinition, browserCommandRun);
    this.actionRegistry.register(browserSessionStopDefinition, browserSessionStopRun);
    // ── Bento presentation generator ─────────────────────────────────────────
    this.actionRegistry.register(bentoCreateDefinition, bentoCreateRun);
    // ── Designer — one-click requirement materialization ────────────────────
    this.actionRegistry.register(designMaterializeDefinition, designMaterializeRun);
    // ── Phase 3: task trajectory actions (specs/task-tree P0) ────────────────
    // The tree service is the single writer of .deeporca/task-trees/** and is
    // exposed to actions via the context (accept-dependencies rule).
    this.actionRegistry.register(taskCreateDefinition, taskCreateRun);
    this.actionRegistry.register(taskStepDefinition, taskStepRun);
    this.actionRegistry.register(taskForkDefinition, taskForkRun);
    this.actionRegistry.register(taskSwitchDefinition, taskSwitchRun);
    this.actionRegistry.register(taskAbandonDefinition, taskAbandonRun);
    this.actionRegistry.register(taskListDefinition, taskListRun);
    this.actionRegistry.register(taskMergeDefinition, taskMergeRun);
    this.actionRegistry.register(taskRecallDefinition, taskRecallRun);
    this.toolExecutor = new ToolExecutor(
      this.projectRoot,
      this.createOpenAIClient,
      this.mcpManager,
      this.actionRegistry
    );
    this.mcpManager.prepare(this.augmentMcpServersWithBuiltins(this.getResolvedSettings().mcpServers));
    // CRG query layer: Node.js direct SQLite read (replaces Python MCP server).
    // Auto-initialized; the query gracefully returns [] when no graph exists.
    configureCrgGraphQuery(createCrgGraphQuery());
    this.messageConverter = new OpenAIMessageConverter({
      renderInitPrompt: () => this.renderInitCommandPrompt(),
      // Inject the current date + active model as a transient user-message tail
      // per request, never into the persisted prefix — keeps the DeepSeek prefix
      // cache warm across days/model switches (the date no longer lives in the
      // system-prompt prefix).
      buildTurnTail: (model) => getCurrentTurnTail(model),
    });
  }

  /**
   * The project's ActionRegistry. Desktop's IPC bridge reads this same instance
   * so the IPC surface and the LLM surface share one registry (no dual state).
   * Phase 1+ module migrations register their actions here.
   */
  getActionRegistry(): ActionRegistry {
    return this.actionRegistry;
  }

  /**
   * Build the user prompt for a subagent invocation (pure — extracted for
   * testing). arch-scan gets a domain-specific prompt; others reference the
   * skill name. The matched skill is force-loaded via UserPromptContent.skills
   * regardless, so this prompt is a fallback trigger, not the only loader.
   */
  private buildSubagentPrompt(skill: string, input?: Record<string, unknown>, prompt?: string): string {
    if (prompt) return prompt;
    if (skill === "arch-scan") {
      const perspective = (input as { perspective?: string } | undefined)?.perspective;
      return perspective
        ? `Scan the codebase architecture focusing on ${perspective} and generate the interactive architecture map (A2UI Surface).`
        : "Scan the codebase architecture and generate the interactive architecture map (A2UI Surface).";
    }
    return `Execute the ${skill} skill for this project.`;
  }

  /**
   * Minimal Subagent runtime (roadmap §十 P2, spec §五). Runs an isolated
   * sub-session that force-loads the named skill and activates the LLM loop to
   * completion. The parent's active session is saved and restored so the UI
   * returns to it. The sub-session currently appears in the sidebar (marked by
   * its skill prompt) — UI isolation is a follow-up; this is the experimental
   * first step the roadmap describes ("先做桌面内受控实验").
   *
   * Re-entrancy: the engine is subagent-friendly — activateSession is keyed by
   * sessionId over Map<sessionId> state, so nested invocations don't collide.
   * Recursion is capped at MAX_SUBAGENT_DEPTH (deep review 2026-08-15, B6): a
   * mutually-recursive skill pair would otherwise nest unbounded LLM loops.
   */
  /** Task trajectory service for the desktop panel bridge (read-only usage). */
  getTaskTreeServiceForPanel(): TaskTreeService | null {
    return this.getTaskTreeService();
  }

  /**
   * Behavioral-memory boot context (activity-frames pipeline B, opt-in via
   * settings.behaviorContext): prepend the compact "how this user works"
   * block as a hidden system message on session creation. Fail-open.
   */
  private appendBehaviorContext(sessionId: string): void {
    try {
      if ((this.getResolvedSettings() as { behaviorContext?: boolean }).behaviorContext !== true) return;
      const block = this.buildBehaviorContext?.();
      if (!block || !block.trim()) return;
      this.appendSessionMessage(
        sessionId,
        this.buildSystemMessage(
          sessionId,
          `<behavior-context>\nHow this user usually works (behavioral memory summary):\n${block}\n</behavior-context>`
        )
      );
    } catch {
      // Fail-open: no behavioral context rather than a broken session start.
    }
  }

  /** Hidden system message channel for actions (lineage recycle, hints). Fail-open. */
  private appendSessionSystemMessage(sessionId: string, text: string): void {
    try {
      if (!text.trim()) return;
      this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, text));
    } catch {
      // Fail-open: messaging issues never break the calling action.
    }
  }

  /** Bind/unbind a session entry's taskRef (task.* actions call this via context). */
  private setSessionTaskRef(sessionId: string, ref: { treeId: string; branch: string; nodeId: string } | null): void {
    try {
      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        ...(ref ? { taskRef: ref } : { taskRef: undefined }),
        updateTime: new Date().toISOString(),
      }));
    } catch {
      // Binding is best-effort — never block the task action.
    }
  }

  /** Sessions that already received a task-recall hint (once per session). */
  private taskRecallHinted = new Set<string>();

  /**
   * Decision-point recall hint (spec §3.2 steps 1-4, minimal loop): when
   * AskUserQuestion executes in a tree-bound session and historical forks
   * resemble the decision, append a hidden <task-recall-hints> message so the
   * agent can offer a memory-seeded fork alongside the question. The human
   * still decides — nothing forks automatically.
   */
  private probeTaskRecallAtDecision(sessionId: string, toolFunction: unknown | null): void {
    try {
      const fn = toolFunction as { name?: string; arguments?: string | Record<string, unknown> } | null;
      if (!fn || fn.name !== "AskUserQuestion") return;
      if (this.taskRecallHinted.has(sessionId)) return;
      this.taskRecallHinted.add(sessionId);
      const ref = this.getSession(sessionId)?.taskRef;
      if (!ref) return;
      let raw: unknown = null;
      if (typeof fn.arguments === "string") {
        raw = (JSON.parse(fn.arguments) as Record<string, unknown>)["questions"];
      } else if (fn.arguments && typeof fn.arguments === "object") {
        raw = (fn.arguments as Record<string, unknown>)["questions"];
      }
      const query =
        typeof raw === "string"
          ? raw
          : Array.isArray(raw)
            ? raw
                .map((q) =>
                  typeof q === "object" && q !== null
                    ? Object.values(q as Record<string, unknown>)
                        .filter((v) => typeof v === "string")
                        .join(" ")
                    : ""
                )
                .join(" ")
            : "";
      if (!query.trim()) return;
      const svc = this.getTaskTreeService();
      const candidates = svc?.recallAtDecision(query, { excludeTreeId: ref.treeId }) ?? [];
      if (candidates.length === 0) return;
      const lines = candidates
        .map(
          (c) =>
            `- task "${c.treeTitle}" forked "${c.branch}" (${Math.round(c.similarity * 100)}% similar) — why: ${c.forkWhy}; outcome: ${c.outcome}`
        )
        .join("\n");
      this.appendSessionSystemMessage(
        sessionId,
        `<task-recall-hints>\nSimilar historical forks exist for the current decision:\n${lines}\n` +
          `If the user's choice matches one of these directions, you may OFFER task.fork with a memorySnapshot ` +
          `(proposal only — the user must approve).\n</task-recall-hints>`
      );
    } catch {
      // Fail-open: the hint never breaks the question flow.
    }
  }

  /**
   * Plan Mode → task-tree materialization (spec §十一, one-way read-only).
   * Extracts checklist lines from an UpdatePlan call's `plan` argument and
   * appends the ones not yet present as step nodes on the session's bound
   * branch. Best-effort and fail-open: materialization issues never affect
   * the plan tool's own result.
   */
  private materializePlanToTaskTree(sessionId: string, toolFunction: unknown | null): void {
    try {
      const fn = toolFunction as { name?: string; arguments?: string | Record<string, unknown> } | null;
      if (!fn || fn.name !== "UpdatePlan") return;
      const ref = this.getSession(sessionId)?.taskRef;
      if (!ref) return;
      let plan: unknown = null;
      if (typeof fn.arguments === "string") {
        plan = (JSON.parse(fn.arguments) as Record<string, unknown>)["plan"];
      } else if (fn.arguments && typeof fn.arguments === "object") {
        plan = (fn.arguments as Record<string, unknown>)["plan"];
      }
      if (typeof plan !== "string" || !plan.trim()) return;
      const lines = plan
        .split("\n")
        .map((line) => line.match(/^\s*[-*]\s+\[( |x)\]\s*(.+?)\s*$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => m[2]!)
        .filter((title) => title.length > 0)
        .slice(0, 20);
      if (lines.length === 0) return;
      const svc = this.getTaskTreeService();
      if (!svc) return;
      // Switch to the bound branch for this materialization (P1: a session's
      // plan belongs to its bound branch, wherever the tree was left).
      svc.switchBranch(ref.treeId, ref.branch);
      const tree = svc.getTree(ref.treeId);
      if (!tree) return;
      const existing = new Set(tree.nodes.map((n) => n.title));
      for (const title of lines) {
        if (!existing.has(title)) {
          existing.add(title); // duplicates within one plan collapse too
          svc.appendStep(ref.treeId, { title, why: "Plan step (materialized one-way from UpdatePlan)." });
        }
      }
    } catch {
      // Fail-open: materialization must never break the plan tool flow.
    }
  }

  /**
   * Branch-level resume (specs/task-tree P1): when a session bound to a tree
   * branch activates, restore that branch as the tree's active branch so
   * subsequent task.step calls land where the session left off. Fail-open.
   */
  private restoreTaskBranchForSession(sessionId: string): void {
    try {
      const ref = this.getSession(sessionId)?.taskRef;
      if (!ref) return;
      const svc = this.getTaskTreeService();
      svc?.switchBranch(ref.treeId, ref.branch);
    } catch {
      // Fail-open: a broken tree must not block session resume.
    }
  }

  /** Lazy task-tree service (created once per manager; null-safe). */
  private getTaskTreeService(): TaskTreeService | null {
    if (!this.taskTreeServiceInstance) {
      this.taskTreeServiceInstance = new TaskTreeService(this.projectRoot);
    }
    return this.taskTreeServiceInstance;
  }

  /**
   * LLM single-choice judgment for classification-shaped actions (flash
   * model, JSON mode). Returns one of `choices` or null on any failure —
   * callers must fail open to their deterministic fallback.
   */
  private async judgeViaLlm(prompt: string, choices: readonly string[]): Promise<string | null> {
    if (choices.length === 0) return null;
    const { client, baseURL, debugLogEnabled } = this.createOpenAIClient();
    if (!client) return null;
    const model = LIGHTWEIGHT_TASK_MODEL;
    try {
      const response = await this.createChatCompletionStream(
        client,
        {
          model,
          temperature: 0,
          max_tokens: 64,
          messages: [
            {
              role: "system",
              content:
                "You classify requests. Respond with JSON only: " +
                `{"choice": "<exactly one of the allowed choices>"}. No other keys.`,
            },
            { role: "user", content: `${prompt}\n\nAllowed choices: ${choices.join(", ")}` },
          ],
          response_format: { type: "json_object" },
          ...buildThinkingRequestOptions(false, baseURL),
        },
        undefined,
        undefined,
        {
          enabled: debugLogEnabled,
          location: "SessionManager.judgeViaLlm",
          baseURL,
          params: { purpose: "action-judgment", model, temperature: 0 },
        }
      );
      const rawContent = response.choices?.[0]?.message?.content;
      const parsed = typeof rawContent === "string" ? (JSON.parse(rawContent) as { choice?: unknown }) : null;
      const choice = parsed?.choice;
      return typeof choice === "string" && choices.includes(choice) ? choice : null;
    } catch {
      return null;
    }
  }

  async runSubagent(opts: RunSubagentOptions): Promise<{ sessionId: string; content: string | null }> {
    if (this.subagentDepth >= MAX_SUBAGENT_DEPTH) {
      throw new Error(`Subagent recursion depth exceeded (>${MAX_SUBAGENT_DEPTH}) — mutually-recursive skills?`);
    }
    const previousActive = this.activeSessionId;
    this.subagentDepth += 1;
    // Force-load the named skill (don't rely on auto-match alone).
    let skillInfo: SkillInfo | undefined;
    try {
      const skills = await this.listSkills();
      skillInfo = skills.find((s) => s.name === opts.skill);
    } catch {
      // Skill scan failure is non-fatal — the prompt still triggers auto-match.
    }
    const userPrompt: UserPromptContent = {
      text: this.buildSubagentPrompt(opts.skill, opts.input as Record<string, unknown> | undefined, opts.prompt),
      skills: skillInfo ? [{ ...skillInfo, isLoaded: false }] : undefined,
    };
    try {
      // createSession sets the sub-session active and runs its LLM loop to
      // completion (it calls activateSession internally).
      const subSessionId = await this.createSession(userPrompt);
      const msgs = this.listSessionMessages(subSessionId);
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
      const content = typeof lastAssistant?.content === "string" ? lastAssistant.content : null;
      return { sessionId: subSessionId, content };
    } finally {
      // Restore the parent as the active session so the UI returns to it.
      this.activeSessionId = previousActive;
      this.subagentDepth = Math.max(0, this.subagentDepth - 1);
    }
  }

  /**
   * Configure the memory Gateway client. Called by the desktop host after the
   * Gateway sidecar has started (or with null to disable memory).
   */
  setMemoryProvider(provider: MemoryProvider | null): void {
    this.memoryProvider = provider;
  }

  /**
   * Lazily initialize and return the skill/tool router bundle.
   * Returns null when routing is disabled or the embedding package is
   * unavailable — callers must fail-open (use full candidate sets).
   *
   * The model directory comes from the host injection point
   * (configureRoutingModelDir, called by the desktop main process — the same
   * pattern as configureCodegraphVendorRoot), or DEEPORCA_ROUTING_MODEL_DIR for
   * dev/CLI use, with a repo-relative fallback for source checkouts.
   */
  private async getRouters(): Promise<RouterBundle> {
    if (this.routerBundle) return this.routerBundle;
    if (this.routerInitPromise) return this.routerInitPromise;
    // R4 backoff: a failed load (missing embedding package, bad model dir) is
    // retried at most once per window — previously every user prompt paid a
    // fresh dynamic-import attempt that could never succeed.
    const backoffRemaining = ROUTING_LOAD_RETRY_BACKOFF_MS - (Date.now() - this.routingLoadFailedAt);
    if (this.routingLoadFailedAt > 0 && backoffRemaining > 0) {
      return { skillRouter: null, toolRouter: null, facade: new RoutingFacade({ toolRouter: null }) };
    }

    this.routerInitPromise = (async () => {
      const settings = this.getResolvedSettings();
      const routingRaw = settings.routing ?? {};
      // Built-in infrastructure servers are always pinned (R1): they serve
      // whole-domain capabilities rather than a single turn's intent — serena
      // (LSP), codegraph (repo graph), a2ui (design + interaction tools) and
      // activity-frames are in-process or auto-injected, so gating them by
      // per-turn relevance only destabilizes the tool prefix.
      const builtinPinned = [
        SERENA_MCP_SERVER_NAME,
        CODEGRAPH_MCP_SERVER_NAME,
        A2UI_MCP_SERVER_NAME,
        ACTIVITY_FRAMES_MCP_SERVER_NAME,
      ];
      const config: RoutingConfig = {
        ...DEFAULT_ROUTING_CONFIG,
        ...routingRaw,
        pinnedServers: [...new Set([...builtinPinned, ...(routingRaw.pinnedServers ?? [])])],
      };
      const modelDir =
        process.env.DEEPORCA_ROUTING_MODEL_DIR ??
        process.env.DEEPCODE_ROUTING_MODEL_DIR ??
        getConfiguredRoutingModelDir() ??
        // Fallback for source checkouts (tsx / packages/core/dist), where no host
        // injection happened. `src/` and `dist/` are both one level under
        // packages/core, so ../../desktop/vendor lands on packages/desktop/vendor.
        // (This previously included a redundant "packages" segment, producing
        // packages/packages/desktop/... — a path that never existed, so routing
        // silently fail-opened and never actually ran.)
        (() => {
          try {
            const { join, dirname } = require("node:path") as typeof NodePath;
            const { fileURLToPath } = require("node:url") as typeof NodeUrl;
            const here = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
            return join(here, "..", "..", "desktop", "vendor", "granite-embedding");
          } catch {
            return "";
          }
        })();
      // Cache dir: project-level .deeporca/cache (best-effort).
      const cacheDir = (() => {
        try {
          const { join } = require("node:path") as typeof NodePath;
          return join(this.projectRoot, ".deeporca", "cache");
        } catch {
          return undefined;
        }
      })();
      const bundle = await createRouters(config, { modelDir, cacheDir });
      // Track load failures for the retry backoff above. A null bundle with
      // routing enabled means the embedding service failed to load.
      this.routingLoadFailedAt = config.enabled && !bundle.skillRouter ? Date.now() : 0;
      this.routerBundle = bundle;
      return bundle;
    })();

    return this.routerInitPromise.catch(() => {
      this.routerInitPromise = null;
      return { skillRouter: null, toolRouter: null, facade: new RoutingFacade({ toolRouter: null }) } as RouterBundle;
    });
  }

  /**
   * Hot-reload hook (R4): drop the cached router bundle so the next consumer
   * re-reads settings.routing (enable/disable, topK, pinned servers…). Called
   * by the host when a settings patch contains a `routing` key. In-flight
   * sessions keep their already-frozen tool routes; new decisions use the
   * fresh configuration.
   */
  invalidateRouting(): void {
    this.routerBundle = null;
    this.routerInitPromise = null;
    this.routingLoadFailedAt = 0;
    this.frozenToolRoutes.clear();
  }

  /** Routing observability status for the knowledge panel (R4). */
  getRoutingStatus(): { state: "ready" | "idle" | "error"; error: string | null } {
    const loadError = getEmbeddingLoadError();
    if (loadError) return { state: "error", error: loadError };
    if (!this.routerBundle) return { state: "idle", error: null };
    return { state: this.routerBundle.skillRouter !== null ? "ready" : "idle", error: null };
  }

  /**
   * G2: route MCP tool definitions for the current turn context.
  /**
   * Create an LLMDecomposer for the SkillWeaver SAD pipeline (G3 compositional
   * routing). Uses the flash model to split a complex query into atomic
   * sub-tasks, with optional skill hints on the second pass.
   * Returns null when no LLM client is available (SAD will fail-open).
   */
  private createSkillDecomposer(options?: { signal?: AbortSignal; sessionId?: string }): LLMDecomposer {
    return {
      decompose: async (query, hints) => {
        const { client, baseURL } = this.createOpenAIClient();
        if (!client) return null;

        const sysPrompt = `You are a task decomposition assistant. Given a complex user query, break it down into atomic sub-tasks — each requiring exactly one skill/tool to complete.
Respond in JSON format:
\`\`\`
{"steps": ["sub-task 1 description", "sub-task 2 description", ...]}
\`\`\`
If the query is simple (single intent), respond with a single-element array.`;

        const userContent =
          hints && hints.length > 0
            ? `Available skills that may be relevant:\n${JSON.stringify(
                hints.map((s) => ({ name: s.name, description: s.description })),
                null,
                2
              )}\n\nQuery: ${query}`
            : `Query: ${query}`;

        try {
          const rawContent = await timedRoutingEvent(
            "SAD",
            async () => {
              const response = await this.createChatCompletionStream(
                client,
                {
                  model: LIGHTWEIGHT_TASK_MODEL,
                  temperature: 0.1,
                  max_tokens: 512,
                  messages: [
                    { role: "system", content: sysPrompt },
                    { role: "user", content: userContent },
                  ],
                  response_format: { type: "json_object" },
                  ...buildThinkingRequestOptions(false, baseURL),
                },
                options?.signal ? { signal: options.signal } : undefined,
                options?.sessionId,
                { enabled: false, location: "SessionManager.createSkillDecomposer", baseURL }
              );
              return response.choices?.[0]?.message?.content;
            },
            () => "hit",
            { sessionId: options?.sessionId, detail: hints ? "refined (with hints)" : "vanilla" }
          );
          const text = typeof rawContent === "string" ? rawContent : "";
          const parsed = JSON.parse(text) as { steps?: string[] };
          const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
          return steps.map((desc, i) => ({ step: i + 1, description: String(desc) }));
        } catch {
          return null; // fail-open
        }
      },
    };
  }

  /**
   * G2: route MCP tool definitions for the current turn context.
   * Returns a (possibly reduced) subset of this.mcpToolDefinitions based on
   * embedding relevance. Built-in tools are never routed (they're added by
   * getTools separately). Fail-open: any error → return full list.
   */
  private async getRoutedMcpTools(sessionId: string): Promise<ToolDefinition[]> {
    const all = this.mcpToolDefinitions;
    if (all.length === 0) return all;

    // Session-frozen (R1): decide once, reuse byte-identical for the whole
    // session — protects the DeepSeek prefix cache across turns/iterations.
    const frozen = this.frozenToolRoutes.get(sessionId);
    if (frozen) {
      return frozen;
    }
    const routed = await this.computeRoutedMcpTools(sessionId, all);
    this.frozenToolRoutes.set(sessionId, routed);
    return routed;
  }

  /** One-time G2 routing decision for a session (see getRoutedMcpTools). */
  private async computeRoutedMcpTools(sessionId: string, all: ToolDefinition[]): Promise<ToolDefinition[]> {
    try {
      const { facade } = await this.getRouters();

      // Build turn context: last user message + last assistant message.
      const msgs = this.listSessionMessages(sessionId);
      let userMessage = "";
      let assistantSummary = "";
      for (let i = msgs.length - 1; i >= 0 && (!userMessage || !assistantSummary); i--) {
        const m = msgs[i]!;
        if (m.role === "user" && !userMessage) {
          userMessage = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        } else if (m.role === "assistant" && !assistantSummary) {
          const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
          assistantSummary = text.slice(0, 512);
        }
      }
      if (!userMessage) return all; // no context → fail-open

      const routable: RoutableTool[] = all.map((t) => ({
        name: t.function.name,
        description: t.function.description ?? "",
        serverName: t.function.name.startsWith("mcp__") ? t.function.name.split("__")[1] : undefined,
        // Real schema length feeds the G2 token-budget estimate (R4).
        schemaJson: JSON.stringify(t.function),
      }));

      // RoutingFacade: decide-once-per-session (G2 selection + telemetry live
      // inside; a frozen decision is reused without re-embedding).
      const decision = await facade.decideToolRoute({
        sessionId,
        context: { userMessage, assistantSummary },
        tools: routable,
      });
      if (decision.selected === routable) return all; // routing declined → full set

      // R3/M4 lazy-connect hint: bring any declared-but-down server back up
      // before its tools are needed. No-op while every server is pinned or
      // user-configured (connected at boot); activates for future auto-
      // injected non-pinned servers and as self-healing when a subprocess died.
      if (decision.serverNames.length > 0) {
        await this.ensureMcpServersConnected(decision.serverNames);
      }

      const selectedNames = new Set(decision.selected.map((t) => t.name));
      const filtered = all.filter((t) => selectedNames.has(t.function.name));
      return filtered.length > 0 ? filtered : all;
    } catch {
      return all; // fail-open
    }
  }

  /**
   * Lazy-connect (R3/M4): (re)connect declared servers that the session's tool
   * route depends on but that are currently down. Best-effort — a failure to
   * reconnect never blocks the turn (the tools will fail-open as unavailable).
   */
  private async ensureMcpServersConnected(serverNames: string[]): Promise<void> {
    try {
      const statuses = this.mcpManager.getStatus();
      const connected = new Set(
        statuses
          .filter((s) => s.connected)
          .map((s) => s.name)
          .filter((name): name is string => typeof name === "string")
      );
      const missing = serverNames.filter((name) => !connected.has(name) && this.declaredMcpServers.has(name));
      if (missing.length === 0) return;
      logRoutingEvent({ stage: "server", outcome: "hit", detail: `lazy-connecting: ${missing.join(", ")}` });
      for (const name of missing) {
        await this.mcpManager.reconnect(name);
      }
      this.refreshMcpToolDefinitions();
    } catch (error) {
      logRoutingEvent({
        stage: "server",
        outcome: "fallback",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** True when the memory provider is available. */
  isMemoryAvailable(): boolean {
    return this.memoryProvider?.isAvailable() ?? false;
  }

  /**
   * @deprecated Use messageConverter.buildMessages directly.
   * Kept for test compatibility.
   */
  buildOpenAIMessages(
    messages: SessionMessage[],
    thinkingEnabled: boolean,
    model: string
  ): ChatCompletionMessageParam[] {
    return this.messageConverter.buildMessages(messages, thinkingEnabled, model);
  }

  /**
   * Merge built-in MCP servers into the configured set. CodeGraph is registered
   * automatically — but only for projects that already contain a `.codegraph/`
   * directory, so the index/knowledge base stays project-scoped and nothing is
   * assumed to exist on the host. A user-provided `codegraph` entry always wins.
   * Similarly, code-review-graph is auto-registered for projects with a
   * `.code-review-graph/` directory, exposing only analysis-layer tools.
   * GitMCP entries (`gitmcp:` prefix) that still hold the portable placeholder
   * config are rewritten here into a concrete spawn config for this machine.
   */
  private augmentMcpServersWithBuiltins(
    servers?: Record<string, McpServerConfig>
  ): Record<string, McpServerConfig> | undefined {
    let result = this.resolveGitmcpServers(servers);

    // CodeGraph MCP (navigation/retrieval layer). Index/sync operations go
    // through the SdkCodegraphController, but MCP tools still run as a
    // subprocess via npm-shim.js (the SDK's MCPServer doesn't expose
    // connect(transport) for in-process bridging yet).
    if (hasCodegraphProject(this.projectRoot) && !isCodegraphDisabled(this.projectRoot)) {
      if (!(result && Object.prototype.hasOwnProperty.call(result, CODEGRAPH_MCP_SERVER_NAME))) {
        result = {
          ...(result ?? {}),
          [CODEGRAPH_MCP_SERVER_NAME]: buildCodegraphMcpServerConfig(this.projectRoot),
        };
      }
    }

    // CRG MCP server removed — queries now go through CrgGraphQuery (Node.js
    // direct SQLite read). The build step is handled by CrgCliController.
    // Serena — semantic code retrieval, editing, refactoring (symbol-level
    // operations via SolidLSP, 40+ languages). Activated for all projects when
    // uv is available and not disabled. Complements the built-in text-level
    // read/edit tools. Spawn config is built by the host-injected SerenaController.
    if (!isSerenaDisabled(this.projectRoot)) {
      if (!(result && Object.prototype.hasOwnProperty.call(result, SERENA_MCP_SERVER_NAME))) {
        const serenaConfig = getSerenaController()?.buildMcpServerConfig(this.projectRoot) ?? null;
        if (serenaConfig) {
          result = {
            ...(result ?? {}),
            [SERENA_MCP_SERVER_NAME]: serenaConfig,
          };
        }
      }
    }

    // SkillSpector MCP server — AI skill/MCP security scanner (prompt injection,
    // data exfiltration, supply-chain CVEs, MCP least-privilege, MCP tool poisoning).
    // Always available (security scanning is relevant to every project) when uv is
    // available and not disabled. Exposes `scan_skill`; the agent defaults use_llm=false
    // (pure-static, zero credentials). Installed from git+SHA — the PyPI package is malware.
    if (!isSkillSpectorDisabled(this.projectRoot)) {
      if (!(result && Object.prototype.hasOwnProperty.call(result, SKILL_SPECTOR_MCP_SERVER_NAME))) {
        const skillSpectorConfig = getSkillSpectorController()?.buildMcpServerConfig(this.projectRoot) ?? null;
        if (skillSpectorConfig) {
          result = {
            ...(result ?? {}),
            [SKILL_SPECTOR_MCP_SERVER_NAME]: skillSpectorConfig,
          };
        }
      }
    }

    return result;
  }

  /**
   * Replace GitMCP placeholder configs (`{ command: "gitmcp" }`) with the real
   * spawn config resolved for this machine. Entries the user configured with a
   * concrete command are left untouched; unresolvable placeholders are kept
   * as-is so the failure surfaces as a visible server error instead of the
   * repository silently disappearing.
   */
  private resolveGitmcpServers(servers?: Record<string, McpServerConfig>): Record<string, McpServerConfig> | undefined {
    if (!servers) {
      return servers;
    }
    let result = servers;
    for (const [name, config] of Object.entries(servers)) {
      if (!isGitmcpServerName(name) || !isGitmcpPlaceholderConfig(config)) {
        continue;
      }
      const built = getGitmcpConfigBuilder()?.(gitmcpSlugFromServerName(name)) ?? null;
      if (built) {
        result = { ...result, [name]: built };
      }
    }
    return result;
  }

  /** Refresh cached MCP tool definitions; any session-frozen route goes stale. */
  private refreshMcpToolDefinitions(): void {
    this.mcpToolDefinitions = augmentMcpToolDescriptions(this.mcpManager.getMcpToolDefinitions());
    this.frozenToolRoutes.clear();
  }

  async initMcpServers(servers?: Record<string, McpServerConfig>): Promise<void> {
    this.mcpManager.setOnToolsListChanged(() => {
      this.refreshMcpToolDefinitions();
    });
    // 设置状态变更回调，通知 UI 更新
    this.mcpManager.setOnStatusChanged(() => {
      this.onMcpStatusChanged?.();
    });
    const augmented = this.augmentMcpServersWithBuiltins(servers) ?? {};
    this.declaredMcpServers = new Set(Object.keys(augmented));
    await this.mcpManager.initialize(augmented);

    // Connect the A2UI in-process MCP server (runs via InMemoryTransport,
    // no subprocess). Always available unless explicitly disabled.
    // The server builder + surface lifecycle are injected by the desktop host.
    if (!isA2uiDisabled(this.projectRoot)) {
      const a2uiBuilder = getA2uiServerBuilder();
      if (a2uiBuilder) {
        const lifecycle = a2uiBuilder(this.projectRoot);
        if (lifecycle) {
          // Restore persisted surfaces AFTER the builder (which clears the
          // module-level surfaces Map to prevent cross-session leaks).
          lifecycle.restoreSurfaces(this.projectRoot);
          await this.mcpManager.connectInProcessServer(A2UI_MCP_SERVER_NAME, lifecycle.server);
          this.currentA2uiLifecycle = lifecycle;
        }
      }
    }

    // CodeGraph MCP tools stay as subprocess (npm-shim.js) — see augmentMcpServersWithBuiltins.
    // The SdkCodegraphController handles index/sync only; in-process MCP bridging
    // is future work (SDK's MCPServer lacks connect(transport)).

    // Connect the Activity-Frames in-process MCP server (behavioral memory).
    // Provides 6 tools for querying local screen activity. If no capture DB
    // exists, tools return "DB not found" errors gracefully.
    // The server builder is injected by the desktop host via seam.
    try {
      const afBuilder = getActivityFramesServerBuilder();
      if (afBuilder) {
        const afServer = afBuilder(undefined, this.projectRoot);
        await this.mcpManager.connectInProcessServer(ACTIVITY_FRAMES_MCP_SERVER_NAME, afServer);
      }
    } catch {
      // Activity DB not available — tools will report gracefully.
    }

    // Connect the built-in Vision MCP server (vision_chat / vision_ocr tools).
    // Gives text-only LLMs (like DeepSeek) the ability to understand images via
    // a vision-capable proxy model. Only connects when a vision model is configured
    // AND the desktop host has injected the server builder.
    const visionSettings = this.getResolvedSettings();
    const visionBuilder = getVisionServerBuilder();
    if (visionSettings.visionModel && visionSettings.visionApiKey && visionBuilder) {
      try {
        const visionServer = visionBuilder(this.projectRoot);
        await this.mcpManager.connectInProcessServer(VISION_MCP_SERVER_NAME, visionServer);
      } catch (error) {
        console.error("[session] vision MCP server failed:", error);
      }
    }

    this.refreshMcpToolDefinitions();
  }

  getMcpStatus() {
    return this.mcpManager.getStatus();
  }

  /**
   * Execute an MCP tool directly (outside the agent loop). Used by the
   * desktop host to forward A2UI user interactions back to the agent
   * via the a2ui_action tool.
   */
  async executeMcpTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const namespacedName = `mcp__${serverName}__${toolName}`;
    return this.mcpManager.executeMcpTool(namespacedName, args);
  }

  async reconnectMcpServer(name: string, config?: McpServerConfig): Promise<void> {
    await this.mcpManager.reconnect(name, config);
    this.refreshMcpToolDefinitions();
  }

  dispose(): void {
    const controller = this.activePromptController;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    this.activePromptController = null;
    for (const sessionController of this.sessionControllers.values()) {
      if (!sessionController.signal.aborted) {
        sessionController.abort();
      }
    }
    this.killLiveProcesses();
    this.sessionControllers.clear();
    this.processTimeoutControls.clear();
    this.mcpManager.disconnect();
    // Flush any pending debounced index write before teardown.
    this.flushSessionsIndex();
    // Persist prototype surfaces to disk before teardown.
    this.currentA2uiLifecycle?.persistSurfaces(this.projectRoot);
    this.currentA2uiLifecycle = null;
    // Release cached messages to free memory.
    this.messageCache.clear();
    // Drop the router bundle so a disposed manager cannot keep serving routes.
    // The embedding service itself is a process-wide singleton shared with other
    // SessionManagers, so it is deliberately NOT closed here — the host closes it
    // on app teardown via closeEmbeddingService().
    this.routerBundle = null;
    this.frozenToolRoutes.clear();
    this.routerInitPromise = null;
  }

  private estimateStreamTokens(text: string): number {
    let tokens = 0;
    for (const char of text) {
      tokens += /[\u3400-\u9fff\uf900-\ufaff]/u.test(char) ? 0.6 : 0.3;
    }
    return tokens;
  }

  private formatEstimatedTokens(tokens: number): string {
    if (tokens <= 0) {
      return "0";
    }

    const roundedTokens = Math.round(tokens);
    if (roundedTokens <= 0) {
      return "0";
    }

    if (roundedTokens < 100) {
      return String(roundedTokens);
    }

    if (roundedTokens < 10000) {
      return `${Number((roundedTokens / 1000).toFixed(1))}k`;
    }

    return `${Math.round(roundedTokens / 1000)}k`;
  }

  private emitLlmStreamProgress(
    requestId: string,
    startedAt: string,
    estimatedTokens: number,
    phase: LlmStreamProgress["phase"],
    sessionId?: string
  ): void {
    this.onLlmStreamProgress?.({
      requestId,
      sessionId,
      startedAt,
      estimatedTokens: Math.round(estimatedTokens),
      formattedTokens: this.formatEstimatedTokens(estimatedTokens),
      phase,
    });
  }

  private isAbortLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return error.name === "AbortError" || error.constructor.name === "APIUserAbortError";
  }

  private throwIfAborted(signal?: AbortSignal | null): void {
    if (!signal?.aborted) {
      return;
    }

    const error = new Error("Request was aborted.");
    error.name = "AbortError";
    throw error;
  }

  private getStreamIdleTimeoutMs(): number {
    const value = this.getResolvedSettings().streamIdleTimeoutMs;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  }

  private async createChatCompletionStream(
    client: NonNullable<ReturnType<CreateOpenAIClient>["client"]>,
    request: Record<string, unknown>,
    options?: Record<string, unknown>,
    sessionId?: string,
    debug?: ChatCompletionDebugOptions
  ): Promise<{
    choices?: Array<{ message?: Record<string, unknown> }>;
    usage?: ModelUsage | null;
  }> {
    const requestId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    let estimatedTokens = 0;
    this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "start", sessionId);

    const streamRequest = {
      ...request,
      stream: true,
      stream_options: {
        ...(isUsageRecord(request.stream_options) ? request.stream_options : {}),
        include_usage: true,
      },
    };

    let response: unknown;
    try {
      response = await (
        client.chat.completions.create as unknown as (
          body: Record<string, unknown>,
          options?: Record<string, unknown>
        ) => Promise<unknown>
      )(streamRequest, options);
    } catch (error) {
      this.logChatCompletionDebug(debug, {
        timestamp: new Date().toISOString(),
        location: debug?.location ?? "SessionManager.createChatCompletionStream:create",
        requestId,
        sessionId,
        model: typeof request.model === "string" ? request.model : undefined,
        baseURL: debug?.baseURL,
        durationMs: Date.now() - startedAtMs,
        params: { ...debug?.params, options: summarizeCompletionOptions(options) },
        request: streamRequest,
        error: normalizeDebugError(error),
      });
      logApiError({
        timestamp: new Date().toISOString(),
        location: "SessionManager.createChatCompletionStream:create",
        requestId,
        sessionId,
        model: typeof request.model === "string" ? request.model : undefined,
        error: getLlmErrorDetails(error),
        request: streamRequest,
      });
      this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "end", sessionId);
      throw error;
    }

    if (!response || typeof (response as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== "function") {
      this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "end", sessionId);
      this.logChatCompletionDebug(debug, {
        timestamp: new Date().toISOString(),
        location: debug?.location ?? "SessionManager.createChatCompletionStream",
        requestId,
        sessionId,
        model: typeof request.model === "string" ? request.model : undefined,
        baseURL: debug?.baseURL,
        durationMs: Date.now() - startedAtMs,
        params: { ...debug?.params, options: summarizeCompletionOptions(options) },
        request: streamRequest,
        response,
      });
      return response as { choices?: Array<{ message?: Record<string, unknown> }>; usage?: ModelUsage | null };
    }

    let content = "";
    let reasoningContent = "";
    let refusal: string | null = null;
    let usage: ModelUsage | null = null;
    const responseChunks: unknown[] = [];
    const toolCallsByIndex = new Map<
      number,
      {
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }
    >();

    const trackText = (value: unknown) => {
      if (typeof value !== "string" || value.length === 0) {
        return;
      }
      estimatedTokens += this.estimateStreamTokens(value);
      this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "update", sessionId);
    };

    try {
      for await (const chunk of withStreamIdleTimeout(
        response as AsyncIterable<Record<string, unknown>>,
        this.getStreamIdleTimeoutMs()
      )) {
        if (debug?.enabled) {
          responseChunks.push(chunk);
        }
        if ("usage" in chunk && chunk.usage != null) {
          usage = chunk.usage as ModelUsage;
        }

        const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
        for (const choice of choices) {
          const delta = isUsageRecord(choice) && isUsageRecord(choice.delta) ? choice.delta : null;
          if (!delta) {
            continue;
          }

          const contentDelta = delta.content;
          if (typeof contentDelta === "string") {
            content += contentDelta;
            trackText(contentDelta);
          }

          const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
          if (typeof reasoningDelta === "string") {
            reasoningContent += reasoningDelta;
            trackText(reasoningDelta);
          }

          if (typeof delta.refusal === "string") {
            refusal = `${refusal ?? ""}${delta.refusal}`;
            trackText(delta.refusal);
          }

          const rawToolCalls = delta.tool_calls;
          if (Array.isArray(rawToolCalls)) {
            for (const rawToolCall of rawToolCalls) {
              if (!isUsageRecord(rawToolCall)) {
                continue;
              }
              const index = typeof rawToolCall.index === "number" ? rawToolCall.index : toolCallsByIndex.size;
              const current = toolCallsByIndex.get(index) ?? {};
              if (typeof rawToolCall.id === "string") {
                current.id = rawToolCall.id;
              }
              if (typeof rawToolCall.type === "string") {
                current.type = rawToolCall.type;
              }
              const rawFunction = isUsageRecord(rawToolCall.function) ? rawToolCall.function : null;
              if (rawFunction) {
                current.function = current.function ?? {};
                if (typeof rawFunction.name === "string") {
                  current.function.name = `${current.function.name ?? ""}${rawFunction.name}`;
                  trackText(rawFunction.name);
                }
                if (typeof rawFunction.arguments === "string") {
                  current.function.arguments = `${current.function.arguments ?? ""}${rawFunction.arguments}`;
                  trackText(rawFunction.arguments);
                }
              }
              toolCallsByIndex.set(index, current);
            }
          }
        }
      }
    } catch (error) {
      this.logChatCompletionDebug(debug, {
        timestamp: new Date().toISOString(),
        location: debug?.location ?? "SessionManager.createChatCompletionStream:stream",
        requestId,
        sessionId,
        model: typeof request.model === "string" ? request.model : undefined,
        baseURL: debug?.baseURL,
        durationMs: Date.now() - startedAtMs,
        params: { ...debug?.params, options: summarizeCompletionOptions(options) },
        request: streamRequest,
        responseChunks,
        error: normalizeDebugError(error),
      });
      logApiError({
        timestamp: new Date().toISOString(),
        location: "SessionManager.createChatCompletionStream:stream",
        requestId,
        sessionId,
        model: typeof request.model === "string" ? request.model : undefined,
        error: getLlmErrorDetails(error),
        request: streamRequest,
      });
      throw error;
    } finally {
      this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "end", sessionId);
    }

    const toolCalls = Array.from(toolCallsByIndex.entries())
      .sort(([left], [right]) => left - right)
      .map(([, toolCall]) => toolCall);
    const normalizedToolCalls = this.normalizeLlmToolCalls(toolCalls);
    const message: Record<string, unknown> = { content };
    if (normalizedToolCalls) {
      message.tool_calls = normalizedToolCalls;
    }
    if (reasoningContent.length > 0) {
      message.reasoning_content = reasoningContent;
    }
    if (refusal != null) {
      message.refusal = refusal;
    }

    const finalResponse = {
      choices: [{ message }],
      usage,
    };
    this.logChatCompletionDebug(debug, {
      timestamp: new Date().toISOString(),
      location: debug?.location ?? "SessionManager.createChatCompletionStream",
      requestId,
      sessionId,
      model: typeof request.model === "string" ? request.model : undefined,
      baseURL: debug?.baseURL,
      durationMs: Date.now() - startedAtMs,
      params: { ...debug?.params, options: summarizeCompletionOptions(options) },
      request: streamRequest,
      responseChunks,
      response: finalResponse,
    });
    return finalResponse;
  }

  private logChatCompletionDebug(
    debug: ChatCompletionDebugOptions | undefined,
    entry: Parameters<typeof logOpenAIChatCompletionDebug>[0]
  ): void {
    if (!debug?.enabled) {
      return;
    }
    logOpenAIChatCompletionDebug(entry);
  }

  async identifyMatchingSkillNames(
    skills: SkillInfo[],
    userPrompt: string,
    options?: { signal?: AbortSignal; sessionId?: string }
  ): Promise<string[]> {
    this.throwIfAborted(options?.signal);
    let systemPrompt = `When users ask you to perform tasks, check if any of the available skills match the goal and situation. Skills provide specialized capabilities and domain knowledge.\n
Response in JSON format:
\`\`\`
{
  "skillNames": ["", ...],
  "multiIntent": false
}
\`\`\`\n
If none of the available skills match, respond with an empty array, i.e. \`{"skillNames": [], "multiIntent": false}\`.\n
Set "multiIntent" to true ONLY when the request clearly combines multiple distinct goals that need different skills (e.g. "generate slides AND run the tests"). Single-purpose requests, however complex, are multiIntent: false.\n
`;
    const simpleSkills = skills
      .filter((x) => !x.isLoaded && x.allowImplicitInvocation !== false)
      .map((x) => ({
        name: x.name,
        description: x.description,
        // R2 compositional metadata (optional; absent → behavior unchanged).
        categories: x.categories,
        inputs: x.inputs,
        outputs: x.outputs,
      }));
    if (simpleSkills.length === 0) {
      return [];
    }
    const candidateSkillNames = new Set(simpleSkills.map((skill) => skill.name));

    // G1 routing: reduce the candidate pool via embedding recall before sending
    // to the flash LLM. Fail-open (null) → use full simpleSkills list.
    let pool: Array<{ name: string; description: string }> = simpleSkills;
    try {
      const { skillRouter } = await this.getRouters();
      if (skillRouter) {
        const shortlist = await timedRoutingEvent(
          "G1",
          () => skillRouter.shortlist(userPrompt, simpleSkills),
          (result) => (result && result.length > 0 ? "hit" : "skip"),
          { sessionId: options?.sessionId, counts: { candidates: simpleSkills.length } }
        );
        if (shortlist && shortlist.length > 0) {
          pool = shortlist;
        }
      }
    } catch {
      // Routing error → fail-open, use full pool.
    }

    const { client, baseURL, debugLogEnabled } = this.createOpenAIClient();
    if (!client) {
      return [];
    }
    // Skill matching is a tiny classification task — route it to the v4 flash
    // model with thinking explicitly disabled and a tight output cap so it
    // never burns pro-level reasoning tokens or adds avoidable latency.
    const model = LIGHTWEIGHT_TASK_MODEL;

    const agentInstructions = this.loadAgentInstructions();
    if (agentInstructions) {
      systemPrompt += `Use the current agent instructions as additional context when deciding which skills match:\n
<agent-instructions>
${agentInstructions}
</agent-instructions>\n
`;
    }
    systemPrompt += "The candidate skills are as follows:\n\n";
    systemPrompt += "```\n" + JSON.stringify(pool, null, 2) + "\n```";

    try {
      const response = await this.createChatCompletionStream(
        client,
        {
          model,
          temperature: 0.1,
          max_tokens: 256,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          ...buildThinkingRequestOptions(false, baseURL),
        },
        options?.signal ? { signal: options.signal } : undefined,
        options?.sessionId,
        {
          enabled: debugLogEnabled,
          location: "SessionManager.identifyMatchingSkillNames",
          baseURL,
          params: { purpose: "skill-matching", model, temperature: 0.1 },
        }
      );
      this.throwIfAborted(options?.signal);

      const rawContent = response.choices?.[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : "";
      if (!content) {
        return [];
      }

      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.skillNames)) {
        const skillNames = parsed.skillNames.filter(
          (skillName: unknown): skillName is string =>
            typeof skillName === "string" && candidateSkillNames.has(skillName)
        );
        // G3 compositional routing — gated on the multi-intent judgment made by
        // the SAME flash call above: single-intent turns pay zero extra calls
        // (previously every prompt ran an SAD decomposition first, and a
        // lower-confidence embedding-only path could short-circuit this
        // verified one).
        if (parsed.multiIntent === true) {
          const composed = await this.composeSkillRoute(userPrompt, simpleSkills, candidateSkillNames, options);
          if (composed && composed.length > 0) {
            return [...new Set([...skillNames, ...composed])];
          }
        }
        return skillNames;
      }

      return [];
    } catch (error) {
      if (this.isAbortLikeError(error) || options?.signal?.aborted) {
        throw error;
      }
      return [];
    }
  }

  /**
   * G3 compositional routing (multi-intent only — gated by the multiIntent
   * judgment in identifyMatchingSkillNames). Decompose → retrieve → compose;
   * returns white-listed skill names, or null (fail-open) when the pipeline
   * declines or fails — the G1 result is then used unchanged. When a plan is
   * adopted, its step/DAG orchestration is injected as a hidden system message
   * so the composition (not just the flat skill list) reaches the agent.
   */
  private async composeSkillRoute(
    userPrompt: string,
    simpleSkills: Array<{
      name: string;
      description: string;
      categories?: string[];
      inputs?: string[];
      outputs?: string[];
    }>,
    candidateSkillNames: Set<string>,
    options?: { signal?: AbortSignal; sessionId?: string }
  ): Promise<string[] | null> {
    try {
      const { skillRouter } = await this.getRouters();
      if (!skillRouter) return null;
      // R2: carry the frontmatter metadata contract into the Compose stage —
      // ioTypeCoercion/categoryJaccard become live instead of always zero.
      const compSkills = simpleSkills.map((s) => ({
        name: s.name,
        description: s.description,
        ...(s.categories ? { categories: s.categories } : {}),
        ...(s.inputs ? { inputTypes: s.inputs } : {}),
        ...(s.outputs ? { outputTypes: s.outputs } : {}),
      }));
      const decomposer = this.createSkillDecomposer(options);
      const plan = await timedRoutingEvent(
        "G3",
        () => skillRouter.composeRoute(userPrompt, compSkills, decomposer),
        (result) => (result && result.steps.length > 1 ? "hit" : "skip"),
        { sessionId: options?.sessionId, counts: { candidates: simpleSkills.length } }
      );
      if (!plan || plan.steps.length <= 1) return null;
      const matched = new Set<string>();
      for (const step of plan.steps) {
        // White-list filter — same anti-hallucination guarantee as the G1 path.
        if (step.skill && candidateSkillNames.has(step.skill.name)) {
          matched.add(step.skill.name);
        }
      }
      if (matched.size === 0) return null;
      const orchestration = this.renderOrchestrationPrompt(plan);
      if (orchestration && options?.sessionId) {
        this.appendSessionMessage(options.sessionId, this.buildSystemMessage(options.sessionId, orchestration));
      }
      return [...matched];
    } catch {
      return null; // fail-open to the G1 result
    }
  }

  /** Render a CompositionPlan as an execution-order hint for the agent. */
  private renderOrchestrationPrompt(plan: {
    steps: Array<{ subTask?: { description?: string }; skill: { name: string } | null }>;
    dependencies: Array<[number, number]>;
  }): string | null {
    if (plan.steps.length === 0) return null;
    const lines = plan.steps
      .map(
        (s, i) =>
          `${i + 1}. ${s.subTask?.description ?? "(unnamed step)"}${s.skill ? ` — use the "${s.skill.name}" skill` : ""}`
      )
      .join("\n");
    const deps =
      plan.dependencies.length > 0
        ? `\nStep dependencies (earlier steps feed later ones): ${plan.dependencies
            .map(([from, to]) => `${from + 1} → ${to + 1}`)
            .join("; ")}`
        : "";
    return (
      `<orchestration-plan>\n` +
      `The user's request was decomposed into ${plan.steps.length} steps. ` +
      `Execute them in order unless the dependencies say otherwise:\n${lines}${deps}\n` +
      `</orchestration-plan>`
    );
  }

  /**
   * Rewrite a draft user prompt into a clearer, more actionable prompt.
   * Like skill matching, this is a lightweight single-turn task and is always
   * routed to the flash model with thinking disabled — it must never consume
   * pro-level reasoning tokens.
   */
  async enhancePrompt(draftPrompt: string, options?: { signal?: AbortSignal }): Promise<string> {
    this.throwIfAborted(options?.signal);
    const draft = draftPrompt.trim();
    if (!draft) {
      return draftPrompt;
    }

    const { client, baseURL, debugLogEnabled } = this.createOpenAIClient();
    if (!client) {
      throw new Error("API key not found. Please configure your settings first.");
    }
    const model = LIGHTWEIGHT_TASK_MODEL;

    const systemPrompt = `You are a prompt engineer for a coding agent. Rewrite the user's draft prompt so the agent can act on it precisely.

Rules:
- Keep the user's original intent, scope and language (Chinese stays Chinese, English stays English).
- Make the goal explicit; clarify vague verbs; keep any file paths, code identifiers, error messages and constraints verbatim.
- Structure multi-part requests as short numbered points when it helps.
- Do NOT invent requirements, do NOT ask questions, do NOT add explanations.
- Output ONLY the rewritten prompt text, no preamble, no quotes, no markdown fences.`;

    const response = await this.createChatCompletionStream(
      client,
      {
        model,
        temperature: 0.3,
        max_tokens: 2048,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: draft },
        ],
        ...buildThinkingRequestOptions(false, baseURL),
      },
      options?.signal ? { signal: options.signal } : undefined,
      undefined,
      {
        enabled: debugLogEnabled,
        location: "SessionManager.enhancePrompt",
        baseURL,
        params: { purpose: "prompt-enhance", model, temperature: 0.3 },
      }
    );
    this.throwIfAborted(options?.signal);

    const rawContent = response.choices?.[0]?.message?.content;
    const enhanced = typeof rawContent === "string" ? rawContent.trim() : "";
    return enhanced || draftPrompt;
  }

  private getSkillScanRoots(): Array<{ root: string; displayRoot: string }> {
    const homeDir = os.homedir();
    return [
      { root: path.join(this.projectRoot, ".deeporca", "skills"), displayRoot: "./.deeporca/skills" },
      { root: path.join(this.projectRoot, ".deepcode", "skills"), displayRoot: "./.deepcode/skills" },
      { root: path.join(this.projectRoot, ".agents", "skills"), displayRoot: "./.agents/skills" },
      { root: path.join(homeDir, ".deeporca", "skills"), displayRoot: "~/.deeporca/skills" },
      { root: path.join(homeDir, ".deepcode", "skills"), displayRoot: "~/.deepcode/skills" },
      { root: path.join(homeDir, ".agents", "skills"), displayRoot: "~/.agents/skills" },
      { root: this.getBundledSkillsRoot(), displayRoot: "bundled:" },
    ];
  }

  private getBundledSkillsRoot(): string {
    const extensionRoot = getExtensionRoot();
    const sourceRoot = path.join(extensionRoot, "templates", "skills", "bundled");

    // Source check keeps local development/tests on the checked-in templates.
    if (fs.existsSync(path.join(extensionRoot, "src", "session.ts")) && fs.existsSync(sourceRoot)) {
      return sourceRoot;
    }

    // In the published bundle, getExtensionRoot() resolves to dist/ and
    // bundled skills are copied to dist/bundled/ (not dist/templates/skills/bundled/).
    const distRoot = path.join(extensionRoot, "bundled");
    return fs.existsSync(distRoot) ? distRoot : sourceRoot;
  }

  /**
   * Resolve skill directories inside plugin packages. Each plugin package at
   * `templates/plugins/<pkg>/skills/<skill>/SKILL.md` contributes skills that
   * are tagged `pluginOwned: true` so the Skills tab can filter them out.
   */
  private getPluginSkillRoots(): Array<{ root: string; displayRoot: string; pkgName: string }> {
    const extensionRoot = getExtensionRoot();
    const pluginsDir = path.join(extensionRoot, "templates", "plugins");
    const distPluginsDir = path.join(extensionRoot, "plugins");
    const base =
      fs.existsSync(distPluginsDir) && !fs.existsSync(path.join(extensionRoot, "src", "session.ts"))
        ? distPluginsDir
        : pluginsDir;
    if (!fs.existsSync(base)) return [];
    const roots: Array<{ root: string; displayRoot: string; pkgName: string }> = [];
    try {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const pkgSkillsDir = path.join(base, entry.name, "skills");
        if (!fs.existsSync(pkgSkillsDir)) continue;
        roots.push({
          root: pkgSkillsDir,
          displayRoot: `plugin:${entry.name}`,
          pkgName: entry.name,
        });
      }
    } catch {
      // unreadable — skip
    }
    return roots;
  }

  async listSkills(sessionId?: string): Promise<SkillInfo[]> {
    const skillRoots = this.getSkillScanRoots();
    const enabledSkills = this.getResolvedSettings().enabledSkills ?? {};
    const skillsByName = new Map<string, SkillInfo>();

    const collectSkills = (root: string, displayRoot: string): SkillInfo[] => {
      if (!fs.existsSync(root)) {
        return [];
      }
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        return [];
      }

      const results: SkillInfo[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) {
          continue;
        }
        const skillName = entry.name;
        const skillPath = path.join(root, skillName, "SKILL.md");
        try {
          if (!fs.existsSync(skillPath)) {
            continue;
          }
          const stat = fs.statSync(skillPath);
          if (!stat.isFile()) {
            continue;
          }
        } catch {
          continue;
        }
        const displayPath =
          displayRoot === "bundled:" ? `bundled:${skillName}/SKILL.md` : `${displayRoot}/${skillName}/SKILL.md`;
        const skill = this.readSkillInfo(skillPath, displayPath, skillName);
        if (enabledSkills[skill.name] === false) {
          continue;
        }
        results.push(skill);
      }
      return results;
    };

    for (const { root, displayRoot } of skillRoots) {
      for (const skill of collectSkills(root, displayRoot)) {
        // Platform-conditional filtering: skills with known platform prefixes
        // are only loaded on matching OS. All other skills load on all platforms.
        if (!isSkillForCurrentPlatform(skill.name)) {
          continue;
        }
        if (!skillsByName.has(skill.name)) {
          skillsByName.set(skill.name, skill);
        }
      }
    }

    // Scan skills inside plugin packages (templates/plugins/<pkg>/skills/).
    // These are tagged pluginOwned so the Skills tab can hide them — they are
    // surfaced via the Plugins tab group cards instead. LLM auto-matching and
    // prompt injection still work exactly the same as standalone skills.
    for (const { root, displayRoot } of this.getPluginSkillRoots()) {
      for (const skill of collectSkills(root, displayRoot)) {
        if (!isSkillForCurrentPlatform(skill.name)) continue;
        if (!skillsByName.has(skill.name)) {
          skill.pluginOwned = true;
          skillsByName.set(skill.name, skill);
        }
      }
    }

    if (sessionId) {
      const loadedSkillKeys = this.getLoadedSkillKeys(sessionId);
      for (const skill of skillsByName.values()) {
        if (loadedSkillKeys.has(this.getSkillKey(skill)) || loadedSkillKeys.has(this.getSkillKeyByName(skill.name))) {
          skill.isLoaded = true;
        }
      }
    }

    return Array.from(skillsByName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Read the raw SKILL.md markdown for a skill by its (display) `path` — the same
   * value surfaced on SkillInfo. The desktop plugin center renders this document.
   * Resolution reuses resolveSkillPath so bundled/home/project display paths all
   * map back to a real file (with the bundled-traversal guard preserved).
   *
   * When `locale` is a Chinese variant (zh / zh-TW / zh-HK / zh-CN), a sibling
   * `SKILL.zh.md` is preferred if present, falling back to the original file.
   * Prompt injection should NOT pass a locale (it always uses the canonical doc).
   */
  readSkillDocument(skillPath: string, locale?: string): string {
    const basePath = this.resolveSkillPath(skillPath);
    if (isChineseLocale(locale)) {
      const zhPath = basePath.replace(/\.md$/i, ".zh.md");
      if (fs.existsSync(zhPath)) {
        return fs.readFileSync(zhPath, "utf8");
      }
    }
    if (!fs.existsSync(basePath)) {
      return "";
    }
    return fs.readFileSync(basePath, "utf8");
  }

  // ── Orca Built-in Plugins ────────────────────────────────────────────────────

  /** Root directory containing built-in plugin folders. */
  private getBuiltinPluginsRoot(): string {
    const extensionRoot = getExtensionRoot();
    const sourceRoot = path.join(extensionRoot, "templates", "plugins");

    // Source check keeps local development/tests on the checked-in templates.
    if (fs.existsSync(path.join(extensionRoot, "src", "session.ts")) && fs.existsSync(sourceRoot)) {
      return sourceRoot;
    }

    // In the published bundle, plugins are copied to dist/plugins/.
    const distRoot = path.join(extensionRoot, "plugins");
    return fs.existsSync(distRoot) ? distRoot : sourceRoot;
  }

  /**
   * List all built-in plugins. Plugin packages live at
   * `templates/plugins/<pkg>/` and may contain nested sub-plugins at
   * `templates/plugins/<pkg>/plugins/<sub>/plugin.json`.
   * We scan BOTH the top level (for packages that ARE plugins themselves) and
   * the nested `plugins/` subdirectory inside each package.
   */
  listBuiltinPlugins(): BuiltinPluginInfo[] {
    const root = this.getBuiltinPluginsRoot();
    if (!fs.existsSync(root)) {
      return [];
    }
    const plugins: BuiltinPluginInfo[] = [];

    const tryReadPlugin = (dir: string, entryName: string): void => {
      const manifestPath = path.join(dir, entryName, "plugin.json");
      try {
        if (!fs.existsSync(manifestPath)) return;
        const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
        plugins.push({
          name: typeof raw.name === "string" ? raw.name : entryName,
          version: typeof raw.version === "string" ? raw.version : "1.0.0",
          description: typeof raw.description === "string" ? raw.description : "",
          category: typeof raw.category === "string" ? raw.category : "general",
          removable: false,
          path: `builtin-plugin:${entryName}`,
        });
      } catch {
        // skip
      }
    };

    try {
      const packages = fs.readdirSync(root, { withFileTypes: true });
      for (const pkgEntry of packages) {
        if (!pkgEntry.isDirectory() && !pkgEntry.isSymbolicLink()) continue;
        const pkgDir = path.join(root, pkgEntry.name);
        // Check if the package itself has a plugin.json (legacy flat layout)
        tryReadPlugin(root, pkgEntry.name);
        // Scan nested plugins/ subdirectory
        const nestedPluginsDir = path.join(pkgDir, "plugins");
        if (fs.existsSync(nestedPluginsDir)) {
          try {
            for (const subEntry of fs.readdirSync(nestedPluginsDir, { withFileTypes: true })) {
              if (!subEntry.isDirectory() && !subEntry.isSymbolicLink()) continue;
              tryReadPlugin(nestedPluginsDir, subEntry.name);
            }
          } catch {
            // unreadable — skip
          }
        }
      }
    } catch {
      // unreadable — return empty
    }
    return plugins.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Read the PLUGIN.md instruction document for a built-in plugin by its name.
   * Used by the desktop plugin detail pane and by prompt injection.
   *
   * When `locale` is a Chinese variant (zh / zh-TW / zh-HK / zh-CN), a sibling
   * `PLUGIN.zh.md` is preferred if present, falling back to the original file.
   * Prompt injection should NOT pass a locale (it always uses the canonical doc).
   */
  readBuiltinPluginDoc(pluginName: string, locale?: string): string {
    const root = this.getBuiltinPluginsRoot();
    const resolvedRoot = path.resolve(root);
    const tryRead = (p: string): string | null => {
      try {
        return fs.readFileSync(p, "utf8");
      } catch {
        return null;
      }
    };

    // Search candidate paths: top-level (legacy flat layout) and nested inside
    // any plugin package's plugins/ subdirectory.
    const candidates: string[] = [path.join(root, pluginName, "PLUGIN.md")];
    try {
      for (const pkgEntry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!pkgEntry.isDirectory() && !pkgEntry.isSymbolicLink()) continue;
        const nestedDir = path.join(root, pkgEntry.name, "plugins", pluginName);
        candidates.push(path.join(nestedDir, "PLUGIN.md"));
      }
    } catch {
      // unreadable root — top-level candidate is enough
    }

    for (const candidate of candidates) {
      const resolvedPath = path.resolve(candidate);
      // Traversal guard
      if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`) && resolvedPath !== resolvedRoot) {
        continue;
      }
      if (isChineseLocale(locale)) {
        const zhPath = resolvedPath.replace(/\.md$/i, ".zh.md");
        const zh = tryRead(zhPath);
        if (zh !== null) return zh;
      }
      const content = tryRead(resolvedPath);
      if (content !== null) return content;
    }
    return "";
  }

  /**
   * Resolve built-in plugin groups from `skill.plugin.md` files. Each plugin
   * package directory `templates/plugins/<pkg>/skill.plugin.md` defines one
   * group via YAML frontmatter (name, description, category, skills[], mcp[],
   * plugins[]). The skill/mcp/plugin arrays are matched against the live lists
   * to produce concrete group members.
   *
   * This is display-only metadata — it never affects loading, enabling, or
   * execution of skills/MCP/plugins.
   */
  listBuiltinPluginGroups(
    skills: SkillInfo[],
    mcpServers: McpServerConfigEntry[],
    builtinPlugins: BuiltinPluginInfo[]
  ): BuiltinPluginGroup[] {
    const root = this.getBuiltinPluginsRoot();
    if (!fs.existsSync(root)) return [];

    // Collect manifests from skill.plugin.md files.
    const manifests: BuiltinPluginGroupManifest[] = [];
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const pluginMdPath = path.join(root, entry.name, "skill.plugin.md");
        if (!fs.existsSync(pluginMdPath)) continue;
        try {
          const raw = fs.readFileSync(pluginMdPath, "utf8");
          const parsed = matter(raw);
          const data = parsed.data as Record<string, unknown>;
          // Extract skill names from frontmatter `skills` array (each item has {name, description})
          const skillItems = Array.isArray(data.skills) ? (data.skills as Array<Record<string, unknown>>) : [];
          const skillNames = skillItems.map((s) => (typeof s?.name === "string" ? s.name : "")).filter(Boolean);
          // Extract mcp names
          const mcpNames = Array.isArray(data.mcp) ? (data.mcp as string[]) : [];
          // Extract plugin names
          const pluginNames = Array.isArray(data.plugins) ? (data.plugins as string[]) : [];
          // Extract action ids (each item has {id, description} or is a string)
          const actionItems = Array.isArray(data.actions)
            ? (data.actions as Array<Record<string, unknown> | string>)
            : [];
          const actionIds = actionItems
            .map((a) => (typeof a === "string" ? a : typeof a?.id === "string" ? a.id : ""))
            .filter(Boolean);
          manifests.push({
            id: typeof data.name === "string" ? data.name : entry.name,
            name: typeof data.name === "string" ? data.name : entry.name,
            description: typeof data.description === "string" ? data.description : "",
            category: typeof data.category === "string" ? data.category : "general",
            icon: typeof data.icon === "string" ? data.icon : undefined,
            skills: skillNames.length > 0 ? skillNames : undefined,
            mcp: mcpNames.length > 0 ? mcpNames : undefined,
            plugins: pluginNames.length > 0 ? pluginNames : undefined,
            actions: actionIds.length > 0 ? actionIds : undefined,
          });
        } catch {
          // unreadable plugin.md — skip
        }
      }
    } catch {
      // unreadable dir — return empty
    }

    const matchName = (patterns: string[] | undefined, name: string): boolean => {
      if (!patterns) return false;
      return patterns.some((p) => {
        if (p.endsWith(":*")) return name.startsWith(p.slice(0, -1));
        if (p.endsWith("-*")) return name.startsWith(p.slice(0, -1));
        return p === name;
      });
    };

    const matchedSkills = new Set<string>();
    const matchedMcp = new Set<string>();
    const matchedPlugins = new Set<string>();
    const matchedActions = new Set<string>();

    // All registered action ids (for matching against group declarations).
    const allActionDefs = this.actionRegistry.toToolDefinitions();
    const allActionEntries = allActionDefs.map((d) => ({
      id: d.function.name,
      description: d.function.description ?? "",
    }));

    // Skills that are ALSO shipped as plugins — exclude from skills list to
    // avoid duplicate display within a group.
    const pluginNamesSet = new Set(builtinPlugins.map((p) => p.name));

    const groups: BuiltinPluginGroup[] = manifests.map((m) => {
      const groupSkills = skills.filter((s) => {
        if (pluginNamesSet.has(s.name)) return false;
        if (matchName(m.skills, s.name)) {
          matchedSkills.add(s.name);
          return true;
        }
        return false;
      });
      const groupMcp = mcpServers.filter((e) => {
        if (matchName(m.mcp, e.name)) {
          matchedMcp.add(e.name);
          return true;
        }
        return false;
      });
      const groupPlugins = builtinPlugins.filter((p) => {
        if (matchName(m.plugins, p.name)) {
          matchedPlugins.add(p.name);
          return true;
        }
        return false;
      });
      // Match actions by id prefix (e.g. "review.*" matches "review.run", "review.full").
      const groupActions = allActionEntries.filter((a) => {
        if (matchName(m.actions, a.id)) {
          matchedActions.add(a.id);
          return true;
        }
        return false;
      });
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        category: m.category,
        icon: m.icon,
        platform: m.platform,
        skills: groupSkills,
        mcpServers: groupMcp,
        plugins: groupPlugins,
        actions: groupActions,
      };
    });

    // Catch-all "other" group for built-in items not claimed by any plugin package.
    const leftoverSkills = skills.filter((s) => !matchedSkills.has(s.name));
    const leftoverMcp = mcpServers.filter((e) => !matchedMcp.has(e.name));
    const leftoverPlugins = builtinPlugins.filter((p) => !matchedPlugins.has(p.name));
    const leftoverActions = allActionEntries.filter((a) => !matchedActions.has(a.id));
    if (leftoverSkills.length || leftoverMcp.length || leftoverPlugins.length || leftoverActions.length) {
      groups.push({
        id: "other",
        name: "Other",
        description: "Built-in items not assigned to a plugin package.",
        category: "other",
        skills: leftoverSkills,
        mcpServers: leftoverMcp,
        plugins: leftoverPlugins,
        actions: leftoverActions,
      });
    }

    return groups;
  }

  private resolveSkillPath(skillPath: string): string {
    if (skillPath.startsWith("plugin:")) {
      // Plugin-owned skill: path format is "plugin:<pkgName>/<skillDir>/SKILL.md"
      const relativePath = skillPath.slice("plugin:".length);
      const sepIdx = relativePath.indexOf("/");
      if (sepIdx > 0) {
        const pkgName = relativePath.slice(0, sepIdx);
        const skillRelPath = relativePath.slice(sepIdx + 1);
        const pluginRoots = this.getPluginSkillRoots();
        const root = pluginRoots.find((r) => r.pkgName === pkgName);
        if (root) {
          const resolvedPath = path.resolve(root.root, skillRelPath);
          const resolvedRoot = path.resolve(root.root);
          if (resolvedPath === resolvedRoot || !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
            return path.join(root.root, "__invalid_plugin_skill__");
          }
          return resolvedPath;
        }
      }
      return path.join(os.homedir(), "__unresolved_plugin_skill__");
    }
    if (skillPath.startsWith("bundled:")) {
      const relativePath = skillPath.slice("bundled:".length);
      const root = this.getBundledSkillsRoot();
      const resolvedPath = path.resolve(root, relativePath);
      const resolvedRoot = path.resolve(root);
      if (resolvedPath === resolvedRoot || !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
        return path.join(root, "__invalid_bundled_skill__");
      }
      return resolvedPath;
    }
    if (skillPath.startsWith("~/")) {
      return path.join(os.homedir(), skillPath.slice(2));
    }
    if (skillPath.startsWith("~\\")) {
      return path.join(os.homedir(), skillPath.slice(2));
    }
    if (skillPath.startsWith("./")) {
      return path.join(this.projectRoot, skillPath.slice(2));
    }
    if (skillPath.startsWith(".\\")) {
      return path.join(this.projectRoot, skillPath.slice(2));
    }
    if (path.isAbsolute(skillPath)) {
      return skillPath;
    }
    return path.join(os.homedir(), skillPath);
  }

  private buildSkillPrompt(skill: SkillInfo): string {
    const skillPath = this.resolveSkillPath(skill.path);
    return buildSkillDocumentsPrompt([
      {
        name: skill.name,
        content: fs.readFileSync(skillPath, "utf8"),
        path: skillPath,
        skillFilePath: skillPath,
      },
    ]);
  }

  /**
   * Build the combined prompt from all built-in plugin packages. Each package's
   * `skill.plugin.md` body (markdown after frontmatter) is injected. Additionally,
   * any nested `plugins/<sub>/PLUGIN.md` files are included for backwards
   * compatibility with legacy plugin descriptors.
   */
  private getBuiltinPluginPrompt(): string {
    const root = this.getBuiltinPluginsRoot();
    if (!fs.existsSync(root)) {
      return "";
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return "";
    }

    const blocks: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      const pkgDir = path.join(root, entry.name);

      // 1. Read skill.plugin.md body (primary — the package-level agent doc)
      const pluginMdPath = path.join(pkgDir, "skill.plugin.md");
      try {
        if (fs.existsSync(pluginMdPath)) {
          const raw = fs.readFileSync(pluginMdPath, "utf8");
          const parsed = matter(raw);
          const content = (parsed.content ?? "").trim();
          if (content) {
            const name = (parsed.data as Record<string, unknown>)?.name ?? entry.name;
            blocks.push(`<builtin-plugin name="${name}">
${content}
</builtin-plugin>`);
          }
        }
      } catch {
        // skip
      }

      // 2. Read nested plugins/<sub>/PLUGIN.md (sub-plugin descriptors)
      const nestedPluginsDir = path.join(pkgDir, "plugins");
      if (fs.existsSync(nestedPluginsDir)) {
        try {
          for (const sub of fs.readdirSync(nestedPluginsDir, { withFileTypes: true })) {
            if (!sub.isDirectory() && !sub.isSymbolicLink()) continue;
            const subDoc = path.join(nestedPluginsDir, sub.name, "PLUGIN.md");
            if (!fs.existsSync(subDoc)) continue;
            const content = fs.readFileSync(subDoc, "utf8").trim();
            if (content) {
              blocks.push(`<builtin-plugin name="${sub.name}">
${content}
</builtin-plugin>`);
            }
          }
        } catch {
          // skip
        }
      }
    }

    if (blocks.length === 0) {
      return "";
    }
    return `The following built-in plugins are always available. Use them when the task matches their capabilities:\n${blocks.join("\n\n")}`;
  }

  private readSkillInfo(skillPath: string, displayPath: string, fallbackName: string): SkillInfo {
    const fallbackSkill: SkillInfo = {
      name: fallbackName.replace(/_/g, "-"),
      path: displayPath,
      description: "",
    };

    try {
      const skillMd = fs.readFileSync(skillPath, "utf8");
      const parsed = matter(skillMd);
      const metadata = parsed.data.metadata;
      const allowImplicitInvocation =
        metadata &&
        typeof metadata === "object" &&
        !Array.isArray(metadata) &&
        (metadata as Record<string, unknown>)["allow-implicit-invocation"] === false
          ? false
          : undefined;
      const stringList = (value: unknown): string[] | undefined => {
        if (!Array.isArray(value)) return undefined;
        const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
        return items.length > 0 ? items : undefined;
      };
      return {
        name:
          typeof parsed.data.name === "string" && parsed.data.name.trim()
            ? parsed.data.name.trim()
            : fallbackSkill.name,
        path: displayPath,
        description: typeof parsed.data.description === "string" ? parsed.data.description.trim() : "",
        allowImplicitInvocation,
        categories: stringList(parsed.data.categories),
        inputs: stringList(parsed.data.inputs),
        outputs: stringList(parsed.data.outputs),
      };
    } catch {
      return fallbackSkill;
    }
  }

  private getSkillKey(skill: Pick<SkillInfo, "path">): string {
    return `path:${skill.path}`;
  }

  private getSkillKeyByName(name: string): string {
    return `name:${name}`;
  }

  private getLoadedSkillKeys(sessionId: string): Set<string> {
    const loadedSkillKeys = new Set<string>();
    for (const message of this.listSessionMessages(sessionId)) {
      if (message.role !== "system" || !message.meta?.skill) {
        continue;
      }
      loadedSkillKeys.add(this.getSkillKey(message.meta.skill));
      loadedSkillKeys.add(this.getSkillKeyByName(message.meta.skill.name));
    }
    return loadedSkillKeys;
  }

  private dedupeSkills(skills?: SkillInfo[]): SkillInfo[] | undefined {
    if (!skills || skills.length === 0) {
      return undefined;
    }

    const dedupedSkills = new Map<string, SkillInfo>();
    for (const skill of skills) {
      if (!skill?.name || !skill?.path) {
        continue;
      }
      const key = this.getSkillKey(skill);
      const existingSkill = dedupedSkills.get(key);
      dedupedSkills.set(key, {
        ...existingSkill,
        ...skill,
        description: skill.description ?? existingSkill?.description ?? "",
        isLoaded: Boolean(existingSkill?.isLoaded || skill.isLoaded),
      });
    }

    return Array.from(dedupedSkills.values());
  }

  private async normalizeSkills(skills?: SkillInfo[], sessionId?: string): Promise<SkillInfo[] | undefined> {
    const dedupedSkills = this.dedupeSkills(skills);
    if (!dedupedSkills || dedupedSkills.length === 0) {
      return undefined;
    }

    const availableSkills = await this.listSkills(sessionId);
    const availableSkillsByKey = new Map<string, SkillInfo>();
    for (const skill of availableSkills) {
      availableSkillsByKey.set(this.getSkillKey(skill), skill);
      availableSkillsByKey.set(this.getSkillKeyByName(skill.name), skill);
    }

    return dedupedSkills.map((skill) => {
      const matchedSkill =
        availableSkillsByKey.get(this.getSkillKey(skill)) ??
        availableSkillsByKey.get(this.getSkillKeyByName(skill.name));
      if (!matchedSkill) {
        return skill;
      }
      return {
        ...matchedSkill,
        ...skill,
        description: matchedSkill.description || skill.description,
        isLoaded: Boolean(matchedSkill.isLoaded || skill.isLoaded),
      };
    });
  }

  private appendSkillMessages(sessionId: string, skills?: SkillInfo[]): void {
    if (!skills || skills.length === 0) {
      return;
    }

    for (const skill of skills) {
      if (skill.isLoaded) {
        continue;
      }
      const skillPrompt = this.buildSkillPrompt(skill);
      const skillMessage = this.buildSkillMessage(sessionId, skillPrompt, skill);
      this.appendSessionMessage(sessionId, skillMessage);
      this.onAssistantMessage(skillMessage, true);
    }
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  setActiveSessionId(sessionId: string | null): void {
    this.activeSessionId = sessionId;
  }

  addSessionSystemMessage(sessionId: string, content: string, visible?: boolean, meta?: MessageMeta): void {
    const message = this.buildSystemMessage(sessionId, content, null, visible, meta);
    if (sessionId) this.appendSessionMessage(sessionId, message);
    this.onAssistantMessage(message, false);
  }

  async handleUserPrompt(userPrompt: UserPromptContent): Promise<void> {
    const controller = new AbortController();
    this.activePromptController = controller;

    try {
      if (!this.activeSessionId || !this.getSession(this.activeSessionId)) {
        await this.createSession(userPrompt, controller);
      } else {
        await this.replySession(this.activeSessionId, userPrompt, controller);
      }
    } catch (error) {
      if (!this.isAbortLikeError(error) && !controller.signal.aborted) {
        throw error;
      }
    } finally {
      if (this.activePromptController === controller) {
        this.activePromptController = null;
      }
    }
  }

  async createSession(userPrompt: UserPromptContent, controller?: AbortController): Promise<string> {
    this.reportNewPrompt();
    const signal = controller?.signal;
    this.throwIfAborted(signal);

    const sessionId = crypto.randomUUID();
    this.ensureFileHistorySession(sessionId);
    const now = new Date().toISOString();
    const index = this.loadSessionsIndex();
    const entry: SessionEntry = {
      id: sessionId,
      summary: userPrompt.text ? userPrompt.text.slice(0, 100) : "[Image Prompt]",
      assistantReply: null,
      assistantThinking: null,
      assistantRefusal: null,
      toolCalls: null,
      status: "pending",
      failReason: null,
      usage: null,
      usagePerModel: null,
      activeTokens: 0,
      createTime: now,
      updateTime: now,
      processes: null,
      planMode: Boolean(userPrompt.planMode),
    };
    index.entries.push(entry);
    const sortedEntries = index.entries.slice().sort((a, b) => {
      const aTime = Date.parse(a.updateTime);
      const bTime = Date.parse(b.updateTime);
      if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
        return b.updateTime.localeCompare(a.updateTime);
      }
      return bTime - aTime;
    });
    const keptEntries = sortedEntries.slice(0, MAX_SESSION_ENTRIES);
    const keptIds = new Set(keptEntries.map((item) => item.id));
    const droppedEntries = sortedEntries.filter((item) => !keptIds.has(item.id));
    index.entries = keptEntries;
    // Session creation is critical — flush immediately (not debounced).
    this.pendingIndex = index;
    this.flushSessionsIndex();
    for (const dropped of droppedEntries) {
      this.cleanupSessionResources(dropped.id, {
        removeMessages: true,
        processIds: this.getProcessIds(dropped.processes ?? null),
      });
    }

    const promptToolOptions = this.getPromptToolOptions();

    // System-message prefix — ordered MOST → LEAST stable so the DeepSeek prefix
    // cache (which keys on the contiguous leading bytes) shares the largest
    // possible stable head across sessions. The date/model line is intentionally
    // absent here: it varies day-to-day and per model switch, so it is injected
    // per-turn as a transient user-message tail (see activateSession) instead of
    // baked into this cache-stable prefix.
    //   1. base system prompt + tool docs        — immutable per build
    //   2. AGENTS.md standing instructions        — rarely change within a project
    //   3. default skill + built-in plugin docs   — stable per skill/plugin set
    //   4. machine-level workspace environment    — stable per machine/project
    const systemPrompt = getSystemPrompt(this.projectRoot, promptToolOptions);
    this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, systemPrompt));

    const agentInstructions = this.loadAgentInstructions();
    if (agentInstructions) {
      this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, agentInstructions));
    }

    const defaultSkillPrompt = getDefaultSkillPrompt({ enabledSkills: this.getResolvedSettings().enabledSkills });
    if (defaultSkillPrompt) {
      this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, defaultSkillPrompt));
    }

    // Orca built-in plugins: always inject their instruction docs into the session.
    const builtinPluginPrompt = this.getBuiltinPluginPrompt();
    if (builtinPluginPrompt) {
      this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, builtinPluginPrompt));
    }

    this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, getStableRuntimeContext(this.projectRoot)));

    // Memory recall — inject cross-session memories before activation.
    // Uses a 2s race: if the Gateway responds fast, memories are injected
    // synchronously before the LLM sees the first message. If it's slow,
    // we proceed without memories rather than blocking session creation.
    if (this.memoryProvider?.isAvailable() && userPrompt.text) {
      try {
        const recall = await Promise.race([
          this.memoryProvider.recall(userPrompt.text, sessionId),
          new Promise<null>((r) => setTimeout(() => r(null), 2000)),
        ]);
        if (recall) {
          const memoryPrompt = getMemoryPrompt(recall);
          if (memoryPrompt) {
            this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, memoryPrompt));
          }
        }
      } catch {
        // Memory recall must never block session creation.
      }
    }

    this.appendBehaviorContext(sessionId);

    this.appendPlanModeTransitionMessages(sessionId, false, Boolean(userPrompt.planMode));

    this.recordUserPromptCheckpoint(sessionId);
    const userMessage = this.buildUserMessage(sessionId, userPrompt);
    this.appendSessionMessage(sessionId, userMessage);

    if (userPrompt.text) {
      const skills = await this.listSkills();
      const skillNames = await this.identifyMatchingSkillNames(skills, userPrompt.text, { signal, sessionId });
      this.throwIfAborted(signal);
      const skillSet = new Set(skillNames);
      const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
      if (Array.isArray(userPrompt.skills)) {
        userPrompt.skills.push(...matchedSkill);
      } else if (matchedSkill.length > 0) {
        userPrompt.skills = matchedSkill;
      }
    }
    userPrompt.skills = await this.normalizeSkills(userPrompt.skills);
    this.throwIfAborted(signal);

    this.appendSkillMessages(sessionId, userPrompt.skills);

    this.activeSessionId = sessionId;
    await this.activateSession(sessionId, controller);
    return sessionId;
  }

  async replySession(sessionId: string, userPrompt: UserPromptContent, controller?: AbortController): Promise<void> {
    const signal = controller?.signal;
    this.throwIfAborted(signal);
    // Release memory from previously active session's file-state caches.
    // Without this, every file ever read/written in every session stays in
    // memory until the session is explicitly deleted.
    if (this.activeSessionId && this.activeSessionId !== sessionId) {
      this.messageCache.delete(this.activeSessionId);
      // Note: we don't clearSessionState for the old session because the user
      // might switch back — but file-state maps grow large; a future enhancement
      // could use an LRU eviction policy here.
    }
    appendProjectPermissionAllows(this.projectRoot, userPrompt.alwaysAllows, {
      inheritedPermissions: this.getResolvedSettings().permissions,
    });
    const now = new Date().toISOString();
    const previousPlanMode = Boolean(this.getSession(sessionId)?.planMode);
    const nextPlanMode = Boolean(userPrompt.planMode);
    const updated = this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "pending",
      failReason: null,
      askPermissions: undefined,
      planMode: nextPlanMode,
      updateTime: now,
    }));

    if (!updated) {
      await this.createSession(userPrompt, controller);
      return;
    }

    this.appendPlanModeTransitionMessages(sessionId, previousPlanMode, nextPlanMode);

    if (hasUserPermissionReplies(userPrompt) && this.hasTrailingPendingToolCalls(sessionId)) {
      this.activeSessionId = sessionId;
      await this.activateSession(sessionId, controller, userPrompt);
      return;
    }

    if (this.isContinuePrompt(userPrompt)) {
      this.activeSessionId = sessionId;
      await this.activateSession(sessionId, controller, userPrompt);
      return;
    }

    this.reportNewPrompt();

    this.ensureFileHistorySession(sessionId);
    const checkpoint = this.recordUserPromptCheckpoint(sessionId);
    if (checkpoint.changedFilePaths.length) {
      const content = `Note that the user manually modified these files:\n${checkpoint.changedFilePaths.join("\n")}`;
      this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, content));
    }
    const userMessage = this.buildUserMessage(sessionId, userPrompt);
    this.appendSessionMessage(sessionId, userMessage);

    if (userPrompt.text) {
      const skills = await this.listSkills(sessionId);
      const skillNames = await this.identifyMatchingSkillNames(skills, userPrompt.text, { signal, sessionId });
      this.throwIfAborted(signal);
      const skillSet = new Set(skillNames);
      const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
      if (Array.isArray(userPrompt.skills)) {
        userPrompt.skills.push(...matchedSkill);
      } else if (matchedSkill.length > 0) {
        userPrompt.skills = matchedSkill;
      }
    }
    userPrompt.skills = await this.normalizeSkills(userPrompt.skills, sessionId);
    this.throwIfAborted(signal);

    this.appendSkillMessages(sessionId, userPrompt.skills);
    this.activeSessionId = sessionId;
    await this.activateSession(sessionId, controller);
  }

  private isContinuePrompt(userPrompt: UserPromptContent): boolean {
    return (
      typeof userPrompt.text === "string" &&
      userPrompt.text.trim() === "/continue" &&
      (!userPrompt.imageUrls || userPrompt.imageUrls.length === 0) &&
      (!userPrompt.skills || userPrompt.skills.length === 0)
    );
  }

  async activateSession(
    sessionId: string,
    controller?: AbortController,
    permissionPrompt?: UserPromptContent
  ): Promise<void> {
    const startedAt = Date.now();
    const { client, model, baseURL, temperature, thinkingEnabled, reasoningEffort, debugLogEnabled, notify, env } =
      this.createOpenAIClient();
    const now = new Date().toISOString();
    rebuildSessionStateFromHistory(sessionId, this.listSessionMessages(sessionId));

    if (!client) {
      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "failed",
        failReason: "API key not found",
        updateTime: now,
      }));
      this.onAssistantMessage(
        this.buildAssistantMessage(
          sessionId,
          `API key not found. Please configure ${getUserSettingsPath()} or ${getProjectSettingsPath(this.projectRoot)}.`,
          null
        ),
        false
      );
      this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
      return;
    }

    const sessionController = controller ?? new AbortController();
    if (sessionController.signal.aborted) {
      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "interrupted",
        failReason: "interrupted",
        updateTime: now,
      }));
      this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
      return;
    }

    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "processing",
      updateTime: now,
    }));

    this.sessionControllers.set(sessionId, sessionController);
    // A fresh activation must not inherit a stale pause request from a previous run.
    this.pauseRequestedSessions.delete(sessionId);
    // Branch-level resume (task-tree P1): restore the bound branch as active.
    this.restoreTaskBranchForSession(sessionId);

    // The activation loop as a local closure: all loop state (iteration count,
    // pending tool calls, consumed permission replies) is per-run, so a failed
    // run can be replayed cleanly by the auto-recovery wrapper below.
    const runActivationLoop = async (): Promise<void> => {
      const maxIterations = 80000; // about 1K RMB cost
      let toolCalls: unknown[] | null = null;

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (this.isInterrupted(sessionId)) {
          return;
        }

        if (this.consumePauseRequest(sessionId)) {
          this.markSessionPaused(sessionId);
          return;
        }

        const session = this.getSession(sessionId);
        if (session == null || session.status === "interrupted" || session.status === "failed") {
          return;
        }

        const pendingToolCallMessage = this.messageConverter.getTrailingPendingToolCallMessage(
          this.listSessionMessages(sessionId)
        );
        if (pendingToolCallMessage.toolCalls.length > 0) {
          const toolAppendResult = await this.appendToolMessages(sessionId, pendingToolCallMessage.toolCalls, {
            permissionOverrides: permissionPrompt?.permissions,
            messagePermissions: pendingToolCallMessage.message?.meta?.permissions,
          });
          await this.appendDeferredPermissionPrompt(sessionId, permissionPrompt, sessionController);
          // Permission replies are one-shot: do not reuse decisions or append the deferred user prompt again on later tool-call batches.
          permissionPrompt = undefined;
          if (this.isInterrupted(sessionId)) {
            return;
          }
          if (toolAppendResult.waitingForUser) {
            this.updateSessionEntry(sessionId, (entry) => ({
              ...entry,
              toolCalls: pendingToolCallMessage.toolCalls,
              status: "waiting_for_user",
              updateTime: new Date().toISOString(),
            }));
            return;
          }
        }

        const compactPromptTokenThreshold = getCompactPromptTokenThreshold(model);
        if (session.activeTokens > compactPromptTokenThreshold) {
          const message = this.buildAssistantMessage(
            sessionId,
            "The conversation is getting long, compacting...",
            null
          );
          message.meta = { asThinking: true };
          this.onAssistantMessage(message, false);
          await this.compactSession(sessionId, sessionController.signal);
        }

        const messages = this.messageConverter.buildMessages(
          this.listSessionMessages(sessionId),
          thinkingEnabled,
          model
        );
        const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort);
        const response = await this.createChatCompletionStream(
          client,
          {
            model,
            ...(temperature !== undefined ? { temperature } : {}),
            messages,
            tools: getTools(this.getPromptToolOptions(), [
              ...(await this.getRoutedMcpTools(sessionId)),
              // defineAction LLM surface: registered actions appear as tools the
              // agent can call (e.g. system_ping). Dispatched in ToolExecutor.
              ...this.actionRegistry.toToolDefinitions(),
            ]),
            ...thinkingOptions,
          },
          { signal: sessionController.signal },
          sessionId,
          {
            enabled: debugLogEnabled,
            location: "SessionManager.activateSession",
            baseURL,
            params: { iteration, temperature, thinkingEnabled, reasoningEffort },
          }
        );

        const message = response.choices?.[0]?.message;
        const rawContent = message?.content;
        const content = typeof rawContent === "string" ? rawContent : "";
        const rawToolCalls = (message as { tool_calls?: unknown[] } | undefined)?.tool_calls ?? null;
        toolCalls = this.normalizeLlmToolCalls(rawToolCalls);
        const rawThinking = (message as { reasoning_content?: unknown } | undefined)?.reasoning_content;
        const thinking = typeof rawThinking === "string" ? rawThinking : null;
        const refusal = (message as { refusal?: string } | undefined)?.refusal ?? null;
        // const html = content ? this.renderMarkdown(content) : "";

        if (this.isInterrupted(sessionId)) {
          return;
        }
        const assistantMessage = this.buildAssistantMessage(sessionId, content, toolCalls, thinking);
        const permissionPlan = toolCalls
          ? computeToolCallPermissions({
              sessionId,
              projectRoot: this.projectRoot,
              toolCalls,
              settings: this.getResolvedSettings().permissions,
              forceAskScopes: this.getSession(sessionId)?.planMode ? PLAN_MODE_FORCE_ASK_SCOPES : undefined,
              readPermissionExemptPaths: this.getSkillScanRoots().map((entry) => entry.root),
              resolveSnippetPath: (id, snippetId) => getSnippet(id, snippetId)?.filePath,
            })
          : null;
        if (permissionPlan) {
          assistantMessage.meta = {
            ...(assistantMessage.meta ?? {}),
            permissions: permissionPlan.permissions,
          };
        }
        this.appendSessionMessage(sessionId, assistantMessage);
        this.onAssistantMessage(assistantMessage, true);

        // Second pause checkpoint: pausing here leaves the tool calls pending, so a
        // later resume re-enters the loop and executes them via the trailing-pending path.
        if (this.consumePauseRequest(sessionId)) {
          this.markSessionPaused(sessionId);
          return;
        }

        let waitingForUser = false;
        const responseUsage = response.usage ?? null;
        if (toolCalls) {
          if (permissionPlan?.askPermissions.length) {
            this.updateSessionEntry(sessionId, (entry) => ({
              ...entry,
              assistantReply: content,
              assistantThinking: thinking,
              assistantRefusal: refusal,
              toolCalls,
              usage: accumulateUsage(entry.usage, responseUsage),
              usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
              activeTokens: getLastPromptTokens(responseUsage),
              status: "ask_permission",
              failReason: null,
              askPermissions: permissionPlan.askPermissions,
              updateTime: new Date().toISOString(),
            }));
            return;
          }
          const toolAppendResult = await this.appendToolMessages(sessionId, toolCalls, {
            messagePermissions: permissionPlan?.permissions,
          });
          waitingForUser = toolAppendResult.waitingForUser;
        }

        if (this.isInterrupted(sessionId)) {
          return;
        }

        this.updateSessionEntry(sessionId, (entry) => ({
          ...entry,
          assistantReply: content,
          assistantThinking: thinking,
          assistantRefusal: refusal,
          toolCalls,
          usage: accumulateUsage(entry.usage, responseUsage),
          usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
          activeTokens: getLastPromptTokens(responseUsage),
          status: refusal ? "failed" : waitingForUser ? "waiting_for_user" : toolCalls ? "processing" : "completed",
          failReason: refusal ? refusal : entry.failReason,
          askPermissions: undefined,
          updateTime: new Date().toISOString(),
        }));

        if (refusal) {
          return;
        }

        if (waitingForUser) {
          return;
        }

        if (!toolCalls) {
          return;
        }
      }

      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "completed",
        updateTime: new Date().toISOString(),
      }));
      this.onAssistantMessage(
        this.buildAssistantMessage(
          sessionId,
          "The AI agent has taken several steps but hasn't reached a conclusion yet. Do you want to continue?",
          null
        ),
        false
      );
    };

    try {
      await this.runActivationLoopWithAutoRecovery(runActivationLoop, sessionId, sessionController);
    } catch (error) {
      const errMessage = describeLlmError(error);
      const aborted = this.isAbortLikeError(error) || sessionController.signal.aborted;
      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: aborted ? "interrupted" : "failed",
        failReason: aborted ? "interrupted" : errMessage,
        updateTime: new Date().toISOString(),
      }));

      if (!aborted) {
        this.onAssistantMessage(this.buildAssistantMessage(sessionId, `Request failed: ${errMessage}`, null), false);
      }
    } finally {
      if (this.sessionControllers.get(sessionId) === sessionController) {
        this.sessionControllers.delete(sessionId);
      }
      this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
      this.maybeSyncCodegraphIndex(sessionId);
      this.maybeSyncCrgIndex(sessionId);
      this.maybeSyncWikiIndex(sessionId);
      this.maybeRunDiagnosticsCheck(sessionId);
      this.maybeCaptureMemory(sessionId);
    }
  }

  /**
   * Run one activation loop with exactly one shot of automatic recovery:
   * a context-window overflow is compacted then retried, an idle-timeout
   * failure is retried as-is. Everything else — and any second failure —
   * keeps the original fail path. Aborts always propagate untouched, and
   * quota errors are never retried (retrying cannot fix an empty balance).
   */
  private async runActivationLoopWithAutoRecovery(
    runLoop: () => Promise<void>,
    sessionId: string,
    sessionController: AbortController
  ): Promise<void> {
    try {
      await runLoop();
    } catch (error) {
      if (this.isAbortLikeError(error) || sessionController.signal.aborted) {
        throw error;
      }
      const category = classifyLlmError(error);
      if (category !== "CONTEXT_WINDOW_EXCEEDED" && category !== "TIMEOUT") {
        throw error;
      }
      if (this.isInterrupted(sessionId)) {
        return;
      }
      const notice = this.buildAssistantMessage(
        sessionId,
        category === "CONTEXT_WINDOW_EXCEEDED"
          ? "The conversation exceeded the context window. Compacting the history and retrying once..."
          : "The model stream stalled. Retrying the request once...",
        null
      );
      notice.meta = { asThinking: true };
      this.onAssistantMessage(notice, false);
      if (category === "CONTEXT_WINDOW_EXCEEDED") {
        try {
          await this.compactSession(sessionId, sessionController.signal);
        } catch (compactionError) {
          if (this.isAbortLikeError(compactionError) || sessionController.signal.aborted) {
            throw compactionError;
          }
          // Compaction itself failed — surface the original overflow error.
          throw error;
        }
      }
      await runLoop();
    }
  }

  async compactSession(sessionId: string, signal?: AbortSignal): Promise<void> {
    this.throwIfAborted(signal);
    const { client, baseURL, debugLogEnabled } = this.createOpenAIClient();
    if (!client) {
      return;
    }
    // Always use the fast/cheap flash model for compaction (summarization does
    // not need the full reasoning capability of the pro model).
    const model = COMPACTION_MODEL;
    const thinkingEnabled = false;
    const reasoningEffort = undefined;
    const temperature = COMPACTION_TEMPERATURE;
    const sessionMessages = this.listSessionMessages(sessionId).filter((message) => !message.compacted);
    if (sessionMessages.length === 0) {
      return;
    }

    const startIndex = sessionMessages.findIndex((message) => message.role !== "system");
    if (startIndex === -1) {
      return;
    }

    const searchStart = Math.floor(startIndex + ((sessionMessages.length - startIndex) * 2) / 3);
    let endIndex = -1;
    for (let i = Math.max(searchStart, startIndex); i < sessionMessages.length; i += 1) {
      if (sessionMessages[i].role !== "tool") {
        endIndex = i;
        break;
      }
    }
    if (endIndex === -1 || endIndex <= startIndex) {
      return;
    }

    const compactPrompt = getCompactPrompt(sessionMessages.slice(startIndex, endIndex));
    const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort);
    const response = await this.createChatCompletionStream(
      client,
      {
        model,
        temperature,
        messages: [{ role: "user", content: compactPrompt }],
        ...thinkingOptions,
      },
      signal ? { signal } : undefined,
      sessionId,
      {
        enabled: debugLogEnabled,
        location: "SessionManager.compactSession",
        baseURL,
        params: { temperature, thinkingEnabled, reasoningEffort },
      }
    );
    this.throwIfAborted(signal);
    const rawLlmResponse = response.choices?.[0]?.message?.content;
    const llmResponse = typeof rawLlmResponse === "string" ? rawLlmResponse : "";
    const compactedSummary = llmResponse.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim();

    const now = new Date().toISOString();
    const responseUsage = response.usage ?? null;
    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      usage: accumulateUsage(entry.usage, responseUsage),
      usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
      // The compaction request's prompt size says nothing about the session's
      // real context pressure — reset and let the next model request re-measure.
      activeTokens: 0,
      updateTime: now,
    }));

    for (let i = startIndex; i < endIndex; i += 1) {
      sessionMessages[i] = { ...sessionMessages[i], compacted: true, updateTime: now };
    }

    const summaryMessage: SessionMessage = {
      id: crypto.randomUUID(),
      sessionId,
      role: "system",
      content: `There are earlier parts of the conversation. Here is a summary: \n\n${compactedSummary}`,
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: false,
      createTime: now,
      updateTime: now,
      meta: {
        isSummary: true,
      },
    };
    sessionMessages.splice(endIndex, 0, summaryMessage);
    this.saveSessionMessages(sessionId, sessionMessages);
  }

  private getPromptToolOptions(): { model: string; webSearchEnabled: boolean } {
    return {
      model: this.getResolvedSettings().model,
      webSearchEnabled: true,
    };
  }

  private reportNewPrompt(): void {
    const { machineId, telemetryEnabled } = this.createOpenAIClient();
    reportNewPrompt({ enabled: telemetryEnabled ?? true, machineId });
  }

  /**
   * Request a graceful pause of the active session. Unlike interrupt, this does
   * not abort the in-flight LLM request or kill processes — the loop stops at
   * the next checkpoint (before the next LLM call or before executing freshly
   * returned tool calls) and the session is marked "paused" so it can be
   * resumed later without losing any state.
   * Returns the session id the pause was requested for, or null when there is
   * no session currently running.
   */
  pauseActiveSession(): string | null {
    const sessionId = this.activeSessionId;
    if (!sessionId || !this.sessionControllers.has(sessionId)) {
      return null;
    }
    this.pauseRequestedSessions.add(sessionId);
    return sessionId;
  }

  /**
   * Resume a paused (or interrupted) session by re-entering the LLM loop.
   * Trailing pending tool calls left by a pause checkpoint are executed first
   * by the loop's trailing-pending path, so no work is lost.
   */
  async resumeSession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (this.sessionControllers.has(sessionId)) {
      // Already running — nothing to resume.
      return;
    }
    const controller = new AbortController();
    this.activePromptController = controller;
    try {
      this.activeSessionId = sessionId;
      await this.activateSession(sessionId, controller);
    } finally {
      if (this.activePromptController === controller) {
        this.activePromptController = null;
      }
    }
  }

  private consumePauseRequest(sessionId: string): boolean {
    return this.pauseRequestedSessions.delete(sessionId);
  }

  private markSessionPaused(sessionId: string): void {
    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "paused",
      failReason: null,
      updateTime: new Date().toISOString(),
    }));
  }

  interruptActiveSession(): void {
    const controller = this.activePromptController;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }

    const sessionId = this.activeSessionId;
    if (sessionId) {
      this.interruptSession(sessionId);
    }
  }

  interruptSession(sessionId: string): void {
    const session = this.getSession(sessionId);
    const processIds = this.getProcessIds(session?.processes ?? null);
    const killedPids: number[] = [];
    const failedPids: number[] = [];
    for (const pid of processIds) {
      const processControlKey = this.getProcessControlKey(sessionId, pid);
      this.processTimeoutControls.delete(processControlKey);
      this.liveProcessKeys.delete(processControlKey);
      if (killProcessTree(pid, "SIGKILL")) {
        killedPids.push(pid);
        continue;
      }
      failedPids.push(pid);
    }

    const controller = this.sessionControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.sessionControllers.delete(sessionId);
    }
    this.pauseRequestedSessions.delete(sessionId);

    const now = new Date().toISOString();
    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "interrupted",
      failReason: "interrupted",
      processes: null,
      updateTime: now,
    }));

    const contentParts = ["Interrupted."];
    if (killedPids.length > 0) {
      contentParts.push(`Killed processes: ${killedPids.join(", ")}.`);
    }
    if (failedPids.length > 0) {
      contentParts.push(`Failed to kill processes: ${failedPids.join(", ")}.`);
    }

    this.onAssistantMessage(this.buildUserMessage(sessionId, { text: contentParts.join(" ") }), false);
  }

  private isInterrupted(sessionId: string): boolean {
    return !this.sessionControllers.has(sessionId);
  }

  /**
   * Mark a session's permission as denied by the user.
   * Updates the session entry status and failReason so the denial is visible in the session list.
   */
  denySessionPermission(sessionId: string, reason?: string): void {
    const now = new Date().toISOString();
    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "permission_denied",
      failReason: reason ?? "Permission denied by user",
      updateTime: now,
    }));
    // An explicit user denial is a terminal decision, not a high-frequency
    // streaming update — flush it like session create/delete rather than leaving
    // it in the debounce window, so a reload cannot come back up as "pending".
    this.flushSessionsIndex();
  }

  adjustActiveBashTimeout(deltaMs: number): BashTimeoutAdjustment | null {
    const sessionId = this.activeSessionId;
    if (!sessionId || !Number.isFinite(deltaMs)) {
      return null;
    }
    const session = this.getSession(sessionId);
    if (!session?.processes) {
      return null;
    }

    let selectedPid: string | null = null;
    for (const pid of session.processes.keys()) {
      if (this.processTimeoutControls.has(this.getProcessControlKey(sessionId, pid))) {
        selectedPid = pid;
      }
    }
    if (!selectedPid) {
      return null;
    }

    const control = this.processTimeoutControls.get(this.getProcessControlKey(sessionId, selectedPid));
    if (!control) {
      return null;
    }

    const current = control.getInfo();
    const next = control.setTimeoutMs(current.timeoutMs + deltaMs);
    this.updateSessionProcessTimeout(sessionId, selectedPid, next);
    return this.buildBashTimeoutAdjustment(selectedPid, next);
  }

  listSessions(): SessionEntry[] {
    const index = this.loadSessionsIndex();
    return index.entries;
  }

  getSession(sessionId: string): SessionEntry | null {
    const index = this.loadSessionsIndex();
    return index.entries.find((entry) => entry.id === sessionId) ?? null;
  }

  /**
   * Delete a session by its ID.
   * Removes the session entry from the index and cleans up associated resources
   * such as message files, in-memory state caches, working directory state,
   * session controllers, and tracked process timeout controls.
   * Returns true if the session was found and deleted, false otherwise.
   */
  deleteSession(sessionId: string): boolean {
    this.frozenToolRoutes.delete(sessionId);
    this.taskRecallHinted.delete(sessionId);
    const index = this.loadSessionsIndex();
    const targetEntry = index.entries.find((entry) => entry.id === sessionId) ?? null;
    const nextEntries = index.entries.filter((entry) => entry.id !== sessionId);
    if (nextEntries.length === index.entries.length) {
      return false;
    }

    index.entries = nextEntries;
    // Session deletion is critical — flush immediately (not debounced).
    this.pendingIndex = index;
    this.flushSessionsIndex();
    this.cleanupSessionResources(sessionId, {
      removeMessages: true,
      processIds: this.getProcessIds(targetEntry?.processes ?? null),
    });
    return true;
  }

  /**
   * Rename a session by updating its summary (display title).
   * Returns true if the session was found and renamed, false otherwise.
   */
  renameSession(sessionId: string, summary: string): boolean {
    const trimmed = summary.trim();
    if (!trimmed) {
      return false;
    }
    const entry = this.getSession(sessionId);
    if (!entry) {
      return false;
    }
    this.updateSessionEntry(sessionId, (existing) => ({
      ...existing,
      summary: trimmed,
      updateTime: new Date().toISOString(),
    }));
    return true;
  }

  listSessionMessages(sessionId: string): SessionMessage[] {
    // Check cache first — avoids re-reading + re-parsing the entire JSONL file
    // on every call (this method is invoked multiple times per loop iteration).
    const cached = this.messageCache.get(sessionId);
    if (cached) {
      return cached;
    }

    const messagePath = this.getSessionMessagesPath(sessionId);
    if (!fs.existsSync(messagePath)) {
      return [];
    }

    const raw = fs.readFileSync(messagePath, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const messages: SessionMessage[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as SessionMessage;
        messages.push(this.normalizeSessionMessage(parsed));
      } catch {
        // ignore malformed line
      }
    }
    this.messageCache.set(sessionId, messages);
    return messages;
  }

  listUndoTargets(sessionId: string): UndoTarget[] {
    return this.listSessionMessages(sessionId)
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => this.isUndoTargetMessage(message))
      .map(({ message, index }) => ({
        message,
        index,
        canRestoreCode: Boolean(
          message.checkpointHash && this.canRestoreCheckpointHash(sessionId, message.checkpointHash)
        ),
      }));
  }

  restoreSessionConversation(sessionId: string, messageId: string): SessionMessage[] {
    const messages = this.listSessionMessages(sessionId);
    const targetIndex = messages.findIndex((message) => message.id === messageId);
    if (targetIndex === -1) {
      throw new Error("Selected message was not found in this session.");
    }

    const keptMessages = messages.slice(0, targetIndex);
    this.saveSessionMessages(sessionId, keptMessages);
    const now = new Date().toISOString();
    const latestAssistant = [...keptMessages].reverse().find((message) => message.role === "assistant");
    const latestAssistantParams = latestAssistant?.messageParams as
      | { tool_calls?: unknown[]; reasoning_content?: string }
      | null
      | undefined;

    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      assistantReply: latestAssistant?.content ?? null,
      assistantThinking:
        typeof latestAssistantParams?.reasoning_content === "string" ? latestAssistantParams.reasoning_content : null,
      assistantRefusal: null,
      toolCalls: null,
      status: "completed",
      failReason: null,
      processes: null,
      updateTime: now,
    }));
    return keptMessages;
  }

  restoreSessionCode(sessionId: string, messageId: string): void {
    const message = this.listSessionMessages(sessionId).find((item) => item.id === messageId);
    if (!message) {
      throw new Error("Selected message was not found in this session.");
    }
    if (!message.checkpointHash) {
      throw new Error("Selected message has no code checkpoint.");
    }
    this.restoreCheckpointHash(sessionId, message.checkpointHash);
  }

  private normalizeSessionMessage(message: SessionMessage): SessionMessage {
    if (message.role !== "tool") {
      return message;
    }

    const nextMeta = message.meta ? { ...message.meta } : undefined;
    const normalizedParamsMd = this.buildToolParamsSnippet(nextMeta?.function ?? null);
    if (nextMeta && normalizedParamsMd) {
      nextMeta.paramsMd = normalizedParamsMd;
    }

    const normalizedResultMd = typeof message.content === "string" ? this.buildToolResultSnippet(message.content) : "";
    if (nextMeta && normalizedResultMd) {
      nextMeta.resultMd = normalizedResultMd;
    }

    return {
      ...message,
      visible: typeof message.content === "string" ? !this.isInvisibleExecution(message.content) : message.visible,
      meta: nextMeta,
    };
  }

  private getProjectStorage(): {
    projectCode: string;
    projectDir: string;
    sessionsIndexPath: string;
  } {
    const projectCode = getProjectCode(this.projectRoot);
    const projectDir = path.join(getUserConfigRoot(), "projects", projectCode);
    const sessionsIndexPath = path.join(projectDir, "sessions-index.json");
    return { projectCode, projectDir, sessionsIndexPath };
  }

  private getFileHistory(): GitFileHistory {
    return new GitFileHistory(this.projectRoot, this.getFileHistoryGitDir());
  }

  private getFileHistoryGitDir(): string {
    const { projectDir } = this.getProjectStorage();
    return path.join(projectDir, "file-history", ".git");
  }

  private ensureFileHistorySession(sessionId: string): string | undefined {
    return this.getFileHistory().ensureSession(sessionId);
  }

  private getCurrentCheckpointHash(sessionId: string): string | undefined {
    return this.getFileHistory().getCurrentCheckpointHash(sessionId);
  }

  private recordUserPromptCheckpoint(sessionId: string): FileHistoryCheckpointResult {
    return this.getFileHistory().recordTrackedFilesCheckpoint(sessionId, "User prompt checkpoint");
  }

  private prepareFileMutationCheckpoint(sessionId: string, filePath: string): void {
    const fileHistory = this.getFileHistory();
    const previousHash = fileHistory.ensureSession(sessionId);
    if (!previousHash) {
      return;
    }
    this.updateLatestUserCheckpointHash(sessionId, undefined, previousHash);
    const nextHash = fileHistory.recordCheckpoint(sessionId, [filePath], "Pre-mutation checkpoint");
    if (nextHash && nextHash !== previousHash) {
      this.updateLatestUserCheckpointHash(sessionId, previousHash, nextHash);
    }
  }

  private recordFileMutationCheckpoint(sessionId: string, filePath: string): void {
    const fileHistory = this.getFileHistory();
    fileHistory.ensureSession(sessionId);
    fileHistory.recordCheckpoint(sessionId, [filePath], "File mutation checkpoint");
    // Remember that this turn changed files so we can refresh the CodeGraph index
    // once the turn settles (see maybeSyncCodegraphIndex).
    this.codegraphDirtySessions.add(sessionId);
    // Same for the CRG graph (see maybeSyncCrgIndex).
    this.crgDirtySessions.add(sessionId);
    // Same for the wiki (see maybeSyncWikiIndex).
    this.wikiDirtySessions.add(sessionId);
    // Track mutated files for post-edit diagnostics (see maybeRunDiagnosticsCheck).
    let files = this.diagnosticsDirtyFiles.get(sessionId);
    if (!files) {
      files = new Set();
      this.diagnosticsDirtyFiles.set(sessionId, files);
    }
    files.add(filePath);
    // Stamp the mutation time so the knowledge dashboard can flag stale indices.
    this.knowledgeFreshness.lastMutation = new Date().toISOString();
  }

  /**
   * After a task turn ends, run an incremental CodeGraph index update if this turn
   * mutated files. Fire-and-forget; the SDK's sync() is concurrent-safe (FileLock).
   */
  private maybeSyncCodegraphIndex(sessionId: string): void {
    if (!this.codegraphDirtySessions.delete(sessionId)) {
      return;
    }
    void getCodegraphController()?.sync(this.projectRoot);
    this.knowledgeFreshness.codegraphSync = new Date().toISOString();
  }

  /**
   * After a task turn ends, run an incremental wiki update if this turn
   * mutated files. Fire-and-forget; the wiki controller's update() is
   * safe to call frequently (OpenWiki --update is diff-based, skips when
   * nothing changed).
   */
  private maybeSyncWikiIndex(sessionId: string): void {
    if (!this.wikiDirtySessions.delete(sessionId)) {
      return;
    }
    void getWikiController()?.update(this.projectRoot);
    this.knowledgeFreshness.wikiSync = new Date().toISOString();
  }

  /**
   * After a task turn ends, run an incremental CRG graph rebuild if this turn
   * mutated files. Fire-and-forget and gated on the project being CRG-enabled;
   * runCrgSync no-ops otherwise.
   */
  private maybeSyncCrgIndex(sessionId: string): void {
    if (!this.crgDirtySessions.delete(sessionId)) {
      return;
    }
    void getCrgController()?.sync(this.projectRoot);
    this.knowledgeFreshness.crgSync = new Date().toISOString();
  }

  /** Knowledge-source freshness timestamps for the desktop dashboard. */
  getKnowledgeFreshness(): {
    lastMutation?: string;
    codegraphSync?: string;
    wikiSync?: string;
    crgSync?: string;
  } {
    return { ...this.knowledgeFreshness };
  }

  /**
   * After a task turn ends, check diagnostics for mutated files via Serena's
   * `get_diagnostics_for_file` MCP tool. Fire-and-forget; if error-level
   * diagnostics are found, a system message is appended so the agent can
   * self-correct in the next turn. Silently skips when Serena is not connected.
   */
  private maybeRunDiagnosticsCheck(sessionId: string): void {
    const dirtyFiles = this.diagnosticsDirtyFiles.get(sessionId);
    if (!dirtyFiles || dirtyFiles.size === 0) return;
    this.diagnosticsDirtyFiles.delete(sessionId);

    // Check if Serena MCP is connected.
    const serenaConnected = this.mcpManager.getStatus().some((s) => s.name === SERENA_MCP_SERVER_NAME && s.connected);
    if (!serenaConnected) return;

    // Fire-and-forget diagnostics check for each mutated file.
    void (async () => {
      for (const filePath of dirtyFiles) {
        try {
          const result = await this.executeMcpTool(SERENA_MCP_SERVER_NAME, "get_diagnostics_for_file", {
            file_path: filePath,
          });
          const diagnostics = extractErrorDiagnostics(result);
          if (diagnostics.length > 0) {
            const message = `⚠️ 编辑后诊断检查发现 ${diagnostics.length} 个错误（${filePath}）：\n${diagnostics.map((d) => `- ${d}`).join("\n")}`;
            const now = new Date().toISOString();
            this.appendSessionMessage(sessionId, {
              id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              sessionId,
              role: "system",
              content: message,
              contentParams: null,
              messageParams: null,
              compacted: false,
              visible: true,
              createTime: now,
              updateTime: now,
            });
          }
        } catch {
          // Diagnostics check is best-effort; ignore failures.
        }
      }
    })();
  }

  /**
   * After a task turn ends, capture the conversation into the memory Gateway.
   * Fire-and-forget — memory capture must never break the session loop.
   * Extracts the user prompt text + last assistant response and sends them
   * to the TDAM Gateway for L0 storage and pipeline processing.
   */
  private maybeCaptureMemory(sessionId: string): void {
    if (!this.memoryProvider?.isAvailable()) {
      return;
    }
    const messages = this.listSessionMessages(sessionId);
    if (messages.length < 2) {
      return;
    }
    // Find the last user message and the last assistant message, and capture
    // them as structured records so the provider can persist them to L0.
    // Passing the actual messages (not just flat text) is required: the TDAI
    // L0 recorder only writes entries found in `messages[]`, so without these
    // the pipeline captures nothing and recall stays permanently empty.
    let userText = "";
    let assistantText = "";
    let lastUser: SessionMessage | undefined;
    let lastAssistant: SessionMessage | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;
      const text = msg.content ?? "";
      if (msg.role === "user" && !userText) {
        userText = text;
        lastUser = msg;
      }
      if (msg.role === "assistant" && !assistantText) {
        assistantText = text;
        lastAssistant = msg;
      }
      if (userText && assistantText) break;
    }
    if (!userText || !assistantText) {
      return;
    }
    const captureMessages: Array<{ role: "user" | "assistant"; content: string; id?: string; timestamp?: number }> = [];
    for (const msg of [lastUser, lastAssistant]) {
      if (!msg || !msg.content || !msg.content.trim()) continue;
      const ts = Date.parse(msg.createTime);
      captureMessages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
        id: msg.id,
        timestamp: Number.isNaN(ts) ? Date.now() : ts,
      });
    }
    // Lineage closure (task-tree recycle channel): <task-lineage> and
    // <task-recall-hints> are hidden SYSTEM messages the plain user/assistant
    // pair above never includes — without this, merge/abandon outcomes and
    // recall hints silently never reach memory. Append them to assistantText
    // so the provider's flat path and the structured messages[] path both
    // carry them (audit 2026-08-15 linkage L3).
    const lineageTail = messages
      .filter(
        (m) =>
          m.role === "system" &&
          !m.compacted &&
          typeof m.content === "string" &&
          (m.content.includes("<task-lineage>") || m.content.includes("<task-recall-hints>"))
      )
      .slice(-3);
    for (const msg of lineageTail) {
      const content = msg.content ?? "";
      if (!content.trim()) continue;
      const ts = Date.parse(msg.createTime);
      captureMessages.push({
        role: "assistant",
        content,
        id: msg.id,
        timestamp: Number.isNaN(ts) ? Date.now() : ts,
      });
    }
    if (lineageTail.length > 0) {
      assistantText = `${assistantText}\n${lineageTail.map((m) => m.content).join("\n")}`;
    }
    void this.memoryProvider
      .capture({ userText, assistantText, sessionKey: sessionId, sessionId, messages: captureMessages })
      .catch(() => {
        // Swallow — best-effort memory capture.
      });
  }

  private updateLatestUserCheckpointHash(sessionId: string, previousHash: string | undefined, nextHash: string): void {
    const messages = this.listSessionMessages(sessionId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || !this.isUndoTargetMessage(message)) {
        continue;
      }
      if (message.checkpointHash && message.checkpointHash !== previousHash) {
        return;
      }
      messages[index] = {
        ...message,
        checkpointHash: nextHash,
        updateTime: new Date().toISOString(),
      };
      this.saveSessionMessages(sessionId, messages);
      return;
    }
  }

  private canRestoreCheckpointHash(sessionId: string, checkpointHash: string): boolean {
    return this.getFileHistory().canRestore(sessionId, checkpointHash);
  }

  private restoreCheckpointHash(sessionId: string, checkpointHash: string): void {
    this.getFileHistory().restore(sessionId, checkpointHash);
  }

  private isUndoTargetMessage(message: SessionMessage): boolean {
    return message.role === "user" && message.visible && !message.compacted;
  }

  private ensureProjectDir(): string {
    const { projectDir } = this.getProjectStorage();
    fs.mkdirSync(projectDir, { recursive: true });
    return projectDir;
  }

  private loadSessionsIndex(): SessionsIndex {
    // A debounced write may still be in flight — until it lands, the in-memory
    // copy is authoritative and the file on disk is stale. Reading the file here
    // would not only return pre-update state to getSession()/listSessions(), it
    // would make consecutive updateSessionEntry() calls inside one debounce
    // window each rebase on the *stale* disk copy and silently drop the earlier
    // update (usage accumulation runs ~17x per streaming turn, so that loss is
    // permanent, not just briefly visible).
    //
    // Returned as a shallow copy so callers keep the snapshot semantics they had
    // when every read hit the disk — they may replace `entries` (createSession,
    // deleteSession) without mutating the pending index behind our back.
    //
    // Deliberately NOT re-normalized: pending entries are already in memory form
    // (`processes` is a Map, produced by normalizeSessionEntry on the way in), and
    // normalizeSessionEntry expects the on-disk shape — its deserializeProcesses
    // uses Object.entries(), which yields [] for a Map and would silently drop
    // every tracked process.
    if (this.pendingIndex) {
      return {
        version: 1,
        entries: [...this.pendingIndex.entries],
        originalPath: this.pendingIndex.originalPath || this.projectRoot,
      };
    }

    const { sessionsIndexPath } = this.getProjectStorage();
    this.ensureProjectDir();

    if (!fs.existsSync(sessionsIndexPath)) {
      return { version: 1, entries: [], originalPath: this.projectRoot };
    }

    try {
      const raw = fs.readFileSync(sessionsIndexPath, "utf8");
      const parsed = JSON.parse(raw) as SessionsIndex;
      const entries = Array.isArray(parsed.entries)
        ? parsed.entries.map((entry) => this.normalizeSessionEntry(entry))
        : [];
      return {
        version: 1,
        entries,
        originalPath: parsed.originalPath || this.projectRoot,
      };
    } catch {
      return { version: 1, entries: [], originalPath: this.projectRoot };
    }
  }

  /**
   * Pending index write timer for debounced saves. High-frequency
   * updateSessionEntry calls (status changes during streaming) are batched
   * into a single disk write every 250ms instead of rewriting the entire
   * index file on every call. Critical operations (create/delete session)
   * call flushSessionsIndex() to force an immediate write.
   */
  private indexWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly INDEX_WRITE_DELAY = 250;

  private saveSessionsIndex(index: SessionsIndex): void {
    // Stash the latest index — the debounced write will pick it up.
    this.pendingIndex = index;
    if (this.indexWriteTimer) return;
    this.indexWriteTimer = setTimeout(() => {
      this.indexWriteTimer = null;
      this.flushSessionsIndex();
    }, SessionManager.INDEX_WRITE_DELAY);
  }

  /** Force-write the pending index immediately (clears any debounce timer). */
  private flushSessionsIndex(): void {
    if (this.indexWriteTimer) {
      clearTimeout(this.indexWriteTimer);
      this.indexWriteTimer = null;
    }
    if (!this.pendingIndex) return;
    const index = this.pendingIndex;
    this.pendingIndex = null;
    const { sessionsIndexPath } = this.getProjectStorage();
    this.ensureProjectDir();
    const normalized = {
      version: 1,
      entries: index.entries.map((entry) => ({
        ...entry,
        processes: this.serializeProcesses(entry.processes),
      })),
      originalPath: this.projectRoot,
    };
    const content = JSON.stringify(normalized, null, 2);
    const tmpPath = `${sessionsIndexPath}.tmp.${process.pid}.${crypto.randomUUID()}`;
    try {
      // Write beside the target and rename only after the complete payload is
      // present. This preserves the last valid index if the process or disk
      // fails halfway through a write. Keep pendingIndex until rename succeeds
      // so a later explicit flush can retry the exact in-memory snapshot.
      fs.writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
      if (process.platform !== "win32") {
        fs.chmodSync(tmpPath, 0o600);
      }
      fs.renameSync(tmpPath, sessionsIndexPath);
      this.pendingIndex = null;
    } catch (error) {
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch {
        // Preserve the original persistence error.
      }
      throw error;
    }
  }

  private pendingIndex: SessionsIndex | null = null;

  private getSessionMessagesPath(sessionId: string): string {
    const { projectDir } = this.getProjectStorage();
    return path.join(projectDir, `${sessionId}.jsonl`);
  }

  private removeSessionMessages(sessionIds: string[]): void {
    for (const sessionId of sessionIds) {
      const messagePath = this.getSessionMessagesPath(sessionId);
      try {
        if (fs.existsSync(messagePath)) {
          fs.unlinkSync(messagePath);
        }
      } catch {
        // ignore delete failures
      }
    }
  }

  private cleanupSessionResources(
    sessionId: string,
    options: { removeMessages: boolean; processIds?: number[] }
  ): void {
    const processIds = options.processIds ?? [];
    for (const pid of processIds) {
      const processControlKey = this.getProcessControlKey(sessionId, pid);
      if (!this.processTimeoutControls.has(processControlKey) && !this.liveProcessKeys.has(processControlKey)) {
        continue;
      }

      this.killTrackedProcess(processControlKey, pid);
    }

    clearSessionState(sessionId);
    clearSessionWorkingDir(sessionId);
    const controller = this.sessionControllers.get(sessionId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    this.sessionControllers.delete(sessionId);
    if (options.removeMessages) {
      this.removeSessionMessages([sessionId]);
    }
  }

  private appendSessionMessage(sessionId: string, message: SessionMessage): void {
    this.ensureProjectDir();
    const messagePath = this.getSessionMessagesPath(sessionId);
    // Restrictive perms (deep review 2026-08-15, C2): transcripts carry user
    // code and tool output — same 0600 treatment settings.json already gets.
    fs.appendFileSync(messagePath, `${JSON.stringify(message)}\n`, { encoding: "utf8", mode: 0o600 });
    // Invalidate cache so the next listSessionMessages re-reads from disk.
    this.messageCache.delete(sessionId);
  }

  private saveSessionMessages(sessionId: string, messages: SessionMessage[]): void {
    this.ensureProjectDir();
    const messagePath = this.getSessionMessagesPath(sessionId);
    const payload = messages.map((message) => JSON.stringify(message)).join("\n");
    fs.writeFileSync(messagePath, payload ? `${payload}\n` : "", { encoding: "utf8", mode: 0o600 });
    // Update cache with the saved array (avoids a disk re-read).
    this.messageCache.set(sessionId, messages);
  }

  private updateSessionEntry(sessionId: string, updater: (entry: SessionEntry) => SessionEntry): SessionEntry | null {
    const index = this.loadSessionsIndex();
    const entryIndex = index.entries.findIndex((entry) => entry.id === sessionId);
    if (entryIndex === -1) {
      return null;
    }

    const updated = updater({ ...index.entries[entryIndex] });
    index.entries[entryIndex] = updated;
    this.saveSessionsIndex(index);
    this.onSessionEntryUpdated?.(updated);
    return updated;
  }

  private buildUserMessage(sessionId: string, prompt: UserPromptContent): SessionMessage {
    const now = new Date().toISOString();
    const imageParams =
      prompt.imageUrls
        ?.filter((url) => Boolean(url))
        .map((url) => ({
          type: "image_url",
          image_url: { url },
        })) ?? [];

    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "user",
      content: prompt.text ?? "",
      contentParams: imageParams.length > 0 ? imageParams : null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: now,
      updateTime: now,
      meta: { userPrompt: this.cloneUserPromptForMeta(prompt) },
      checkpointHash: this.getCurrentCheckpointHash(sessionId),
    };
  }

  private appendPlanModeTransitionMessages(sessionId: string, wasEnabled: boolean, isEnabled: boolean): void {
    if (wasEnabled === isEnabled) {
      return;
    }

    if (isEnabled) {
      const prompt = getPlanModePrompt();
      if (prompt) {
        this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, prompt));
      }
      this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, PLAN_MODE_ON_STATUS_MESSAGE));
      return;
    }

    this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, PLAN_MODE_OFF_STATUS_MESSAGE));
  }

  private renderInitCommandPrompt(): string {
    const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "init_command.md.ejs");
    const template = fs.readFileSync(templatePath, "utf8");
    return ejs.render(template, {
      agentsMdFile: this.getEffectiveProjectAgentsMdFile(),
    });
  }

  private getEffectiveProjectAgentsMdFile(): string | null {
    return this.loadProjectAgentInstructions()?.displayPath ?? null;
  }

  private loadProjectAgentInstructions(): { content: string; displayPath: string } | null {
    const candidatePaths = [
      {
        absolutePath: path.join(this.projectRoot, ".deeporca", "AGENTS.md"),
        displayPath: "./.deeporca/AGENTS.md",
      },
      {
        absolutePath: path.join(this.projectRoot, ".deepcode", "AGENTS.md"),
        displayPath: "./.deepcode/AGENTS.md",
      },
      {
        absolutePath: path.join(this.projectRoot, "AGENTS.md"),
        displayPath: "./AGENTS.md",
      },
    ];

    for (const candidatePath of candidatePaths) {
      const content = this.readNonEmptyFile(candidatePath.absolutePath);
      if (content) {
        return {
          content,
          displayPath: candidatePath.displayPath,
        };
      }
    }

    return null;
  }

  private readNonEmptyFile(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = fs.readFileSync(filePath, "utf8").trim();
      return content || null;
    } catch {
      return null;
    }
  }

  private loadAgentInstructions(): string | null {
    const projectInstructions = this.loadProjectAgentInstructions();
    if (projectInstructions) {
      return projectInstructions.content;
    }

    return (
      this.readNonEmptyFile(path.join(os.homedir(), ".deeporca", "AGENTS.md")) ??
      this.readNonEmptyFile(path.join(os.homedir(), ".deepcode", "AGENTS.md"))
    );
  }

  private buildSystemMessage(
    sessionId: string,
    content: string,
    contentParams: unknown | null = null,
    visible = false,
    meta?: MessageMeta
  ): SessionMessage {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "system",
      content,
      contentParams,
      messageParams: null,
      compacted: false,
      visible,
      createTime: now,
      updateTime: now,
      meta,
    };
  }

  private buildSkillMessage(sessionId: string, content: string, skill: SkillInfo): SessionMessage {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "system",
      content,
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: now,
      updateTime: now,
      meta: { skill: { ...skill, isLoaded: true } },
    };
  }

  private buildAssistantMessage(
    sessionId: string,
    content: string | null,
    toolCalls: unknown[] | null,
    reasoningContent?: string | null
  ): SessionMessage {
    const now = new Date().toISOString();
    const hasReasoningContent = reasoningContent != null;
    const messageParams: { tool_calls?: unknown[]; reasoning_content?: string } | null =
      toolCalls || hasReasoningContent ? {} : null;
    if (toolCalls) {
      messageParams!.tool_calls = toolCalls;
    }
    if (hasReasoningContent) {
      messageParams!.reasoning_content = reasoningContent;
    }
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "assistant",
      content,
      contentParams: null,
      messageParams,
      compacted: false,
      visible: (content || reasoningContent || "").trim() ? true : false,
      createTime: now,
      updateTime: now,
      meta: toolCalls ? { asThinking: true } : undefined,
    };
  }

  private generateToolCallId(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  private normalizeLlmToolCalls(rawToolCalls: unknown[] | null | undefined): unknown[] | null {
    if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) {
      return null;
    }

    return rawToolCalls.map((toolCall) => {
      if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
        return toolCall;
      }

      const record = toolCall as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      if (id) {
        return toolCall;
      }

      return {
        ...record,
        id: this.generateToolCallId(),
      };
    });
  }

  private buildToolMessage(
    sessionId: string,
    toolCallId: string,
    content: string,
    toolFunction: unknown | null
  ): SessionMessage {
    const now = new Date().toISOString();
    const paramsMd = this.buildToolParamsSnippet(toolFunction);
    const resultMd = this.buildToolResultSnippet(content);
    const isInvisibleExecution = this.isInvisibleExecution(content);
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "tool",
      content,
      contentParams: null,
      messageParams: { tool_call_id: toolCallId },
      compacted: false,
      visible: !isInvisibleExecution,
      createTime: now,
      updateTime: now,
      meta: {
        function: toolFunction ?? undefined,
        paramsMd,
        resultMd,
      },
    };
  }

  private async appendToolMessages(
    sessionId: string,
    toolCalls: unknown[],
    options: {
      permissionOverrides?: UserToolPermission[];
      messagePermissions?: MessageToolPermission[];
    } = {}
  ): Promise<{ waitingForUser: boolean }> {
    const hooks: ToolExecutionHooks = {
      onProcessStart: (pid, command) => this.addSessionProcess(sessionId, pid, command),
      onProcessExit: (pid) => this.removeSessionProcess(sessionId, pid),
      onProcessStdout: (pid, chunk) => this.onProcessStdout?.(Number(pid), chunk),
      onProcessTimeoutControl: (pid, control) => this.setSessionProcessTimeoutControl(sessionId, pid, control),
      onBackgroundProcessComplete: (completion) => this.addBackgroundProcessCompletionMessage(sessionId, completion),
      onBeforeFileMutation: (filePath) => this.prepareFileMutationCheckpoint(sessionId, filePath),
      onAfterFileMutation: (filePath) => this.recordFileMutationCheckpoint(sessionId, filePath),
      shouldStop: () => this.isInterrupted(sessionId),
    };
    const parsedToolCalls = toolCalls
      .map((toolCall) => parseToolCallForPermissions(toolCall))
      .filter((toolCall): toolCall is PermissionToolCall => Boolean(toolCall));
    const toolExecutions: ToolCallExecution[] = [];
    for (const toolCall of parsedToolCalls) {
      if (hooks.shouldStop?.()) {
        break;
      }
      const blockedResult = buildPermissionToolExecution(toolCall, options);
      if (blockedResult) {
        toolExecutions.push(blockedResult);
        continue;
      }
      const executions = await this.toolExecutor.executeToolCalls(sessionId, [toolCall], hooks);
      toolExecutions.push(...executions);
    }
    if (this.isInterrupted(sessionId)) {
      return { waitingForUser: false };
    }
    let waitingForUser = false;
    const followUpMessages: SessionMessage[] = [];
    for (const execution of toolExecutions) {
      if (execution.result.awaitUserResponse === true) {
        waitingForUser = true;
      }
      const toolFunction = this.messageConverter.findToolFunction(toolCalls, execution.toolCallId);
      const toolMessage = this.buildToolMessage(sessionId, execution.toolCallId, execution.content, toolFunction);
      this.appendSessionMessage(sessionId, toolMessage);
      this.onAssistantMessage(toolMessage, true);
      // Plan Mode → tree materialization (ONE-WAY, read-only per spec §十一:
      // the plan is the source of truth; the tree never writes back). When a
      // session is bound to a task tree, new plan checklist lines become step
      // nodes on the bound branch (matched by title — no duplicates).
      this.materializePlanToTaskTree(sessionId, toolFunction);
      // Decision-point probe (spec §3.2 step 1): when the agent asks the user
      // to choose between approaches, surface similar historical forks once
      // per session as a hidden hint — proposals only, never auto-forks.
      this.probeTaskRecallAtDecision(sessionId, toolFunction);

      for (const followUpMessage of execution.result.followUpMessages ?? []) {
        if (followUpMessage.role !== "system") {
          continue;
        }
        followUpMessages.push(
          this.buildSystemMessage(sessionId, followUpMessage.content, followUpMessage.contentParams ?? null)
        );
      }
    }

    for (const followUpMessage of followUpMessages) {
      this.appendSessionMessage(sessionId, followUpMessage);
    }
    return { waitingForUser };
  }

  private cloneUserPromptForMeta(prompt: UserPromptContent): UserPromptContent {
    return {
      text: prompt.text,
      imageUrls: prompt.imageUrls ? [...prompt.imageUrls] : undefined,
      skills: prompt.skills ? prompt.skills.map((skill) => ({ ...skill })) : undefined,
      permissions: prompt.permissions ? prompt.permissions.map((permission) => ({ ...permission })) : undefined,
      alwaysAllows: prompt.alwaysAllows ? [...prompt.alwaysAllows] : undefined,
      planMode: prompt.planMode,
    };
  }

  private hasTrailingPendingToolCalls(sessionId: string): boolean {
    return (
      this.messageConverter.getTrailingPendingToolCallMessage(this.listSessionMessages(sessionId)).toolCalls.length > 0
    );
  }

  private async appendDeferredPermissionPrompt(
    sessionId: string,
    userPrompt: UserPromptContent | undefined,
    controller: AbortController
  ): Promise<void> {
    if (!userPrompt || this.isContinuePrompt(userPrompt)) {
      return;
    }
    const text = userPrompt.text ?? "";
    const hasUserContent =
      text.trim().length > 0 ||
      (Array.isArray(userPrompt.imageUrls) && userPrompt.imageUrls.length > 0) ||
      (Array.isArray(userPrompt.skills) && userPrompt.skills.length > 0);
    if (!hasUserContent) {
      return;
    }
    this.reportNewPrompt();
    const signal = controller.signal;
    const userMessage = this.buildUserMessage(sessionId, userPrompt);
    this.appendSessionMessage(sessionId, userMessage);
    if (userPrompt.text) {
      const skills = await this.listSkills(sessionId);
      const skillNames = await this.identifyMatchingSkillNames(skills, userPrompt.text, { signal, sessionId });
      this.throwIfAborted(signal);
      const skillSet = new Set(skillNames);
      const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
      if (Array.isArray(userPrompt.skills)) {
        userPrompt.skills.push(...matchedSkill);
      } else if (matchedSkill.length > 0) {
        userPrompt.skills = matchedSkill;
      }
    }
    userPrompt.skills = await this.normalizeSkills(userPrompt.skills, sessionId);
    this.throwIfAborted(signal);
    this.appendSkillMessages(sessionId, userPrompt.skills);
  }

  private buildToolParamsSnippet(toolFunction: unknown | null): string {
    if (!toolFunction || typeof toolFunction !== "object") {
      return "";
    }
    const args = (toolFunction as { arguments?: unknown }).arguments;
    const toolName = (toolFunction as { name?: unknown }).name;
    if (typeof args !== "string") {
      return "";
    }
    const trimmed = args.trim();
    if (!trimmed) {
      return "";
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return this.formatToolParamsSnippet(
          typeof toolName === "string" ? toolName : null,
          parsed as Record<string, unknown>
        );
      }
    } catch {
      // fall back to raw string
    }
    return trimmed;
  }

  private formatToolParamsSnippet(toolName: string | null, args: Record<string, unknown>): string {
    if (toolName === "bash") {
      const command = typeof args.command === "string" ? args.command.trim() : "";
      const description = typeof args.description === "string" ? args.description.trim() : "";
      if (command && description) {
        return `${command}  # ${description}`;
      }
      if (command) {
        return command;
      }
      if (description) {
        return description;
      }
    } else if (toolName === "UpdatePlan") {
      return typeof args.explanation === "string" ? args.explanation.trim() : "";
    } else if (toolName === "write") {
      return typeof args.file_path === "string" ? args.file_path.trim() : "";
    } else if (toolName === "edit") {
      const filePath = typeof args.file_path === "string" ? args.file_path.trim() : "";
      if (filePath) {
        return filePath;
      }
      return typeof args.snippet_id === "string" ? args.snippet_id.trim() : "";
    }

    const firstKey = Object.keys(args)[0];
    if (!firstKey) {
      return "";
    }

    const value = args[firstKey];
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (toolName === "read" && text.startsWith(this.projectRoot)) {
      return text.slice(this.projectRoot.length).replace(/^[\\/]/, "");
    }
    return text;
  }

  private buildToolResultSnippet(content: string): string {
    const trimmed = content.trim();
    if (!trimmed) {
      return "";
    }

    const maxLength = 2000;

    try {
      const parsed = JSON.parse(content) as { output?: unknown };
      if (parsed.output !== undefined) {
        if (typeof parsed.output === "string") {
          return this.formatToolResultSnippet(parsed.output, maxLength);
        }
        return this.formatToolResultSnippet(JSON.stringify(parsed.output), maxLength);
      }
    } catch {
      // fall back to raw content
    }

    return this.formatToolResultSnippet(content, maxLength);
  }

  private formatToolResultSnippet(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)}... (total ${value.length} chars)`;
  }

  private isInvisibleExecution(content: string): boolean {
    if (!content.trim()) {
      return false;
    }
    try {
      const parsed = JSON.parse(content) as { name?: unknown; ok?: unknown };
      return parsed.name === "bash" && parsed.ok !== true;
    } catch {
      return false;
    }
  }

  private maybeNotifyTaskCompletion(
    sessionId: string,
    notifyCommand: string | undefined,
    startedAt: number,
    configuredEnv: Record<string, string> = {}
  ): void {
    if (!notifyCommand) {
      return;
    }

    const session = this.getSession(sessionId);
    if (!session || (session.status !== "completed" && session.status !== "failed")) {
      return;
    }

    // Find the last assistant message body for the BODY env variable.
    let body: string | undefined;
    const messages = this.listSessionMessages(sessionId);
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.role === "assistant" && msg.content) {
        body = msg.content;
        break;
      }
    }

    launchNotifyScript(notifyCommand, Date.now() - startedAt, this.projectRoot, undefined, configuredEnv, {
      status: session.status,
      failReason: session.failReason ?? undefined,
      body,
      title: session.summary ?? undefined,
    });
  }

  private addSessionProcess(sessionId: string, processId: string | number, command: string): void {
    const now = new Date().toISOString();
    this.liveProcessKeys.add(this.getProcessControlKey(sessionId, processId));
    this.updateSessionEntry(sessionId, (entry) => {
      const processes = new Map(entry.processes ?? []);
      processes.set(String(processId), { startTime: now, command });
      return {
        ...entry,
        processes,
        updateTime: now,
      };
    });
  }

  private addBackgroundProcessCompletionMessage(
    sessionId: string,
    completion: {
      command: string;
      outputPath: string;
      ok: boolean;
      exitCode: number | null;
      signal: string | null;
      error?: string;
      completedAtMs: number;
      startedAtMs: number;
    }
  ): void {
    const status = completion.ok ? "completed" : "failed";
    const exitText =
      completion.exitCode !== null
        ? `exit code ${completion.exitCode}`
        : completion.signal
          ? `signal ${completion.signal}`
          : completion.error || "unknown status";
    const durationMs = Math.max(0, completion.completedAtMs - completion.startedAtMs);
    const baseContent =
      `Background command "${completion.command}" ${status} with ${exitText} ` +
      `after ${this.formatBackgroundDuration(durationMs)}. Output: ${completion.outputPath}`;
    const logTail = completion.ok ? null : this.buildBackgroundFailureLogTailSlice(completion.outputPath);
    const content = logTail ? `${baseContent}\n${logTail}` : baseContent;
    this.addSessionSystemMessage(sessionId, content, true);
  }

  private buildBackgroundFailureLogTailSlice(outputPath: string): string | null {
    const tail = this.readTextFileTail(outputPath, BACKGROUND_FAILURE_LOG_TAIL_CHARS);
    if (!tail || !tail.content) {
      return null;
    }
    const prefix = tail.truncated ? `(${tail.totalBytes} bytes)...\n` : "";
    return [
      `<background_task_failure_log path="${outputPath}">`,
      `${prefix}${tail.content}`,
      "</background_task_failure_log>",
    ].join("\n");
  }

  private readTextFileTail(
    filePath: string,
    maxChars: number
  ): { content: string; totalBytes: number; truncated: boolean } | null {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size <= 0) {
        return null;
      }
      const content = readTextFileWithMetadata(filePath).content;
      return {
        content: content.slice(-maxChars).trimEnd(),
        totalBytes: stat.size,
        truncated: content.length > maxChars,
      };
    } catch {
      return null;
    }
  }

  private formatBackgroundDuration(durationMs: number): string {
    if (durationMs < 1000) {
      return `${durationMs}ms`;
    }
    const seconds = Math.round(durationMs / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  private removeSessionProcess(sessionId: string, processId: string | number): void {
    const now = new Date().toISOString();
    const processControlKey = this.getProcessControlKey(sessionId, processId);
    this.processTimeoutControls.delete(processControlKey);
    this.liveProcessKeys.delete(processControlKey);
    this.updateSessionEntry(sessionId, (entry) => {
      const processes = new Map(entry.processes ?? []);
      processes.delete(String(processId));
      return {
        ...entry,
        processes: processes.size > 0 ? processes : null,
        updateTime: now,
      };
    });
  }

  private setSessionProcessTimeoutControl(
    sessionId: string,
    processId: string | number,
    control: ProcessTimeoutControl | null
  ): void {
    const key = this.getProcessControlKey(sessionId, processId);
    if (!control) {
      this.processTimeoutControls.delete(key);
      return;
    }

    this.processTimeoutControls.set(key, control);
    this.updateSessionProcessTimeout(sessionId, processId, control.getInfo());
  }

  private updateSessionProcessTimeout(sessionId: string, processId: string | number, info: ProcessTimeoutInfo): void {
    const now = new Date().toISOString();
    this.updateSessionEntry(sessionId, (entry) => {
      const processes = new Map(entry.processes ?? []);
      const pid = String(processId);
      const processInfo = processes.get(pid);
      if (!processInfo) {
        return entry;
      }
      processes.set(pid, {
        ...processInfo,
        timeoutMs: info.timeoutMs,
        deadlineAt: new Date(info.deadlineAtMs).toISOString(),
        timedOut: info.timedOut,
      });
      return {
        ...entry,
        processes,
        updateTime: now,
      };
    });
  }

  private buildBashTimeoutAdjustment(processId: string, info: ProcessTimeoutInfo): BashTimeoutAdjustment {
    return {
      processId,
      timeoutMs: info.timeoutMs,
      deadlineAt: new Date(info.deadlineAtMs).toISOString(),
      timedOut: info.timedOut,
    };
  }

  private getProcessControlKey(sessionId: string, processId: string | number): string {
    return `${sessionId}:${String(processId)}`;
  }

  private killLiveProcesses(): void {
    for (const processControlKey of Array.from(this.liveProcessKeys)) {
      const processId = this.getProcessIdFromControlKey(processControlKey);
      if (processId === null) {
        this.liveProcessKeys.delete(processControlKey);
        continue;
      }
      this.killTrackedProcess(processControlKey, processId);
    }
  }

  private killTrackedProcess(processControlKey: string, processId: number): void {
    const killedGroup = killProcessTree(processId, "SIGKILL");
    if (!killedGroup) {
      try {
        process.kill(processId, "SIGKILL");
      } catch {
        // Ignore process-kill failures during cleanup.
      }
    }
    this.processTimeoutControls.delete(processControlKey);
    this.liveProcessKeys.delete(processControlKey);
  }

  private getProcessIdFromControlKey(processControlKey: string): number | null {
    const separatorIndex = processControlKey.lastIndexOf(":");
    const rawProcessId = separatorIndex >= 0 ? processControlKey.slice(separatorIndex + 1) : processControlKey;
    const processId = Number(rawProcessId);
    return Number.isInteger(processId) && processId > 0 ? processId : null;
  }

  private getProcessIds(processes: Map<string, SessionProcessEntry> | null): number[] {
    if (!processes) {
      return [];
    }
    const ids: number[] = [];
    for (const pid of processes.keys()) {
      const parsed = Number(pid);
      if (Number.isInteger(parsed) && parsed > 0) {
        ids.push(parsed);
      }
    }
    return ids;
  }

  private normalizeSessionEntry(entry: unknown): SessionEntry {
    const value = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      id: typeof value.id === "string" ? value.id : crypto.randomUUID(),
      summary: typeof value.summary === "string" ? value.summary : null,
      assistantReply: typeof value.assistantReply === "string" ? value.assistantReply : null,
      assistantThinking: typeof value.assistantThinking === "string" ? value.assistantThinking : null,
      assistantRefusal: typeof value.assistantRefusal === "string" ? value.assistantRefusal : null,
      toolCalls: Array.isArray(value.toolCalls) ? value.toolCalls : null,
      status: this.normalizeSessionStatus(value.status),
      failReason: typeof value.failReason === "string" ? value.failReason : null,
      usage: (value.usage as ModelUsage) ?? null,
      usagePerModel: this.normalizeUsagePerModel(value),
      activeTokens: typeof value.activeTokens === "number" ? value.activeTokens : 0,
      createTime: typeof value.createTime === "string" ? value.createTime : new Date().toISOString(),
      updateTime: typeof value.updateTime === "string" ? value.updateTime : new Date().toISOString(),
      processes: this.deserializeProcesses(value.processes),
      askPermissions: normalizeAskPermissions(value.askPermissions),
      planMode: value.planMode === true,
      taskRef: this.normalizeTaskRef(value.taskRef),
    };
  }

  private normalizeTaskRef(value: unknown): { treeId: string; branch: string; nodeId: string } | undefined {
    if (!value || typeof value !== "object") return undefined;
    const ref = value as Record<string, unknown>;
    if (
      typeof ref.treeId === "string" &&
      typeof ref.branch === "string" &&
      typeof ref.nodeId === "string" &&
      /^[0-9a-f-]{36}$/i.test(ref.treeId)
    ) {
      return { treeId: ref.treeId, branch: ref.branch, nodeId: ref.nodeId };
    }
    return undefined;
  }

  private normalizeSessionStatus(status: unknown): SessionStatus {
    if (
      status === "failed" ||
      status === "pending" ||
      status === "processing" ||
      status === "waiting_for_user" ||
      status === "completed" ||
      status === "interrupted" ||
      status === "ask_permission" ||
      status === "permission_denied"
    ) {
      return status;
    }
    return "pending";
  }

  private normalizeUsagePerModel(entry: Record<string, unknown>): Record<string, ModelUsage> | null {
    if (!Object.prototype.hasOwnProperty.call(entry, "usagePerModel")) {
      return null;
    }
    if (!isUsageRecord(entry.usagePerModel)) {
      return null;
    }
    const usagePerModel: Record<string, ModelUsage> = {};
    for (const [model, usage] of Object.entries(entry.usagePerModel)) {
      if (!model || !isUsageRecord(usage)) {
        continue;
      }
      usagePerModel[model] = usage as ModelUsage;
    }
    return usagePerModel;
  }

  private deserializeProcesses(value: unknown): Map<string, SessionProcessEntry> | null {
    if (!value || typeof value !== "object") {
      return null;
    }
    const processes = new Map<string, SessionProcessEntry>();
    for (const [pid, entry] of Object.entries(value as Record<string, unknown>)) {
      if (!pid) {
        continue;
      }
      if (typeof entry === "string") {
        // Backward compatibility for old format where just stored start time
        processes.set(pid, { startTime: entry, command: "Running process..." });
      } else if (typeof entry === "object" && entry !== null) {
        const obj = entry as {
          startTime?: unknown;
          command?: unknown;
          timeoutMs?: unknown;
          deadlineAt?: unknown;
          timedOut?: unknown;
        };
        const startTime = typeof obj.startTime === "string" ? obj.startTime : new Date().toISOString();
        const command = typeof obj.command === "string" ? obj.command : "Running process...";
        processes.set(pid, {
          startTime,
          command,
          timeoutMs: typeof obj.timeoutMs === "number" ? obj.timeoutMs : undefined,
          deadlineAt: typeof obj.deadlineAt === "string" ? obj.deadlineAt : undefined,
          timedOut: typeof obj.timedOut === "boolean" ? obj.timedOut : undefined,
        });
      }
    }
    return processes.size > 0 ? processes : null;
  }

  private serializeProcesses(
    processes: Map<string, SessionProcessEntry> | null
  ): Record<string, SessionProcessEntry> | null {
    if (!processes || processes.size === 0) {
      return null;
    }
    const serialized: Record<string, SessionProcessEntry> = {};
    for (const [pid, entry] of processes.entries()) {
      serialized[pid] = entry;
    }
    return serialized;
  }
}
