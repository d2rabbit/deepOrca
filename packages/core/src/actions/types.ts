/**
 * defineAction primitive — "define once, surface everywhere".
 *
 * One {@link ActionDefinition} registered with {@link ActionRegistry.register}
 * becomes (a) an LLM tool the agent can call, (b) an entry point the desktop
 * IPC layer can delegate to, and (c) a unit the orchestration actions can
 * compose. See `specs/define-action/design.md` §二/§十.
 *
 * Design (codebase-design skill): ActionRegistry is a DEEP module — a 4-method
 * interface hiding MCP/tool generation, progress routing, spawn delegation and
 * cancellation. The {@link Spawner} seam keeps core UI-free (electron never
 * imported); the desktop host injects a real spawner at boot, tests inject a
 * mock. Two adapters (LLM tool generation + future IPC bridge) call the same
 * `execute`, proving the seam real.
 */

import type { ToolDefinition } from "../prompt";

/**
 * JSON-schema fragment for an action's input — the OpenAI function-tool
 * `parameters` shape. Carried verbatim onto the generated tool definition so
 * the agent sees accurate input contracts without a zod→json-schema conversion
 * step. (Strict runtime validation via zod is a future refinement; today the
 * registry does a light `object`-type check and the action's `run` validates
 * its own input.)
 */
export type ActionParameters = ToolDefinition["function"]["parameters"];

/** Stable, machine-readable error codes (registry never throws bare errors). */
export type ActionErrorCode = "ACTION_NOT_FOUND" | "INPUT_INVALID" | "ACTION_FAILED" | "CANCELLED";

/** Structured error returned by {@link ActionRegistry.execute} on failure. */
export class ActionError extends Error {
  readonly code: ActionErrorCode;
  readonly actionId: string;
  constructor(code: ActionErrorCode, actionId: string, message: string) {
    super(message);
    this.name = "ActionError";
    this.code = code;
    this.actionId = actionId;
  }
}

/**
 * Capability declaration. `id` is a dotted namespace (`"review.run"`,
 * `"index.buildAll"`); `sideEffects` feeds the desktop permission gate so the
 * IPC bridge can reuse the existing permission system instead of a parallel
 * privilege model.
 */
export interface ActionDefinition<I = Record<string, unknown>> {
  readonly id: string;
  readonly description: string;
  readonly category?: string;
  readonly parameters: ActionParameters;
  readonly sideEffects?: string[];
  /** Internal use: the parsed input type. */
  readonly _input?: I;
}

/** Progress event emitted through {@link ActionContext.emit}. */
export interface ActionProgress {
  readonly message: string;
  readonly percent?: number;
  readonly data?: unknown;
}

/**
 * Injected execution context. Follows "accept dependencies, don't create
 * them": the spawner (and optionally `runSubagent` for arch-scan-style
 * non-deterministic actions) is provided by the host, not constructed here, so
 * core never imports electron and deterministic actions stay free of an agent
 * dependency.
 */
export interface McpDispatchResult {
  readonly ok: boolean;
  readonly output?: string;
  readonly error?: string;
}

export interface ActionContext {
  readonly projectRoot: string;
  readonly signal: AbortSignal;
  readonly emit: (event: ActionProgress) => void;
  readonly spawner: Spawner;
  /** Only injected for non-deterministic actions (e.g. arch-scan.run). */
  readonly runSubagent?: (opts: RunSubagentOptions) => Promise<unknown>;
  /**
   * Dispatch an MCP tool call by its fully-qualified namespaced name
   * (e.g. "mcp__code-review-graph__detect_changes_tool"). Injected by the host
   * (SessionManager wires it to mcpManager.executeMcpTool). Only actions that
   * route to existing MCP servers (e.g. via ctx.executeMcpTool) need
   * it; deterministic actions never touch it (small surface).
   */
  readonly executeMcpTool?: (namespacedToolName: string, args: Record<string, unknown>) => Promise<McpDispatchResult>;
  /**
   * LLM single-choice judgment, injected by SessionManager (flash-class model,
   * JSON mode). Returns one of `choices`, or null when unavailable/failed —
   * callers MUST fall back to deterministic behavior on null (fail-open).
   * Lets classification-shaped actions (e.g. design.materialize routing)
   * upgrade from keyword heuristics without core gaining an LLM dependency.
   */
  readonly judgeViaLlm?: (prompt: string, choices: readonly string[]) => Promise<string | null>;
}

export interface RunSubagentOptions {
  readonly skill: string;
  readonly prompt?: string;
  readonly input?: Record<string, unknown>;
}

/** The `run` function authors implement. */
export type ActionRun<I, O> = (input: I, ctx: ActionContext) => Promise<O>;

/**
 * Spawn capability — the core↔desktop seam (design M2). core defines the
 * interface; the desktop host injects an `ElectronNodeSpawner` at boot, tests
 * inject a `MockSpawner`. Without this seam core would have to import electron
 * to spawn subprocesses (ocr/crg/wiki/codegraph builds), violating the layer
 * rule. Two adapters ⇒ real seam.
 */
export interface Spawner {
  spawn(
    command: string,
    args: readonly string[],
    opts?: { cwd?: string; env?: Record<string, string> }
  ): SpawnedProcess;
  /** Resolve a Node runner path (Electron bundled Node or system Node). */
  resolveNodeRunner(): string | null;
}

export interface SpawnedProcess {
  /** Line-streamed stdout. */
  readonly stdout: AsyncIterable<string>;
  /** Line-streamed stderr. */
  readonly stderr: AsyncIterable<string>;
  /** Resolves with the exit code when the process terminates. */
  readonly exited: Promise<{ code: number }>;
  kill(signal?: NodeJS.Signals): void;
}

/**
 * Default no-op spawner. Used when a host hasn't injected a real one.
 * Spawn-based actions that touch `ctx.spawner.spawn(...)` get a clear
 * `ACTION_FAILED` ("spawner not configured") rather than a silent null deref.
 * Deterministic actions that never spawn are unaffected.
 */
export const NULL_SPAWNER: Spawner = {
  spawn(command) {
    const err = new Error(
      `NULL_SPAWNER: no Spawner configured (command "${command}" not run). Call configureActionSpawner at host boot.`
    );
    return {
      stdout: rejectIterable(err),
      stderr: rejectIterable(err),
      exited: Promise.reject(err),
      kill() {
        /* nothing to kill */
      },
    };
  },
  resolveNodeRunner: () => null,
};

function rejectIterable(err: unknown): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          return Promise.reject(err);
        },
      };
    },
  };
}
