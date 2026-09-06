/**
 * Shared LSP process helpers (2026-09-06 convergence): `sanitizedEnv()` and
 * the kill-tree teardown were duplicated verbatim between lsp-relay.ts and
 * lsp-bridge/lsp-client.ts. One implementation now serves both (the bridge
 * bundle inlines it — standalone CJS, no core imports, same as frames.ts).
 */

import { spawn, type ChildProcess } from "node:child_process";

/**
 * Sanitized env for a language server — no credentials, no app secrets
 * (design §2.7: the LS is untrusted computation). Both the relay and the
 * bridge hand this to every spawn.
 */
export function sanitizedLspEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    "PATH",
    "PATHEXT",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SYSTEMROOT",
    "COMSPEC",
    "TEMP",
    "TMP",
    "LANG",
  ]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Kill a language-server process TREE. Windows: npx/.cmd spawns a cmd.exe →
 * npx.cmd → node chain, so proc.kill() only fells the first link — taskkill
 * /T /F reaches the grandchildren (ENOENT-safe: falls back to proc.kill).
 * POSIX: the server leads its own process group (spawn detached), so a
 * negative-pid signal reaches the whole tree; falls back to a direct kill.
 */
export function killLspTree(proc: ChildProcess | null): void {
  if (!proc || proc.exitCode !== null || proc.killed) return;
  if (process.platform === "win32" && typeof proc.pid === "number") {
    try {
      const killer = spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
      // ENOENT (taskkill missing) must not surface as an uncaught 'error'.
      killer.on("error", () => proc.kill());
    } catch {
      proc.kill();
    }
  } else if (typeof proc.pid === "number") {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      proc.kill();
    }
  } else {
    proc.kill();
  }
}
