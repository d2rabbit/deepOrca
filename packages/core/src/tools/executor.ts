import { handleAskUserQuestionTool } from "./ask-user-question-handler";
import { handleBashTool } from "./bash-handler";
import { handleEditTool } from "./edit-handler";
import { handleReadTool } from "./read-handler";
import { handleUpdatePlanTool } from "./update-plan-handler";
import { handleWebSearchTool } from "./web-search-handler";
import { handleWebFetchTool } from "./web-fetch-handler";
import type { WebPageFetcher } from "../common/tool-types";
import { handleWriteTool } from "./write-handler";
import type { McpManager } from "../mcp/mcp-manager";
import { dispatchToolCall } from "../actions";
import type { ActionRegistry } from "../actions";
import type {
  CreateOpenAIClient,
  ToolCall,
  ToolExecutionHooks,
  ToolExecutionResult,
  ToolErrorType,
  ToolHandler,
  ToolCallExecution,
} from "../common/tool-types";
import type { PathGrant } from "../common/path-boundary";
import type { BashSandboxSpawner } from "../common/tool-types";

export type {
  CreateOpenAIClient,
  ToolCall,
  ToolExecutionContext,
  ToolExecutionHooks,
  ToolExecutionResult,
  ToolErrorType,
  ToolHandler,
  ToolCallExecution,
  ProcessTimeoutInfo,
  ProcessTimeoutControl,
  BackgroundProcessCompletion,
  ToolExecutionFollowUpMessage,
} from "../common/tool-types";

const BUILT_IN_TOOL_NAME_ALIASES = new Map<string, string>([
  ["Bash", "bash"],
  ["Read", "read"],
  ["Write", "write"],
  ["Edit", "edit"],
]);

export class ToolExecutor {
  private readonly projectRoot: string;
  private readonly createOpenAIClient?: CreateOpenAIClient;
  private readonly fetchWebPage?: WebPageFetcher;
  private readonly mcpManager?: McpManager;
  private readonly actionRegistry?: ActionRegistry;
  private readonly toolHandlers = new Map<string, ToolHandler>();

  constructor(
    projectRoot: string,
    createOpenAIClient?: CreateOpenAIClient,
    mcpManager?: McpManager,
    actionRegistry?: ActionRegistry,
    fetchWebPage?: WebPageFetcher
  ) {
    this.projectRoot = projectRoot;
    this.createOpenAIClient = createOpenAIClient;
    this.mcpManager = mcpManager;
    this.actionRegistry = actionRegistry;
    this.fetchWebPage = fetchWebPage;
    this.registerToolHandlers();
  }

  async executeToolCalls(
    sessionId: string,
    toolCalls: unknown[],
    hooks?: ToolExecutionHooks,
    extras?: { pathGrant?: PathGrant; bashSandbox?: BashSandboxSpawner }
  ): Promise<ToolCallExecution[]> {
    // Parse every input call. A malformed envelope (missing id, missing
    // function block, non-string name) used to be silently filtered out,
    // which broke the OpenAI tool protocol: the assistant emitted N tool
    // calls and received <N tool messages, leaving dangling tool_call ids
    // that some providers reject. We now emit a synthetic failure result for
    // each malformed call so the input/output arrays stay 1:1.
    const parsedCalls = toolCalls.map((toolCall, index) => this.parseToolCall(toolCall, index));

    const executions: ToolCallExecution[] = [];
    for (const parsed of parsedCalls) {
      if (hooks?.shouldStop?.()) {
        break;
      }
      if (!parsed.ok) {
        // Synthetic failure for the malformed call — preserves 1:1 mapping.
        const result = parsed.result;
        executions.push({
          toolCallId: parsed.toolCallId,
          content: this.formatToolResult(result),
          result,
        });
        continue;
      }
      const result = await this.executeToolCall(sessionId, parsed.call, hooks, extras?.pathGrant, extras?.bashSandbox);
      executions.push({
        toolCallId: parsed.call.id,
        content: this.formatToolResult(result),
        result,
      });
      if (hooks?.shouldStop?.()) {
        break;
      }
    }
    return executions;
  }

  private registerToolHandlers(): void {
    this.toolHandlers.set("bash", handleBashTool);
    this.toolHandlers.set("read", handleReadTool);
    this.toolHandlers.set("write", handleWriteTool);
    this.toolHandlers.set("edit", handleEditTool);
    this.toolHandlers.set("AskUserQuestion", handleAskUserQuestionTool);
    this.toolHandlers.set("UpdatePlan", handleUpdatePlanTool);
    this.toolHandlers.set("WebSearch", handleWebSearchTool);
    this.toolHandlers.set("WebFetch", handleWebFetchTool);
  }

  /**
   * Parse a raw tool call from the LLM into a {@link ToolCall}.
   *
   * Returns a discriminated result: a well-formed call yields `{ ok: true,
   * call }`; a malformed envelope yields `{ ok: false, toolCallId, result }`
   * where `result` is a synthetic failure (with a stable correlation id) that
   * the caller MUST forward as a tool message. This replaces the previous
   * `.filter(Boolean)` that silently dropped invalid calls and broke the
   * assistant→tool-message cardinality.
   *
   * When the id itself is missing we synthesise `invalid_tool_call_<index>` so
   * the response still carries a usable tool_call_id; a provider that requires
   * the original id will simply see the failure attached to the synthetic id,
   * which is strictly better than dropping the call entirely.
   */
  private parseToolCall(
    toolCall: unknown,
    index: number
  ): { ok: true; call: ToolCall } | { ok: false; toolCallId: string; result: ToolExecutionResult } {
    if (!toolCall || typeof toolCall !== "object") {
      return this.invalidToolCall(index, "tool call is not an object");
    }

    const record = toolCall as {
      id?: unknown;
      type?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };

    const id = typeof record.id === "string" && record.id ? record.id : null;

    const functionRecord = record.function;
    if (!functionRecord || typeof functionRecord !== "object") {
      return this.invalidToolCall(id ?? index, "tool call is missing the `function` block");
    }

    if (typeof functionRecord.name !== "string" || !functionRecord.name) {
      return this.invalidToolCall(id ?? index, "tool call is missing a string `function.name`");
    }

    const rawArguments = typeof functionRecord.arguments === "string" ? functionRecord.arguments : "";

    return {
      ok: true,
      call: {
        // Use the model-supplied id when present; otherwise keep the synthetic
        // id so the protocol stays paired.
        id: id ?? this.syntheticToolCallId(index),
        type: "function",
        function: {
          name: functionRecord.name,
          arguments: rawArguments,
        },
      },
    };
  }

  private syntheticToolCallId(index: number): string {
    return `invalid_tool_call_${index}`;
  }

  private invalidToolCall(
    idOrIndex: string | number,
    reason: string
  ): { ok: false; toolCallId: string; result: ToolExecutionResult } {
    // Prefer a real id string when present; otherwise synthesise one from the
    // index so the response still pairs with the assistant's call slot.
    const toolCallId =
      typeof idOrIndex === "string" && idOrIndex.length > 0
        ? idOrIndex
        : this.syntheticToolCallId(typeof idOrIndex === "number" ? idOrIndex : 0);
    const result: ToolExecutionResult = {
      ok: false,
      name: "invalid_tool_call",
      error: `InvalidToolCall: ${reason}. The model emitted a tool call that could not be parsed; the assistant should re-emit it with a valid structure.`,
      errorType: "INVALID_TOOL_CALL",
      retryable: false,
    };
    return { ok: false, toolCallId, result };
  }

  private async executeToolCall(
    sessionId: string,
    toolCall: ToolCall,
    hooks?: ToolExecutionHooks,
    pathGrant?: PathGrant,
    bashSandbox?: BashSandboxSpawner
  ): Promise<ToolExecutionResult> {
    const toolName = toolCall.function.name;
    const handlerName = BUILT_IN_TOOL_NAME_ALIASES.get(toolName) ?? toolName;
    const handler = this.toolHandlers.get(handlerName);
    if (!handler) {
      if (this.mcpManager?.isMcpTool(toolName)) {
        const parsedArgs = this.parseToolArguments(toolCall.function.arguments);
        const args = parsedArgs.ok ? parsedArgs.args : {};
        return this.mcpManager.executeMcpTool(toolName, args);
      }
      // defineAction surface: a tool name that maps to a registered action
      // (e.g. "system_ping") is dispatched through the ActionRegistry. This is
      // the LLM leg of "define once, surface everywhere" — the same action is
      // also reachable via desktop IPC (action-ipc.ts). Action tool names are
      // dotted-ids with dots→underscores, so they never start with "mcp__".
      if (this.actionRegistry?.actionIdForToolName(toolName)) {
        const parsed = this.parseToolArguments(toolCall.function.arguments);
        if (!parsed.ok) {
          return {
            ok: false,
            name: toolName,
            error: parsed.error,
            errorType: "INVALID_INPUT",
            retryable: false,
          };
        }
        try {
          const { output } = await dispatchToolCall(this.actionRegistry, toolName, parsed.args);
          return {
            ok: true,
            name: toolName,
            output: typeof output === "string" ? output : JSON.stringify(output),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const { errorType, retryable } = this.classifyThrownError(error);
          return { ok: false, name: toolName, error: message, errorType, retryable };
        }
      }
      return {
        ok: false,
        name: toolName,
        error: `Unknown tool: ${toolName}`,
        errorType: "INVALID_INPUT",
        retryable: false,
      };
    }

    const parsedArgs = this.parseToolArguments(toolCall.function.arguments);
    if (!parsedArgs.ok) {
      return {
        ok: false,
        name: toolName,
        error: parsedArgs.error,
        errorType: "INVALID_INPUT",
        retryable: false,
      };
    }

    try {
      return await handler(parsedArgs.args, {
        sessionId,
        projectRoot: this.projectRoot,
        toolCall,
        pathGrant,
        bashSandbox,
        createOpenAIClient: this.createOpenAIClient,
        fetchWebPage: this.fetchWebPage,
        onProcessStart: hooks?.onProcessStart,
        onProcessExit: hooks?.onProcessExit,
        onProcessStdout: hooks?.onProcessStdout,
        onProcessTimeoutControl: hooks?.onProcessTimeoutControl,
        onBackgroundProcessComplete: hooks?.onBackgroundProcessComplete,
        onBeforeFileMutation: hooks?.onBeforeFileMutation,
        onAfterFileMutation: hooks?.onAfterFileMutation,
        onPathGateVerdict: hooks?.onPathGateVerdict,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Handler threw without producing a structured result. Classify by the
      // error shape when we can, defaulting to INTERNAL (a crash, not a user
      // input problem).
      const { errorType, retryable } = this.classifyThrownError(error);
      return {
        ok: false,
        name: toolName,
        error: message,
        errorType,
        retryable,
      };
    }
  }

  /**
   * Map a thrown error to a structured {@link ToolErrorType} + retryable hint.
   * Handlers that return a structured result directly bypass this; it only
   * classifies the catch-all path where a handler threw.
   */
  private classifyThrownError(error: unknown): { errorType: ToolErrorType; retryable: boolean } {
    if (error instanceof Error) {
      const name = error.name;
      if (name === "AbortError" || name === "TimeoutError") {
        return { errorType: name === "AbortError" ? "ABORTED" : "TIMEOUT", retryable: true };
      }
      const msg = error.message.toLowerCase();
      if (/permission|forbidden|not allowed|denied/.test(msg)) {
        return { errorType: "PERMISSION_DENIED", retryable: false };
      }
      if (/timeout|timed out/.test(msg)) {
        return { errorType: "TIMEOUT", retryable: true };
      }
      if (/enoent|not found|does not exist/.test(msg)) {
        return { errorType: "NOT_FOUND", retryable: false };
      }
    }
    return { errorType: "INTERNAL", retryable: false };
  }

  private parseToolArguments(
    rawArguments: string
  ): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
    if (!rawArguments) {
      return { ok: true, args: {} };
    }

    try {
      const parsed = JSON.parse(rawArguments);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "InputParseError: Tool arguments must be a JSON object." };
      }
      return { ok: true, args: parsed as Record<string, unknown> };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error:
          `InputParseError: Failed to parse tool arguments: ${message}. ` +
          "Ensure the tool call arguments are valid JSON. Prefer Edit over Write for large existing-file changes.",
      };
    }
  }

  private formatToolResult(result: ToolExecutionResult): string {
    const payload: Record<string, unknown> = {
      ok: result.ok,
      name: result.name,
    };

    if (typeof result.output !== "undefined") {
      payload.output = result.output;
    }

    if (result.error) {
      payload.error = result.error;
    }

    // Surface the structured classification so the agent can choose to retry
    // vs. give up, and so telemetry can aggregate by type rather than parsing
    // free-text messages.
    if (result.errorType) {
      payload.errorType = result.errorType;
    }
    if (typeof result.retryable === "boolean") {
      payload.retryable = result.retryable;
    }

    if (result.metadata && Object.keys(result.metadata).length > 0) {
      payload.metadata = result.metadata;
    }

    if (result.awaitUserResponse === true) {
      payload.awaitUserResponse = true;
    }

    return JSON.stringify(payload, null, 2);
  }
}
