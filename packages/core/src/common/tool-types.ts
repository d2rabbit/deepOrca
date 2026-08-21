import type OpenAI from "openai";
import type { ReasoningEffort } from "../settings";
import type { GateVerdict, PathGrant } from "./path-boundary";

export type CreateOpenAIClient = () => {
  client: OpenAI | null;
  model: string;
  baseURL?: string;
  temperature?: number;
  thinkingEnabled: boolean;
  reasoningEffort?: ReasoningEffort;
  debugLogEnabled?: boolean;
  notify?: string;
  webSearchTool?: string;
  webSearchProvider?: string;
  env?: Record<string, string>;
};

/** Secondary-model client factory — tier-2 fallback for background LLM tasks. */
export type CreateSecondaryClient = () => {
  client: OpenAI | null;
  model: string;
  baseURL: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

/** Outcome of an execution-time path gate check, for the audit bus (P1). */
export type PathGateVerdictRecord = {
  tool: string;
  verdict: GateVerdict;
  filePath: string;
};

/**
 * P3 bash sandbox seam: wraps the bash tool's shell invocation in a
 * kernel-mediated sandbox (macOS sandbox-exec; bwrap/WSL2 to follow).
 * Same source as pathGrant — constructed by the session, threaded through
 * the executor. Returning null runs the shell unwrapped (noop backend).
 */
export type BashSandboxSpawner = {
  readonly backend: string;
  wrapShell(
    shellPath: string,
    shellArgs: string[],
    cwd: string
  ): { argv: string[]; env?: Record<string, string> } | null;
};

/** Page-extraction contract shared by WebFetch's rendered and static engines. */
export type WebFetchPage = {
  /** Final URL after redirects. */
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly links: ReadonlyArray<{ readonly title: string; readonly url: string }>;
  /** Which engine produced the page: "rendered" (host Chromium) | "static". */
  readonly engine: "rendered" | "static";
  readonly truncated: boolean;
};

/** Host-injected rendered-page fetcher (desktop wires the Chromium provider). */
export type WebPageFetcher = (url: string, options?: { timeoutMs?: number }) => Promise<WebFetchPage>;

export type ToolExecutionContext = {
  sessionId: string;
  projectRoot: string;
  toolCall: ToolCall;
  /**
   * Path capability granted to this tool call, derived by the session from
   * the permission plan (specs/sandbox/design.md §4.1). Absent ⇒ handlers
   * degrade to projectRoot-only enforcement, i.e. fail-closed for
   * out-of-project paths.
   */
  pathGrant?: PathGrant;
  bashSandbox?: BashSandboxSpawner;
  createOpenAIClient?: CreateOpenAIClient;
  /**
   * Host-injected rendered-page fetcher (WebFetch's preferred engine — the
   * desktop app wires its hidden offscreen Chromium provider here). Absent ⇒
   * WebFetch falls back to the built-in static HTTP fetch.
   */
  fetchWebPage?: WebPageFetcher;
  onProcessStart?: (processId: string | number, command: string) => void;
  onProcessExit?: (processId: string | number) => void;
  onProcessStdout?: (processId: string | number, chunk: string) => void;
  onProcessTimeoutControl?: (processId: string | number, control: ProcessTimeoutControl | null) => void;
  onBackgroundProcessComplete?: (completion: BackgroundProcessCompletion) => void;
  onBeforeFileMutation?: (filePath: string) => void;
  onAfterFileMutation?: (filePath: string, source?: string) => void;
  onPathGateVerdict?: (record: PathGateVerdictRecord) => void;
  bashTimeoutMs?: number;
  bashMinTimeoutMs?: number;
};

export type ToolExecutionHooks = {
  onProcessStart?: (processId: string | number, command: string) => void;
  onProcessExit?: (processId: string | number) => void;
  onProcessStdout?: (processId: string | number, chunk: string) => void;
  onProcessTimeoutControl?: (processId: string | number, control: ProcessTimeoutControl | null) => void;
  onBackgroundProcessComplete?: (completion: BackgroundProcessCompletion) => void;
  onBeforeFileMutation?: (filePath: string) => void;
  onAfterFileMutation?: (filePath: string, source?: string) => void;
  onPathGateVerdict?: (record: PathGateVerdictRecord) => void;
  shouldStop?: () => boolean;
};

export type BackgroundProcessCompletion = {
  taskId: string;
  processId: number;
  command: string;
  outputPath: string;
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  error?: string;
  cwd: string | null;
  shellPath: string;
  startedAtMs: number;
  completedAtMs: number;
};

export type ProcessTimeoutInfo = {
  timeoutMs: number;
  startedAtMs: number;
  deadlineAtMs: number;
  timedOut: boolean;
};

export type ProcessTimeoutControl = {
  getInfo: () => ProcessTimeoutInfo;
  setTimeoutMs: (timeoutMs: number) => ProcessTimeoutInfo;
};

/**
 * Structured error classification for a tool execution failure.
 *
 * The human-readable message stays in {@link ToolExecutionResult.error}; this
 * enum lets the UI, telemetry and the agent itself distinguish "fix your
 * input and retry" from "you don't have permission" from "the tool crashed".
 * Handlers and the executor set it; consumers may fall back to `INTERNAL`
 * when it is absent (older callers).
 */
export type ToolErrorType =
  | "INVALID_INPUT"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "ABORTED"
  | "PROCESS_FAILED"
  | "INVALID_TOOL_CALL"
  | "INTERNAL";

export type ToolExecutionResult = {
  ok: boolean;
  name: string;
  output?: string;
  error?: string;
  /**
   * Structured error classification. Present whenever `ok` is false and the
   * failure was produced (or re-wrapped) by the executor/handlers. Legacy
   * handlers that only populate `error` leave this undefined; consumers
   * treat undefined as `INTERNAL`.
   */
  errorType?: ToolErrorType;
  /**
   * Hint that a retry with the same input is sensible (e.g. a transient
   * network blip, a tool still initialising). `false` for permission/input
   * errors where retrying without changes will fail the same way. Absent on
   * success.
   */
  retryable?: boolean;
  /** Optional machine-readable details (filtered/size-capped before display). */
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  awaitUserResponse?: boolean;
  followUpMessages?: ToolExecutionFollowUpMessage[];
};

export type ToolExecutionFollowUpMessage = {
  role: "system";
  content: string;
  contentParams?: unknown | null;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<ToolExecutionResult>;

export type ToolCallExecution = {
  toolCallId: string;
  content: string;
  result: ToolExecutionResult;
};
