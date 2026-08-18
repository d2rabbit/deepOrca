/**
 * Routing module — embedding-based skill/tool recall for context reduction.
 *
 * Two routing tiers:
 *   - M1-M3 (single routing): SkillRouter.shortlist + ToolRouter.select
 *   - M4 (compositional routing): SkillRouter.composeRoute
 *     Implements the Decompose-Retrieve-Compose pipeline from
 *     "Compositional Skill Routing for LLM Agents" (Gao, 2026).
 *
 * Public API:
 *   - createRouters(config, opts) → { skillRouter, toolRouter }
 *   - SAD (decomposition) + Composer (compatibility planning) exports
 *   - Types for integration (RoutableSkill, CompositionalSkill, etc.)
 *
 * Routers are fail-open: any error returns null/undefined and the caller
 * falls back to the full candidate set. See specs/skill-routing/design.md.
 */

export { VectorIndex, type VectorIndexEntry, type VectorIndexHit } from "./vector-index";
export { SkillRouterImpl } from "./skill-router";
export { ToolRouterImpl } from "./tool-router";
export { RoutingFacade, type ToolRouteDecision, type ToolRouteRequest } from "./routing-facade";
export { SkillShardRecaller } from "./skill-shard-recaller";
export { shardSkillDocument, renderShardedContent, type ShardedSkillDocument, type SkillShard } from "./skill-sharding";
export { runSad, jaccardSet, categoryJaccard, type SadOptions, DEFAULT_SAD_OPTIONS } from "./sad";
export {
  composePlan,
  ioTypeCoercion,
  keywordCooccurrence,
  detectDependencies,
  type ComposeStageOptions,
  DEFAULT_COMPOSE_STAGE_OPTIONS,
} from "./composer";
export {
  getEmbeddingService,
  getEmbeddingLoadError,
  resetEmbeddingLoader,
  configureRoutingModelDir,
  getConfiguredRoutingModelDir,
  configureRoutingLogger,
  closeEmbeddingService,
} from "./embedding-loader";
export type { EmbeddingLoaderOptions } from "./embedding-loader";
export {
  logRoutingEvent,
  timedRoutingEvent,
  setRoutingEventSink,
  type RoutingEvent,
  type RoutingOutcome,
  type RoutingStage,
} from "./telemetry";
export type {
  ComposeOptions,
  CompositionalSkill,
  CompositionPlan,
  LLMDecomposer,
  PlanStep,
  RoutingConfig,
  RoutingEmbeddingService,
  RoutableSkill,
  RoutableTool,
  SkillCandidate,
  SkillRouter,
  SkillShortlistOptions,
  SubTask,
  ToolRouter,
  ToolSelectOptions,
  TurnContext,
} from "./types";
export { DEFAULT_ROUTING_CONFIG, DEFAULT_COMPOSE_OPTIONS } from "./types";

import type { RoutingConfig } from "./types";
import type { SkillRouter } from "./types";
import type { ToolRouter } from "./types";
import { SkillRouterImpl } from "./skill-router";
import { ToolRouterImpl } from "./tool-router";
import { RoutingFacade } from "./routing-facade";
import { SkillShardRecaller } from "./skill-shard-recaller";
import { getEmbeddingService } from "./embedding-loader";

export interface RouterBundle {
  skillRouter: SkillRouter | null;
  toolRouter: ToolRouter | null;
  /** Session-scoped decision point (freeze + invalidate) over toolRouter. */
  facade: RoutingFacade;
  /** G3: recall side of large-skill sharded injection (null = fail-open to full docs). */
  shardRecaller: SkillShardRecaller | null;
}

/**
 * Create the router bundle. Embedding service is loaded lazily; if the
 * @deeporca/embedding package is unavailable, both routers are null (fail-open).
 */
export async function createRouters(
  config: RoutingConfig,
  opts: { modelDir: string; cacheDir?: string }
): Promise<RouterBundle> {
  if (!config.enabled) {
    return {
      skillRouter: null,
      toolRouter: null,
      facade: new RoutingFacade({ toolRouter: null }),
      shardRecaller: null,
    };
  }

  const embeddingService = await getEmbeddingService({ modelDir: opts.modelDir });
  if (!embeddingService) {
    return {
      skillRouter: null,
      toolRouter: null,
      facade: new RoutingFacade({ toolRouter: null }),
      shardRecaller: null,
    };
  }

  const toolRouter = new ToolRouterImpl(config, embeddingService, opts.cacheDir);
  return {
    skillRouter: new SkillRouterImpl(config, embeddingService, opts.cacheDir),
    toolRouter,
    facade: new RoutingFacade({ toolRouter }),
    shardRecaller: new SkillShardRecaller(embeddingService, opts.cacheDir),
  };
}
