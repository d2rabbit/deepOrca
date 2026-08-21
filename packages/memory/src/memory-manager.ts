/**
 * MemoryManager — in-process L0-L3 memory pipeline manager.
 *
 * Wraps TdaiCore for direct in-process calls (no HTTP overhead).
 * Replaces the previous MemoryGatewayClient HTTP sidecar architecture.
 *
 * Lifecycle:
 *   const mgr = new MemoryManager(config);
 *   await mgr.init();
 *   const recall = await mgr.recall("user query", "session-1");
 *   await mgr.capture({ userText, assistantText, sessionKey });
 *   await mgr.destroy();
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TdaiCore } from "./tdai/core/tdai-core.js";
import type { RecallResult, CaptureResult, CompletedTurn } from "./tdai/core/types.js";
import { parseConfig } from "./tdai/config.js";
import { LocalMemoryCleaner } from "./tdai/utils/memory-cleaner.js";
import { DeepOrcaHostAdapter, type DeepOrcaMemoryConfig, type MemoryGenerationInfo } from "./adapter.js";

/** Aggregate memory-pipeline LLM consumption (Phase 2, specs/memory-remediation). */
export interface MemoryUsageStats {
  /** Total run() invocations (successful + failed). */
  calls: number;
  /** Runs that threw (API error, timeout, …). */
  failedCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  byLayer: Record<"l1" | "l2" | "l3" | "other", { calls: number; totalTokens: number }>;
}

/**
 * In-memory counters + best-effort JSONL audit trail for every memory-pipeline
 * LLM call. The log lands at `<dataDir>/.metadata/generation-log.jsonl`; a
 * write failure never propagates — generation stays "successful" even if the
 * log cannot be persisted (same semantics as upstream best-effort.ts).
 */
export function createGenerationRecorder(dataDir: string): {
  record: (info: MemoryGenerationInfo) => void;
  getUsage: () => MemoryUsageStats;
} {
  const byLayer: MemoryUsageStats["byLayer"] = {
    l1: { calls: 0, totalTokens: 0 },
    l2: { calls: 0, totalTokens: 0 },
    l3: { calls: 0, totalTokens: 0 },
    other: { calls: 0, totalTokens: 0 },
  };
  let calls = 0;
  let failedCalls = 0;
  let promptTokens = 0;
  let completionTokens = 0;

  const logPath = path.join(dataDir, ".metadata", "generation-log.jsonl");
  let metadataDirReady: Promise<void> | undefined;
  const ensureMetadataDir = (): Promise<void> => {
    metadataDirReady ??= fs
      .mkdir(path.join(dataDir, ".metadata"), { recursive: true })
      .then(() => undefined)
      .catch(() => undefined);
    return metadataDirReady;
  };

  return {
    record(info) {
      calls += 1;
      if (!info.ok) failedCalls += 1;
      promptTokens += info.promptTokens;
      completionTokens += info.completionTokens;
      const bucket = byLayer[info.layer] ?? byLayer.other;
      bucket.calls += 1;
      bucket.totalTokens += info.totalTokens;
      // Fire-and-forget append; failures are swallowed by design.
      void ensureMetadataDir()
        .then(() => fs.appendFile(logPath, `${JSON.stringify(info)}\n`, "utf-8"))
        .catch(() => {});
    },
    getUsage() {
      return {
        calls,
        failedCalls,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        byLayer: {
          l1: { ...byLayer.l1 },
          l2: { ...byLayer.l2 },
          l3: { ...byLayer.l3 },
          other: { ...byLayer.other },
        },
      };
    },
  };
}

export class MemoryManager {
  private core: TdaiCore | null = null;
  private adapter: DeepOrcaHostAdapter;
  private config: DeepOrcaMemoryConfig;
  private initialized = false;
  private readonly generation: ReturnType<typeof createGenerationRecorder>;
  /** Daily retention cleaner (Phase 4 / T4.2); null when retention=0. */
  private cleaner: LocalMemoryCleaner | null = null;

  constructor(config: DeepOrcaMemoryConfig) {
    this.config = config;
    this.generation = createGenerationRecorder(config.dataDir);
    // Telemetry rides on the config the adapter sees; the caller's object is
    // left untouched (host-provided onGeneration, if any, still fires first).
    const hostOnGeneration = config.onGeneration;
    this.adapter = new DeepOrcaHostAdapter({
      ...config,
      onGeneration: (info) => {
        hostOnGeneration?.(info);
        this.generation.record(info);
      },
    });
  }

  /** Initialize the TdaiCore pipeline (SQLite, stores, schedulers). */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Parse via the official parser so every required sub-field is populated
    // with validated defaults. Earlier code hand-built a partial object and
    // cast it via `as unknown as MemoryTdaiConfig`, leaving pipeline/store
    // code reading undefined timeouts, embedding dimensions, dedup settings,
    // etc. — which could produce NaN delays or eager tight-looping.
    const embeddingCfg = this.config.embedding ?? { enabled: false, provider: "none" };
    const tdaiConfig = parseConfig({
      capture: { enabled: true },
      extraction: { enabled: true },
      persona: { triggerEveryN: 50 },
      // Phase 3 / T3.3: 10 turns per L1 extraction batch (was 5). The same
      // conversation is already summarized by core's compaction; halving the
      // extraction cadence cuts the per-batch flash burn without starving
      // recall (idle 600s + shutdown flush still catch up). Phase 4 / T4.5:
      // host-configurable via settings.memory.everyNConversations.
      pipeline: { everyNConversations: this.config.pipeline?.everyNConversations ?? 10 },
      recall: {
        enabled: true,
        strategy: "hybrid",
        timeoutMs: 5000,
        // Phase 4 / T4.4: bounded recall injection. Previously 0 (= unlimited):
        // a long atomic fact or a large persona rode along every turn forever.
        maxCharsPerMemory: 300,
        maxTotalRecallChars: 2000,
      },
      embedding: embeddingCfg,
      storeBackend: "sqlite",
      bm25: { enabled: true, language: "zh" },
      memoryCleanup: { enabled: false },
      report: { enabled: false },
      llm: { enabled: false },
      offload: { enabled: false },
    });

    this.core = new TdaiCore({
      hostAdapter: this.adapter,
      config: tdaiConfig,
      graniteModelDir: this.config.graniteModelDir,
      // L2/L3 active (restored in Phase 1, specs/memory-remediation): the
      // runner now provides sandboxed read/write/edit file tools, so scene
      // extraction and persona generation can actually write their outputs;
      // pipeline-side failure backoff caps wasted retries.
    });

    await this.core.initialize();
    this.initialized = true;

    // Phase 4 / T4.2: daily retention cleaner. Conservative default (30 days)
    // with the cleaner's own minimum-retain guards (never drops below 50 L0 /
    // 20 L1 rows); 0 disables. The store handle arrives asynchronously once
    // TdaiCore's store init settles — until then the cleaner only prunes
    // expired JSONL shards.
    const retentionDays = this.config.retentionDays ?? 30;
    if (retentionDays > 0) {
      this.cleaner = new LocalMemoryCleaner({
        baseDir: this.config.dataDir,
        l0RetentionDays: retentionDays,
        // L1 is the LLM-paid distilled layer — keep it 3× longer, floored at
        // the spec's 90 days (specs/memory-remediation T4.2: "L0 30 / L1 90").
        l1RetentionDays: Math.max(90, retentionDays * 3),
        cleanTime: "03:30",
        logger: {
          debug: (m) => console.debug(`[memory] ${m}`),
          info: (m) => console.info(`[memory] ${m}`),
          warn: (m) => console.warn(`[memory] ${m}`),
          error: (m) => console.error(`[memory] ${m}`),
        },
      });
      this.cleaner.start();
      const core = this.core;
      void core
        .getReadyVectorStore()
        .then((store) => this.cleaner?.setVectorStore(store))
        .catch(() => {});
    }
  }

  /** Recall memories relevant to the user's query. */
  async recall(query: string, sessionKey: string): Promise<RecallResult | null> {
    if (!this.core || !this.initialized) return null;
    try {
      this.adapter.updateContext({ sessionKey });
      return await this.core.handleBeforeRecall(query, sessionKey);
    } catch (err) {
      console.warn(`[memory] recall failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** Capture a completed conversation turn. */
  async capture(turn: {
    userText: string;
    assistantText: string;
    sessionKey: string;
    sessionId?: string;
    /** Last user + assistant messages (plus "system" lineage hints — T4.3:
     * persisted to L0 under their real role, excluded from L1 extraction).
     * When omitted, two messages are synthesized from userText/assistantText.
     * The L0 recorder only persists entries it finds in messages[], so this
     * MUST be non-empty for capture to actually record anything. */
    messages?: Array<{
      role: "user" | "assistant" | "system";
      content: string;
      id?: string;
      timestamp?: number;
    }>;
  }): Promise<CaptureResult | null> {
    if (!this.core || !this.initialized) return null;
    try {
      // Build the messages payload for L0. Prefer the structured messages
      // passed by the caller (they carry real ids/timestamps); fall back to
      // synthesizing two entries from the flat text fields.
      const messages: unknown[] =
        turn.messages && turn.messages.length > 0
          ? turn.messages
          : [
              { role: "user", content: turn.userText, timestamp: Date.now() },
              { role: "assistant", content: turn.assistantText, timestamp: Date.now() },
            ];
      const completedTurn: CompletedTurn = {
        userText: turn.userText,
        assistantText: turn.assistantText,
        messages,
        sessionKey: turn.sessionKey,
        sessionId: turn.sessionId,
        startedAt: Date.now(),
      };
      return await this.core.handleTurnCommitted(completedTurn);
    } catch (err) {
      console.warn(`[memory] capture failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** Search memories by query. */
  async searchMemories(query: string, limit: number = 5): Promise<{ text: string; total: number } | null> {
    if (!this.core || !this.initialized) return null;
    try {
      const result = await this.core.searchMemories({ query, limit });
      return { text: result.text, total: result.total };
    } catch (err) {
      console.warn(`[memory] searchMemories failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * Pipeline statistics for the knowledge dashboard. Counts are read from the
   * on-disk store layout (L0 conversations/, L1 records/, L3 persona.md) rather
   * than through TdaiCore, so this stays cheap and works even when the core is
   * mid-initialization. `usage` aggregates every memory-pipeline LLM call this
   * process has made (Phase 2, specs/memory-remediation) — the per-call audit
   * trail lives at <dataDir>/.metadata/generation-log.jsonl.
   */
  async getStats(): Promise<{ l0: number; l1: number; l2: number; l3: boolean; usage: MemoryUsageStats } | null> {
    if (!this.initialized) return null;
    const baseDir = this.config.dataDir;
    const countFiles = async (dir: string): Promise<number> => {
      try {
        const entries = await fs.readdir(path.join(baseDir, dir), { withFileTypes: true });
        return entries.filter((e) => e.isFile()).length;
      } catch {
        return 0;
      }
    };
    const fileExists = async (rel: string): Promise<boolean> => {
      try {
        await fs.access(path.join(baseDir, rel));
        return true;
      } catch {
        return false;
      }
    };
    const [l0, l1, l2, l3] = await Promise.all([
      countFiles("conversations"),
      countFiles("records"),
      countFiles("scene_blocks"),
      fileExists("persona.md"),
    ]);
    return { l0, l1, l2, l3, usage: this.generation.getUsage() };
  }

  /** Aggregate memory-pipeline LLM consumption for this process. */
  getUsage(): MemoryUsageStats {
    return this.generation.getUsage();
  }

  /**
   * Clear all stored memory data for this project (L0-L3). Removes the on-disk
   * directories and the persona file, then re-initializes the pipeline so it
   * starts fresh. Used by the knowledge dashboard's "clear memory" button.
   */
  async clearProjectMemory(): Promise<void> {
    if (!this.initialized || !this.core) return;
    const baseDir = this.config.dataDir;
    const rmDir = async (dir: string): Promise<void> => {
      try {
        await fs.rm(path.join(baseDir, dir), { recursive: true, force: true });
      } catch {
        // best-effort
      }
    };
    const rmFile = async (file: string): Promise<void> => {
      try {
        await fs.unlink(path.join(baseDir, file));
      } catch {
        // best-effort
      }
    };
    await Promise.all([
      rmDir("conversations"),
      rmDir("records"),
      rmDir("scene_blocks"),
      rmDir(".metadata"),
      rmDir(".backup"),
      rmFile("persona.md"),
    ]);
    // Re-initialize so the pipeline picks up the clean state. The old cleaner
    // must be destroyed FIRST — init() unconditionally creates a new one, and
    // the orphaned timer would keep firing daily against a closed store.
    this.cleaner?.destroy();
    this.cleaner = null;
    await this.core.destroy();
    this.core = null;
    this.initialized = false;
    await this.init();
  }

  /** Flush and destroy the pipeline. */
  async destroy(): Promise<void> {
    this.cleaner?.destroy();
    this.cleaner = null;
    if (this.core) {
      try {
        await this.core.destroy();
      } catch {
        // best-effort cleanup
      }
      this.core = null;
    }
    this.initialized = false;
  }

  /** Check if the memory pipeline is active. */
  isAvailable(): boolean {
    return this.initialized && this.core !== null;
  }

  // ── Agent-callable retrieval tools (Phase 4 / T4.1) ──────────────────────
  //
  // These power tdai_memory_search / tdai_conversation_search on the agent's
  // tool surface via core's MemoryProvider bridge — the tools the recall
  // guide points at, previously referenced but never registered.

  /** OpenAI function-calling shape, structurally compatible with core's ToolDefinition. */
  getToolDefinitions(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
    };
  }> {
    return [
      {
        type: "function",
        function: {
          name: "tdai_memory_search",
          description:
            "Search structured long-term memories (L1 atomic facts: user preferences, events, rules). Use when the injected memory context is insufficient.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search keywords or a question." },
              limit: { type: "number", description: "Max results (1-20, default 5)." },
              type: { type: "string", description: "Optional filter: persona | episodic | instruction." },
              scene: { type: "string", description: "Optional scene-name filter." },
            },
            required: ["query"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "tdai_conversation_search",
          description:
            "Search raw past conversations (L0 originals): exact message wording, timelines, context details. Good for verifying or supplementing memory_search.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search keywords." },
              limit: { type: "number", description: "Max results (1-20, default 5)." },
            },
            required: ["query"],
          },
        },
      },
    ];
  }

  /** Execute one agent tool call by name. Throws on unknown name / misuse. */
  async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.core || !this.initialized) {
      throw new Error("Memory pipeline not initialized");
    }
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      throw new Error("Memory tool requires a non-empty string 'query' argument.");
    }
    const limitRaw = typeof args.limit === "number" ? args.limit : 5;
    const limit = Math.min(20, Math.max(1, Math.floor(limitRaw)));

    if (name === "tdai_memory_search") {
      const type = typeof args.type === "string" ? args.type : undefined;
      const scene = typeof args.scene === "string" ? args.scene : undefined;
      const result = await this.core.searchMemories({ query, limit, type, scene });
      return result.text || "(no matching memories)";
    }
    if (name === "tdai_conversation_search") {
      const result = await this.core.searchConversations({ query, limit });
      return result.text || "(no matching conversations)";
    }
    throw new Error(`Unknown memory tool: ${name}`);
  }
}
