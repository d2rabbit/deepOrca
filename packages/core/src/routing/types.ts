/**
 * Routing types — shared interfaces for skill/tool routing.
 *
 * The routing layer reduces the number of skills and MCP tools injected into
 * the LLM context each turn by embedding-based semantic recall. It is
 * strictly fail-open: any error returns null/undefined and the caller falls
 * back to the full candidate set.
 *
 * See specs/skill-routing/design.md for the full design.
 */

// ── Skill routing (G1) ─────────────────────────────────────────────────────

/** Minimal skill shape needed for routing (subset of session.ts SkillInfo). */
export interface RoutableSkill {
  name: string;
  description: string;
  /** Already-loaded skills bypass routing (always included). */
  isLoaded?: boolean;
}

export interface SkillShortlistOptions {
  /** Number of candidates to return (default 8). */
  topK?: number;
}

export interface SkillRouter {
  /**
   * Return a top-K shortlist of skills relevant to the prompt.
   * Returns null when routing is unavailable (model not ready, error, etc.)
   * — callers MUST fall back to the full candidate list.
   *
   * Already-loaded skills (isLoaded===true) are always included verbatim and
   * do not count against topK.
   */
  shortlist(prompt: string, candidates: RoutableSkill[], opts?: SkillShortlistOptions): Promise<RoutableSkill[] | null>;

  /**
   * Compositional routing (M4 — SkillWeaver Decompose-Retrieve-Compose).
   * Decomposes a complex query into sub-tasks, retrieves skills per sub-task,
   * and composes a compatibility-aware plan with DAG dependencies.
   *
   * Returns null when compositional routing is unavailable (no decomposer,
   * model not ready, single-skill query, or error) — callers fall back to
   * the simple shortlist().
   *
   * @param query        The user's complex query.
   * @param candidates   Full skill library with compositional metadata.
   * @param decomposer   LLM that splits the query into atomic sub-tasks.
   * @param opts         Compositional routing options.
   */
  composeRoute(
    query: string,
    candidates: CompositionalSkill[],
    decomposer: LLMDecomposer,
    opts?: ComposeOptions
  ): Promise<CompositionPlan | null>;
}

// ── Tool routing (G2) ──────────────────────────────────────────────────────

/** Minimal tool shape needed for routing (subset of ToolDefinition). */
export interface RoutableTool {
  /** Tool function name (e.g. "mcp__server__tool" or "bash"). */
  name: string;
  /** Tool description used for embedding. */
  description: string;
  /** MCP server name (undefined for built-in tools). */
  serverName?: string;
  /**
   * Serialized JSON schema of the tool definition (optional). When present,
   * the token-budget estimate uses its real length instead of a rough
   * name+description approximation (R4).
   */
  schemaJson?: string;
}

export interface ToolSelectOptions {
  /** Max estimated tokens of MCP tool schemas before full injection (default 2000). */
  tokenBudget?: number;
}

export interface ToolRouter {
  /**
   * Select a subset of MCP tools relevant to the current turn context.
   * Built-in tools are never routed (caller passes only MCP tools).
   * Returns undefined when routing is unavailable — caller uses all tools.
   *
   * Routing is server-level: if a server is relevant, ALL its tools are included.
   * Pinned servers (configured) always pass through.
   */
  select(context: TurnContext, mcpTools: RoutableTool[], opts?: ToolSelectOptions): Promise<RoutableTool[] | undefined>;
}

/** Context for tool routing: the user's message + recent assistant output. */
export interface TurnContext {
  /** Current user message. */
  userMessage: string;
  /** Previous assistant message, truncated (≤512 chars). */
  assistantSummary?: string;
}

// ── Routing config (settings.routing) ──────────────────────────────────────

export interface RoutingConfig {
  /** Master switch (default true). When off, all routing is bypassed. */
  enabled: boolean;
  /** G1: skill shortlist size (default 8). */
  skillTopK: number;
  /** G1: skip routing when candidate count ≤ this (default 12). */
  skillMinPool: number;
  /** G2: MCP tool gating switch (default true). */
  mcpToolGating: boolean;
  /** G2: token budget threshold for full injection (default 2000). */
  mcpTokenBudget: number;
  /** G2: server names that always pass through (never gated). */
  pinnedServers: string[];
  /** G3: recall-based injection for LARGE skills (default true). */
  skillSharding: boolean;
  /** G3: SKILL.md below this size is injected in full, never sharded (default 6000 chars). */
  shardMinChars: number;
  /** G3: sections recalled per injection (default 4). */
  shardTopK: number;
}

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  enabled: true,
  skillTopK: 8,
  skillMinPool: 12,
  mcpToolGating: true,
  mcpTokenBudget: 2000,
  pinnedServers: [],
  skillSharding: true,
  shardMinChars: 6000,
  shardTopK: 4,
};

// ── Embedding adapter ──────────────────────────────────────────────────────
//
// We use a structural interface (not @deeporca/embedding directly) so the
// routing module stays decoupled. The EmbeddingService from @deeporca/embedding
// satisfies this shape; routing loads it via dynamic import (fail-open on miss).

export interface RoutingEmbeddingService {
  embed(text: string): Promise<Float32Array>;
  /** Query encoding (optional — falls back to embed when absent). */
  embedQuery?(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  getDimensions(): number;
  isReady(): boolean;
  startWarmup(): void;
  close?(): void | Promise<void>;
  /** Optional: provider+model identifier for cache invalidation. */
  getProviderInfo?(): { provider: string; model: string };
}

// ── Compositional routing (M4 — SkillWeaver Decompose-Retrieve-Compose) ────
//
// Implements the three-stage pipeline from "Compositional Skill Routing for
// LLM Agents" (Gao, 2026, arxiv.org/abs/2606.18051):
//   1. Decompose: SAD (Iterative Skill-Aware Decomposition) — LLM splits a
//      complex query into atomic sub-tasks, with skill hints fed back.
//   2. Retrieve: bi-encoder top-K recall per sub-task (reuse VectorIndex).
//   3. Compose: compatibility-aware planner picks final skills + builds DAG.

/**
 * A skill with the metadata needed for compatibility scoring.
 * Extends RoutableSkill with I/O type + category info (Compose stage).
 */
export interface CompositionalSkill extends RoutableSkill {
  /** Functional category tag(s), e.g. ["database", "sql"]. Used for category Jaccard. */
  categories?: string[];
  /** Output type descriptors, e.g. ["table", "json"]. Used for I/O type coercion. */
  outputTypes?: string[];
  /** Expected input type descriptors, e.g. ["query", "file"]. */
  inputTypes?: string[];
}

/** An atomic sub-task produced by SAD decomposition. */
export interface SubTask {
  /** 1-based step index in the decomposition order. */
  step: number;
  /** Natural-language description of the atomic task. */
  description: string;
}

/** A skill candidate for a sub-task, with retrieval similarity score. */
export interface SkillCandidate {
  skill: CompositionalSkill;
  /** Cosine similarity from the bi-encoder retrieval (0..1). */
  similarity: number;
}

/** A resolved plan step: sub-task → chosen skill. */
export interface PlanStep {
  subTask: SubTask;
  /** The selected skill (null if no candidate met the threshold). */
  skill: CompositionalSkill | null;
  /** Final selection score: α·sim + (1-α)·avg_compat. */
  score: number;
  /** Retrieval similarity component. */
  similarity: number;
  /** Average compatibility with preceding steps (0..1). */
  compatibility: number;
}

/**
 * A composition plan — the output of the Compose stage.
 * Represents a DAG: steps may have dependencies on earlier steps.
 */
export interface CompositionPlan {
  /** Ordered plan steps (topological order). */
  steps: PlanStep[];
  /** DAG edges: [fromStepIndex, toStepIndex] meaning toStep depends on fromStep. */
  dependencies: Array<[number, number]>;
  /** Whether decomposition was used (false = single-skill shortlist fallback). */
  decomposed: boolean;
}

/**
 * LLM decomposer interface (injected by the host — keeps routing decoupled
 * from the OpenAI client). Given a query + optional skill hints, returns
 * atomic sub-tasks.
 */
export interface LLMDecomposer {
  /**
   * Decompose a query into atomic sub-tasks.
   * @param query The user's complex query.
   * @param hints Optional skill hints (name+description) from prior retrieval.
   * @returns Ordered list of atomic sub-tasks, or null on failure.
   */
  decompose(query: string, hints?: CompositionalSkill[]): Promise<SubTask[] | null>;
}

/** Options for the compositional router. */
export interface ComposeOptions {
  /** α trade-off between relevance and compatibility (default 0.5). From Eq.4. */
  alpha?: number;
  /** Max SAD iterations (default 1). Round 1 captures most DA gain. */
  maxSadIterations?: number;
  /** SAD convergence threshold — Jaccard of hint sets above this = converged (default 0.6). */
  sadConvergenceThreshold?: number;
  /** Number of hint skills fed back into SAD (default 15). */
  sadHintCount?: number;
  /** Candidates retrieved per sub-task before Compose selection (default 10). */
  retrieveTopK?: number;
  /** Min similarity for a skill to be selected (default 0.3). Below this → null skill. */
  minSelectionScore?: number;
}

export const DEFAULT_COMPOSE_OPTIONS: Required<ComposeOptions> = {
  alpha: 0.5,
  maxSadIterations: 1,
  sadConvergenceThreshold: 0.6,
  sadHintCount: 15,
  retrieveTopK: 10,
  minSelectionScore: 0.3,
};
