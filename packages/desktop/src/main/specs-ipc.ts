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
 * Containment goes through `safeSpecsPath` (lexical + double realpath).
 *
 * Honest residual vs EditorOpenSystem: that handler additionally confirms
 * before handing executable extensions to the OS; its extension list is
 * module-private to index.ts. The spec domain's open target is markdown
 * documents, so the confirmation is not duplicated here — revisit if the
 * domain ever carries executable artifacts.
 */

import { shell } from "electron";
import { getSpecGraph } from "@deeporca/core";

import { IpcRequest } from "../shared/ipc";
import { resolveRegisteredRoot } from "./knowledge-ipc.js";
import { safeSpecsPath } from "./safe-path";

type IpcHelpers = {
  handle: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
  handlePrivileged: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
};

export function registerSpecsIpc(helpers: IpcHelpers): void {
  const { handle, handlePrivileged } = helpers;

  handle(IpcRequest.SpecsGraph, async (rootArg?: string) => {
    const pinned = resolveRegisteredRoot(rootArg);
    // Unregistered root → empty graph, never enumerated (safety invariant).
    if (!pinned) return { root: "", nodes: [] };
    return getSpecGraph(pinned);
  });

  handlePrivileged(IpcRequest.SpecsOpen, async (rootArg: string | undefined, relPath: string) => {
    const pinned = resolveRegisteredRoot(rootArg);
    if (!pinned) return { ok: false, error: "unregistered workspace" };
    const check = safeSpecsPath(pinned, relPath);
    if (!check.ok) return { ok: false, error: "Path is outside the spec domain" };
    const error = await shell.openPath(check.absPath);
    return error ? { ok: false, error } : { ok: true };
  });
}
