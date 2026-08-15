// Core library public API — consumed by the DeepOrca desktop client.

// App config directories (bidirectional .deepcode/.deeporca compatibility)
export {
  getUserConfigRoot,
  getProjectConfigRoot,
  getEnvVar,
  CONFIG_DIR_NAME,
  LEGACY_CONFIG_DIR_NAME,
} from "./common/app-dirs";

// Settings
export {
  resolveCurrentSettings,
  resolveSettings,
  resolveSettingsSources,
  readSettings,
  readProjectSettings,
  writeSettings,
  writeProjectSettings,
  writeModelConfigSelection,
  applyModelConfigSelection,
  modelConfigKey,
  getUserSettingsPath,
  getProjectSettingsPath,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  DEFAULT_SECONDARY_MODEL,
  ENDPOINT_PRESETS,
  normalizeEndpoints,
  buildModelKey,
  parseModelKey,
  resolveModelCapability,
  collectAllModelKeys,
  findEndpointForModel,
} from "./settings";
export type {
  DeepcodingSettings,
  ResolvedDeepcodingSettings,
  ModelConfigSelection,
  PermissionScope,
  PermissionSettings,
  PermissionDefaultMode,
  McpServerConfig,
  ReasoningEffort,
  StatusLineSettings,
  ResolvedStatusLineSettings,
  StatusLineProviderConfig,
  EndpointConfig,
  ModelRegistration,
} from "./settings";

// Session
export { SessionManager, getProjectCode, getCompactPromptTokenThreshold } from "./session";
export type {
  SessionMessage,
  SessionEntry,
  SessionStatus,
  SessionsIndex,
  SessionMessageRole,
  MessageMeta,
  UndoTarget,
  UserPromptContent,
  SkillInfo,
  BuiltinPluginInfo,
  BuiltinPluginGroup,
  McpServerConfigEntry,
  ModelUsage,
  SessionProcessEntry,
  BashTimeoutAdjustment,
  LlmStreamProgress,
} from "./session";

// Prompt utilities
export {
  getSystemPrompt,
  getCompactPrompt,
  getRuntimeContext,
  getDefaultSkillPrompt,
  getPlanModePrompt,
  getExtensionRoot,
  getTools,
  buildSkillDocumentsPrompt,
} from "./prompt";
export type { ToolDefinition, SkillPromptDocument } from "./prompt";

// Tools
export { ToolExecutor } from "./tools/executor";
export type {
  CreateOpenAIClient,
  ToolCall,
  ToolExecutionContext,
  ToolExecutionHooks,
  ToolExecutionResult,
  ToolHandler,
  ToolCallExecution,
  ProcessTimeoutInfo,
  ProcessTimeoutControl,
  BackgroundProcessCompletion,
  ToolExecutionFollowUpMessage,
} from "./common/tool-types";

// Tool handlers
export { handleBashTool, clearSessionWorkingDir } from "./tools/bash-handler";
export { handleReadTool } from "./tools/read-handler";
export { handleWriteTool } from "./tools/write-handler";
export { handleEditTool } from "./tools/edit-handler";
export { handleUpdatePlanTool } from "./tools/update-plan-handler";
export { handleWebSearchTool } from "./tools/web-search-handler";
export { handleAskUserQuestionTool } from "./tools/ask-user-question-handler";

// MCP
export { McpManager } from "./mcp/mcp-manager";
export type { McpServerStatus } from "./mcp/mcp-manager";
export { createMcpSpawnSpec, type McpSpawnSpec } from "./mcp/spawn-spec";

// Common utilities
export { createOpenAIClient, createSecondaryClient, createVisionClient } from "./common/openai-client";
export { buildThinkingRequestOptions } from "./common/openai-thinking";
export {
  readTextFileWithMetadata,
  writeTextFile,
  buildDiffPreview,
  ensureParentDirectory,
  configureFileUtilsWriteBoundary,
  PathBoundaryError,
} from "./common/file-utils";
export { gateWrite, gateRead, type PathGrant, type GateVerdict } from "./common/path-boundary";
export { normalizeFilePath, getSnippet, clearSessionState, recordFileState, getFileState } from "./common/state";
export { GitFileHistory } from "./common/file-history";
export { killProcessTree } from "./common/process-tree";
export { launchNotifyScript } from "./common/notify";
// CodeGraph: constants + settings state + MCP config builder.
// Index/sync operations migrated to desktop's SdkCodegraphController (SDK).
// MCP tools still use subprocess via npm-shim.js (SDK's MCPServer lacks
// connect(transport) for in-process bridging — future work).
export {
  hasCodegraphProject,
  buildCodegraphMcpServerConfig,
  setCodegraphDisabled,
  isCodegraphDisabled,
  CODEGRAPH_MCP_SERVER_NAME,
  CODEGRAPH_DIR_NAME,
} from "./common/codegraph";
// Node runtime resolution (extracted from codegraph.ts — shared by GitMCP + OpenWiki).
export { resolveModernNode } from "./common/sqlite-runtime";
export type { CodegraphExecutable } from "./common/sqlite-runtime";

// Shared uv binary resolver (used by CRG, Serena, SkillSpector).
export { resolveUvBinary, configureUvVendorRoot } from "./common/uv";

export {
  CRG_MCP_SERVER_NAME,
  configureCrgVersionRoot,
  setCrgDisabled,
  isCrgDisabled,
  hasCrgProject,
  buildCrgMcpServerConfig,
  runCrgResetWithOutput,
  runCrgVisualize,
} from "./common/crg";

export { SERENA_MCP_SERVER_NAME, setSerenaDisabled, isSerenaDisabled } from "./common/serena-mcp";

// Serena controller seam — desktop injects SerenaCliController at boot.
export { type SerenaController, configureSerenaController, getSerenaController } from "./actions/serena-controller";
export { SKILL_SPECTOR_MCP_SERVER_NAME, setSkillSpectorDisabled, isSkillSpectorDisabled } from "./common/skill-spector";
export {
  type SkillSpectorController,
  configureSkillSpectorController,
  getSkillSpectorController,
} from "./actions/skill-spector-controller";

// Activity-Frames MCP seam — desktop injects the server builder at boot.
export {
  ACTIVITY_FRAMES_MCP_SERVER_NAME,
  configureActivityFramesServerBuilder,
  getActivityFramesServerBuilder,
  type ActivityFramesServerBuilder,
} from "./mcp/activity-frames-seam";

// GitMCP seam — desktop injects the config builder at boot.
// resolve.ts (slug parsing + path resolution) stays in core.
export { configureGitmcpConfigBuilder, getGitmcpConfigBuilder, type GitmcpConfigBuilder } from "./mcp/gitmcp-seam";
export { buildGitmcpMcpServerConfig } from "./gitmcp/resolve";

// Vision MCP seam — desktop injects the concrete server builder at boot.
export {
  VISION_MCP_SERVER_NAME,
  configureVisionServerBuilder,
  getVisionServerBuilder,
  type VisionServerBuilder,
  type VisionServerLike,
} from "./mcp/vision-seam";

// Semantic skill/tool routing. The host injects the vendored embedding model dir
// and a logger (same pattern as codegraph/serena above), and closes the shared
// embedding service — which holds onnxruntime native handles — on app teardown.
export {
  configureRoutingModelDir,
  configureRoutingLogger,
  closeEmbeddingService,
  getEmbeddingLoadError,
} from "./routing";

// A2UI MCP seam — desktop injects the server builder + lifecycle at boot.
export {
  A2UI_MCP_SERVER_NAME,
  configureA2uiServerBuilder,
  getA2uiServerBuilder,
  setA2uiDisabled,
  isA2uiDisabled,
  type A2uiLifecycle,
  type A2uiServerBuilder,
} from "./mcp/a2ui-seam";

// Memory — in-process provider interface, implemented by @deeporca/memory.
// (The legacy HTTP Gateway sidecar client was removed: it had no call sites and
// was superseded by the in-process pipeline.)
export type { MemoryProvider } from "./session";
export {
  GITMCP_SERVER_PREFIX,
  GITMCP_PLACEHOLDER_COMMAND,
  isGitmcpServerName,
  gitmcpServerNameForSlug,
  gitmcpSlugFromServerName,
  parseRepoSlug,
  buildGitmcpPlaceholderConfig,
  buildGitmcpMaintenanceCommand,
  resolveGitmcpServerEntry,
} from "./gitmcp/resolve";
export { reportNewPrompt } from "./common/telemetry";
export {
  DEEPSEEK_V4_MODELS,
  COMPACTION_MODEL,
  supportsMultimodal,
  defaultsToThinkingMode,
} from "./common/model-capabilities";
export { findGitBashPath, resolveShellPath, setShellIfWindows } from "./common/shell-utils";
export { logApiError } from "./common/error-logger";
export { logOpenAIChatCompletionDebug } from "./common/debug-logger";
export { describeLlmError, getLlmErrorDetails } from "./common/llm-error";
export type { LlmErrorDetails } from "./common/llm-error";
export {
  clampBashTimeoutMs,
  DEFAULT_BASH_TIMEOUT_MS,
  BASH_TIMEOUT_INCREMENT_MS,
  BASH_TIMEOUT_DECREMENT_MS,
} from "./common/bash-timeout";
export { executeValidatedTool, semanticBoolean } from "./common/validate";
export { OpenAIMessageConverter } from "./common/openai-message-converter";
export {
  computeToolCallPermissions,
  buildPermissionToolExecution,
  hasUserPermissionReplies,
  appendProjectPermissionAllows,
  normalizeAskPermissions,
  parseToolCallForPermissions,
} from "./common/permissions";
export type {
  AskPermissionRequest,
  AskPermissionScope,
  BashPermissionScope,
  MessageToolPermission,
  PermissionDecision,
  PermissionToolCall,
  UserToolPermission,
} from "./common/permissions";

// State types
export type { FileState, FileSnippet, FileLineEnding } from "./common/state";
export type { FileReadMetadata } from "./common/file-utils";

// defineAction primitive — "define once, surface everywhere". See
// specs/define-action/design.md. Phase 0: registry + ping proof action.
export {
  ActionRegistry,
  defineAction,
  dispatchToolCall,
  configureActionSpawner,
  getActionSpawner,
  ActionError,
  NULL_SPAWNER,
  pingDefinition,
  pingRun,
  reviewRunDefinition,
  reviewRun,
  reviewCheckAvailableDefinition,
  reviewCheckAvailableRun,
  reviewFullDefinition,
  reviewFullRun,
  configureReviewController,
  getReviewController,
  crgReindexDefinition,
  crgReindexRun,
  crgVisualizeDefinition,
  crgVisualizeRun,
  configureCrgGraphQuery,
  getCrgGraphQuery,
  createCrgGraphQuery,
  formatCrgContextForOcr,
  mergeReviewWithCrgRisk,
  configureCrgController,
  getCrgController,
  codegraphReindexDefinition,
  codegraphReindexRun,
  codegraphListDefinition,
  codegraphListRun,
  configureCodegraphController,
  getCodegraphController,
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
  indexBuildAllDefinition,
  indexBuildAllRun,
  archScanRunDefinition,
  archScanRunRun,
} from "./actions";
export type {
  RegistryHost,
  ExecuteOptions,
  RunHandle,
  DispatchResult,
  ActionDefinition,
  ActionContext,
  ActionErrorCode,
  ActionParameters,
  ActionProgress,
  ActionRun,
  RunSubagentOptions,
  SpawnedProcess,
  Spawner,
  PingInput,
  PingOutput,
  ReviewInput,
  ReviewAvailability,
  ReviewFullOutput,
  CodegraphController,
  ControllerProgress,
  ReviewController,
  ReviewResult,
  ReviewComment,
  ReviewOptions,
  WikiController,
  WikiResult,
  WikiInitOutput,
  WikiPage,
  CrgController,
  CrgGraphQuery,
  CrgChangedFunction,
  CrgImpactNode,
  CrgRiskData,
  CrgCommunity,
} from "./actions";

export type {
  TaskBranch,
  TaskNode,
  TaskNodeKind,
  TaskNodeStatus,
  TaskReflogEntry,
  TaskTreeIndex,
  TaskTreeSummary,
} from "./tasks/types";
export { TaskTreeService } from "./tasks/task-tree-service";
