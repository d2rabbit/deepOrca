/**
 * specs-ipc — the Specs panel's wire surface (specs/spec-graph-adoption §1.4).
 *
 * Deliberately a separate file from knowledge-ipc.ts (design 硬约束 5): the
 * MECHANISM is shared — the same registered-root guard, the same degrade-
 * to-empty contract for unregistered roots — but the SEMANTICS are a
 * different track: the spec domain is the pre-design source of truth, not a
 * knowledge store. Reads are pure; `SpecsOpen` hands the node's markdown to
 * the OS with the same containment discipline as EditorOpenSystem.
 */

import { shell } from "electron";
import { getSpecGraph } from "@deeporca/core";

import { IpcRequest } from "../shared/ipc";
import { resolveRegisteredRoot } from "./knowledge-ipc.js";
import { safePathWithinRoot } from "./safe-path";

type IpcHelpers = {
  handle: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
  handlePrivileged: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
};

type SessionBridge = { projectRoot: string };

export function registerSpecsIpc(helpers: IpcHelpers, getBridge: () => SessionBridge): void {
  const { handle, handlePrivileged } = helpers;

  handle(IpcRequest.SpecsGraph, async (rootArg?: string) => {
    const pinned = resolveRegisteredRoot(rootArg);
    // Unregistered root → empty graph, never enumerated (safety invariant).
    if (!pinned) return { root: "", nodes: [] };
    return getSpecGraph(pinned);
  });

  handlePrivileged(IpcRequest.SpecsOpen, async (rootArg: string | undefined, relPath: string) => {
    const pinned = resolveRegisteredRoot(rootArg) ?? getBridge().projectRoot;
    const absPath = safePathWithinRoot(pinned, relPath);
    if (!absPath) return { ok: false, error: "Path escapes project root" };
    const normalized = absPath.replace(/\\/g, "/");
    const specsRoot = pinned.replace(/\\/g, "/").replace(/\/+$/, "") + "/.deeporca/specs/";
    if (!normalized.startsWith(specsRoot)) {
      return { ok: false, error: "Path is outside the spec domain" };
    }
    const error = await shell.openPath(normalized);
    return error ? { ok: false, error } : { ok: true };
  });
}
