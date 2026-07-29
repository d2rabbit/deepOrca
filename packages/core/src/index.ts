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
export { McpClient } from "./mcp/mcp-client";
export type { McpServerStatus } from "./mcp/mcp-manager";

// Common utilities
export { createOpenAIClient } from "./common/openai-client";
export { buildThinkingRequestOptions } from "./common/openai-thinking";
export { readTextFileWithMetadata, writeTextFile, buildDiffPreview, ensureParentDirectory } from "./common/file-utils";
export { normalizeFilePath, getSnippet, clearSessionState, recordFileState, getFileState } from "./common/state";
export { GitFileHistory } from "./common/file-history";
export { killProcessTree } from "./common/process-tree";
export { launchNotifyScript } from "./common/notify";
export {
  hasCodegraphProject,
  buildCodegraphMcpServerConfig,
  configureCodegraphVendorRoot,
  setCodegraphDisabled,
  isCodegraphDisabled,
  getCodegraphVendorRoot,
  resolveCodegraphExecutable,
  resolveModernNode,
  runCodegraphCommand,
  runCodegraphInit,
  runCodegraphInitAsync,
  runCodegraphSync,
  runCodegraphSyncAsync,
  runCodegraphResetAsync,
  runCodegraphResetWithOutput,
  spawnCodegraphPiped,
  CODEGRAPH_PACKAGE,
  CODEGRAPH_MCP_SERVER_NAME,
  CODEGRAPH_DIR_NAME,
  CODEGRAPH_VENDOR_ENTRY,
} from "./common/codegraph";
export type { CodegraphExecutable } from "./common/codegraph";

export {
  CRG_PACKAGE,
  CRG_MCP_SERVER_NAME,
  CRG_DIR_NAME,
  CRG_ANALYSIS_TOOLS,
  configureCrgVendorRoot,
  getCrgVendorRoot,
  resolveUvBinary,
  resolveCrgExecutable,
  setCrgDisabled,
  isCrgDisabled,
  hasCrgProject,
  buildCrgMcpServerConfig,
  runCrgBuild,
  runCrgSync,
  runCrgBuildWithOutput,
  runCrgResetWithOutput,
  spawnCrgPiped,
} from "./common/crg";
export type { CrgExecutable } from "./common/crg";

export { DART_MCP_SERVER_NAME, buildDartMcpServerConfig, hasDartProject, isDartMcpAvailable } from "./common/dart-mcp";
export {
  SERENA_MCP_SERVER_NAME,
  buildSerenaMcpServerConfig,
  configureSerenaUvResolver,
  isSerenaAvailable,
} from "./common/serena-mcp";

export {
  MemoryGatewayClient,
  resolveGatewayEntry,
  resolveTsxBinary,
  buildGatewayEnv,
  DEFAULT_GATEWAY_PORT,
} from "./common/memory";
export type {
  RecallResult,
  CompletedTurn,
  CaptureResult,
  MemorySearchResult,
  MemoryGatewayConfig,
} from "./common/memory";
export {
  GITMCP_SERVER_PREFIX,
  GITMCP_PLACEHOLDER_COMMAND,
  isGitmcpServerName,
  gitmcpServerNameForSlug,
  gitmcpSlugFromServerName,
  parseRepoSlug,
  buildGitmcpPlaceholderConfig,
  buildGitmcpMcpServerConfig,
  buildGitmcpMaintenanceCommand,
  resolveGitmcpServerEntry,
} from "./gitmcp/resolve";
export {
  GitmcpStore,
  getGitmcpIndexDbPath,
  gitmcpSqliteAvailable,
  removeGitmcpRepoIndex,
  readGitmcpRepoMeta,
} from "./gitmcp/store";
export type { GitmcpRepoMeta, DocChunk, SearchBackend, SearchHit } from "./gitmcp/store";
export { indexRepository, chunkMarkdown } from "./gitmcp/indexer";
export type { IndexResult } from "./gitmcp/indexer";
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
