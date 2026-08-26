/**
 * Symbol relationship graph query (knowledge R3-6) — pure function over a
 * CodeGraph index database. Extracted from the IPC handler for testability
 * against real index files.
 *
 * Display-layer only: builds a callers|focus|callees neighborhood for HUMAN
 * viewing; the agent-facing CodeGraph MCP tools never go through here.
 */

import type { KnowledgeSymbolGraph, KnowledgeSymbolGraphEdge, KnowledgeSymbolGraphNode } from "../shared/ipc";

/** Minimal DatabaseSync surface this query needs (node:sqlite compatible). */
export interface SqliteDb {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

/** Relationship edge kinds surfaced in the graph ("contains" is file nesting, not a link). */
const REL = "('calls','references','instantiates','implements')";
/** Per-direction edge cap before the result is marked truncated. */
const EDGE_CAP = 300;

type NodeRow = { id: string; name: string; kind: string; file_path: string };
type EdgeRow = { source: string; target: string; kind: string };

export function buildSymbolGraph(db: SqliteDb, query?: string): KnowledgeSymbolGraph {
  const trimmed = (query ?? "").trim();
  // Focus set: query matches, else the most-referenced non-file symbols
  // (in-degree hubs — the "what is this codebase wired around" default view).
  const focusRows = trimmed
    ? (db
        .prepare(
          "SELECT id, name, kind, file_path FROM nodes WHERE (name LIKE ? OR qualified_name LIKE ?) AND kind NOT IN ('import','unknown','file') ORDER BY name LIMIT 12"
        )
        .all(`%${trimmed}%`, `%${trimmed}%`) as NodeRow[])
    : (db
        .prepare(
          `SELECT n.id, n.name, n.kind, n.file_path, COUNT(*) AS deg
           FROM nodes n JOIN edges e ON e.target = n.id
           WHERE n.kind NOT IN ('import','unknown','file') AND e.kind IN ('calls','references','instantiates')
           GROUP BY n.id ORDER BY deg DESC LIMIT 10`
        )
        .all() as (NodeRow & { deg: number })[]);
  if (focusRows.length === 0) return { nodes: [], edges: [], truncated: false };
  const focusIds = focusRows.map((r) => r.id);

  const placeholders = focusIds.map(() => "?").join(",");
  const inRows = db
    .prepare(
      `SELECT source, target, kind FROM edges WHERE target IN (${placeholders}) AND kind IN ${REL} LIMIT ${EDGE_CAP}`
    )
    .all(...focusIds) as EdgeRow[];
  const outRows = db
    .prepare(
      `SELECT source, target, kind FROM edges WHERE source IN (${placeholders}) AND kind IN ${REL} LIMIT ${EDGE_CAP}`
    )
    .all(...focusIds) as EdgeRow[];

  const nodeIds = new Set<string>(focusIds);
  for (const e of [...inRows, ...outRows]) {
    nodeIds.add(e.source);
    nodeIds.add(e.target);
  }
  const nodeRows = (
    db
      .prepare(`SELECT id, name, kind, file_path FROM nodes WHERE id IN (${[...nodeIds].map(() => "?").join(",")})`)
      .all(...nodeIds) as NodeRow[]
  ).filter((n) => n.kind !== "import");
  const byId = new Map(nodeRows.map((n) => [n.id, n]));

  const nodes: KnowledgeSymbolGraphNode[] = nodeRows.map((n) => ({
    id: n.id,
    name: n.name,
    kind: n.kind,
    filePath: n.file_path,
    // Callers are the SOURCES of edges into the focus set; the target of an
    // in-edge is always a focus node, so testing e.target here (the original
    // inline-handler bug, caught by the functional test) never matched.
    role: focusIds.includes(n.id) ? "focus" : inRows.some((e) => e.source === n.id) ? "caller" : "callee",
  }));

  const allowedKinds = new Set(["calls", "references", "instantiates", "implements"]);
  const seen = new Set<string>();
  const edges: KnowledgeSymbolGraphEdge[] = [];
  for (const e of [...inRows, ...outRows]) {
    if (!allowedKinds.has(e.kind) || !byId.has(e.source) || !byId.has(e.target)) continue;
    const key = `${e.source}→${e.target}:${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: e.source, target: e.target, kind: e.kind as KnowledgeSymbolGraphEdge["kind"] });
  }
  const truncated = inRows.length >= EDGE_CAP || outRows.length >= EDGE_CAP;
  return { nodes, edges, truncated };
}
