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
}

// ── LLMRunner ────────────────────────────────────────────────────────────────

class DeepOrcaLLMRunner implements LLMRunner {
  constructor(
    private config: DeepOrcaMemoryConfig,
    private modelOverride?: string
  ) {}

  async run(params: LLMRunParams): Promise<string> {
    const model = this.modelOverride ?? this.config.model;
    const messages: Array<{ role: string; content: string }> = [];
    if (params.systemPrompt) {
      messages.push({ role: "system", content: params.systemPrompt });
    }
    messages.push({ role: "user", content: params.prompt });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? this.config.timeoutMs ?? 120000);

    try {
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
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`LLM call failed: ${resp.status} ${resp.statusText} ${text}`);
      }

      const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? "";
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ── LLMRunnerFactory ─────────────────────────────────────────────────────────

class DeepOrcaLLMRunnerFactory implements LLMRunnerFactory {
  constructor(private config: DeepOrcaMemoryConfig) {}

  createRunner(options?: LLMRunnerCreateOptions): LLMRunner {
    return new DeepOrcaLLMRunner(this.config, options?.modelRef);
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
