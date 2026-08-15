import { createMacosBackend } from "./macos-sandbox-exec";
import { NoopSandboxBackend } from "./noop";
import type { SandboxBackend, SandboxBackendName } from "./interface";

// Platform detection chain (specs/sandbox/design.md §4.5, task 15). Every
// unavailable candidate is REPORTED through onDegradation — the caller wires
// that into the audit log and a UI notice. Silent degradation is forbidden
// (design constraint 6): "has a sandbox" must never be an illusion.

export type SandboxDegradation = {
  backend: SandboxBackendName;
  detail: string;
};

export type DetectBashSandboxOptions = {
  projectRoot: string;
  networkAllowed: boolean;
  extraReadRoots?: readonly string[];
  /** Called once per unavailable candidate in the chain order. */
  onDegradation?: (degradation: SandboxDegradation) => void;
};

export function detectBashSandboxBackend(options: DetectBashSandboxOptions): SandboxBackend {
  switch (process.platform) {
    case "darwin": {
      const backend = createMacosBackend({
        projectRoot: options.projectRoot,
        networkAllowed: options.networkAllowed,
        extraReadRoots: options.extraReadRoots,
      });
      const probe = backend.probe();
      if (probe.available) {
        return backend;
      }
      options.onDegradation?.({ backend: probe.backend, detail: probe.detail });
      return new NoopSandboxBackend(`macOS sandbox-exec probe failed: ${probe.detail}`);
    }
    case "linux":
      // bwrap backend is task 17 (not implemented); report, don't guess.
      options.onDegradation?.({
        backend: "linux-bwrap",
        detail: "bubblewrap backend not implemented yet (sandbox task 17)",
      });
      return new NoopSandboxBackend("linux-bwrap backend not implemented yet");
    case "win32":
      // WSL2 backend is task 18 (not implemented); report, don't guess.
      options.onDegradation?.({
        backend: "windows-wsl2",
        detail: "WSL2 backend not implemented yet (sandbox task 18)",
      });
      return new NoopSandboxBackend("windows-wsl2 backend not implemented yet");
    default:
      options.onDegradation?.({
        backend: "noop",
        detail: `unsupported platform: ${process.platform}`,
      });
      return new NoopSandboxBackend(`unsupported platform: ${process.platform}`);
  }
}
