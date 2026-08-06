/**
 * ToolRouter — G2: reduces injected MCP tool schemas via server-level recall.
 *
 * With many MCP servers connected, injecting every tool's JSON schema each
 * turn bloats the context. ToolRouter embeds each server's combined tool
 * descriptions once (cached), embeds the turn context (user message + recent
 * assistant output), and only injects tools from relevant servers.
 *
 * Server-level granularity: if a server is relevant, ALL its tools are
 * included (avoids "half a server" breaking call chains). Pinned servers
 * always pass through.
 *
 * Fail-open: any error → undefined → caller uses all tools.
 */

import { VectorIndex, type VectorIndexEntry } from "./vector-index";
import type { RoutingConfig, RoutingEmbeddingService, RoutableTool, ToolRouter, TurnContext } from "./types";

/** Approximate tokens per character for budget estimation. */
const CHARS_PER_TOKEN = 4;

export class ToolRouterImpl implements ToolRouter {
  private index: VectorIndex;
  private config: RoutingConfig;
  private embeddingService: RoutingEmbeddingService | null;
  private indexedSignature: string | null = null;

  constructor(config: RoutingConfig, embeddingService: RoutingEmbeddingService | null, cacheDir?: string) {
    this.config = config;
    this.embeddingService = embeddingService;
    this.index = new VectorIndex({ cacheDir });
    if (embeddingService) {
      this.index.attach(embeddingService);
    }
  }

  async select(
    context: TurnContext,
    mcpTools: RoutableTool[],
    opts?: { tokenBudget?: number }
  ): Promise<RoutableTool[] | undefined> {
    // Fail-open: routing disabled or no embedding service.
    if (
      !this.config.enabled ||
      !this.config.mcpToolGating ||
      !this.embeddingService ||
      !this.embeddingService.isReady()
    ) {
      return undefined;
    }

    // Token budget check: if all MCP tools fit comfortably, inject everything.
    const budget = opts?.tokenBudget ?? this.config.mcpTokenBudget;
    const estTokens = this.estimateTokens(mcpTools);
    if (estTokens <= budget) {
      return undefined; // signal "no routing needed"
    }

    // No MCP tools → nothing to route.
    if (mcpTools.length === 0) return undefined;

    try {
      // Group tools by server.
      const serverMap = this.groupByServer(mcpTools);

      // Rebuild server-level index if changed.
      await this.ensureIndexed(serverMap);

      // Embed the turn context (user message + assistant summary).
      const queryText = this.buildQueryText(context);
      const topK = Math.min(serverMap.size, 10);
      const hits = await this.index.query(queryText, topK);
      if (hits.length === 0) return undefined;

      const relevantServers = new Set(hits.map((h) => h.id));

      // Always include pinned servers.
      for (const pin of this.config.pinnedServers) {
        relevantServers.add(pin);
      }

      // Select tools from relevant + pinned servers.
      const routed = mcpTools.filter((t) => t.serverName && relevantServers.has(t.serverName));
      return routed.length > 0 ? routed : undefined;
    } catch {
      return undefined; // fail-open
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private groupByServer(tools: RoutableTool[]): Map<string, RoutableTool[]> {
    const map = new Map<string, RoutableTool[]>();
    for (const t of tools) {
      const server = t.serverName ?? "_unknown";
      const arr = map.get(server);
      if (arr) arr.push(t);
      else map.set(server, [t]);
    }
    return map;
  }

  private async ensureIndexed(serverMap: Map<string, RoutableTool[]>): Promise<void> {
    // Signature: server → concatenated tool names+descriptions.
    const parts: string[] = [];
    for (const [server, tools] of serverMap) {
      parts.push(`${server}\0${tools.map((t) => `${t.name}:${t.description}`).join("|")}`);
    }
    const signature = parts.join("\n");
    if (signature === this.indexedSignature && this.index.size > 0) return;

    const entries: VectorIndexEntry[] = [];
    for (const [server, tools] of serverMap) {
      // Index text: server name + all tool names + descriptions (combined).
      const text = `${server}\n${tools.map((t) => `${t.name}: ${t.description}`).join("\n")}`;
      entries.push({ id: server, text });
    }

    const ok = await this.index.rebuild(entries, this.embeddingService?.getProviderInfo?.().model);
    if (!ok) throw new Error("tool vector index rebuild failed");
    this.indexedSignature = signature;
  }

  private buildQueryText(context: TurnContext): string {
    const parts = [context.userMessage];
    if (context.assistantSummary) {
      parts.push(context.assistantSummary.slice(0, 512));
    }
    return parts.join("\n");
  }

  private estimateTokens(tools: RoutableTool[]): number {
    // Rough: name + description chars / 4. Ignores parameters schema (which
    // is the bulk, but we only need a relative comparison for the budget gate).
    let chars = 0;
    for (const t of tools) {
      chars += t.name.length + t.description.length;
    }
    return Math.ceil((chars * 3) / CHARS_PER_TOKEN); // ×3 to account for schema overhead
  }
}
