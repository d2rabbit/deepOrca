// Desktop-only sidecar for MCP server *disable* state. Disabling a server (rather
// than removing it) is a client concern that must not leak into core settings —
// notably the built-in CodeGraph server, which can be disabled but never removed.
// State lives in `<config root>/desktop/mcp.json`, keyed by resolved project root.

import { getUserConfigRoot } from "@deeporca/core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type McpStore = { disabled: Record<string, string[]> };

/** Path to the MCP sidecar file. */
function storePath(): string {
  return path.join(getUserConfigRoot(), "desktop", "mcp.json");
}

/** Read the raw store, tolerating a missing/corrupt file. */
function read(): McpStore {
  try {
    const raw = readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw) as McpStore;
    if (parsed && parsed.disabled && typeof parsed.disabled === "object") {
      return { disabled: parsed.disabled };
    }
  } catch {
    // Missing or invalid file → treat as empty store.
  }
  return { disabled: {} };
}

/** Persist the store, creating the parent directory as needed. */
function write(data: McpStore): void {
  const file = storePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function keyOf(projectRoot: string): string {
  return path.resolve(projectRoot);
}

/** Names of MCP servers disabled for a given project root. */
export function readDisabledMcp(projectRoot: string): string[] {
  return read().disabled[keyOf(projectRoot)] ?? [];
}

/** True when `name` is disabled for `projectRoot`. */
export function isMcpDisabled(projectRoot: string, name: string): boolean {
  return readDisabledMcp(projectRoot).includes(name);
}

/** Set the disable state of one MCP server for a project root (idempotent). */
export function setMcpDisabled(projectRoot: string, name: string, disabled: boolean): void {
  const data = read();
  const key = keyOf(projectRoot);
  const current = new Set(data.disabled[key] ?? []);
  if (disabled) {
    current.add(name);
  } else {
    current.delete(name);
  }
  if (current.size > 0) {
    data.disabled[key] = [...current];
  } else {
    delete data.disabled[key];
  }
  write(data);
}
