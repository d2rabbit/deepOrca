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
export type { CodegraphController, ControllerProgress, ControllerSyncResult } from "./codegraph-controller";
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
export { crgReindexDefinition, crgReindexRun } from "./crg";
export type { CrgReindexOutput } from "./crg";
// CRG query layer (Node.js direct SQLite read — replaces Python MCP server).
export {
  configureCrgGraphQuery,
  getCrgGraphQuery,
  createCrgGraphQuery,
  formatCrgContextForOcr,
  mergeReviewWithCrgRisk,
} from "./crg-query";
export type {
  CrgGraphQuery,
  CrgChangedFunction,
  CrgImpactNode,
  CrgRiskData,
  CrgRiskNode,
  CrgRiskEdge,
  CrgCommunity,
} from "./crg-query";
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
export { isWikiVariantFile } from "./wiki-variants";
export { archScanRunDefinition, archScanRunRun } from "./arch-scan";
export type { ArchScanInput, ArchScanOutput } from "./arch-scan";
export {
  configureArchifyPaths,
  getArchifyPaths,
  configureArchRenderer,
  getArchRenderer,
  configureArchifyLanguage,
  getArchifyLanguage,
} from "./archify-controller";
export type { ArchifyPaths, ArchRenderer } from "./archify-controller";
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
  designLintDefinition,
  designLintRun,
  designReviewDefinition,
  designReviewRun,
  designReviseDefinition,
  designReviseRun,
  designExtractDefinition,
  designExtractRun,
  designDriftDefinition,
  designDriftRun,
} from "./design";
// specs/design-md-collection：设计系统三源解析（bundled / project / vendored）。
export {
  BUNDLED_DESIGN_SYSTEM_IDS,
  PROJECT_DESIGN_SYSTEM_ID,
  configureDesignSystemsVendorRoot,
  getDesignSystemsVendorRoot,
  listVendoredDesignSystems,
  looksLikeDesignSystemDoc,
  readProjectDesignSystem,
  resolveDesignSystem,
} from "./design-systems";
export type { DesignSystemSource, ResolvedDesignSystem } from "./design-systems";
// specs/design-stage-gates：共享 stage-gate 引擎 + 审计器/深度门/稳定 seam 公共面。
export {
  archSectionsAudit,
  callSubagentStable,
  countTableDataRows,
  leaferCanvasFindings,
  normalizeGeneratedMarkdown,
  openuiInteractivityFindings,
  programPageCount,
  runDesignStage,
  subagentContentOf,
} from "./design-gates";
export type { DesignStageConfig, DesignStageResult, LeaferCanvasDepth } from "./design-gates";
export type {
  DesignMaterializeInput,
  DesignMaterializeOutput,
  DesignLintOutput,
  DesignReviewInput,
  DesignReviewOutput,
  DesignReviseInput,
  DesignExtractInput,
  DesignExtractOutput,
  DesignDriftInput,
  DesignDriftOutput,
} from "./design";
export { OPENUI_CREATE_CONTRACT, OPENUI_PRESERVE_CONTRACT } from "./openui-contract";
export {
  LEAFER_CREATE_CONTRACT,
  LEAFER_PRESERVE_CONTRACT,
  LEAFER_PRIMITIVES,
  LEAFER_CANVAS_PRESETS,
  looksLikeLeaferDocument,
  parseLeaferDocument,
  validateLeaferDocument,
  formatLeaferFeedback,
} from "./leafer-contract";
export type { LeaferVerdict, LeaferIssue, LeaferCanvasSize, LeaferPrimitive } from "./leafer-contract";
export { repairLeaferProgram, selfCheckLeaferDocument, canonicalLeaferText } from "./leafer-repair";
export { lintLeaferDocument } from "./leafer-lint";
export { describeLeaferDocument, canonicalLeaferJson, leaferNodeStableNameAt } from "./leafer-describe";
export type { DescribeResult } from "./leafer-describe";
export { designAuditDefinition, designAuditRun, lintDesignDocument } from "./design-audit";
export type {
  DesignAuditInput,
  DesignAuditOutput,
  DesignAuditFinding,
  DesignAuditSeverity,
  DesignAuditAxes,
  DesignLintResult,
} from "./design-audit";
export { memoryAuditDefinition, memoryAuditRun } from "./memory-audit";
export { memoryDistillDefinition, memoryDistillRun } from "./memory-distill";
export type {
  MemoryDistillInput,
  MemoryDistillOutput,
  DistillProposal,
  DistillAction,
  SessionDigest,
} from "./memory-distill";
export type {
  MemoryAuditInput,
  MemoryAuditOutput,
  MemoryAuditEvent,
  MemoryAuditEventKind,
  MemoryAuditPattern,
  AlwaysAllowCandidate,
} from "./memory-audit";
export {
  prototypeSpecDefinition,
  prototypeSpecRun,
  prototypePmDesignDefinition,
  prototypePmDesignRun,
  specSectionsAudit,
  prototypeMaterializeDefinition,
  prototypeMaterializeRun,
  prototypeVerifyDefinition,
  prototypeVerifyRun,
  prototypeReviseDefinition,
  prototypeReviseRun,
  prototypeArchDefinition,
  prototypeArchRun,
  looksLikeArchDoc,
  openuiIssueCount,
  formatOpenuiFeedback,
} from "./prototype";
export type {
  PrototypeSpecInput,
  PrototypeSpecOutput,
  PrototypeMaterializeInput,
  PrototypeMaterializeOutput,
  PrototypeVerifyInput,
  PrototypeVerifyOutput,
  PrototypeReviseInput,
  PrototypeArchInput,
  PrototypeArchOutput,
  ArtifactRef,
  PrototypeSuiteContent,
  UiSuiteContent,
  OpenuiVerdict,
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
