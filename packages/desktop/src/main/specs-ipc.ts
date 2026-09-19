/**
 * specs-ipc — the Specs panel's wire surface (specs/spec-graph-adoption §1.4).
 *
 * Deliberately a separate file from knowledge-ipc.ts (design 硬约束 5): the
 * MECHANISM is shared — the same registered-root guard, the same degrade-
 * to-empty contract for unregistered roots — but the SEMANTICS are a
 * different track: the spec domain is the pre-design source of truth, not a
 * knowledge store.
 *
 * Root discipline (2026-09-19 review fix): BOTH handlers treat an explicitly
 * supplied but unregistered root as a rejection — `specs:graph` degrades to
 * an empty graph, `specs:open` returns an error; neither falls back to the
 * active root (an unregistered root is never enumerated, per the AGENTS.md
 * safety invariant). Only an OMITTED root resolves to the active root.
 * Containment goes through `safeSpecsPath`, which (like the wiki domain)
 * enforces `.md`-only on top of the lexical + double-realpath layers — so
 * EditorOpenSystem's executable-extension confirmation is not needed here:
 * a non-markdown target is structurally rejected before `openPath` (2026-09
 * swarm review).
 *
 * Electron and the shared root resolver are INJECTED (design-ipc pattern):
 * this module stays importable outside the main bundle, so the root/containment
 * contract is unit-testable without an Electron runtime.
 */

import { getSpecGraph, validateSpecs } from "@deeporca/core";

import { IpcRequest } from "../shared/ipc";
import { safeSpecsPath } from "./safe-path";

type IpcHelpers = {
  handle: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
  handlePrivileged: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
};

export type SpecsIpcDeps = {
  /** Root resolver — the shared registered-root guard (knowledge-ipc). */
  resolveRoot: (root: string | undefined) => string | null;
  /** OS opener — electron `shell.openPath`; returns "" on success. */
  openPath: (absPath: string) => Promise<string>;
};

export function registerSpecsIpc(helpers: IpcHelpers, deps: SpecsIpcDeps): void {
  const { handle, handlePrivileged } = helpers;
  const { resolveRoot, openPath } = deps;

  handle(IpcRequest.SpecsGraph, async (rootArg?: string) => {
    const pinned = resolveRoot(rootArg);
    // Unregistered root → empty graph, never enumerated (safety invariant).
    if (!pinned) return { root: "", nodes: [], issues: [] };
    // Sequential on purpose: validateSpecs shares revalidate's (mtimeMs, size)
    // cache, so after getSpecGraph's pass it is stat-only — concurrent calls
    // would double-miss and read+parse the whole tree twice. The panel gets
    // the design's promised issue detail (design.md 呈现) at negligible cost.
    const graph = await getSpecGraph(pinned);
    const issues = await validateSpecs(pinned);
    return { ...graph, issues };
  });

  handlePrivileged(IpcRequest.SpecsOpen, async (rootArg: string | undefined, relPath: string) => {
    const pinned = resolveRoot(rootArg);
    if (!pinned) {
      console.warn(`[specs] open refused: unregistered workspace root`);
      return { ok: false, error: "unregistered workspace" };
    }
    const check = safeSpecsPath(pinned, relPath);
    if (!check.ok) {
      // JSON.stringify: relPath is renderer-controlled — a bare interpolate
      // would let newline-bearing strings forge multi-line log entries.
      console.warn(`[specs] open refused (${check.reason}): ${JSON.stringify(relPath)}`);
      return {
        ok: false,
        error:
          check.reason === "not-markdown"
            ? "Only markdown spec documents can be opened"
            : "Path is outside the spec domain",
      };
    }
    const error = await openPath(check.absPath);
    if (error) console.warn(`[specs] openPath failed for ${JSON.stringify(check.absPath)}: ${error}`);
    return error ? { ok: false, error } : { ok: true };
  });
}
