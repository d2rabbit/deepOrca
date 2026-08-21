/**
 * DeepOrca HostAdapter + LLMRunner implementation.
 *
 * This adapter bridges TDAI Core's abstract interfaces to DeepOrca's
 * runtime: LLM calls go through the OpenAI-compatible API configured
 * in DeepOrca settings (using Electron's bundled Node fetch).
 *
 * No Vercel AI SDK dependency — direct fetch calls to the OpenAI API.
 */

import type {
  HostAdapter,
  RuntimeContext,
  Logger,
  LLMRunner,
  LLMRunnerFactory,
  LLMRunnerCreateOptions,
  LLMRunParams,
} from "./tdai/core/types.js";
import {
  buildFileToolDefinitions,
  executeFileTool,
  type FileToolDefinition,
  type RawToolCall,
} from "./runner-tools.js";

// Max chat-completions round-trips per run() when tools are enabled — the
// model gets this many chances to interleave file operations before we give
// up and return whatever text it produced (matches upstream
// MAX_TOOL_ITERATIONS).
const MAX_TOOL_ITERATIONS = 20;

/** Messages for the OpenAI chat-completions protocol, tool-calling included. */
type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: RawToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: RawToolCall[];
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * Per-LLM-call telemetry (Phase 2, specs/memory-remediation): emitted once
 * per `run()` — including failures — so the host can surface memory-pipeline
 * consumption that previously ran through a private fetch client and never
 * showed up in usage accounting.
 */
export interface MemoryGenerationInfo {
  /** Wall-clock start of the run (epoch ms). */
  ts: number;
  /** Pipeline layer derived from taskId (l1-extraction / scene-extract-* / persona-generation). */
  layer: "l1" | "l2" | "l3" | "other";
  taskId: string;
  model: string;
  /** Total run duration (ms). */
  latencyMs: number;
  /** Chat-completions round-trips (1 for pure text; more with tool calls). */
  rounds: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  ok: boolean;
  error?: string;
}

function deriveLayer(taskId: string): MemoryGenerationInfo["layer"] {
  if (taskId.startsWith("l1-")) return "l1";
  if (taskId.startsWith("scene-extract")) return "l2";
  if (taskId.startsWith("persona-generation")) return "l3";
  return "other";
}

// ── Configuration ────────────────────────────────────────────────────────────

export interface DeepOrcaMemoryConfig {
  /** OpenAI-compatible API base URL. */
  baseUrl: string;
  /** API key. */
  apiKey: string;
  /** Model name for memory extraction tasks (e.g. "deepseek-v4-flash"). */
  model: string;
  /** Max output tokens (default: 4096). */
  maxTokens?: number;
  /** Request timeout in ms (default: 120000). */
  timeoutMs?: number;
  /** Data directory for TDAI storage (L0/L1/scene data). */
  dataDir: string;
  /** Default user ID. */
  userId?: string;
  /** Default workspace directory. */
  workspaceDir?: string;
  /**
   * Embedding configuration for vector recall.
   * - `provider: "none"` (default): no embedding, vector search disabled.
   * - `provider: "local-onnx"`: Granite 97M R2 via @deeporca/embedding.
   *   Requires `graniteModelDir` (vendored model path) when set.
   */
  embedding?: { provider: "none" | "local-onnx"; dimensions?: number };
  /**
   * Granite model root directory (HF mirror layout) for provider="local-onnx".
   * In the desktop app this is the vendored path
   * (…/vendor/granite-embedding). Ignored when provider !== "local-onnx".
   */
  graniteModelDir?: string;
  /**
   * Per-call telemetry hook (Phase 2, specs/memory-remediation). Invoked once
   * per run() with layer/model/latency/tokens/error — including failed runs.
   * Implementations must never throw; exceptions are swallowed by the runner.
   */
  onGeneration?: (info: MemoryGenerationInfo) => void;
  /**
   * Days to retain L0/L1 shards + store rows (Phase 4 / T4.2). Default 30
   * (conservative, with the cleaner's own minimum-retain guards); 0 disables
   * cleanup entirely.
   */
  retentionDays?: number;
  /**
   * Pipeline tuning passthrough (Phase 4 / T4.5). Omitted fields fall back
   * to the MemoryManager defaults.
   */
  pipeline?: {
    /** Conversations per L1 extraction batch (default 10). */
    everyNConversations?: number;
  };
}

// ── LLMRunner ────────────────────────────────────────────────────────────────

class DeepOrcaLLMRunner implements LLMRunner {
  constructor(
    private config: DeepOrcaMemoryConfig,
    private modelOverride?: string,
    private enableTools = false
  ) {}

  async run(params: LLMRunParams): Promise<string> {
    const model = this.modelOverride ?? this.config.model;
    const messages: ChatMessage[] = [];
    if (params.systemPrompt) {
      messages.push({ role: "system", content: params.systemPrompt });
    }
    messages.push({ role: "user", content: params.prompt });

    // Tools are only offered when the runner was created with enableTools AND
    // the call carries a workspaceDir to sandbox against — the L2/L3 callers
    // always pass one (scene_blocks dir / memory dataDir). L1 extraction and
    // dedup run tool-less so the model cannot hallucinate file calls.
    const workspaceDir = params.workspaceDir;
    const tools: FileToolDefinition[] | undefined =
      this.enableTools && workspaceDir ? buildFileToolDefinitions() : undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? this.config.timeoutMs ?? 120000);

    const startedAt = Date.now();
    let rounds = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let ok = false;
    let errorMessage: string | undefined;
    try {
      let lastText = "";
      for (let iteration = 0; ; iteration++) {
        const data = await this.requestChatCompletion(model, messages, params, tools, controller.signal);
        rounds += 1;
        if (data.usage) {
          promptTokens += data.usage.prompt_tokens ?? 0;
          completionTokens += data.usage.completion_tokens ?? 0;
        }
        const choice = data.choices?.[0];
        const toolCalls = choice?.message?.tool_calls ?? [];
        if (typeof choice?.message?.content === "string") {
          lastText = choice.message.content;
        }
        if (!tools || !workspaceDir || toolCalls.length === 0 || iteration >= MAX_TOOL_ITERATIONS) {
          ok = true;
          return lastText;
        }
        // Feed the model's tool requests back: execute each one inside the
        // workspace sandbox and append the results as tool messages.
        messages.push({
          role: "assistant",
          content: choice?.message?.content ?? "",
          tool_calls: toolCalls,
        });
        for (const call of toolCalls) {
          const content = await executeFileTool(
            call.function.name,
            call.function.arguments,
            workspaceDir,
            undefined,
            params.allowedFiles?.map((file) => file.toLowerCase())
          );
          messages.push({ role: "tool", tool_call_id: call.id, content });
        }
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      clearTimeout(timeout);
      this.reportGeneration(params, model, startedAt, rounds, promptTokens, completionTokens, ok, errorMessage);
    }
  }

  /** Fire the host telemetry hook; never let it disturb the LLM path. */
  private reportGeneration(
    params: LLMRunParams,
    model: string,
    startedAt: number,
    rounds: number,
    promptTokens: number,
    completionTokens: number,
    ok: boolean,
    error: string | undefined
  ): void {
    try {
      this.config.onGeneration?.({
        ts: startedAt,
        layer: deriveLayer(params.taskId),
        taskId: params.taskId,
        model,
        latencyMs: Date.now() - startedAt,
        rounds,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        ok,
        error,
      });
    } catch {
      // Telemetry must never break the pipeline.
    }
  }

  /** One POST /chat/completions round-trip. */
  private async requestChatCompletion(
    model: string,
    messages: ChatMessage[],
    params: LLMRunParams,
    tools: FileToolDefinition[] | undefined,
    signal: AbortSignal
  ): Promise<ChatCompletionResponse> {
    const resp = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: params.maxTokens ?? this.config.maxTokens ?? 4096,
        temperature: 0.1,
        // Omit the field entirely when disabled — some OpenAI-compatible
        // backends emit spurious tool calls on pure-text tasks otherwise.
        ...(tools ? { tools } : {}),
      }),
      signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`LLM call failed: ${resp.status} ${resp.statusText} ${text}`);
    }

    return (await resp.json()) as ChatCompletionResponse;
  }
}

// ── LLMRunnerFactory ─────────────────────────────────────────────────────────

class DeepOrcaLLMRunnerFactory implements LLMRunnerFactory {
  constructor(private config: DeepOrcaMemoryConfig) {}

  createRunner(options?: LLMRunnerCreateOptions): LLMRunner {
    // enableTools routes L2 scene / L3 persona runners onto the sandboxed
    // file-tool loop (Phase 1, specs/memory-remediation); L1 runners keep
    // the pure-text path.
    return new DeepOrcaLLMRunner(this.config, options?.modelRef, options?.enableTools ?? false);
  }
}

// ── HostAdapter ──────────────────────────────────────────────────────────────

export class DeepOrcaHostAdapter implements HostAdapter {
  readonly hostType = "standalone" as const;

  private config: DeepOrcaMemoryConfig;
  private logger: Logger;
  private runnerFactory: DeepOrcaLLMRunnerFactory;
  private currentContext: RuntimeContext;

  constructor(config: DeepOrcaMemoryConfig) {
    this.config = config;
    this.logger = {
      debug: (msg: string) => console.debug(`[memory] ${msg}`),
      info: (msg: string) => console.info(`[memory] ${msg}`),
      warn: (msg: string) => console.warn(`[memory] ${msg}`),
      error: (msg: string) => console.error(`[memory] ${msg}`),
    };
    this.runnerFactory = new DeepOrcaLLMRunnerFactory(config);
    this.currentContext = {
      userId: config.userId ?? "default_user",
      sessionId: "",
      sessionKey: "",
      platform: "deeporca",
      workspaceDir: config.workspaceDir ?? config.dataDir,
      dataDir: config.dataDir,
    };
  }

  getRuntimeContext(): RuntimeContext {
    return this.currentContext;
  }

  getLogger(): Logger {
    return this.logger;
  }

  getLLMRunnerFactory(): LLMRunnerFactory {
    return this.runnerFactory;
  }

  /** Update context for a new session (called by MemoryManager). */
  updateContext(params: { userId?: string; sessionId?: string; sessionKey?: string }): void {
    this.currentContext = {
      ...this.currentContext,
      userId: params.userId ?? this.currentContext.userId,
      sessionId: params.sessionId ?? this.currentContext.sessionId,
      sessionKey: params.sessionKey ?? this.currentContext.sessionKey,
    };
  }
}
