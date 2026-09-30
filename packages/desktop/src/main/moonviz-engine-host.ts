/**
 * MoonViz engine host (specs/moonviz-engine-replacement T1.2) — the
 * MAIN-process client over the engine worker, implementing core's
 * `MoonvizEngineSeam`.
 *
 * Watchdog: the worker executes each call synchronously; a hung call blocks
 * the worker's event loop forever, so the watchdog lives HERE. Every call
 * gets a `callTimeoutMs` timer (default 30s, deepDesign's CALL_TIMEOUT); on
 * fire → worker.terminate() → rebuild (respawn + re-init from the retained
 * bytes) → all in-flight calls reject with core's MoonvizResetError. The
 * canonical doc lives on the caller side, so a `withSession` retry from the
 * same doc is deterministic — core's seam retries once automatically.
 *
 * Vendor path red line: this module receives `wasmPath` / `workerPath` /
 * `componentVocabulary` as parameters from the app wiring (main/index.ts) —
 * it never derives them itself, and core never sees a path at all.
 */

import { readFile } from "node:fs/promises";
import {
  MoonvizEngineError,
  MoonvizResetError,
  type MoonvizComponentInfo,
  type MoonvizEngineSeam,
  type MoonvizRequestMethod,
  type MoonvizWorkerStats,
} from "@deeporca/core/moonviz-engine";

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface MoonvizEngineHostOptions {
  /** Vendored wasm-gc asset (absolute path, resolved by app wiring). */
  wasmPath: string;
  /** Compiled worker entry (absolute path, resolved by app wiring). */
  workerPath: string;
  /** Engine anchor version — init fails the worker on mismatch. */
  expectedVersion: string;
  /** Watchdog per call (default 30000, deepDesign CALL_TIMEOUT). */
  callTimeoutMs?: number;
  /** Memory-ratchet knobs (defaults in the worker; test-overridable). */
  maxMutatingOps?: number;
  ratchetHeapBytes?: number;
  /** Battery-only: enables the worker's never-responding `hang` method. */
  allowTestHooks?: boolean;
  /** components.json snapshot bytes (decoded), injected into core's config. */
  componentVocabulary?: MoonvizComponentInfo[];
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
}

export interface MoonvizEngineHost extends MoonvizEngineSeam {
  readonly version: string;
  readonly componentVocabulary: MoonvizComponentInfo[];
  stats(): Promise<MoonvizWorkerStats | null>;
  dispose(): Promise<void>;
}

export async function createMoonvizEngineHost(options: MoonvizEngineHostOptions): Promise<MoonvizEngineHost> {
  const { Worker } = await import("node:worker_threads");
  const callTimeoutMs = options.callTimeoutMs ?? 30_000;
  const bytes = await readFile(options.wasmPath);
  const bytesBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  let worker: InstanceType<typeof Worker> | null = null;
  let nextId = 1;
  let version = "";
  // Rebuilds counted on the HOST side: the worker process restarts on every
  // rebuild, so its own counter resets — the host's is the durable one.
  let hostRebuilds = 0;
  const pending = new Map<number, PendingCall>();
  let initPromise: Promise<void> | null = null;
  let disposed = false;

  function rejectAllPending(error: Error): void {
    for (const [id, call] of pending) {
      clearTimeout(call.timer);
      call.reject(error);
      pending.delete(id);
    }
  }

  function spawnWorker(): InstanceType<typeof Worker> {
    const next = new Worker(options.workerPath);
    next.on("message", (message: WorkerResponse) => {
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.ok) call.resolve(message.result);
      else call.reject(new MoonvizEngineError(message.error ?? "worker call failed"));
    });
    next.on("error", (error) => {
      rejectAllPending(new MoonvizResetError(`engine worker crashed: ${String(error).slice(0, 160)}`));
      // The worker is dead even with nothing in flight — invalidate it so the
      // next call respawns instead of postMessage-ing into the void and
      // stalling until the watchdog fires.
      if (worker === next) {
        worker = null;
        initPromise = null;
      }
    });
    next.on("exit", (code) => {
      rejectAllPending(
        new MoonvizResetError(
          pending.size > 0 ? `engine worker exited (${code}) with calls in flight` : `engine worker exited (${code})`
        )
      );
      if (worker === next) {
        worker = null;
        initPromise = null;
      }
    });
    return next;
  }

  function postCall(method: MoonvizRequestMethod, params: Record<string, unknown>): Promise<unknown> {
    if (disposed) return Promise.reject(new MoonvizResetError("engine host disposed"));
    const id = nextId++;
    return (async () => {
      // Await (re)initialization — a rebuild in progress (watchdog fired)
      // must finish before the call goes out.
      await init();
      const current = worker;
      if (!current) return Promise.reject(new MoonvizResetError("engine worker not running"));
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          // The worker's event loop is blocked by the hung synchronous call —
          // terminate is the only interruption V8 offers. Reject the caller
          // first (it must not wait for the rebuild), then rebuild.
          reject(
            new MoonvizResetError(
              `engine call timed out after ${callTimeoutMs}ms (${method}) — worker terminated and rebuilt`
            )
          );
          // rebuild() ends in await init(), which can reject (init timeout,
          // crash-loop, anchor drift after a vendor swap) — an unhandled
          // rejection here would take the main process down, the exact
          // failure the watchdog exists to contain.
          void rebuild(`call timeout after ${callTimeoutMs}ms (${method})`).catch(() => undefined);
        }, callTimeoutMs);
        pending.set(id, { resolve, reject, timer, method });
        current.postMessage({ id, method, params });
      });
    })();
  }

  async function rebuild(reason: string): Promise<void> {
    const current = worker;
    worker = null;
    // Drop the (resolved) init promise so the next init actually spawns.
    initPromise = null;
    hostRebuilds += 1;
    rejectAllPending(new MoonvizResetError(`engine rebuilt: ${reason}`));
    if (current) {
      current.removeAllListeners();
      await current.terminate().catch(() => undefined);
    }
    await init();
  }

  function init(): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!worker) worker = spawnWorker();
      const id = nextId++;
      const params: Record<string, unknown> = {
        bytes: bytesBuffer,
        expectedVersion: options.expectedVersion,
      };
      if (options.maxMutatingOps) params.maxMutatingOps = options.maxMutatingOps;
      if (options.ratchetHeapBytes) params.ratchetHeapBytes = options.ratchetHeapBytes;
      if (options.allowTestHooks) params.allowTestHooks = true;
      const result = (await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new MoonvizEngineError(`engine worker init timed out after ${callTimeoutMs}ms`));
        }, callTimeoutMs);
        pending.set(id, {
          resolve,
          reject,
          timer,
          method: "init",
        });
        worker!.postMessage({ id, method: "init", params });
      })) as { version: string };
      version = result.version;
    })();
    // A failed init must not poison the next attempt (deepDesign issue #1-B:
    // no first-failure stickiness) — reset the promise and drop the worker.
    initPromise = initPromise.catch(async (error) => {
      initPromise = null;
      const current = worker;
      worker = null;
      if (current) {
        current.removeAllListeners();
        await current.terminate().catch(() => undefined);
      }
      rejectAllPending(
        new MoonvizResetError(`engine init failed: ${String((error as Error)?.message ?? error).slice(0, 160)}`)
      );
      throw error;
    }) as Promise<void>;
    return initPromise;
  }

  await init();

  const host: MoonvizEngineHost = {
    get version() {
      return version;
    },
    get componentVocabulary() {
      return options.componentVocabulary ?? [];
    },
    async call(method, params) {
      if (initPromise) await initPromise;
      // A reset failure (timeout/crash rebuilt the worker) is safe to replay
      // once ONLY for stateless/doc-keyed calls. Session methods carry a
      // handle that died with the old worker: replaying them on the fresh
      // one can never succeed (handle is gone) and — worse — freshly
      // allocated handles are small integers, so a replay can land on a
      // DIFFERENT document's session. Session ladders recover at the
      // withSession layer (doc-keyed replay from the authoritative doc).
      const sessionBearing = method.startsWith("session") && method !== "sessionOpen";
      try {
        return await postCall(method, params);
      } catch (error) {
        if (error instanceof MoonvizResetError && !sessionBearing) {
          return await postCall(method, params);
        }
        throw error;
      }
    },
    async stats() {
      try {
        const workerStats = (await postCall("stats", {})) as MoonvizWorkerStats | null;
        return workerStats ? { ...workerStats, rebuilds: workerStats.rebuilds + hostRebuilds } : null;
      } catch {
        return null;
      }
    },
    async dispose() {
      disposed = true;
      rejectAllPending(new MoonvizResetError("engine host disposed"));
      const current = worker;
      worker = null;
      if (current) await current.terminate().catch(() => undefined);
    },
  };
  return host;
}
