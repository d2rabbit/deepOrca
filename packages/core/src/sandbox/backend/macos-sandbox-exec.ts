import { execFileSync } from "node:child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { safeRealPath } from "../../common/path-boundary";
import type { SandboxBackend, SandboxProbeResult, SandboxWrapRequest } from "./interface";

// macOS seatbelt backend (specs/sandbox/design.md §4.5, task 16). Profile
// semantics were established empirically on macOS (2026-08-16); each rule
// below exists because removing it was observed to break something:
//
// - `(allow process-fork)` — WITHOUT the `*` suffix; `process-fork*` is an
//   unbound variable in this macOS version's SBPL and every fork() under the
//   profile dies with "fork: Operation not permitted" (rc 128).
// - Broad `(allow file-read*)` + explicit `(deny … (subpath HOME))` — a
//   subpath allowlist approach (even covering /usr,/System,/Library,/private)
//   aborts processes with SIGABRT; read-blacklisting HOME is both sufficient
//   for T2 and empirically stable.
// - Seatbelt is last-match-wins: the deny of HOME precedes the re-allow of
//   roots that live under it (project directory, skill roots).
// - The inner shell is forced to /bin/bash: zsh exits 1 under
//   `(deny default)` regardless of ZDOTDIR (unmet startup dependencies),
//   while bash runs fine. The bash handler's wrapped command is POSIX.
// - GIT_CONFIG_GLOBAL=/dev/null: git treats an EPERM-unreadable ~/.gitconfig
//   as fatal; inside the sandbox HOME is unreadable by design, so git needs
//   this redirect to fall back to repo-local config.

export const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

export type MacosSandboxProfileInput = {
  /** Realpath-normalized project root. */
  projectRoot: string;
  /** Realpath-normalized home directory whose contents must stay unreadable (T2). */
  homeDir: string;
  /** Roots re-allowed after the HOME deny (e.g. skill scan roots under HOME). */
  extraReadRoots?: readonly string[];
  /** Writable roots; defaults to [projectRoot]. */
  writeRoots?: readonly string[];
  /** Writable temp areas for toolchains; defaults to system temp realpaths. */
  tempWriteRoots?: readonly string[];
  networkAllowed: boolean;
};

/** Escape a path for a Seatbelt `(subpath "/…")` string literal. */
function sbEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function defaultTempWriteRoots(): string[] {
  const roots = new Set<string>(["/private/tmp"]);
  const realTmp = safeRealPath(os.tmpdir());
  if (realTmp) {
    roots.add(realTmp);
  }
  return [...roots];
}

/** Pure profile generator — unit-testable without touching sandbox-exec. */
export function buildSeatbeltProfile(input: MacosSandboxProfileInput): string {
  const lines: string[] = ["(version 1)", "(deny default)", "(allow process-exec*)", "(allow process-fork)"];
  // Read: broad allow, then blacklist HOME, then re-allow sanctioned roots
  // living under it. Last match wins.
  lines.push("(allow file-read*)");
  lines.push(`(deny file-read* (subpath "${sbEscape(input.homeDir)}"))`);
  const readReallows = [input.projectRoot, ...(input.extraReadRoots ?? [])];
  for (const root of readReallows) {
    lines.push(`(allow file-read* (subpath "${sbEscape(root)}"))`);
  }
  // Write: strict allowlist only.
  const writeRoots = input.writeRoots ?? [input.projectRoot];
  const tempRoots = input.tempWriteRoots ?? defaultTempWriteRoots();
  for (const root of [...writeRoots, ...tempRoots]) {
    lines.push(`(allow file-write* (subpath "${sbEscape(root)}"))`);
  }
  // Device literals shells and CLI tools open unconditionally.
  for (const device of ["/dev/null", "/dev/tty"]) {
    lines.push(`(allow file-read* (literal "${device}"))`);
    lines.push(`(allow file-write* (literal "${device}"))`);
  }
  // Final HOME WRITE fence: temp write roots (e.g. realpath(TMPDIR)) can
  // CONTAIN the home directory (test harnesses redirect HOME into TMPDIR;
  // some real setups nest similarly) and last-match-wins would re-open it.
  // Deny HOME writes after the temp allows, then re-allow the sanctioned
  // write roots so projects living under HOME keep working.
  lines.push(`(deny file-write* (subpath "${sbEscape(input.homeDir)}"))`);
  for (const root of writeRoots) {
    lines.push(`(allow file-write* (subpath "${sbEscape(root)}"))`);
  }
  // Network is denied by `(deny default)`; allow only when the network scope
  // resolved to allow (a denied ask never reaches execution, so allow+ask ⇒ on).
  if (input.networkAllowed) {
    lines.push("(allow network*)");
  }
  return `${lines.join("\n")}\n`;
}

const PROBE_PROFILE =
  "(version 1)(deny default)(allow process-exec*)(allow process-fork)(allow file-read*)(allow file-write*)";

export class MacosSandboxExecBackend implements SandboxBackend {
  readonly name = "macos-sandbox-exec" as const;
  private readonly profile: string;
  private probeResult: SandboxProbeResult | null = null;

  constructor(private readonly input: MacosSandboxProfileInput) {
    this.profile = buildSeatbeltProfile(input);
  }

  /**
   * Compiles and RUNS a minimal profile — a syntax-only check would miss
   * sandbox_init failures at runtime (deprecated/removed features), and a
   * broken probe would silently turn every bash call into an abort.
   */
  probe(): SandboxProbeResult {
    if (this.probeResult) {
      return this.probeResult;
    }
    try {
      fs.accessSync(SANDBOX_EXEC_PATH, fs.constants.X_OK);
      execFileSync(SANDBOX_EXEC_PATH, ["-p", PROBE_PROFILE, "/usr/bin/true"], {
        stdio: "ignore",
        timeout: 5_000,
      });
      this.probeResult = { backend: this.name, available: true, detail: "sandbox-exec probe passed" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.probeResult = {
        backend: this.name,
        available: false,
        detail: `sandbox-exec unavailable: ${message}`,
      };
    }
    return this.probeResult;
  }

  wrapShell(request: SandboxWrapRequest): { argv: string[]; env: Record<string, string> } | null {
    if (!this.probe().available) {
      return null;
    }
    // Force bash inside the sandbox (zsh cannot start under deny-default).
    // Ignore request.shellPath deliberately; shellArgs is the `-c <command>`
    // pair, which is POSIX and shell-agnostic.
    return {
      argv: [SANDBOX_EXEC_PATH, "-p", this.profile, "/bin/bash", ...request.shellArgs],
      env: { GIT_CONFIG_GLOBAL: "/dev/null" },
    };
  }
}

/** Convenience factory used by the detector: realpaths everything it can. */
export function createMacosBackend(options: {
  projectRoot: string;
  networkAllowed: boolean;
  extraReadRoots?: readonly string[];
  /** Additional writable roots (path-level grants; caller canonicalizes). */
  writeRoots?: readonly string[];
}): MacosSandboxExecBackend {
  const projectRoot = safeRealPath(options.projectRoot) ?? path.resolve(options.projectRoot);
  const homeDir = safeRealPath(os.homedir()) ?? os.homedir();
  const extraReadRoots = (options.extraReadRoots ?? [])
    .map((root) => safeRealPath(root) ?? path.resolve(projectRoot, root))
    .filter((root) => root !== projectRoot);
  // projectRoot is ALWAYS write root #1 — buildSeatbeltProfile uses
  // `input.writeRoots ?? [projectRoot]`, so an explicit list must include it.
  const grantedWriteRoots = [
    ...new Set((options.writeRoots ?? []).map((root) => safeRealPath(root) ?? path.resolve(projectRoot, root))),
  ].filter((root) => root !== projectRoot);
  return new MacosSandboxExecBackend({
    projectRoot,
    homeDir,
    extraReadRoots,
    writeRoots: [projectRoot, ...grantedWriteRoots],
    networkAllowed: options.networkAllowed,
  });
}
