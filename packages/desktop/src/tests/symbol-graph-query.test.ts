/**
 * Functional tests for the symbol-graph query (knowledge R3-6) against a
 * REAL CodeGraph index when the repo has one (.codegraph/codegraph.db is
 * gitignored, so CI environments skip this file); a synthetic in-memory DB
 * covers the structural contract everywhere.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { buildSymbolGraph, type SqliteDb } from "../main/symbol-graph-query";
import type { KnowledgeSymbolGraphNode } from "../shared/ipc";

/** Minimal in-memory stub honoring the SqliteDb surface. */
function memoryDb(tables: {
  nodes: Array<{ id: string; name: string; kind: string; file_path: string; qualified_name?: string }>;
  edges: Array<{ source: string; target: string; kind: string }>;
}): SqliteDb {
  return {
    prepare(sql: string) {
      return {
        all(...params: unknown[]): unknown[] {
          if (sql.includes("LIKE ?")) {
            const like = String(params[0]);
            return tables.nodes.filter((n) => n.name.includes(like.slice(1, -1)));
          }
          if (sql.includes("ORDER BY deg DESC")) {
            const inDeg = new Map<string, number>();
            for (const e of tables.edges) {
              if (["calls", "references", "instantiates"].includes(e.kind)) {
                inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
              }
            }
            return tables.nodes
              .filter((n) => !["import", "unknown", "file"].includes(n.kind) && inDeg.has(n.id))
              .sort((a, b) => (inDeg.get(b.id) ?? 0) - (inDeg.get(a.id) ?? 0))
              .slice(0, 10)
              .map((n) => ({ ...n, deg: inDeg.get(n.id) }));
          }
          if (sql.startsWith("SELECT source, target, kind FROM edges WHERE target")) {
            const ids = new Set(params as string[]);
            return tables.edges.filter(
              (e) => ids.has(e.target) && !e.kind.includes("contains") && e.kind !== "imports"
            );
          }
          if (sql.startsWith("SELECT source, target, kind FROM edges WHERE source")) {
            const ids = new Set(params as string[]);
            return tables.edges.filter(
              (e) => ids.has(e.source) && !e.kind.includes("contains") && e.kind !== "imports"
            );
          }
          if (sql.startsWith("SELECT id, name, kind, file_path FROM nodes WHERE id IN")) {
            const ids = new Set(params as string[]);
            return tables.nodes.filter((n) => ids.has(n.id));
          }
          return [];
        },
      };
    },
  };
}

test("query mode: focus matches, callers/callees roled, contains/import excluded", () => {
  const db = memoryDb({
    nodes: [
      { id: "file:a.ts", name: "a.ts", kind: "file", file_path: "a.ts" },
      { id: "f:main", name: "main", kind: "function", file_path: "a.ts" },
      { id: "f:helper", name: "helper", kind: "function", file_path: "a.ts" },
      { id: "f:caller1", name: "caller1", kind: "function", file_path: "b.ts" },
      { id: "f:caller2", name: "caller2", kind: "method", file_path: "b.ts" },
      { id: "i:node", name: "node:fs", kind: "import", file_path: "a.ts" },
    ],
    edges: [
      { source: "file:a.ts", target: "f:main", kind: "contains" },
      { source: "f:caller1", target: "f:main", kind: "calls" },
      { source: "f:caller2", target: "f:main", kind: "references" },
      { source: "f:main", target: "f:helper", kind: "calls" },
      { source: "f:main", target: "i:node", kind: "imports" },
    ],
  });
  const graph = buildSymbolGraph(db, "main");
  const byName = new Map(graph.nodes.map((n) => [n.name, n]));
  assert.equal(byName.get("main")?.role, "focus");
  assert.equal(byName.get("caller1")?.role, "caller");
  assert.equal(byName.get("caller2")?.role, "caller");
  assert.equal(byName.get("helper")?.role, "callee");
  assert.ok(!byName.has("node:fs"), "import nodes filtered out");
  assert.equal(graph.edges.length, 3, "contains/imports edges excluded");
  assert.ok(graph.edges.every((e) => ["calls", "references"].includes(e.kind)));
  assert.equal(graph.truncated, false);
});

test("hub mode (no query): highest in-degree symbols become the focus set", () => {
  const db = memoryDb({
    nodes: [
      { id: "f:hub", name: "hub", kind: "function", file_path: "a.ts" },
      { id: "f:a", name: "a", kind: "function", file_path: "a.ts" },
      { id: "f:b", name: "b", kind: "function", file_path: "a.ts" },
    ],
    edges: [
      { source: "f:a", target: "f:hub", kind: "calls" },
      { source: "f:b", target: "f:hub", kind: "calls" },
    ],
  });
  const graph = buildSymbolGraph(db, "");
  const hub = graph.nodes.find((n) => n.name === "hub") as KnowledgeSymbolGraphNode | undefined;
  assert.equal(hub?.role, "focus");
  assert.equal(graph.nodes.filter((n) => n.role === "caller").length, 2);
});

test("no match → empty graph, not a throw", () => {
  const db = memoryDb({ nodes: [], edges: [] });
  const graph = buildSymbolGraph(db, "zzz");
  assert.deepEqual(graph, { nodes: [], edges: [], truncated: false });
});

import { fileURLToPath } from "node:url";
// import.meta.dirname is undefined under tsx's transform — derive from the URL.
const REAL_DB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.codegraph/codegraph.db");
test("against the REAL repo index when present (skipped otherwise)", { skip: !fs.existsSync(REAL_DB) }, async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(REAL_DB, { readOnly: true }) as unknown as SqliteDb;
  const graph = buildSymbolGraph(db, "getBridge");
  assert.ok(graph.nodes.length > 0, "query 'getBridge' finds focus nodes in the real index");
  assert.ok(graph.nodes.some((n) => n.role === "focus"));
  assert.ok(graph.edges.length > 0, "real index has relationship edges around getBridge");
  // Every edge endpoint must be a returned node (no dangling references).
  const ids = new Set(graph.nodes.map((n) => n.id));
  assert.ok(graph.edges.every((e) => ids.has(e.source) && ids.has(e.target)));

  const hubs = buildSymbolGraph(db, "");
  assert.ok(hubs.nodes.filter((n) => n.role === "focus").length > 0, "hub view picks focus symbols");
  assert.ok(hubs.nodes.length >= hubs.nodes.filter((n) => n.role === "focus").length);
});
