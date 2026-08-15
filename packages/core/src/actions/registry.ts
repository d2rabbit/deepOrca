/**
 * {@link ActionRegistry} — the DEEP central module (design M1).
 *
 * 4-method interface hiding tool-definition generation, progress routing,
 * cancellation propagation and dispatch. Authors register one action; the
 * registry surfaces it as an LLM tool (`toToolDefinitions`) and a dispatchable
 * entry (`execute`). The desktop IPC bridge (built later) iterates `list()` to
 * auto-register IPC handlers that delegate to `execute` — that second adapter
 * is what makes the seam real.
 *
 * Locality: spawn/MCP/IPC wiring changes live here, not per capability.
 * Leverage: the Nth capability costs O(1) (`defineAction`), not O(3 hand-written
 * bindings).
 */

import type { ToolDefinition } from "../prompt";
import type { TaskTreeService } from "../tasks/task-tree-service";
import type { ActionContext, ActionDefinition, ActionProgress, ActionRun, McpDispatchResult, Spawner } from "./types";
import { ActionError, NULL_SPAWNER } from "./types";

/** Host context accepted at construction ("accept dependencies, don't create"). */
export interface RegistryHost {
  /** The open project root, surfaced to every action via {@link ActionContext}. */
  readonly projectRoot: string;
  /**
   * Subprocess spawn capability. Defaults to {@link NULL_SPAWNER} — spawn-based
   * actions then fail with a clear error if the host hasn't injected a real one.
   */
  readonly spawner?: Spawner;
  /**
   * MCP tool dispatch — injected by SessionManager (wired to mcpManager). Only
   * actions that route to existing MCP servers read it via
   * {@link ActionContext.executeMcpTool}; absent otherwise.
   */
  readonly executeMcpTool?: (
    namespacedToolName: string,
    args: Record<string, unknown>
  ) => Promise<import("./types").McpDispatchResult>;
  /**
   * Subagent dispatch — injected by SessionManager (runs an isolated sub-session
   * that executes a skill). Only non-deterministic actions (e.g. arch-scan.run)
   * read it via {@link ActionContext.runSubagent}. See roadmap §十 / spec §五.
   */
  readonly runSubagent?: (opts: import("./types").RunSubagentOptions) => Promise<unknown>;
  /**
   * LLM single-choice judgment — injected by SessionManager. Actions read it
   * via {@link ActionContext.judgeViaLlm} and must fail open when absent.
   */
  readonly judgeViaLlm?: (prompt: string, choices: readonly string[]) => Promise<string | null>;
  /** Task trajectory service provider (injected by SessionManager). */
  readonly taskTrees?: () => TaskTreeService | null;
  /** Current active session id provider (session-binding actions). */
  readonly activeSessionId?: () => string | null;
  /** Session taskRef reverse-pointer writer (host-owned mutation). */
  readonly setSessionTaskRef?: (
    sessionId: string,
    ref: { treeId: string; branch: string; nodeId: string } | null
  ) => void;
}

/** Options passed to {@link ActionRegistry.execute}. */
export interface ExecuteOptions {
  readonly signal?: AbortSignal;
}

/**
 * Handle returned by {@link ActionRegistry.execute} — "return results, don't
 * leak side effects": one execution's progress and cancellation live on this
 * value (not a global channel), so callers compose cleanly.
 */
export interface RunHandle<O> {
  /** Resolves with the action result; rejects with {@link ActionError} on failure. */
  readonly result: Promise<O>;
  /** Subscribe to progress; returns an unsubscribe function. */
  onProgress(cb: (event: ActionProgress) => void): () => void;
  /** Request cancellation; propagates via `ctx.signal`. Idempotent. */
  cancel(reason?: string): void;
}

interface RegisteredAction {
  readonly def: ActionDefinition;
  readonly run: ActionRun<unknown, unknown>;
}

const ACTION_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

export class ActionRegistry {
  private readonly actions = new Map<string, RegisteredAction>();
  private readonly order: string[] = [];
  private readonly projectRoot: string;
  private readonly spawner: Spawner;
  private readonly mcpDispatch?: (
    namespacedToolName: string,
    args: Record<string, unknown>
  ) => Promise<McpDispatchResult>;
  private readonly subagentDispatch?: (opts: import("./types").RunSubagentOptions) => Promise<unknown>;
  private readonly judgeDispatch?: (prompt: string, choices: readonly string[]) => Promise<string | null>;
  private readonly taskTreeProvider?: () => TaskTreeService | null;
  private readonly activeSessionProvider?: () => string | null;
  private readonly setTaskRef?: (
    sessionId: string,
    ref: { treeId: string; branch: string; nodeId: string } | null
  ) => void;

  constructor(host: RegistryHost) {
    this.projectRoot = host.projectRoot;
    this.spawner = host.spawner ?? NULL_SPAWNER;
    this.mcpDispatch = host.executeMcpTool;
    this.subagentDispatch = host.runSubagent;
    this.judgeDispatch = host.judgeViaLlm;
    this.taskTreeProvider = host.taskTrees;
    this.activeSessionProvider = host.activeSessionId;
    this.setTaskRef = host.setSessionTaskRef;
  }

  /**
   * Register an action. Throws on duplicate or malformed id (caller setup
   * error — not a runtime-recoverable path, so a throw is appropriate here).
   */
  register<I, O>(def: ActionDefinition<I>, run: ActionRun<I, O>): void {
    if (!ACTION_ID_PATTERN.test(def.id)) {
      throw new Error(`ActionRegistry.register: invalid id "${def.id}" (expected dotted lowercase, e.g. "review.run")`);
    }
    if (this.actions.has(def.id)) {
      throw new Error(`ActionRegistry.register: duplicate id "${def.id}"`);
    }
    this.actions.set(def.id, {
      def: def as ActionDefinition,
      run: run as unknown as ActionRun<unknown, unknown>,
    });
    this.order.push(def.id);
  }

  /** All registered definitions, in registration order (stable for tool lists). */
  list(): readonly ActionDefinition[] {
    return this.order.map((id) => this.actions.get(id)!.def);
  }

  /** Generate LLM function-tool definitions for every registered action. */
  toToolDefinitions(): ToolDefinition[] {
    return this.order.map((id) => {
      const { def } = this.actions.get(id)!;
      // Dotted id → tool name (OpenAI function names: [a-zA-Z0-9_-]+).
      const toolName = def.id.replace(/\./g, "_");
      return {
        type: "function" as const,
        function: {
          name: toolName,
          description: def.description,
          parameters: def.parameters,
        },
      };
    });
  }

  /**
   * Execute an action by id. Returns a {@link RunHandle}; never throws
   * synchronously — failures surface as {@link ActionError} rejections on
   * `handle.result`. Light input shape check only; deeper validation is the
   * action's responsibility.
   */
  execute<I = unknown, O = unknown>(id: string, input: unknown, opts: ExecuteOptions = {}): RunHandle<O> {
    const entry = this.actions.get(id);
    const ac = new AbortController();
    if (opts.signal) {
      if (opts.signal.aborted) ac.abort(opts.signal.reason);
      else opts.signal.addEventListener("abort", () => ac.abort(opts.signal!.reason), { once: true });
    }
    // Buffer progress emitted before the first subscriber attaches. An action
    // may emit synchronously during execute() (before the caller can call
    // onProgress); those events are held here and flushed to the first
    // subscriber. This avoids any async defer that would race the test runner.
    const subscribers = new Set<(e: ActionProgress) => void>();
    const buffer: ActionProgress[] = [];
    const emit = (e: ActionProgress) => {
      if (subscribers.size === 0) {
        buffer.push(e);
        return;
      }
      for (const cb of subscribers) cb(e);
    };
    let cancelled = false;

    const result = (async () => {
      // Pre-aborted (external signal already aborted, or cancel() called
      // synchronously after execute() but the action hadn't started): short-
      // circuit to CANCELLED. An abort *event* listener added after abort
      // never fires, so this check avoids relying on the action re-checking.
      if (ac.signal.aborted) {
        throw new ActionError("CANCELLED", id, "aborted before action start");
      }
      if (!entry) {
        throw new ActionError("ACTION_NOT_FOUND", id, `No action registered for "${id}"`);
      }
      const { parameters } = entry.def;
      const expectsObject = parameters?.type === "object";
      if (expectsObject && (typeof input !== "object" || input === null || Array.isArray(input))) {
        throw new ActionError(
          "INPUT_INVALID",
          id,
          `Action "${id}" expects an object input, got ${Array.isArray(input) ? "array" : typeof input}`
        );
      }
      const ctx: ActionContext = {
        projectRoot: this.projectRoot,
        signal: ac.signal,
        emit,
        spawner: this.spawner,
        executeMcpTool: this.mcpDispatch,
        runSubagent: this.subagentDispatch,
        judgeViaLlm: this.judgeDispatch,
        taskTrees: this.taskTreeProvider,
        activeSessionId: this.activeSessionProvider,
        setSessionTaskRef: this.setTaskRef,
      };
      try {
        return (await entry.run(input, ctx)) as O;
      } catch (err) {
        if (cancelled || ac.signal.aborted) {
          throw new ActionError("CANCELLED", id, err instanceof Error ? err.message : "action cancelled");
        }
        if (err instanceof ActionError) throw err;
        throw new ActionError("ACTION_FAILED", id, err instanceof Error ? err.message : String(err));
      }
    })();

    return {
      result,
      onProgress: (cb) => {
        for (const e of buffer) cb(e);
        subscribers.add(cb);
        return () => {
          subscribers.delete(cb);
        };
      },
      cancel: (reason) => {
        cancelled = true;
        ac.abort(reason ?? "cancelled by caller");
      },
    };
  }

  /** Resolve an LLM tool name back to its action id (dispatch routing helper). */
  actionIdForToolName(toolName: string): string | null {
    for (const id of this.order) {
      if (id.replace(/\./g, "_") === toolName) return id;
    }
    return null;
  }
}
