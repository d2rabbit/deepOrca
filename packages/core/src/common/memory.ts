/**
 * TencentDB-Agent-Memory integration — Gateway HTTP client.
 *
 * TDAM (https://github.com/TencentCloud/TencentDB-Agent-Memory) is a four-layer
 * memory system (L0 raw → L1 atomic facts → L2 scenario → L3 persona) that
 * captures conversation knowledge and makes it queryable across sessions.
 *
 * TDAM ships as a Node package with an HTTP Gateway daemon (port 8420). We run
 * it as a managed sidecar — the Gateway handles all the heavy lifting (SQLite +
 * sqlite-vec vector search, LLM extraction, BM25 hybrid retrieval) while
 * DeepOrca communicates via simple HTTP calls. This avoids native-module ABI
 * issues inside Electron and keeps the memory pipeline isolated.
 *
 * Integration hooks in SessionManager:
 *   - createSession:  recall() → inject memories into system prompt
 *   - turn complete:  capture() → fire-and-forget store (async)
 *   - compactSession: capture evicted window before summarization
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const moduleRequire = createRequire(import.meta.url);

/** Default Gateway port. */
export const DEFAULT_GATEWAY_PORT = 8420;

/** Base URL for the Gateway, derived from port. */
function gatewayBaseUrl(port: number = DEFAULT_GATEWAY_PORT): string {
  return `http://127.0.0.1:${port}`;
}

/** Result of a recall operation — memories relevant to the user's query. */
export type RecallResult = {
  /** Text to prepend to the user message (contextual recall). */
  prependContext?: string;
  /** Text to append to the system prompt (persona + relevant memories). */
  appendSystemContext?: string;
  /** Individual L1 memories that matched. */
  recalledMemories?: Array<{ content: string; score: number; type: string }>;
  /** L3 persona summary, if available. */
  persona?: string | null;
  /** Which recall strategy was used (hybrid/keyword/vector). */
  strategy?: string;
};

/** A completed conversation turn to capture. */
export type CompletedTurn = {
  userText: string;
  assistantText: string;
  sessionKey: string;
  sessionId?: string;
  startedAt?: string;
};

/** Result of a capture operation. */
export type CaptureResult = {
  l0RecordedCount: number;
  schedulerNotified: boolean;
};

/** Search result from memory or conversation search. */
export type MemorySearchResult = {
  text: string;
  total: number;
  strategy?: string;
};

/**
 * Configuration for the memory Gateway connection.
 */
export type MemoryGatewayConfig = {
  /** Gateway port (default 8420). */
  port?: number;
  /** Bearer token for authenticated routes (optional). */
  apiKey?: string;
  /** User ID for multi-user isolation (defaults to "default_user"). */
  userId?: string;
};

/**
 * HTTP client for the TDAM Gateway. All methods are best-effort — memory
 * operations must NEVER break the session loop. Errors are caught and logged,
 * not thrown to callers.
 */
export class MemoryGatewayClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly userId: string;
  private healthy = false;

  constructor(config: MemoryGatewayConfig = {}) {
    const port = config.port ?? DEFAULT_GATEWAY_PORT;
    this.baseUrl = gatewayBaseUrl(port);
    this.apiKey = config.apiKey;
    this.userId = config.userId ?? "default_user";
  }

  /** Headers for authenticated requests. */
  private get headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) {
      h["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  /**
   * Check if the Gateway is alive. Updates the internal health flag.
   * The /health endpoint does not require auth.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      this.healthy = resp.ok;
      return this.healthy;
    } catch {
      this.healthy = false;
      return false;
    }
  }

  /** True if the last healthCheck succeeded. */
  get isHealthy(): boolean {
    return this.healthy;
  }

  /** Convenience: healthy AND user has memory enabled. */
  isAvailable(): boolean {
    return this.healthy;
  }

  /**
   * Recall relevant memories before an LLM turn. Called at session creation
   * to inject context into the system prompt.
   */
  async recall(query: string, sessionKey: string): Promise<RecallResult | null> {
    if (!this.healthy) return null;
    try {
      const resp = await fetch(`${this.baseUrl}/recall`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          query,
          session_key: sessionKey,
          user_id: this.userId,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        context?: string;
        strategy?: string;
        memory_count?: number;
      };
      // Map the Gateway response to our RecallResult shape.
      return {
        appendSystemContext: data.context ?? undefined,
        strategy: data.strategy,
      };
    } catch {
      return null;
    }
  }

  /**
   * Capture a completed turn. Fire-and-forget — the caller should not await
   * this in the hot path. Errors are swallowed.
   */
  async capture(turn: CompletedTurn): Promise<CaptureResult | null> {
    if (!this.healthy) return null;
    try {
      const resp = await fetch(`${this.baseUrl}/capture`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          user_content: turn.userText,
          assistant_content: turn.assistantText,
          session_key: turn.sessionKey,
          session_id: turn.sessionId,
          user_id: this.userId,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        l0_recorded?: number;
        scheduler_notified?: boolean;
      };
      return {
        l0RecordedCount: data.l0_recorded ?? 0,
        schedulerNotified: data.scheduler_notified ?? false,
      };
    } catch {
      return null;
    }
  }

  /**
   * Search memories (L1 atomic facts + L2 scenarios). Used by the
   * memory_search agent tool.
   */
  async searchMemories(query: string, limit: number = 5): Promise<MemorySearchResult | null> {
    if (!this.healthy) return null;
    try {
      const resp = await fetch(`${this.baseUrl}/search/memories`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          query,
          limit,
          user_id: this.userId,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        results?: string;
        total?: number;
        strategy?: string;
      };
      return {
        text: data.results ?? "",
        total: data.total ?? 0,
        strategy: data.strategy,
      };
    } catch {
      return null;
    }
  }

  /**
   * Search raw conversations (L0). Used by the memory_search agent tool
   * when the user wants to find specific past discussions.
   */
  async searchConversations(query: string, limit: number = 5): Promise<MemorySearchResult | null> {
    if (!this.healthy) return null;
    try {
      const resp = await fetch(`${this.baseUrl}/search/conversations`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          query,
          limit,
          user_id: this.userId,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        results?: string;
        total?: number;
      };
      return {
        text: data.results ?? "",
        total: data.total ?? 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Signal that a session has ended, flushing any buffered work.
   * Fire-and-forget.
   */
  async sessionEnd(sessionKey: string): Promise<void> {
    if (!this.healthy) return;
    try {
      await fetch(`${this.baseUrl}/session/end`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          session_key: sessionKey,
          user_id: this.userId,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // Swallow — best-effort.
    }
  }
}

/**
 * Resolve the Gateway entry point from the installed npm package.
 * Returns the absolute path to the Gateway server script, or null if the
 * package is not installed.
 */
export function resolveGatewayEntry(): string | null {
  try {
    const pkgPath = moduleRequire.resolve("@tencentdb-agent-memory/memory-tencentdb/package.json");
    const pkgDir = dirname(pkgPath);

    // Check for gateway server entry in dist/ or src/
    const candidates = [
      join(pkgDir, "dist", "gateway", "server.mjs"),
      join(pkgDir, "dist", "gateway", "server.js"),
      join(pkgDir, "src", "gateway", "server.ts"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the environment variables for the Gateway process. These configure
 * the LLM endpoint that TDAM uses for memory extraction.
 */
export function buildGatewayEnv(opts: { apiKey: string; baseUrl: string; model: string }): Record<string, string> {
  return {
    // TDAM reads these for the standalone LLM runner.
    TDAI_LLM_API_KEY: opts.apiKey,
    TDAI_LLM_BASE_URL: opts.baseUrl,
    TDAI_LLM_MODEL: opts.model,
    // Also set the Docker-style vars as fallback.
    MODEL_API_KEY: opts.apiKey,
    MODEL_BASE_URL: opts.baseUrl,
    MODEL_NAME: opts.model,
    // Skip the OpenClaw postinstall patch — we're not OpenClaw.
    MEMORY_TENCENTDB_SKIP_OPENCLAW_PATCH: "1",
  };
}
