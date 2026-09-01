/**
 * Desktop IPC bridge for the defineAction primitive (design M6, spec §十).
 *
 * This is the third surface: the same actions the LLM sees as tools (M5) and
 * the future MCP clients see (mcp__ namespace) are reachable from the renderer
 * via typed IPC. The bridge iterates the registry and exposes two channels —
 * `ActionList` (introspection) and `ActionRun` (dispatch + progress). One
 * `defineAction` registration thus reaches IPC + MCP + LLM.
 *
 * Electron-free: imports only `node:child_process` and `@deeporca/core`, so it
 * is unit-testable without Electron. The `handle`/`emit`/`getProjectRoot`
 * adapters are injected by `main/index.ts`, which owns `ipcMain`.
 *
 * Phase 0: wires the `system.ping` action end-to-end as the trivial proof.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import type { ActionRegistry } from "@deeporca/core";
import {
  ActionError,
  type ActionDefinition,
  type ActionProgress,
  type SpawnedProcess,
  type Spawner,
} from "@deeporca/core";

/** IpcHelpers subset this module needs (matches main/index.ts IpcHelpers). */
export interface ActionIpcHelpers {
  handle: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
  handlePrivileged: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
}

/** Injected main-process dependencies (kept abstract so this file is testable). */
export interface ActionIpcDeps {
  /** Send a typed event to the renderer (wraps webContents.send in main). */
  emit: (channel: string, payload: unknown) => void;
  /** The project's ActionRegistry (owned by SessionManager), or null if no
   * engine/project is active. IPC and LLM surfaces share this one instance. */
  getRegistry: () => ActionRegistry | null;
  /** The project root actions run against — stamped onto every progress
   *  event so the renderer can multiplex concurrent per-workspace runs. */
  getRoot: () => string;
}

/** Result of an ActionRun IPC call — success or structured failure. */
export type ActionRunResult = { ok: true; output: unknown } | { ok: false; error: string; code: string };

/**
 * {@link Spawner} backed by `node:child_process`. The real production adapter
 * (design M2): core stays electron-free by accepting this interface; desktop
 * injects a real instance at boot via `configureActionSpawner`. `spawn` is
 * line-buffered so action authors consume `for await (const line of stdout)`.
 */
export class ElectronNodeSpawner implements Spawner {
  spawn(
    command: string,
    args: readonly string[],
    opts: { cwd?: string; env?: Record<string, string> } = {}
  ): SpawnedProcess {
    const child = spawn(command, [...args], {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      stdout: linesFrom(child.stdout),
      stderr: linesFrom(child.stderr),
      exited: new Promise<{ code: number }>((resolve) => {
        child.on("exit", (code, signal) => {
          resolve({ code: signal ? -1 : (code ?? 0) });
        });
        child.on("error", () => resolve({ code: -1 }));
      }),
      kill(signal) {
        if (!child.killed) child.kill(signal);
      },
    };
  }

  /** The host Node runner — `process.execPath` (Electron bundled Node under
   * ELECTRON_RUN_AS_NODE, or a plain node binary in tests/CLI hosts). */
  resolveNodeRunner(): string | null {
    return process.execPath;
  }
}

function linesFrom(stream: NodeJS.ReadableStream | null): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      if (!stream) return emptyAsyncIterator();
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      return rl[Symbol.asyncIterator]();
    },
  };
}

function emptyAsyncIterator(): AsyncIterator<string> {
  return {
    next: () => Promise.resolve({ value: undefined as unknown as string, done: true }),
  };
}

/**
 * Register the action IPC channels. Call once from `registerIpc()` in
 * `main/index.ts`. Reads the live ActionRegistry from `deps.getRegistry()`
 * — the SAME instance SessionManager owns and the LLM surface consumes — so
 * IPC, LLM, and MCP never diverge. Exposes:
 *   - `ActionList` → the registered action definitions (for a future UI surface)
 *   - `ActionRun`  → execute by id; streams `event:actionProgress`; returns the
 *                    result or a structured {@link ActionRunResult} error.
 *
 * `ActionRun` is privileged: actions may spawn subprocesses (review.run, crg,
 * index builds), so it routes through the audited privileged handler.
 */
export function registerActionIpc(helpers: ActionIpcHelpers, deps: ActionIpcDeps): void {
  const { handle, handlePrivileged } = helpers;
  const { emit, getRegistry } = deps;

  handle(IpcActionChannel.List, (): ActionDefinition[] => {
    const registry = getRegistry();
    if (!registry) return [];
    return [...registry.list()];
  });

  handlePrivileged(IpcActionChannel.Run, async (id: string, input: unknown): Promise<ActionRunResult> => {
    const registry = getRegistry();
    if (!registry) {
      return { ok: false, error: "no project open", code: "NO_PROJECT" };
    }
    const root = deps.getRoot();
    const runHandle = registry.execute(id, input);
    runHandle.onProgress((e: ActionProgress) => {
      emit(IpcActionEvent.Progress, { actionId: id, root, ...e });
    });
    try {
      const output = await runHandle.result;
      return { ok: true, output };
    } catch (err) {
      if (err instanceof ActionError) {
        return { ok: false, error: err.message, code: err.code };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: "ACTION_FAILED" };
    } finally {
      // Terminal marker on EVERY settle path (success, action error, throw) —
      // background-task indicators (bottom-right badge) key off data.done.
      // Without a guaranteed terminal event an indicator can stick "running"
      // forever — the same stuck-state class as the index-module incident.
      emit(IpcActionEvent.Progress, {
        actionId: id,
        root,
        message: "done",
        percent: 100,
        data: { done: true },
      });
    }
  });
}

/** IPC channel-name constants (mirrors the IpcRequest/IpcEvent pattern in shared/ipc.ts). */
export const IpcActionChannel = {
  List: "action:list",
  Run: "action:run",
} as const;

export const IpcActionEvent = {
  Progress: "event:actionProgress",
} as const;
