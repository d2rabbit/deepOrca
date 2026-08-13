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
import { DeepOrcaHostAdapter, type DeepOrcaMemoryConfig } from "./adapter.js";

export class MemoryManager {
  private core: TdaiCore | null = null;
  private adapter: DeepOrcaHostAdapter;
  private config: DeepOrcaMemoryConfig;
  private initialized = false;

  constructor(config: DeepOrcaMemoryConfig) {
    this.config = config;
    this.adapter = new DeepOrcaHostAdapter(config);
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
      pipeline: { everyNConversations: 5 },
      recall: { enabled: true, strategy: "hybrid", timeoutMs: 5000 },
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
    });

    await this.core.initialize();
    this.initialized = true;
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
    /** Last user + assistant messages. When omitted, two messages are
     * synthesized from userText/assistantText. The L0 recorder only persists
     * entries it finds in messages[], so this MUST be non-empty for capture
     * to actually record anything. */
    messages?: Array<{ role: "user" | "assistant"; content: string; id?: string; timestamp?: number }>;
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
   * mid-initialization.
   */
  async getStats(): Promise<{ l0: number; l1: number; l2: number; l3: boolean } | null> {
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
    return { l0, l1, l2, l3 };
  }

  /** Flush and destroy the pipeline. */
  async destroy(): Promise<void> {
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
}
