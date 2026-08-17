import type { SandboxBackend, SandboxProbeResult, SandboxWrapRequest } from "./interface";

/** Explicit non-implementation: every wrap request runs unwrapped. */
export class NoopSandboxBackend implements SandboxBackend {
  readonly name = "noop" as const;

  constructor(private readonly reason: string) {}

  probe(): SandboxProbeResult {
    return { backend: "noop", available: false, detail: this.reason };
  }

  wrapShell(_request: SandboxWrapRequest): null {
    return null;
  }
}
