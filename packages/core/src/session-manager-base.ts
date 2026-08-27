// SessionManager layer 1/6 — fields, constructor, LLM client/stream core.
// The class was split along feature lines to respect the 2500-line file limit;
// SessionManager (session.ts) is the concrete composition of all layers.
// Upward references (constructor closures calling higher-layer methods) are
// declared here as protected abstract and implemented above.
import * as crypto from "crypto";
import {
  ToolExecutionGate,
  type ToolExecutionGateContext,
  type ToolExecutionGateListener,
} from "./common/tool-execution-gate";
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
  designExtractDefinition,
  designExtractRun,
  designDriftDefinition,
  designDriftRun,
  designAuditDefinition,
  designAuditRun,
  prototypeSpecDefinition,
  prototypeSpecRun,
  prototypeMaterializeDefinition,
  prototypeMaterializeRun,
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
} from "./actions";
import type { AuditLog } from "./sandbox/audit";
import { buildThinkingRequestOptions } from "./common/openai-thinking";
import { configureCrgGraphQuery, createCrgGraphQuery } from "./actions/crg-query";
import { createSecondaryClient as defaultCreateSecondaryClient, createEndpointClient } from "./common/openai-client";
import { DEFAULT_STREAM_IDLE_TIMEOUT_MS } from "./settings";
import { findModelRegistration, resolveBackgroundLlm, resolveModelSpec } from "./common/model-capabilities";
import { getLlmErrorDetails } from "./common/llm-error";
import { getSnippet } from "./common/state";
import { isUsageRecord } from "./session-usage";
import { logApiError } from "./common/error-logger";
import { logOpenAIChatCompletionDebug, normalizeDebugError } from "./common/debug-logger";
import { McpManager } from "./mcp/mcp-manager";
import { OpenAIMessageConverter } from "./common/openai-message-converter";
import { PLAN_MODE_FORCE_ASK_SCOPES } from "./session-constants";
import { scavengeToolCalls } from "./common/tool-call-repair";
import { SkillMatchCache } from "./common/skill-match-cache";
import { summarizeCompletionOptions } from "./session-helpers";
import type { TaskTreeService } from "./tasks/task-tree-service";
import { type A2uiLifecycle } from "./mcp/a2ui-seam";
import {
  type CreateOpenAIClient,
  type CreateSecondaryClient,
  type ProcessTimeoutControl,
  ToolExecutor,
} from "./tools/executor";
import {
  type PermissionPlan,
  computeToolCallPermissions,
  DEFAULT_FORCE_ASK_DEFAULTED_SCOPES,
} from "./common/permissions";
import { type RouterBundle } from "./routing";
import { type ToolDefinition, getCurrentTurnTail, getTools } from "./prompt";
import { withStreamIdleTimeout } from "./session-stream";
import type { BackgroundLlmTaskOptions, BackgroundLlmTaskResult, RunSubagentOptions } from "./actions";
import type { McpServerConfig, PermissionSettings } from "./settings";
import type { MessageMeta, SkillInfo, UserPromptContent } from "./session-types";
import type { BashSandboxSpawner, WebPageFetcher } from "./common/tool-types";
import type { SandboxBackend, SandboxBackendStatus, SandboxProbeResult } from "./sandbox/backend/interface";
import type {
  MemoryProvider,
  ChatCompletionDebugOptions,
  ModelUsage,
  SessionEntry,
  SessionsIndex,
  SessionMessage,
  SessionResolvedSettings,
  SessionManagerOptions,
  LlmStreamProgress,
} from "./session-types";

export abstract class SessionManagerBase {
  protected readonly projectRoot: string;

  protected readonly createOpenAIClient: CreateOpenAIClient;

  protected readonly createSecondaryClient: CreateSecondaryClient;

  protected readonly fetchWebPage?: WebPageFetcher;

  /**
   * Before-tool-execution gate (dsh P1-4): a synchronous listener registry at
   * the execution point, with the permission check as its FIRST built-in
   * listener. Execution layer only — it never influences router selection.
   */
  protected readonly toolExecutionGate = new ToolExecutionGate<PermissionPlan>();

  /** The permission check as gate listener #1 (see toolExecutionGate). */
  protected readonly permissionGateListener = (context: ToolExecutionGateContext) => {
    const { sessionId, toolCalls } = context;
    // Quarantine (design.md §10.3): out-of-cwd R/W/D denied outright at
    // the permission layer (never asked), and bash force-asked when no
    // sandbox backend is available — a quarantined repo must not ask its
    // way out of the boundary.
    const quarantined = this.isWorkspaceQuarantined();
    const effectivePermissions = this.effectivePermissions();
    const permissionPlan = computeToolCallPermissions({
      sessionId,
      projectRoot: this.projectRoot,
      toolCalls,
      settings: effectivePermissions,
      forceAskScopes: this.getSession(sessionId)?.planMode ? PLAN_MODE_FORCE_ASK_SCOPES : undefined,
      // Baseline (plan mode or not): allowAll must not silently cover
      // out-of-cwd write/delete. Explicit allow-list grants survive —
      // only the defaultMode fallback is forced to ask (§4.2, decision
      // 2026-08-15).
      forceAskDefaultedScopes: DEFAULT_FORCE_ASK_DEFAULTED_SCOPES,
      forceAskTools: quarantined && !this.getOrCreateBashBackend(sessionId).probe.available ? ["bash"] : undefined,
      readPermissionExemptPaths: [
        ...this.getSkillScanRoots().map((entry) => entry.root),
        ...(effectivePermissions?.allowedReadPaths ?? []),
      ],
      writePermissionExemptPaths: effectivePermissions?.allowedWritePaths ?? [],
      resolveSnippetPath: (id, snippetId) => getSnippet(id, snippetId)?.filePath,
    });
    return {
      verdict: permissionPlan.askPermissions.length > 0 ? ("ask" as const) : ("allow" as const),
      payload: permissionPlan,
      source: "permissions",
    };
  };

  protected readonly getResolvedSettings: () => SessionResolvedSettings;

  protected readonly onAssistantMessage: (message: SessionMessage, shouldConnect: boolean) => void;

  protected readonly onSessionEntryUpdated?: (entry: SessionEntry) => void;

  protected readonly onLlmStreamProgress?: (progress: LlmStreamProgress) => void;

  protected readonly buildBehaviorContext?: () => string | null;

  protected readonly onMcpStatusChanged?: () => void;

  protected readonly onSandboxStatusChanged?: (status: SandboxBackendStatus) => void;

  protected readonly onProcessStdout?: (pid: number, chunk: string) => void;

  protected activeSessionId: string | null = null;

  protected activePromptController: AbortController | null = null;

  protected readonly sessionControllers = new Map<string, AbortController>();

  /** Sessions with a graceful-pause request pending; honored at the next loop boundary. */
  protected readonly pauseRequestedSessions = new Set<string>();

  protected readonly processTimeoutControls = new Map<string, ProcessTimeoutControl>();

  protected readonly liveProcessKeys = new Set<string>();

  protected readonly toolExecutor: ToolExecutor;

  protected readonly mcpManager = new McpManager();

  protected mcpToolDefinitions: ToolDefinition[] = [];

  /** Server names declared (settings + builtins) — lazy-connect eligibility. */
  protected declaredMcpServers = new Set<string>();

  /**
   * G2 session-frozen tool injection sets (R1): the routed tool set is decided
   * ONCE per session and then stays byte-identical — per-iteration re-routing
   * changed the request prefix every turn, killing DeepSeek's prefix cache and
   * occasionally dropping tools mid-task. Invalidated when the discovered tool
   * set changes (tools/list, reconnect) or the session is deleted.
   */
  protected frozenToolRoutes = new Map<string, ToolDefinition[]>();

  /**
   * ActionRegistry — owns the defineAction primitive's registered actions for
   * this project. Constructed here (core) using the host-injected Spawner
   * (getActionSpawner); desktop's IPC bridge reaches this same instance via the
   * engine so IPC + LLM + MCP share one registry. Phase 0 ships system.ping.
   */
  protected readonly actionRegistry: ActionRegistry;

  /** Skill/tool routers (lazy-initialized; null when routing disabled/unavailable). */
  protected routerBundle: RouterBundle | null = null;

  protected routerInitPromise: Promise<RouterBundle> | null = null;

  /** When the last router load FAILED (0 = never / success) — retry backoff (R4). */
  protected routingLoadFailedAt = 0;

  /** G3 shard-injection switches mirrored from the routing config at bundle build. */
  protected shardConfig: { enabled: boolean; minChars: number; topK: number } | null = null;

  /** Current subagent nesting depth (recursion cap, deep review 2026-08-15 B6). */
  protected subagentDepth = 0;

  /** True while a silent subagent runs — new sub-sessions get isSilentSubagent. */
  protected silentSubagentActive = false;

  /**
   * Live sessionless background-task ids (runBackgroundLlmTask). Used to
   * suppress LLM stream-progress events for pipeline-internal loops so they
   * never light up the conversation view.
   */
  protected readonly backgroundTaskIds = new Set<string>();

  /** Task trajectory service (specs/task-tree P0) — single writer, lazily built. */
  protected taskTreeServiceInstance: TaskTreeService | null = null;

  /** Sessions that mutated files during the current turn and need a CodeGraph index sync. */
  protected readonly codegraphDirtySessions = new Set<string>();

  /** Sessions that mutated files during the current turn and need a CRG graph sync. */
  protected readonly crgDirtySessions = new Set<string>();

  /** Sessions that mutated files during the current turn and need a wiki update. */
  protected readonly wikiDirtySessions = new Set<string>();

  /** Files mutated during the current turn, per session, for post-edit diagnostics. */
  protected readonly diagnosticsDirtyFiles = new Map<string, Set<string>>();

  /** Knowledge-source freshness timestamps (ISO) surfaced to the dashboard. */
  protected knowledgeFreshness: {
    lastMutation?: string;
    codegraphSync?: string;
    wikiSync?: string;
    crgSync?: string;
  } = {};

  /** Memory Gateway client (null when memory is disabled or Gateway unavailable). */
  /** Memory provider (null when memory is disabled or not yet initialized). */
  protected memoryProvider: MemoryProvider | null = null;

  /** A2UI lifecycle bundle (null when A2UI is disabled or builder not injected). */
  protected currentA2uiLifecycle: A2uiLifecycle | null = null;

  protected readonly messageConverter: OpenAIMessageConverter;

  /**
   * Per-session message cache. listSessionMessages is called multiple times
   * per loop iteration (×80000 max), each time re-reading and re-parsing the
   * entire JSONL file. This cache holds the parsed result so repeated reads
   * within a turn are O(1). Mirrored on append (see appendSessionMessage),
   * replaced on full save, cleared on session switch or dispose.
   */
  protected readonly messageCache = new Map<string, SessionMessage[]>();

  /** Sessions that already received a task-recall hint (once per session). */
  protected taskRecallHinted = new Set<string>();

  /** LLM skill-match results keyed by (candidate pool, prompt) — Phase 3 /
   *  T3.2: the deferred-permission path re-sends the same prompt and must not
   *  re-burn the flash classification call. */
  protected readonly skillMatchCache = new SkillMatchCache();

  /**
   * Pending index write timer for debounced saves. High-frequency
   * updateSessionEntry calls (status changes during streaming) are batched
   * into a single disk write every 250ms instead of rewriting the entire
   * index file on every call. Critical operations (create/delete session)
   * call flushSessionsIndex() to force an immediate write.
   */
  protected indexWriteTimer: ReturnType<typeof setTimeout> | null = null;

  protected static readonly INDEX_WRITE_DELAY = 250;

  /** Persistence-only cap for entry.assistantThinking in sessions-index.json
   *  (see flushSessionsIndex) — reasoning dumps dominate index size otherwise. */
  protected static readonly INDEX_THINKING_SNIPPET_CHARS = 2048;

  protected pendingIndex: SessionsIndex | null = null;

  /**
   * Set once dispose() finishes. A disposed manager must never touch the
   * sessions index again: reload()/window recreation swaps in a fresh
   * SessionManager while this instance's late async catch handlers (e.g. the
   * abort path that stamps status:"interrupted") may still fire. Without this
   * guard those handlers rebuild a stale snapshot from disk and its debounced
   * timer later overwrites the new manager's writes — permanently losing any
   * session created after the swap (see flushSessionsIndex/saveSessionsIndex).
   */
  protected disposed = false;

  protected readonly sessionAuditLogs = new Map<string, AuditLog>();

  protected readonly bashSandboxBySession = new Map<string, BashSandboxSpawner>();

  protected readonly bashBackendBySession = new Map<string, { backend: SandboxBackend; probe: SandboxProbeResult }>();

  constructor(options: SessionManagerOptions) {
    this.projectRoot = options.projectRoot;
    this.createOpenAIClient = options.createOpenAIClient;
    this.createSecondaryClient = options.createSecondaryClient ?? defaultCreateSecondaryClient;
    this.fetchWebPage = options.fetchWebPage;
    this.toolExecutionGate.register("permissions", this.permissionGateListener);
    this.getResolvedSettings = options.getResolvedSettings;
    this.onAssistantMessage = options.onAssistantMessage;
    this.onSessionEntryUpdated = options.onSessionEntryUpdated;
    this.onLlmStreamProgress = options.onLlmStreamProgress;
    this.onMcpStatusChanged = options.onMcpStatusChanged;
    this.onSandboxStatusChanged = options.onSandboxStatusChanged;
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
      // Sessionless background LLM loop (R2-2): index.build-all's arch-scan
      // stage runs here — zero session residue, zero conversation-view impact.
      runBackgroundTask: (opts) => this.runBackgroundLlmTask(opts),
      // LLM single-choice judgment for classification-shaped actions
      // (design.materialize routing). Fail-open: null → caller's heuristic.
      judgeViaLlm: (prompt, choices) => this.judgeViaLlm(prompt, choices),
      completeViaLlm: (messages, opts) => this.completeTextViaLlm(messages, opts),
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
    // ── Designer — dembrandt brand ingestion (design.extract / design.drift;
    // pinned npx CLI via ctx.spawner, deterministic, no LLM) ────────────────
    this.actionRegistry.register(designExtractDefinition, designExtractRun);
    this.actionRegistry.register(designDriftDefinition, designDriftRun);
    // ── Designer — deterministic anti-slop audit (design.audit; taste #11
    // three-axis machine check + gate subset, zero LLM, changes nothing) ────
    this.actionRegistry.register(designAuditDefinition, designAuditRun);
    // ── Prototype module (design-module split): 需求 → 需求文档 → 原型图 —
    // two explicit steps, no auto-routing (real-machine feedback) ──────────
    this.actionRegistry.register(prototypeSpecDefinition, prototypeSpecRun);
    this.actionRegistry.register(prototypeMaterializeDefinition, prototypeMaterializeRun);
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
      this.actionRegistry,
      this.fetchWebPage,
      // Memory retrieval tools (Phase 4 / T4.1). Read through `this.memoryProvider`
      // at CALL time — the provider may be bound after the executor is built
      // (desktop binds on memory start / project switch).
      {
        getToolDefinitions: () =>
          this.memoryProvider?.isAvailable() ? (this.memoryProvider.getToolDefinitions?.() ?? []) : [],
        invoke: (name, args) => {
          const run = this.memoryProvider?.executeTool?.(name, args);
          if (!run) {
            return Promise.reject(new Error(`Memory tool unavailable: ${name}`));
          }
          return run;
        },
      }
    );
    this.mcpManager.prepare(this.augmentMcpServersWithBuiltins(this.getResolvedSettings().mcpServers));
    // CRG query layer: Node.js direct SQLite read (replaces Python MCP server).
    // Auto-initialized; the query gracefully returns [] when no graph exists.
    configureCrgGraphQuery(createCrgGraphQuery());
    this.messageConverter = new OpenAIMessageConverter({
      renderInitPrompt: () => this.renderInitCommandPrompt(),
      // User-declared per-model capabilities (endpoint models[].thinking/vision)
      // override the family registry when filtering multimodal content.
      resolveModelRegistration: (model) => {
        const settings = this.getResolvedSettings();
        return findModelRegistration(settings.endpoints ?? [], model, settings.primaryEndpointId);
      },
      // Inject the current date + active model as a transient user-message tail
      // per request, never into the persisted prefix — keeps the DeepSeek prefix
      // cache warm across days/model switches (the date no longer lives in the
      // system-prompt prefix).
      buildTurnTail: (model) => getCurrentTurnTail(model),
    });

    // Must run after every field is initialized and BEFORE any consumer can
    // observe sessions (no activation loop can exist yet — controllers are
    // empty, so nothing live can be swept by accident).
    this.sweepStaleRunsAfterRestart();
  }

  /**
   * Boot-time reconciliation hook. Declared here, IMPLEMENTED by the
   * persistence layer (dynamic dispatch reaches the subclass override even
   * though construction starts here) — sweeping stale `processing` entries
   * needs sessions-index access that only lives below this class.
   */
  protected sweepStaleRunsAfterRestart(): void {}

  // ── Upward contracts ────────────────────────────────────────────────────────
  // The constructor's wiring closures, the permission gate listener, and lower
  // layers call the members below. Their implementations live in HIGHER layers
  // of the chain (mcp → skills → persistence → lifecycle → tasks); the
  // signatures here mirror those implementations exactly.
  protected abstract isWorkspaceQuarantined(): boolean;
  protected abstract effectivePermissions(): Required<PermissionSettings> | undefined;
  protected abstract getSession(sessionId: string): SessionEntry | null;
  protected abstract getOrCreateBashBackend(sessionId: string): {
    backend: SandboxBackend;
    probe: SandboxProbeResult;
  };
  protected abstract getSkillScanRoots(): Array<{ root: string; displayRoot: string }>;
  protected abstract runSubagent(opts: RunSubagentOptions): Promise<{ sessionId: string; content: string | null }>;
  protected abstract runBackgroundLlmTask(opts: BackgroundLlmTaskOptions): Promise<BackgroundLlmTaskResult>;
  protected abstract getTaskTreeService(): TaskTreeService | null;
  protected abstract setSessionTaskRef(
    sessionId: string,
    ref: { treeId: string; branch: string; nodeId: string } | null
  ): void;
  protected abstract appendSessionSystemMessage(sessionId: string, text: string): void;
  protected abstract augmentMcpServersWithBuiltins(
    servers?: Record<string, McpServerConfig>
  ): Record<string, McpServerConfig> | undefined;
  protected abstract renderInitCommandPrompt(): string;
  protected abstract normalizeLlmToolCalls(rawToolCalls: unknown[] | null | undefined): unknown[] | null;
  protected abstract getPromptToolOptions(): { model: string; webSearchEnabled: boolean };
  protected abstract getRoutedMcpTools(sessionId: string): Promise<ToolDefinition[]>;
  protected abstract generateToolCallId(): string;
  protected abstract listSessionMessages(sessionId: string): SessionMessage[];
  protected abstract loadAgentInstructions(): string | null;
  protected abstract appendSessionMessage(sessionId: string, message: SessionMessage): void;
  protected abstract buildSystemMessage(
    sessionId: string,
    content: string,
    contentParams?: unknown | null,
    visible?: boolean,
    meta?: MessageMeta
  ): SessionMessage;
  protected abstract buildSkillMessage(sessionId: string, content: string, skill: SkillInfo): SessionMessage;
  protected abstract buildToolParamsSnippet(toolFunction: unknown | null): string;
  protected abstract buildToolResultSnippet(content: string): string;
  protected abstract isInvisibleExecution(content: string): boolean;
  protected abstract cloneUserPromptForMeta(prompt: UserPromptContent): UserPromptContent;
  protected abstract addSessionSystemMessage(
    sessionId: string,
    content: string,
    visible?: boolean,
    meta?: MessageMeta
  ): void;

  /**
   * Register a before-tool-execution listener (dsh P1-4). Runs synchronously
   * at the execution layer, strictly AFTER routing — it must never influence
   * which tools/skills the router selected. Verdict precedence: deny > ask >
   * allow. Returns an unregister function.
   */
  registerBeforeToolExecution(name: string, listener: ToolExecutionGateListener<PermissionPlan>): () => void {
    return this.toolExecutionGate.register(name, listener);
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
   * Resolve the LLM for a background task (compaction, skill matching,
   * classification, prompt enhancement, skill decomposition): the family's
   * lightweight model on the primary endpoint, else the same lightweight model
   * dynamically detected on ANOTHER configured endpoint (e.g. flash on
   * opencode-zen while the session runs pro on opencode-go), else the user's
   * configured secondary model, else the primary session model itself (always
   * served). DeepSeek endpoints resolve to deepseek-v4-flash — identical to
   * the pre-registry hardcoded constants.
   */
  protected createBackgroundLlm(): {
    client: ReturnType<CreateOpenAIClient>["client"];
    model: string;
    baseURL?: string;
    debugLogEnabled?: boolean;
  } {
    const primary = this.createOpenAIClient();
    const settings = this.getResolvedSettings();
    const endpoints = settings.endpoints ?? [];
    const primaryEndpoint =
      endpoints.find((endpoint) => endpoint.id === settings.primaryEndpointId) ??
      endpoints.find((endpoint) => endpoint.baseURL === primary.baseURL);
    // Cross-endpoint activation candidates: other credential-backed endpoints
    // that register models (the family lightweight may live there).
    const crossEndpoints = endpoints.filter(
      (endpoint) => endpoint !== primaryEndpoint && !!endpoint.apiKey && !!endpoint.models && endpoint.models.length > 0
    );
    const choice = resolveBackgroundLlm({
      primaryModel: primary.model,
      baseURL: primary.baseURL,
      endpointModelIds: primaryEndpoint?.models?.map((entry) => entry.id),
      crossEndpointCandidates: crossEndpoints.map((endpoint) => ({
        modelIds: endpoint.models?.map((entry) => entry.id) ?? [],
      })),
      secondaryModel: settings.secondaryModel && settings.secondaryApiKey ? settings.secondaryModel : undefined,
    });
    if (choice.tier === "lightweight-cross-endpoint") {
      const endpoint = crossEndpoints[choice.endpointIndex];
      const client = createEndpointClient(endpoint?.apiKey, endpoint?.baseURL);
      if (client && endpoint) {
        return {
          client,
          model: choice.model,
          baseURL: endpoint.baseURL,
          debugLogEnabled: primary.debugLogEnabled,
        };
      }
    }
    if (choice.tier === "secondary") {
      const secondary = this.createSecondaryClient();
      if (secondary.client) {
        return {
          client: secondary.client,
          model: secondary.model,
          baseURL: secondary.baseURL,
          debugLogEnabled: primary.debugLogEnabled,
        };
      }
    }
    return {
      client: primary.client,
      model: choice.tier === "secondary" ? primary.model : choice.model,
      baseURL: primary.baseURL,
      debugLogEnabled: primary.debugLogEnabled,
    };
  }

  /**
   * LLM single-choice judgment for classification-shaped actions (flash
   * model, JSON mode). Returns one of `choices` or null on any failure —
   * callers must fail open to their deterministic fallback.
   */
  protected async judgeViaLlm(prompt: string, choices: readonly string[]): Promise<string | null> {
    if (choices.length === 0) return null;
    const { client, baseURL, debugLogEnabled, model } = this.createBackgroundLlm();
    if (!client) return null;
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
          ...buildThinkingRequestOptions(false, baseURL, "max", model),
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

  /**
   * Free-form backend text completion on the PRIMARY (settings) model — the
   * content-work counterpart of judgeViaLlm's flash-class classification.
   * Translation-grade output: no JSON mode, no max_tokens cap, thinking off
   * (cost/latency), temperature pinned low for fidelity. Returns null on any
   * failure so callers can fail open.
   */
  protected async completeTextViaLlm(
    messages: Array<{ role: "system" | "user"; content: string }>,
    opts?: { signal?: AbortSignal }
  ): Promise<string | null> {
    const { client, model, baseURL, debugLogEnabled } = this.createOpenAIClient();
    if (!client) return null;
    try {
      const response = await this.createChatCompletionStream(
        client,
        {
          model,
          temperature: 0.2,
          messages,
          ...buildThinkingRequestOptions(false, baseURL, "max", model),
        },
        opts?.signal ? { signal: opts.signal } : undefined,
        undefined,
        {
          enabled: debugLogEnabled,
          location: "SessionManager.completeTextViaLlm",
          baseURL,
          params: { purpose: "backend-completion", model },
        }
      );
      const content = response.choices?.[0]?.message?.content;
      return typeof content === "string" && content.trim() ? content : null;
    } catch {
      return null;
    }
  }

  protected estimateStreamTokens(text: string): number {
    // Same projection as before (CJK ≈0.6 tokens/char, else ≈0.3) but via
    // code-point range comparison: the per-character /u regex ran once per
    // code point of every streamed delta — hundreds of thousands of regex
    // calls over a long response. Also fixes the old range's skew by using
    // the canonical CJK blocks compaction.ts already treats as dense.
    let cjk = 0;
    let other = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0;
      const isCjk =
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0x3000 && code <= 0x30ff) ||
        (code >= 0xff00 && code <= 0xffef) ||
        (code >= 0xac00 && code <= 0xd7af);
      if (isCjk) {
        cjk += 1;
      } else {
        other += 1;
      }
    }
    return cjk * 0.6 + other * 0.3;
  }

  protected formatEstimatedTokens(tokens: number): string {
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

  protected emitLlmStreamProgress(
    requestId: string,
    startedAt: string,
    estimatedTokens: number,
    phase: LlmStreamProgress["phase"],
    sessionId?: string
  ): void {
    // Sessionless background tasks (runBackgroundLlmTask) never surface stream
    // progress — their token flow is pipeline-internal and must not light up
    // the conversation view's progress UI.
    if (sessionId && this.backgroundTaskIds.has(sessionId)) {
      return;
    }
    this.onLlmStreamProgress?.({
      requestId,
      sessionId,
      startedAt,
      estimatedTokens: Math.round(estimatedTokens),
      formattedTokens: this.formatEstimatedTokens(estimatedTokens),
      phase,
    });
  }

  protected isAbortLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return error.name === "AbortError" || error.constructor.name === "APIUserAbortError";
  }

  protected throwIfAborted(signal?: AbortSignal | null): void {
    if (!signal?.aborted) {
      return;
    }

    const error = new Error("Request was aborted.");
    error.name = "AbortError";
    throw error;
  }

  protected getStreamIdleTimeoutMs(): number {
    const value = this.getResolvedSettings().streamIdleTimeoutMs;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  }

  protected async createChatCompletionStream(
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
    // Per-family reasoning contract for this request's model: which streaming
    // delta fields carry reasoning, and which field name persists it.
    const modelSpec = resolveModelSpec({
      model: typeof request.model === "string" ? request.model : "",
    });

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

          // Nullish-coalescing chain over the family's reasoning read fields
          // (defaults to reasoning_content ?? reasoning — pre-registry order).
          let reasoningDelta: unknown;
          for (const field of modelSpec.reasoningReadFields) {
            const candidate = (delta as Record<string, unknown>)[field];
            if (candidate !== null && candidate !== undefined) {
              reasoningDelta = candidate;
              break;
            }
          }
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
    let normalizedToolCalls = this.normalizeLlmToolCalls(toolCalls);
    // Text-channel scavenging (dirge mechanism): a weak model may write its
    // calls into the content/reasoning text instead of the structured
    // tool_calls field (```json fences, <tool_call> tags, bare JSON with a
    // registered name). Only fires when the structured channel produced
    // nothing, and only dispatches names that exist in this loop's tool
    // surface — repair never invents a name.
    if (!normalizedToolCalls || normalizedToolCalls.length === 0) {
      const scavengeText = [content, reasoningContent].filter((part) => part.length > 0).join("\n");
      if (scavengeText.length > 0 && sessionId) {
        const allowed = new Set(
          getTools(this.getPromptToolOptions(), [
            ...(await this.getRoutedMcpTools(sessionId)),
            ...this.actionRegistry.toToolDefinitions(),
            ...(this.memoryProvider?.isAvailable() ? (this.memoryProvider.getToolDefinitions?.() ?? []) : []),
          ]).map((tool) => tool.function.name)
        );
        const scavenged = scavengeToolCalls(scavengeText, allowed);
        if (scavenged.calls.length > 0) {
          normalizedToolCalls = scavenged.calls.map((call) => ({
            id: this.generateToolCallId(),
            type: "function",
            function: { name: call.name, arguments: call.arguments || "{}" },
          }));
        }
      }
    }
    const message: Record<string, unknown> = { content };
    if (normalizedToolCalls) {
      message.tool_calls = normalizedToolCalls;
    }
    if (reasoningContent.length > 0) {
      message[modelSpec.reasoningField] = reasoningContent;
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

  protected logChatCompletionDebug(
    debug: ChatCompletionDebugOptions | undefined,
    entry: Parameters<typeof logOpenAIChatCompletionDebug>[0]
  ): void {
    if (!debug?.enabled) {
      return;
    }
    logOpenAIChatCompletionDebug(entry);
  }
}
