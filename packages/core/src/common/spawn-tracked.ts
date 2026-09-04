/**
 * spawnTracked — hardened one-shot child-process runner for the CLI adapters
 * (wiki / CRG / OCR), in core so both core paths and desktop adapters share
 * ONE implementation (desktop must never duplicate it in reverse).
 *
 * Exists because the index-knowledge module shipped THREE instances of the
 * same failure class (real-machine reports), and the code-review module had
 * two more:
 *   1. `close`-only exit detection — Node's `close` waits for the stdio
 *      pipes to close, and pipe-inherited grandchildren (MCP connector
 *      servers, uv-managed Python tools) can hold them open FOREVER, so a
 *      finished CLI left the job stuck on "running". `exit` is authoritative
 *      here; `close` only races a short stdout-flush grace.
 *   2. No timeout — a wedged child spanned the UI spinner indefinitely.
 *   3. No liveness signal — long silent stages (LLM loops) showed nothing.
 *
 * Contract:
 *   - resolves { code, signal, stdout, stderr, forcedOk } for ANY process
 *     exit (callers decide exit-code semantics);
 *   - rejects only for spawn failure or the hard timeout (SIGKILLed);
 *   - heartbeat hook for progress lines, with a force-finish escape for
 *     authoritative completion markers (work done + recorded, only the exit
 *     is wedged — must resolve SUCCESS, not fail);
 *   - logging is host-injected (configureSpawnTrackedLogger) — core never
 *     touches the console directly.
 */

import { spawn, type ChildProcess } from "child_process";

/** Give the final stdout flush this long after process death before settling. */
const EXIT_FLUSH_GRACE_MS = 2000;

type SpawnTrackedLogger = (line: string) => void;

let configuredLogger: SpawnTrackedLogger | null = null;

/** Host injects the log sink (desktop wires console.log at boot). */
export function configureSpawnTrackedLogger(logger: SpawnTrackedLogger | null): void {
  configuredLogger = logger;
}

function log(line: string): void {
  try {
    configuredLogger?.(line);
  } catch {
    // A broken host logger must never break process tracking.
  }
}

export type SpawnTrackedOptions = {
  /** Log label, used in errors and log lines. */
  label: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  /** Hard cap before SIGKILL + rejection. */
  timeoutMs: number;
  /** Heartbeat interval; omit for no heartbeat. */
  heartbeatMs?: number;
  /**
   * Periodic liveness hook. Return a progress line (string), null to stay
   * silent this tick, or call `finishOk()` to force-settle SUCCESS (for
   * authoritative completion markers — the exit being wedged must not mask
   * finished work). Throwing inside rejects the run with that error.
   */
  onHeartbeat?: (ctx: { elapsedSecs: number; finishOk: (note?: string) => void }) => string | null | void;
  /** Per-line stdout tap (progress). */
  onStdoutLine?: (line: string) => void;
  /** Per-line stderr tap (always logged first, then tapped). */
  onStderrLine?: (line: string) => void;
  /** Extra spawn log line (pid/cwd). Default true. */
  logSpawn?: boolean;
};

export type SpawnTrackedResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** True when force-finished via finishOk() — code/signal then reflect the kill. */
  forcedOk: boolean;
  forcedNote?: string;
};

export function spawnTracked(opts: SpawnTrackedOptions): Promise<SpawnTrackedResult> {
  const { label, command, args, cwd, env, timeoutMs, heartbeatMs, onHeartbeat, onStdoutLine, onStderrLine, logSpawn } =
    opts;

  return new Promise<SpawnTrackedResult>((resolve, reject) => {
    const child: ChildProcess = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      // windowsHide (user ask 2026-08-31): a console child spawned from the
      // GUI main process allocated a visible conhost that flashed on every
      // tool invocation (Windows only). Hide it — stdio stays piped.
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (logSpawn !== false) {
      log(`[${label}] spawn pid=${child.pid} cwd=${cwd}`);
    }

    const startedAtMs = Date.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    let forcedOk = false;
    let forcedNote: string | undefined;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let exitGrace: ReturnType<typeof setTimeout> | null = null;
    const watchdog = setTimeout(() => {
      timedOut = true;
      kill();
      // settle runs from the exit path; belt-and-braces in case even `exit`
      // is delayed by a wedged kernel-side process.
      setTimeout(() => settle(null, "SIGKILL"), 1000);
    }, timeoutMs);

    const settle = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      if (heartbeat) clearInterval(heartbeat);
      clearTimeout(watchdog);
      if (exitGrace) clearTimeout(exitGrace);
      const elapsed = Math.round((Date.now() - startedAtMs) / 1000);
      log(`[${label}] pid=${child.pid} exited code=${code} signal=${signal} after ${elapsed}s`);
      if (timedOut) {
        reject(new Error(`${label} 超时（${Math.round(timeoutMs / 60000)} 分钟无完成信号）已终止`));
        return;
      }
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
        forcedOk,
        forcedNote,
      });
    };

    const kill = (): void => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone — the exit path settles.
      }
    };

    if (heartbeatMs && onHeartbeat) {
      heartbeat = setInterval(() => {
        if (settled) return;
        try {
          const line = onHeartbeat({
            elapsedSecs: Math.round((Date.now() - startedAtMs) / 1000),
            finishOk: (note) => {
              forcedOk = true;
              forcedNote = note;
              kill();
            },
          });
          if (typeof line === "string" && line.length > 0) onStdoutLine?.(line);
        } catch (err) {
          if (!settled) {
            settled = true;
            if (heartbeat) clearInterval(heartbeat);
            clearTimeout(watchdog);
            kill();
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }
      }, heartbeatMs);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) onStdoutLine?.(line);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) {
          // Startup/config errors land on stderr long before exit — surface
          // them in the host log immediately.
          log(`[${label} stderr] ${line.slice(0, 200)}`);
          onStderrLine?.(line);
        }
      }
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (heartbeat) clearInterval(heartbeat);
      clearTimeout(watchdog);
      reject(new Error(`${label} spawn failed: ${err.message}`));
    });

    // `exit` (process death) is authoritative; the grace lets the final
    // stdout flush land before we snapshot the buffers.
    child.on("exit", (code, signal) => {
      exitGrace = setTimeout(() => settle(code, signal), EXIT_FLUSH_GRACE_MS);
    });
    child.on("close", (code, signal) => settle(code, signal));
  });
}
