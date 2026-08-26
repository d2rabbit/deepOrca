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
  BackgroundLlmTaskOptions,
  BackgroundLlmTaskResult,
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
export { crgReindexDefinition, crgReindexRun, crgVisualizeDefinition, crgVisualizeRun } from "./crg";
export type { CrgReindexOutput, CrgVisualizeOutput } from "./crg";
// CRG query layer (Node.js direct SQLite read — replaces Python MCP server).
export {
  configureCrgGraphQuery,
  getCrgGraphQuery,
  createCrgGraphQuery,
  formatCrgContextForOcr,
  mergeReviewWithCrgRisk,
} from "./crg-query";
export type { CrgGraphQuery, CrgChangedFunction, CrgImpactNode, CrgRiskData, CrgCommunity } from "./crg-query";
// CRG build controller (build only — queries go through CrgGraphQuery).
export { configureCrgController, getCrgController } from "./crg-controller";
export type { CrgController } from "./crg-controller";
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
export { wikiTranslateDefinition, wikiTranslateRun } from "./wiki-translate";
export type { WikiTranslateInput, WikiTranslateOutput } from "./wiki-translate";
export {
  detectWikiLanguage,
  wikiVariantPath,
  isWikiVariantFile,
  containedUnderWiki,
  listWikiBasePages,
} from "./wiki-translate";
export { archScanRunDefinition, archScanRunRun } from "./arch-scan";
export type { ArchScanInput, ArchScanOutput } from "./arch-scan";
export {
  browserSessionStartDefinition,
  browserSessionStartRun,
  browserCommandDefinition,
  browserCommandRun,
  browserSessionStopDefinition,
  browserSessionStopRun,
} from "./browser";
export type { BrowserSessionStartOutput, BrowserCommandOutput } from "./browser";
export { bentoCreateDefinition, bentoCreateRun } from "./bento";
export type { BentoCreateInput, BentoCreateOutput } from "./bento";
export {
  designMaterializeDefinition,
  designMaterializeRun,
  designExtractDefinition,
  designExtractRun,
  designDriftDefinition,
  designDriftRun,
} from "./design";
export type {
  DesignMaterializeInput,
  DesignMaterializeOutput,
  DesignExtractInput,
  DesignExtractOutput,
  DesignDriftInput,
  DesignDriftOutput,
} from "./design";
export { designAuditDefinition, designAuditRun } from "./design-audit";
export type {
  DesignAuditInput,
  DesignAuditOutput,
  DesignAuditFinding,
  DesignAuditSeverity,
  DesignAuditAxes,
} from "./design-audit";
export {
  prototypeSpecDefinition,
  prototypeSpecRun,
  prototypeMaterializeDefinition,
  prototypeMaterializeRun,
} from "./prototype";
export type {
  PrototypeSpecInput,
  PrototypeSpecOutput,
  PrototypeMaterializeInput,
  PrototypeMaterializeOutput,
} from "./prototype";
export {
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
} from "./task";
