// SessionManager layer — see session-manager-base.ts for the split rationale.
import * as NodePath from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  buildCodegraphMcpServerConfig,
  CODEGRAPH_MCP_SERVER_NAME,
  hasCodegraphProject,
  isCodegraphDisabled,
} from "./common/codegraph";
import {
  DEFAULT_ROUTING_CONFIG,
  getEmbeddingLoadError,
  RoutingFacade,
  timedRoutingEvent,
  type RoutingConfig,
  type RoutableTool,
} from "./routing";
import { A2UI_MCP_SERVER_NAME, isA2uiDisabled, getA2uiServerBuilder } from "./mcp/a2ui-seam";
import { ACTIVITY_FRAMES_MCP_SERVER_NAME, getActivityFramesServerBuilder } from "./mcp/activity-frames-seam";
import { augmentMcpToolDescriptions } from "./session-mcp-hints";
import { buildThinkingRequestOptions } from "./common/openai-thinking";
import { DEMBRANDT_MCP_SERVER_NAME, buildDembrandtMcpServerConfig } from "./common/dembrandt";
import { getGitmcpConfigBuilder } from "./mcp/gitmcp-seam";
import { getSerenaController } from "./actions/serena-controller";
import { getSkillSpectorController } from "./actions/skill-spector-controller";
import { gitmcpSlugFromServerName, isGitmcpPlaceholderConfig, isGitmcpServerName } from "./gitmcp/resolve";
import { logRoutingEvent } from "./routing";
import { ROUTING_LOAD_RETRY_BACKOFF_MS } from "./session-constants";
import { SERENA_MCP_SERVER_NAME, isSerenaDisabled } from "./common/serena-mcp";
import { SessionManagerBase } from "./session-manager-base";
import { SKILL_SPECTOR_MCP_SERVER_NAME, isSkillSpectorDisabled } from "./common/skill-spector";
import { type RouterBundle, createRouters, getConfiguredRoutingModelDir } from "./routing";
import type { ToolDefinition } from "./prompt";
import { VISION_MCP_SERVER_NAME, getVisionServerBuilder } from "./mcp/vision-seam";
import type { LLMDecomposer } from "./routing/types";
import type { McpServerConfig } from "./settings";
import type { MemoryProvider, SessionMessage } from "./session-types";

export abstract class SessionManagerMcp extends SessionManagerBase {
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
  protected async getRouters(): Promise<RouterBundle> {
    if (this.routerBundle) return this.routerBundle;
    if (this.routerInitPromise) return this.routerInitPromise;
    // R4 backoff: a failed load (missing embedding package, bad model dir) is
    // retried at most once per window — previously every user prompt paid a
    // fresh dynamic-import attempt that could never succeed.
    const backoffRemaining = ROUTING_LOAD_RETRY_BACKOFF_MS - (Date.now() - this.routingLoadFailedAt);
    if (this.routingLoadFailedAt > 0 && backoffRemaining > 0) {
      return {
        skillRouter: null,
        toolRouter: null,
        facade: new RoutingFacade({ toolRouter: null }),
        shardRecaller: null,
      };
    }

    this.routerInitPromise = (async () => {
      try {
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
              // Static node: imports — a bare require() here is a guaranteed
              // ReferenceError inside this ESM package (the same landmine the
              // crg-query loader hit; review round 2026-09-01).
              const here =
                typeof __dirname !== "undefined" ? __dirname : NodePath.dirname(fileURLToPath(import.meta.url));
              return NodePath.join(here, "..", "..", "desktop", "vendor", "granite-embedding");
            } catch {
              return "";
            }
          })();
        // Cache dir: project-level .deeporca/cache (best-effort).
        const cacheDir = NodePath.join(this.projectRoot, ".deeporca", "cache");
        const bundle = await createRouters(config, { modelDir, cacheDir });
        // Track load failures for the retry backoff above. A null bundle with
        // routing enabled means the embedding service failed to load.
        this.routingLoadFailedAt = config.enabled && !bundle.skillRouter ? Date.now() : 0;
        this.routerBundle = bundle;
        this.shardConfig = {
          enabled: config.skillSharding,
          minChars: config.shardMinChars,
          topK: config.shardTopK,
        };
        return bundle;
      } catch {
        // Thrown failures (embedding dynamic import, model load) previously
        // escaped this init promise for every caller but the first — the raw
        // promise was handed to concurrent second callers — and never armed
        // the R4 backoff, so every prompt re-paid the dynamic import. Both
        // are fixed here: fail open AND arm the backoff window.
        this.routingLoadFailedAt = Date.now();
        return {
          skillRouter: null,
          toolRouter: null,
          facade: new RoutingFacade({ toolRouter: null }),
          shardRecaller: null,
        } as RouterBundle;
      } finally {
        // Drop the in-flight promise once settled: on success routerBundle
        // short-circuits future calls; on failure the backoff above governs
        // the next attempt (previously the null-ing lived in a .catch() that
        // only the first caller ever attached).
        this.routerInitPromise = null;
      }
    })();

    return this.routerInitPromise;
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
    this.shardConfig = null;
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
   * Create an LLMDecomposer for the SkillWeaver SAD pipeline (G3 compositional
   * routing). Uses the flash model to split a complex query into atomic
   * sub-tasks, with optional skill hints on the second pass.
   * Returns null when no LLM client is available (SAD will fail-open).
   */
  protected createSkillDecomposer(options?: { signal?: AbortSignal; sessionId?: string }): LLMDecomposer {
    return {
      decompose: async (query, hints) => {
        const { client, baseURL, model } = this.createBackgroundLlm();
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
                  model,
                  temperature: 0.1,
                  max_tokens: 512,
                  messages: [
                    { role: "system", content: sysPrompt },
                    { role: "user", content: userContent },
                  ],
                  response_format: { type: "json_object" },
                  ...buildThinkingRequestOptions(false, baseURL, "max", model),
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
  protected async getRoutedMcpTools(sessionId: string): Promise<ToolDefinition[]> {
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
  protected async computeRoutedMcpTools(sessionId: string, all: ToolDefinition[]): Promise<ToolDefinition[]> {
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
  protected async ensureMcpServersConnected(serverNames: string[]): Promise<void> {
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
   * directory (or its `.deeporca/codegraph/` store behind the symlink), so the
   * index/knowledge base stays project-scoped and nothing is assumed to exist
   * on the host. A user-provided `codegraph` entry always wins. (The
   * code-review-graph MCP server was retired — queries read graph.db directly
   * from `.deeporca/crg/` via CrgGraphQuery.)
   * GitMCP entries (`gitmcp:` prefix) that still hold the portable placeholder
   * config are rewritten here into a concrete spawn config for this machine.
   */
  protected augmentMcpServersWithBuiltins(
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

    // Dembrandt MCP server — website design-token/brand extraction engine
    // (URL → W3C DTCG tokens / Tailwind @theme / DESIGN.md + drift gate; see
    // docs/research/2026-08-17-external-repos-prestudy.md §1). Pinned npx
    // spawn — no npm dependency, no vendored Chromium (the CLI downloads its
    // own Playwright browser on demand). Availability gate mirrors the
    // neighbors: the config builder returns null unless the project shows
    // design context (designs/ or .deeporca/DESIGN.md — the codegraph-style
    // project marker; npx self-manages the runtime, so no controller seam)
    // and the per-root disable flag is clear (same mechanism as
    // serena/skill-spector).
    if (!(result && Object.prototype.hasOwnProperty.call(result, DEMBRANDT_MCP_SERVER_NAME))) {
      const dembrandtConfig = buildDembrandtMcpServerConfig(this.projectRoot);
      if (dembrandtConfig) {
        result = {
          ...(result ?? {}),
          [DEMBRANDT_MCP_SERVER_NAME]: dembrandtConfig,
        };
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
  protected resolveGitmcpServers(
    servers?: Record<string, McpServerConfig>
  ): Record<string, McpServerConfig> | undefined {
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
  protected refreshMcpToolDefinitions(): void {
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
}
