/**
 * Stub — CleanContextRunner was an OpenClaw-specific context compression runner.
 * In DeepOrca, LLMRunner is always provided, so this fallback is never reached.
 */
export class CleanContextRunner {
  constructor(_opts: unknown) {}
  async run(params: { prompt: string; systemPrompt?: string; taskId: string; timeoutMs?: number }): Promise<string> {
    throw new Error("CleanContextRunner should not be called — LLMRunner must be provided via HostAdapter");
  }
}
