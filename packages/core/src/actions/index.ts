/**
 * defineAction primitive — public surface. See `specs/define-action/design.md`.
 */

export { ActionRegistry } from "./registry";
export type { RegistryHost, ExecuteOptions, RunHandle } from "./registry";
export { defineAction } from "./define";
export { dispatchToolCall } from "./mcp-bridge";
export type { DispatchResult } from "./mcp-bridge";
export { configureActionSpawner, getActionSpawner } from "./spawner-host";
export { ActionError, NULL_SPAWNER } from "./types";
export type {
  ActionContext,
  ActionDefinition,
  ActionErrorCode,
  ActionParameters,
  ActionProgress,
  ActionRun,
  RunSubagentOptions,
  SpawnedProcess,
  Spawner,
} from "./types";

// Controller seams (host-injected; core has zero tool-specific code).
export { configureCodegraphController, getCodegraphController } from "./codegraph-controller";
export type { CodegraphController, ControllerProgress } from "./codegraph-controller";
export { configureReviewController, getReviewController } from "./review-controller";
export type { ReviewController, ReviewResult, ReviewComment, ReviewOptions } from "./review-controller";

// Bundled actions.
export { pingDefinition, pingRun } from "./actions/ping";
export type { PingInput, PingOutput } from "./actions/ping";
export {
  reviewRunDefinition,
  reviewRun,
  reviewCheckAvailableDefinition,
  reviewCheckAvailableRun,
  reviewFullDefinition,
  reviewFullRun,
} from "./review";
export type { ReviewInput, ReviewAvailability, ReviewFullOutput } from "./review";
export {
  crgReindexDefinition,
  crgReindexRun,
  crgVisualizeDefinition,
  crgVisualizeRun,
  crgAnalyzeDefinition,
  crgAnalyzeRun,
} from "./crg";
export type { CrgReindexOutput, CrgVisualizeOutput, CrgAnalyzeInput, CrgAnalyzeOutput } from "./crg";
export {
  codegraphReindexDefinition,
  codegraphReindexRun,
  codegraphListDefinition,
  codegraphListRun,
} from "./codegraph";
export type { CodegraphReindexOutput, CodegraphIndexEntry } from "./codegraph";
export {
  wikiInitDefinition,
  wikiInitRun,
  wikiUpdateDefinition,
  wikiUpdateRun,
  wikiListPagesDefinition,
  wikiListPagesRun,
  wikiReadPageDefinition,
  wikiReadPageRun,
  configureWikiController,
  getWikiController,
} from "./wiki";
export type { WikiInitOutput, WikiPage, WikiPageDetail, WikiFrontmatter, WikiController, WikiResult } from "./wiki";
export { indexBuildAllDefinition, indexBuildAllRun } from "./index-build";
export type { IndexBuildInput, IndexBuildStage, IndexBuildOutput } from "./index-build";
export { archScanRunDefinition, archScanRunRun } from "./arch-scan";
export type { ArchScanInput, ArchScanOutput } from "./arch-scan";
