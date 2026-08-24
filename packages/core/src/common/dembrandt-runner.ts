/**
 * dembrandt process runner — isolated spawn surface (offline-only).
 *
 * The vendored dembrandt CLI is a plain Node ESM entry; it is spawned through
 * the host-injected Spawner with a literal executable name (argv form, never a
 * shell string). The dynamic part — the vendored bin path — is a single argv
 * entry produced by common/dembrandt.ts's containment-checked resolver, so no
 * externally influenced value ever becomes the executable.
 *
 * There is NO runtime npx fallback: an unprovisioned vendor tree yields a
 * spawnError, never a network fetch.
 */

import { resolveDembrandtCommand } from "./dembrandt";

type SpawnLike = {
  stdout: AsyncIterable<string>;
  stderr: AsyncIterable<string>;
  exited: Promise<{ code: number }>;
};

type SpawnerLike = {
  spawn(command: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }): SpawnLike;
};

/**
 * Spawn the vendored dembrandt CLI and collect stdout/stderr to completion.
 * stderr is drained concurrently so a verbose child cannot fill the pipe and
 * stall. The literal "node" executable resolves on PATH (desktop hosts run
 * with a Node ≥22 toolchain present — CodeGraph already depends on it).
 *
 * Abort support: an optional signal kills the CLI as soon as it fires —
 * previously a cancelled action left the (Playwright-driving) child running
 * to completion.
 */
export async function runDembrandtProcess(
  ctx: { spawner: SpawnerLike; signal?: AbortSignal },
  cliArgs: readonly string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string; spawnError?: string }> {
  const cmd = resolveDembrandtCommand("dembrandt");
  if (cmd.kind !== "vendored") {
    return { code: -1, stdout: "", stderr: "", spawnError: cmd.reason };
  }
  const vendoredBin: string = cmd.args[0] as string;
  const argv: string[] = [vendoredBin, ...cliArgs];
  const proc = ctx.spawner.spawn("node", argv, { cwd, env: cmd.env });
  let stderr = "";
  const drainStderr = (async () => {
    for await (const chunk of proc.stderr) stderr += chunk;
  })();
  let stdout = "";
  let aborted = false;
  const onAbort = (): void => {
    aborted = true;
    try {
      // Best-effort kill: the spawner surfaces it as a non-zero exited code
      // (or a stream error), either of which settles this run.
      (proc as unknown as { kill?: (sig?: string) => unknown }).kill?.("SIGKILL");
    } catch {
      // No kill surface — the process runs on; the run still rejects below.
    }
  };
  ctx.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    try {
      for await (const chunk of proc.stdout) stdout += chunk;
      await drainStderr;
    } catch (err) {
      try {
        await drainStderr;
      } catch {
        // The primary error wins.
      }
      throw err;
    }
    const exit = await proc.exited;
    if (aborted) {
      return { code: exit.code, stdout, stderr, spawnError: "aborted" };
    }
    return { code: exit.code, stdout, stderr };
  } finally {
    ctx.signal?.removeEventListener("abort", onAbort);
  }
}
