// P3 sandbox backend contract (specs/sandbox/design.md §4.5). Backends wrap
// the bash tool's shell invocation in a kernel-mediated sandbox. The seam is
// deliberately narrow: probe (cheap, cacheable) + wrapShell (pure argv/env
// construction — no spawning here, the bash handler stays the single spawner).

export type SandboxBackendName = "macos-sandbox-exec" | "linux-bwrap" | "windows-wsl2" | "noop";

export type SandboxProbeResult = {
  backend: SandboxBackendName;
  /** False ⇒ the caller must fall back to noop AND record the degradation. */
  available: boolean;
  /** Why the probe failed — goes verbatim into the audit log and UI notice. */
  detail: string;
};

export type SandboxWrapRequest = {
  shellPath: string;
  shellArgs: string[];
  cwd: string;
};

export type SandboxWrapResult = {
  argv: string[];
  env?: Record<string, string>;
};

export interface SandboxBackend {
  readonly name: SandboxBackendName;
  probe(): SandboxProbeResult;
  /** null ⇒ backend cannot wrap this invocation; caller runs unwrapped. */
  wrapShell(request: SandboxWrapRequest): SandboxWrapResult | null;
}
