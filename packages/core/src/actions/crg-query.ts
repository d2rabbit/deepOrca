/**
 * CRG Graph Query Layer — Node.js direct SQLite read.
 *
 * Replaces the Python MCP server (`code-review-graph serve --mcp`) for all
 * query operations. Reads `.deeporca/crg/graph.db` (legacy
 * `.code-review-graph/` readable until migrated) directly with
 * `node:sqlite` (available in Electron 43 / Node 24.18+). Zero Python
 * processes, zero IPC, zero JSON-RPC overhead.
 *
 * The graph.db schema is documented at:
 * https://github.com/tirth8205/code-review-graph/blob/main/docs/schema.md
 *
 * Only the BUILD step (tree-sitter parsing + Leiden community detection)
 * still requires Python via uv. Once graph.db exists, all queries are pure SQL.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { CRG_DATA_DIR, CRG_LEGACY_DIR as CRG_LEGACY_DATA_DIR } from "../common/generated-dirs";

// ESM-safe lazy loader for `node:sqlite` (Node ≥22.5). A bare `require(...)`
// in this ESM package is a guaranteed ReferenceError — every query then
// silently returned "no data" through its catch, which is exactly the
// "CRG graph present but produced no structural data" degradation
// (user-reported 2026-08-31). Same pattern as common/sqlite-runtime.ts.
const moduleRequire = createRequire(import.meta.url);

// ── Six-factor risk model (upstream changes.py:compute_risk_score) ─────────
// The precomputed risk_index table uses a SIMPLER model (11 keywords, binary
// coverage). The six-factor scorer below re-implements the full upstream
// factors that are expressible in SQL — flow participation, cross-community
// calls, transitive test coverage, security keywords (the FULL 24-word list
// from upstream constants.SECURITY_KEYWORDS), caller count. Churn is opt-in
// (needs `git log --numstat`) and stays off for the overview.

/** Full upstream security keyword list (constants.py — 24 entries). */
const SECURITY_KEYWORDS: readonly string[] = [
  "auth",
  "login",
  "password",
  "token",
  "session",
  "crypt",
  "secret",
  "credential",
  "permission",
  "sql",
  "query",
  "execute",
  "connect",
  "socket",
  "request",
  "http",
  "sanitize",
  "validate",
  "encrypt",
  "decrypt",
  "hash",
  "sign",
  "verify",
  "admin",
  "privilege",
];

/** Factor caps — identical to upstream compute_risk_score. */
const RISK_FLOW_CAP = 0.25;
const RISK_CROSS_COMMUNITY_CAP = 0.15;
const RISK_TEST_BASE = 0.3;
const RISK_TEST_SCALE = 0.25;
const RISK_SECURITY = 0.2;
const RISK_CALLER_CAP = 0.1;
/** Transitive test window: node AND its direct callees (upstream depth 1). */
const RISK_TEST_MAX = 5;

// ── Types ────────────────────────────────────────────────────────────────────

export interface CrgChangedFunction {
  qualifiedName: string;
  name: string;
  filePath: string;
  language: string;
  lineStart: number;
  lineEnd: number;
  kind: string; // "Function" | "Class" | "Test" | etc.
}

export interface CrgImpactNode {
  qualifiedName: string;
  name: string;
  kind: string;
  filePath: string;
  depth: number;
}

export interface CrgRiskData {
  qualifiedName: string;
  riskScore: number;
  callerCount: number;
  /** TWO vocabularies by source (review round 2026-09-01): the risk_index
   *  path emits "unknown"|"covered"|"uncovered"|"partial" (the wheel's own
   *  values); the six-factor overview emits "tested"|"untested" (computed
   *  from TESTED_BY edges). Display-only today — normalize before adding any
   *  logic that branches on the value. */
  testCoverage: string;
  securityRelevant: boolean;
}

/** A risk-ranked node for the overview graph (simplified in-app risk map). */
export interface CrgRiskNode {
  qualifiedName: string;
  name: string;
  filePath: string;
  kind: string;
  lineStart: number;
  /** Definition end line — lets consumers bind findings by line-range
   *  overlap (design spec §4.3). */
  lineEnd: number;
  riskScore: number;
  callerCount: number;
  testCoverage: string;
  securityRelevant: boolean;
  /** Community (Leiden) membership — the map's second grouping axis
   *  (design mining item ④). Absent on graphs without community data. */
  communityId?: number | null;
}

/** A CALLS edge between two overview nodes (both endpoints in the set). */
export interface CrgRiskEdge {
  source: string;
  target: string;
}

/** One inclusive changed line interval in the NEW file (git --unified=0
 *  hunks). Used for line-precise change detection (upstream
 *  `map_changes_to_nodes` semantics). */
export type ChangedLineRange = [number, number];

/** A stored execution flow that touches changed files. */
export interface CrgAffectedFlow {
  id: number;
  name: string;
  entryPoint: string;
  criticality: number;
  nodeCount: number;
  fileCount: number;
  /** Critical-path symbol chain (flow_snapshots), when available. */
  criticalPath: string[];
}

export interface CrgCommunity {
  id: number;
  name: string;
  cohesion: number;
  size: number;
  dominantLanguage: string;
  description: string;
}

export interface CrgGraphQuery {
  /**
   * Detect which graph nodes are in the given changed files. With
   * `changedRanges` (repo-relative path → changed line intervals, as parsed
   * from `git diff --unified=0`) the match is line-precise: a node counts as
   * changed only when ITS [lineStart, lineEnd] overlaps a changed interval
   * (upstream `map_changes_to_nodes`). Without ranges it falls back to
   * file-level membership (whole file changed).
   */
  detectChanges(
    root: string,
    changedFiles: string[],
    changedRanges?: Record<string, ChangedLineRange[]>
  ): CrgChangedFunction[];
  /** BFS from changed nodes through CALLS/REFERENCES edges. */
  getImpactRadius(root: string, qualifiedNames: string[], maxDepth: number): CrgImpactNode[];
  /** Read risk_index for the given nodes. */
  getRiskData(root: string, qualifiedNames: string[]): CrgRiskData[];
  /**
   * Risk overview for the simplified in-app risk map: the top-N nodes ranked
   * by the SIX-FACTOR risk model (flow participation, cross-community calls,
   * transitive test coverage, security keywords, caller count; churn is
   * opt-in and off here) plus the CALLS edges whose BOTH endpoints are in
   * that set. Falls back to the precomputed risk_index table when the
   * six-factor inputs (flows / communities) are absent. Empty when the graph
   * itself is absent.
   */
  getRiskOverview(root: string, limit: number): { nodes: CrgRiskNode[]; edges: CrgRiskEdge[] };
  /**
   * FULL node rows (file path / line range / community) for exactly the given
   * qualified names — the on-demand-review seam: findings whose CRG node sits
   * OUTSIDE the top-N overview can still be located on the graph. Missing
   * names are simply absent from the result. Never throws.
   */
  getRiskNodesByNames(root: string, qualifiedNames: string[]): CrgRiskNode[];
  /** CALLS edges whose BOTH endpoints are in the given name set. */
  getEdgesForNodes(root: string, qualifiedNames: string[]): CrgRiskEdge[];
  /**
   * Stored execution flows whose member nodes live in changed files
   * (flows + flow_memberships; flow_snapshots for the critical path).
   * Empty on graphs without flow data (v2.0+ table) — never throws.
   */
  getAffectedFlows(root: string, changedFiles: string[]): CrgAffectedFlow[];
  /** Count INHERITS/IMPLEMENTS edges touching the given nodes (Liskov risk). */
  getInheritanceEdges(root: string, qualifiedNames: string[]): number;
  /**
   * File-node content hashes for the given files (build-time `file_hash`,
   * upstream change detection) — keyed by the graph's POSIX absolute
   * identity. Empty for graphs without File nodes. Freshness probe (design
   * mining item ⑥): compare against CURRENT file contents to detect a stale
   * graph. Never throws.
   */
  getFileHashes(root: string, files: string[]): Record<string, string>;
  /** Find functions with no TESTED_BY edge. */
  getTestGaps(root: string, qualifiedNames: string[]): string[];
  /** Get community info for node IDs. */
  getCommunities(root: string, nodeIds: number[]): CrgCommunity[];
  /** True when the CRG graph.db exists (canonical or legacy location). */
  hasGraph(root: string): boolean;
}

// ── Seam ────────────────────────────────────────────────────────────────────

let queryImpl: CrgGraphQuery | null = null;

export function configureCrgGraphQuery(q: CrgGraphQuery | null): void {
  queryImpl = q;
}

export function getCrgGraphQuery(): CrgGraphQuery | null {
  return queryImpl;
}

// ── Default implementation (reads graph.db with node:sqlite) ────────────────

// Generated-content centralization (user rule 2026-08-31): the canonical
// graph lives at <root>/.deeporca/crg/; a pre-centralization graph at the
// wheel's old default <root>/.code-review-graph/ stays READABLE until the
// next build/update migrates it — queries are read-only, so serving them
// from the legacy location is safe and keeps review.full's enrichment alive
// for unmigrated projects.
const CRG_DIR = CRG_DATA_DIR;
const CRG_LEGACY_DIR = CRG_LEGACY_DATA_DIR;
const GRAPH_DB = "graph.db";

/**
 * CRG graph identity is POSIX (vendored wheel invariant #774):
 * `nodes.file_path` — and the path component of qualified names — are stored
 * as forward-slash ABSOLUTE paths on every OS (`normalize_file_path`). Host
 * paths arrive in native form on Windows (`path.resolve` → backslashes), so
 * every value compared against a db path goes through this.
 */
function toGraphPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Resolve the graph directory for a root: canonical when present, else the
 *  legacy location while it still holds a graph, else canonical (where a
 *  fresh build will create it). */
function graphDir(root: string): string {
  const canonical = path.join(root, CRG_DIR);
  if (fs.existsSync(path.join(canonical, GRAPH_DB))) return canonical;
  const legacy = path.join(root, CRG_LEGACY_DIR);
  if (fs.existsSync(path.join(legacy, GRAPH_DB))) return legacy;
  return canonical;
}

/**
 * Create a CrgGraphQuery that reads the graph.db directly.
 * Loads `node:sqlite` lazily via createRequire (stable in Electron 43's
 * bundled Node 24.18; unavailable runtimes degrade each query to empty).
 */
export function createCrgGraphQuery(): CrgGraphQuery {
  return {
    hasGraph(root: string): boolean {
      return fs.existsSync(path.join(graphDir(root), GRAPH_DB));
    },

    detectChanges(
      root: string,
      changedFiles: string[],
      changedRanges?: Record<string, ChangedLineRange[]>
    ): CrgChangedFunction[] {
      if (changedFiles.length === 0) return [];
      const dbPath = path.join(graphDir(root), GRAPH_DB);
      if (!fs.existsSync(dbPath)) return [];
      try {
        const { DatabaseSync } = moduleRequire("node:sqlite");
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          // Match nodes whose file_path is in the changed files list, in BOTH
          // spellings: the wheel's identity is POSIX-absolute (#774, see
          // toGraphPath) — native-separator paths never matched on Windows —
          // while a pre-#774 graph row may still carry the native form, so the
          // un-normalized absolute path rides along as a fallback key.
          const absFiles = changedFiles.map((f) => (path.isAbsolute(f) ? f : path.resolve(root, f)));
          const keys = [...new Set(absFiles.flatMap((f) => [toGraphPath(f), f]))];
          const placeholders = keys.map(() => "?").join(",");
          const stmt = db.prepare(
            `SELECT qualified_name, name, file_path, language, line_start, line_end, kind
             FROM nodes
             WHERE file_path IN (${placeholders}) AND kind IN ('Function', 'Class', 'Test', 'Type')
             ORDER BY file_path, line_start`
          );
          const rows = stmt.all(...keys) as Record<string, unknown>[];

          // Line-precise narrowing (upstream `map_changes_to_nodes`, design
          // spec mining item ①): a node counts as changed only when its
          // definition range OVERLAPS a changed interval. Repo-relative
          // range keys resolve into the graph's POSIX identity — the same
          // spelling normalization as the file keys above.
          let rangesByKey: Map<string, ChangedLineRange[]> | null = null;
          if (changedRanges && Object.keys(changedRanges).length > 0) {
            rangesByKey = new Map();
            for (const [rel, ranges] of Object.entries(changedRanges)) {
              const abs = path.isAbsolute(rel) ? rel : path.resolve(root, rel);
              rangesByKey.set(toGraphPath(abs), ranges);
            }
          }

          return rows
            .filter((r) => {
              if (!rangesByKey) return true;
              const ranges = rangesByKey.get(toGraphPath(String(r.file_path)));
              // Files WITHOUT hunk intervals (untracked workspace files, mode
              // -only changes, deletions — none appear in `git diff`) fall
              // back to FILE-level detection: membership in changedFiles was
              // already established by the IN clause above, and dropping them
              // here would silently strip the most common working state of
              // its structural enrichment (review round 2026-09-01). Ranges
              // only NARROW files that have them.
              if (!ranges || ranges.length === 0) return true;
              const lineStart = Number(r.line_start ?? 0);
              const lineEnd = Number(r.line_end ?? 0);
              return ranges.some(([start, end]) => lineStart <= end && lineEnd >= start);
            })
            .map((r) => ({
              qualifiedName: String(r.qualified_name),
              name: String(r.name),
              filePath: String(r.file_path),
              language: String(r.language ?? ""),
              lineStart: Number(r.line_start ?? 0),
              lineEnd: Number(r.line_end ?? 0),
              kind: String(r.kind),
            }));
        } finally {
          db.close();
        }
      } catch {
        return [];
      }
    },

    getImpactRadius(root: string, qualifiedNames: string[], maxDepth: number): CrgImpactNode[] {
      if (qualifiedNames.length === 0) return [];
      const dbPath = path.join(graphDir(root), GRAPH_DB);
      if (!fs.existsSync(dbPath)) return [];
      try {
        const { DatabaseSync } = moduleRequire("node:sqlite");
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          // BFS through CALLS edges (source calls target → changing source affects target's callers).
          // Also follow REFERENCES and DEPENDS_ON edges.
          const visited = new Set<string>();
          const result: CrgImpactNode[] = [];
          let frontier = [...qualifiedNames];
          for (let depth = 1; depth <= maxDepth; depth++) {
            if (frontier.length === 0) break;
            const placeholders = frontier.map(() => "?").join(",");
            // Find callers (who calls the changed functions) + references.
            const stmt = db.prepare(
              `SELECT DISTINCT n.qualified_name, n.name, n.kind, n.file_path
               FROM edges e
               JOIN nodes n ON e.source_qualified = n.qualified_name
               WHERE e.target_qualified IN (${placeholders})
               AND e.kind IN ('CALLS', 'REFERENCES', 'DEPENDS_ON', 'INHERITS', 'IMPLEMENTS')
               AND n.qualified_name NOT IN (${
                 Array.from(visited)
                   .map(() => "?")
                   .join(",") || "''"
               })`
            );
            const excludeParams = frontier.length > 0 ? [...frontier, ...visited] : [...visited];
            const rows = stmt.all(...excludeParams) as Record<string, unknown>[];
            const nextFrontier: string[] = [];
            for (const r of rows) {
              const qn = String(r.qualified_name);
              if (!visited.has(qn)) {
                visited.add(qn);
                nextFrontier.push(qn);
                result.push({
                  qualifiedName: qn,
                  name: String(r.name),
                  kind: String(r.kind),
                  filePath: String(r.file_path),
                  depth,
                });
              }
            }
            frontier = nextFrontier;
          }
          return result;
        } finally {
          db.close();
        }
      } catch {
        return [];
      }
    },

    getRiskData(root: string, qualifiedNames: string[]): CrgRiskData[] {
      if (qualifiedNames.length === 0) return [];
      const dbPath = path.join(graphDir(root), GRAPH_DB);
      if (!fs.existsSync(dbPath)) return [];
      try {
        const { DatabaseSync } = moduleRequire("node:sqlite");
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const placeholders = qualifiedNames.map(() => "?").join(",");
          // risk_index table may not exist in older graphs — guard with try/catch.
          let stmt;
          try {
            stmt = db.prepare(
              `SELECT qualified_name, risk_score, caller_count, test_coverage, security_relevant
               FROM risk_index
               WHERE qualified_name IN (${placeholders})`
            );
          } catch {
            // Table doesn't exist — return default risk data.
            return qualifiedNames.map((qn) => ({
              qualifiedName: qn,
              riskScore: 0,
              callerCount: 0,
              testCoverage: "unknown",
              securityRelevant: false,
            }));
          }
          const rows = stmt.all(...qualifiedNames) as Record<string, unknown>[];
          return rows.map((r) => ({
            qualifiedName: String(r.qualified_name),
            riskScore: Number(r.risk_score ?? 0),
            callerCount: Number(r.caller_count ?? 0),
            testCoverage: String(r.test_coverage ?? "unknown"),
            securityRelevant: Boolean(r.security_relevant),
          }));
        } finally {
          db.close();
        }
      } catch {
        return [];
      }
    },

    getTestGaps(root: string, qualifiedNames: string[]): string[] {
      if (qualifiedNames.length === 0) return [];
      const dbPath = path.join(graphDir(root), GRAPH_DB);
      if (!fs.existsSync(dbPath)) return [];
      try {
        const { DatabaseSync } = moduleRequire("node:sqlite");
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const placeholders = qualifiedNames.map(() => "?").join(",");
          // Functions that have NO TESTED_BY edge.
          const stmt = db.prepare(
            `SELECT n.qualified_name
             FROM nodes n
             WHERE n.qualified_name IN (${placeholders})
             AND n.kind = 'Function'
             AND NOT EXISTS (
               SELECT 1 FROM edges e
               WHERE e.source_qualified = n.qualified_name
               AND e.kind = 'TESTED_BY'
             )`
          );
          const rows = stmt.all(...qualifiedNames) as Record<string, unknown>[];
          return rows.map((r) => String(r.qualified_name));
        } finally {
          db.close();
        }
      } catch {
        return [];
      }
    },

    getRiskOverview(root: string, limit: number): { nodes: CrgRiskNode[]; edges: CrgRiskEdge[] } {
      const capped = Math.max(1, Math.min(200, Math.floor(limit)));
      const dbPath = path.join(graphDir(root), GRAPH_DB);
      if (!fs.existsSync(dbPath)) return { nodes: [], edges: [] };
      try {
        const { DatabaseSync } = moduleRequire("node:sqlite");
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          // Six-factor model first (mining item ②): flow participation,
          // cross-community calls, transitive tests, the FULL security
          // keyword list and caller count — each factor degrades to 0 on
          // its own query failure (older graphs lack flows/communities), and
          // an empty candidate set falls back to the precomputed
          // risk_index table (the original simplified model).
          const nodes = overviewFromSixFactors(db, capped);
          const source = nodes.length > 0 ? nodes : overviewFromRiskIndex(db, capped);
          if (source.length === 0) return { nodes: [], edges: [] };
          return {
            nodes: source,
            edges: overviewEdges(
              db,
              source.map((n) => n.qualifiedName)
            ),
          };
        } finally {
          db.close();
        }
      } catch {
        return { nodes: [], edges: [] };
      }
    },

    getRiskNodesByNames(root: string, qualifiedNames: string[]): CrgRiskNode[] {
      if (qualifiedNames.length === 0) return [];
      const dbPath = path.join(graphDir(root), GRAPH_DB);
      if (!fs.existsSync(dbPath)) return [];
      try {
        const { DatabaseSync } = moduleRequire("node:sqlite");
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const ph = qualifiedNames.map(() => "?").join(",");
          const rows = db
            .prepare(
              `SELECT n.qualified_name, n.name, n.file_path, n.line_start, n.line_end, n.kind, n.community_id,
                      COALESCE(ri.risk_score, 0) AS risk_score,
                      COALESCE(ri.caller_count, 0) AS caller_count,
                      COALESCE(ri.test_coverage, 'unknown') AS test_coverage,
                      COALESCE(ri.security_relevant, 0) AS security_relevant
               FROM nodes n
               LEFT JOIN risk_index ri ON ri.qualified_name = n.qualified_name
               WHERE n.qualified_name IN (${ph})`
            )
            .all(...qualifiedNames) as Record<string, unknown>[];
          return rows.map((r) => ({
            qualifiedName: String(r.qualified_name),
            name: String(r.name ?? r.qualified_name),
            filePath: String(r.file_path ?? ""),
            kind: String(r.kind ?? "Function"),
            lineStart: Number(r.line_start ?? 0),
            lineEnd: Number(r.line_end ?? r.line_start ?? 0),
            riskScore: Number(r.risk_score ?? 0),
            callerCount: Number(r.caller_count ?? 0),
            testCoverage: String(r.test_coverage ?? "unknown"),
            securityRelevant: Boolean(r.security_relevant),
            communityId: r.community_id == null ? null : Number(r.community_id),
          }));
        } finally {
          db.close();
        }
      } catch {
        return [];
      }
    },

    getEdgesForNodes(root: string, qualifiedNames: string[]): CrgRiskEdge[] {
      if (qualifiedNames.length < 2) return [];
      const dbPath = path.join(graphDir(root), GRAPH_DB);
      if (!fs.existsSync(dbPath)) return [];
      try {
        const { DatabaseSync } = moduleRequire("node:sqlite");
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const ph = qualifiedNames.map(() => "?").join(",");
          const rows = db
            .prepare(
              `SELECT DISTINCT e.source_qualified, e.target_qualified
               FROM edges e
               WHERE e.kind = 'CALLS'
               AND e.source_qualified IN (${ph})
               AND e.target_qualified IN (${ph})`
            )
            .all(...qualifiedNames, ...qualifiedNames) as Record<string, unknown>[];
          return rows.map((r) => ({
            source: String(r.source_qualified),
            target: String(r.target_qualified),
          }));
        } finally {
          db.close();
        }
      } catch {
        return [];
      }
    },

    getAffectedFlows(root: string, changedFiles: string[]): CrgAffectedFlow[] {
      if (changedFiles.length === 0) return [];
      const dbPath = path.join(graphDir(root), GRAPH_DB);
      if (!fs.existsSync(dbPath)) return [];
      try {
        const { DatabaseSync } = moduleRequire("node:sqlite");
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const absFiles = changedFiles.map((f) => (path.isAbsolute(f) ? f : path.resolve(root, f)));
          const keys = [...new Set(absFiles.flatMap((f) => [toGraphPath(f), f]))];
          const ph = keys.map(() => "?").join(",");
          // flows/flow_memberships are v2.0+ — older graphs simply have no
          // flow data (degrade to [] instead of failing the caller).
          let rows: Record<string, unknown>[];
          try {
            rows = db
              .prepare(
                `SELECT DISTINCT f.id AS fid, f.name AS fname, f.entry_point_id, f.criticality,
                        f.node_count, f.file_count
                 FROM flows f
                 JOIN flow_memberships fm ON fm.flow_id = f.id
                 JOIN nodes n ON n.id = fm.node_id
                 WHERE n.file_path IN (${ph})`
              )
              .all(...keys) as Record<string, unknown>[];
          } catch {
            return [];
          }
          if (rows.length === 0) return [];

          // Entry-point names + critical-path chains (flow_snapshots, v6).
          const flowIds = [...new Set(rows.map((r) => Number(r.fid)))];
          const entryIds = [...new Set(rows.map((r) => Number(r.entry_point_id)))];
          const nameById = new Map<number, string>();
          if (entryIds.length > 0) {
            try {
              const eph = entryIds.map(() => "?").join(",");
              for (const r of db.prepare(`SELECT id, name FROM nodes WHERE id IN (${eph})`).all(...entryIds) as Record<
                string,
                unknown
              >[]) {
                nameById.set(Number(r.id), String(r.name));
              }
            } catch {
              // entry names are cosmetic
            }
          }
          const pathByFlow = new Map<number, string[]>();
          if (flowIds.length > 0) {
            try {
              const fph = flowIds.map(() => "?").join(",");
              for (const r of db
                .prepare(`SELECT flow_id, critical_path FROM flow_snapshots WHERE flow_id IN (${fph})`)
                .all(...flowIds) as Record<string, unknown>[]) {
                try {
                  const arr = JSON.parse(String(r.critical_path ?? "[]")) as unknown;
                  if (Array.isArray(arr)) {
                    pathByFlow.set(
                      Number(r.flow_id),
                      arr.filter((x): x is string => typeof x === "string").slice(0, 5)
                    );
                  }
                } catch {
                  // malformed snapshot — skip the chain
                }
              }
            } catch {
              // flow_snapshots absent — chains stay empty
            }
          }
          const out = new Map<number, CrgAffectedFlow>();
          for (const r of rows) {
            const id = Number(r.fid);
            const entry = nameById.get(Number(r.entry_point_id)) ?? `node:${r.entry_point_id}`;
            out.set(id, {
              id,
              name: String(r.fname),
              entryPoint: entry,
              criticality: Number(r.criticality ?? 0),
              nodeCount: Number(r.node_count ?? 0),
              fileCount: Number(r.file_count ?? 0),
              criticalPath: pathByFlow.get(id) ?? [],
            });
          }
          return [...out.values()];
        } finally {
          db.close();
        }
      } catch {
        return [];
      }
    },

    getInheritanceEdges(root: string, qualifiedNames: string[]): number {
      if (qualifiedNames.length === 0) return 0;
      const dbPath = path.join(graphDir(root), GRAPH_DB);
      if (!fs.existsSync(dbPath)) return 0;
      try {
        const { DatabaseSync } = moduleRequire("node:sqlite");
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const q = qualifiedNames.map(() => "?").join(",");
          const row = db
            .prepare(
              `SELECT COUNT(*) AS c FROM edges
               WHERE kind IN ('INHERITS', 'IMPLEMENTS')
               AND (source_qualified IN (${q}) OR target_qualified IN (${q}))`
            )
            .get(...qualifiedNames, ...qualifiedNames) as { c?: number } | undefined;
          return Number(row?.c ?? 0);
        } finally {
          db.close();
        }
      } catch {
        return 0;
      }
    },

    getFileHashes(root: string, files: string[]): Record<string, string> {
      if (files.length === 0) return {};
      const dbPath = path.join(graphDir(root), GRAPH_DB);
      if (!fs.existsSync(dbPath)) return {};
      try {
        const { DatabaseSync } = moduleRequire("node:sqlite");
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const absFiles = files.map((f) => (path.isAbsolute(f) ? f : path.resolve(root, f)));
          const keys = [...new Set(absFiles.flatMap((f) => [toGraphPath(f), f]))];
          const q = keys.map(() => "?").join(",");
          // File nodes store name == file_path == the absolute path (#774
          // spelling); absent kind='File' rows (older graphs) degrade to {}.
          const rows = db
            .prepare(`SELECT file_path, file_hash FROM nodes WHERE kind = 'File' AND file_path IN (${q})`)
            .all(...keys) as Record<string, unknown>[];
          const out: Record<string, string> = {};
          for (const r of rows) {
            const hash = r.file_hash;
            if (typeof hash === "string" && hash) out[toGraphPath(String(r.file_path))] = hash;
          }
          return out;
        } finally {
          db.close();
        }
      } catch {
        return {};
      }
    },

    getCommunities(root: string, nodeIds: number[]): CrgCommunity[] {
      if (nodeIds.length === 0) return [];
      const dbPath = path.join(graphDir(root), GRAPH_DB);
      if (!fs.existsSync(dbPath)) return [];
      try {
        const { DatabaseSync } = moduleRequire("node:sqlite");
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const placeholders = nodeIds.map(() => "?").join(",");
          let stmt;
          try {
            stmt = db.prepare(
              `SELECT id, name, cohesion, size, dominant_language, description
               FROM communities
               WHERE id IN (${placeholders})`
            );
          } catch {
            return [];
          }
          const rows = stmt.all(...nodeIds) as Record<string, unknown>[];
          return rows.map((r) => ({
            id: Number(r.id),
            name: String(r.name ?? ""),
            cohesion: Number(r.cohesion ?? 0),
            size: Number(r.size ?? 0),
            dominantLanguage: String(r.dominant_language ?? ""),
            description: String(r.description ?? ""),
          }));
        } finally {
          db.close();
        }
      } catch {
        return [];
      }
    },
  };
}

// ── Overview scoring helpers (module-level, share a live db handle) ─────────

type OverviewDb = {
  prepare: (sql: string) => { all: (...args: unknown[]) => Record<string, unknown>[] };
};

/** The precomputed simplified model — the historical overview ranking. */
function overviewFromRiskIndex(db: OverviewDb, capped: number): CrgRiskNode[] {
  let nodeRows: Record<string, unknown>[];
  try {
    nodeRows = db
      .prepare(
        `SELECT n.qualified_name, n.name, n.file_path, n.kind, n.line_start, n.line_end,
                r.risk_score, r.caller_count, r.test_coverage, r.security_relevant
         FROM nodes n
         JOIN risk_index r ON r.qualified_name = n.qualified_name
         WHERE n.kind IN ('Function', 'Class')
         ORDER BY r.risk_score DESC, r.caller_count DESC
         LIMIT ${capped}`
      )
      .all() as Record<string, unknown>[];
  } catch {
    return [];
  }
  return nodeRows.map((r) => ({
    qualifiedName: String(r.qualified_name),
    name: String(r.name),
    filePath: String(r.file_path),
    kind: String(r.kind),
    lineStart: Number(r.line_start ?? 0),
    lineEnd: Number(r.line_end ?? 0),
    riskScore: Number(r.risk_score ?? 0),
    callerCount: Number(r.caller_count ?? 0),
    testCoverage: String(r.test_coverage ?? "unknown"),
    securityRelevant: Boolean(r.security_relevant),
    communityId: r.community_id == null ? null : Number(r.community_id),
  }));
}

/**
 * Full six-factor ranking (mining item ②, upstream `compute_risk_score`):
 *   flow participation  min(Σ criticality, 0.25)
 *   cross-community     min(cross-community CALLERS × 0.05, 0.15)
 *   test coverage       0.30 − min(direct+transitive tests / 5, 1) × 0.25
 *   security keywords   0.20 (FULL 24-word list — risk_index only has 11)
 *   caller count        min(callers / 20, 0.10)
 * (churn is opt-in upstream — needs `git log`, stays off here)
 *
 * Degradation: the base query only touches `nodes`/`edges` (core schema);
 * the flow and caller-community factors each load through their OWN
 * try/catch below, so a graph missing `flows`/`flow_memberships` or
 * `community_id` zeroes just that factor instead of failing the run.
 *
 * Deliberate deviations from upstream (documented, review round 2026-09-01):
 *   - cross-community counts DISTINCT caller COMMUNITIES, upstream counts
 *     every cross-community caller (over-counts when callers cluster);
 *   - transitive tests have no upstream frontier cap (upstream stops at 50);
 *   - no `min(count × 0.05, 0.25)` fallback when a node has no criticality.
 * All three shift scores only within the factor caps.
 */
function overviewFromSixFactors(db: OverviewDb, capped: number): CrgRiskNode[] {
  let baseRows: Record<string, unknown>[];
  try {
    baseRows = db
      .prepare(
        `SELECT n.id AS node_id, n.qualified_name, n.name, n.file_path, n.line_start, n.line_end,
                n.kind, n.community_id,
                COALESCE(caller.cnt, 0) AS caller_count,
                COALESCE(tested_direct.cnt, 0) AS direct_tests,
                COALESCE(tested_trans.cnt, 0) AS transitive_tests
         FROM nodes n
         LEFT JOIN (SELECT target_qualified, COUNT(*) AS cnt FROM edges WHERE kind = 'CALLS' GROUP BY target_qualified) caller
           ON caller.target_qualified = n.qualified_name
         LEFT JOIN (SELECT source_qualified, COUNT(*) AS cnt FROM edges WHERE kind = 'TESTED_BY' GROUP BY source_qualified) tested_direct
           ON tested_direct.source_qualified = n.qualified_name
         LEFT JOIN (
           SELECT e1.source_qualified, COUNT(DISTINCT e2.source_qualified) AS cnt
           FROM edges e1
           JOIN edges e2 ON e2.source_qualified = e1.target_qualified AND e2.kind = 'TESTED_BY'
           WHERE e1.kind = 'CALLS'
           GROUP BY e1.source_qualified
         ) tested_trans ON tested_trans.source_qualified = n.qualified_name
         WHERE n.kind IN ('Function', 'Class')`
      )
      .all() as Record<string, unknown>[];
  } catch {
    return [];
  }
  if (baseRows.length === 0) return [];

  // Flow participation — its own query so a graph without the flow tables
  // (older wheels) zeroes the factor instead of failing the whole overview.
  const flowCrit = new Map<string, number>();
  try {
    for (const r of db
      .prepare(
        `SELECT fm.node_id, SUM(f.criticality) AS crit
         FROM flow_memberships fm JOIN flows f ON f.id = fm.flow_id
         GROUP BY fm.node_id`
      )
      .all() as Record<string, unknown>[]) {
      flowCrit.set(String(r.node_id), Number(r.crit) || 0);
    }
  } catch {
    // older graphs simply have no flow data (degrade to [] — factor stays 0)
  }

  const callerComm = new Map<string, Set<number>>();
  const nodeComm = new Map<string, number | null>();
  for (const r of baseRows) {
    nodeComm.set(String(r.qualified_name), r.community_id == null ? null : Number(r.community_id));
  }
  try {
    // Caller community per target — cross-community = caller cid != node cid.
    for (const r of db
      .prepare(
        `SELECT e.target_qualified, n.community_id AS cid
         FROM edges e
         JOIN nodes n ON n.qualified_name = e.source_qualified
         WHERE e.kind = 'CALLS' AND n.community_id IS NOT NULL`
      )
      .all() as Record<string, unknown>[]) {
      const t = String(r.target_qualified);
      const cid = Number(r.cid);
      const set = callerComm.get(t) ?? new Set<number>();
      set.add(cid);
      callerComm.set(t, set);
    }
  } catch {
    // community data unavailable — factor stays 0
  }

  const rows = baseRows
    .map((r) => {
      const qn = String(r.qualified_name);
      const name = String(r.name);
      const qnLower = `${name} ${qn}`.toLowerCase();

      const flowScore = Math.min(flowCrit.get(String(r.node_id)) ?? 0, RISK_FLOW_CAP);

      const myCid = nodeComm.get(qn) ?? null;
      let cross = 0;
      if (myCid !== null) {
        const cids = callerComm.get(qn);
        if (cids) for (const cid of cids) if (cid !== myCid) cross++;
      }
      const crossScore = Math.min(cross * 0.05, RISK_CROSS_COMMUNITY_CAP);

      const testCount = Number(r.direct_tests ?? 0) + Number(r.transitive_tests ?? 0);
      const testScore = RISK_TEST_BASE - Math.min(testCount / RISK_TEST_MAX, 1) * RISK_TEST_SCALE;

      const secRelevant = SECURITY_KEYWORDS.some((kw) => qnLower.includes(kw));
      const secScore = secRelevant ? RISK_SECURITY : 0;

      const caller = Number(r.caller_count ?? 0);
      const callerScore = Math.min(caller / 20, RISK_CALLER_CAP);

      const score = Math.min(Math.max(flowScore + crossScore + testScore + secScore + callerScore, 0), 1);
      return {
        qualifiedName: qn,
        name,
        filePath: String(r.file_path),
        kind: String(r.kind),
        lineStart: Number(r.line_start ?? 0),
        lineEnd: Number(r.line_end ?? 0),
        riskScore: Math.round(score * 10000) / 10000,
        callerCount: caller,
        testCoverage: testCount > 0 ? "tested" : "untested",
        securityRelevant: secRelevant,
        communityId: r.community_id == null ? null : Number(r.community_id),
      };
    })
    .filter((n) => n.filePath)
    .sort((a, b) => b.riskScore - a.riskScore || b.callerCount - a.callerCount)
    .slice(0, capped);
  return rows;
}

/** CALLS edges whose BOTH endpoints are in the overview set. */
function overviewEdges(db: OverviewDb, names: string[]): CrgRiskEdge[] {
  const inSet = new Set(names);
  const q = names.map(() => "?").join(",");
  const edgeRows = db
    .prepare(
      `SELECT e.source_qualified, e.target_qualified
       FROM edges e
       WHERE e.kind = 'CALLS'
       AND e.source_qualified IN (${q})
       AND e.target_qualified IN (${q})`
    )
    .all(...names, ...names) as Record<string, unknown>[];
  const edges: CrgRiskEdge[] = [];
  const seen = new Set<string>();
  for (const r of edgeRows) {
    const source = String(r.source_qualified);
    const target = String(r.target_qualified);
    if (!inSet.has(source) || !inSet.has(target) || source === target) continue;
    const key = `${source}\u0000${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source, target });
  }
  return edges;
}

// ── Formatting helpers (for OCR delegation background injection) ────────────

/**
 * Format CRG structural analysis as a concise background string for OCR.
 * Delegation mode (2026-08-31): the string rides in two places — as
 * `--background` on `ocr delegate preview` (run metadata) and, verbatim, in
 * the host reviewer's prompt ("Business background" section), so the LLM
 * reviewer knows which functions are high-risk before it starts.
 *
 * Mining item ⑤ (design spec §5): the upstream `_generate_review_guidance`
 * rule set — affected execution flows, wide blast radius, inheritance /
 * implementation edges and cross-file spread — renders as explicit review
 * directives below the factual listing, so the reviewer's attention follows
 * the structural evidence.
 */
export interface CrgContextExtras {
  /** Stored execution flows touching the changed files. */
  flows?: CrgAffectedFlow[];
  /** Impact-radius node count (BFS depth 2) — wide blast radius warning. */
  impactedCount?: number;
  /** INHERITS/IMPLEMENTS edges touching the changed nodes (Liskov risk). */
  inheritanceCount?: number;
  /** Changed file count — cross-file spread / PR-size signal. */
  changedFileCount?: number;
  /** Frequently-changed files in the change set (churn hotspot, minimal
   *  form: advisory only — does not enter the score). */
  churnHotspots?: { file: string; commits: number }[];
}

export function formatCrgContextForOcr(
  changes: CrgChangedFunction[],
  risks: CrgRiskData[],
  testGaps: string[],
  extra?: CrgContextExtras
): string {
  if (changes.length === 0) return "";

  const riskMap = new Map(risks.map((r) => [r.qualifiedName, r]));
  const lines: string[] = [
    "Structural code analysis (from Code Review Graph):",
    `${changes.length} function(s) affected by this change.`,
  ];

  // Group by risk level.
  const high = changes.filter((c) => (riskMap.get(c.qualifiedName)?.riskScore ?? 0) >= 0.7);
  const medium = changes.filter((c) => {
    const s = riskMap.get(c.qualifiedName)?.riskScore ?? 0;
    return s >= 0.3 && s < 0.7;
  });

  if (high.length > 0) {
    lines.push(`\nHIGH RISK (${high.length}):`);
    for (const c of high) {
      const r = riskMap.get(c.qualifiedName);
      lines.push(
        `  - ${c.name} (${c.filePath}:${c.lineStart}): ${r?.callerCount ?? 0} callers` +
          (r?.securityRelevant ? ", security-sensitive" : "")
      );
    }
  }

  if (medium.length > 0) {
    lines.push(`\nMEDIUM RISK (${medium.length}):`);
    for (const c of medium.slice(0, 10)) {
      const r = riskMap.get(c.qualifiedName);
      lines.push(`  - ${c.name} (${c.filePath}:${c.lineStart}): ${r?.callerCount ?? 0} callers`);
    }
    if (medium.length > 10) lines.push(`  ... and ${medium.length - 10} more`);
  }

  if (testGaps.length > 0) {
    lines.push(`\nTEST GAPS (${testGaps.length}):`);
    lines.push(
      `  ${testGaps
        .slice(0, 10)
        .map((q) => q.split("::").pop())
        .join(", ")}` + (testGaps.length > 10 ? `, ... and ${testGaps.length - 10} more` : "")
    );
  }

  if (extra && extra.flows && extra.flows.length > 0) {
    lines.push(`\nIMPACTED FLOWS (${extra.flows.length}):`);
    for (const f of extra.flows.slice(0, 5)) {
      const chain = f.criticalPath.length > 0 ? ` — ${f.criticalPath.join(" → ")}` : "";
      lines.push(`  - ${f.name} (criticality ${f.criticality.toFixed(2)}): ${f.entryPoint}${chain}`);
    }
  }

  // Upstream guidance rules (tools/review.py:_generate_review_guidance).
  if (extra && extra.impactedCount != null && extra.impactedCount > 20) {
    lines.push(
      `\nWIDE BLAST RADIUS: ${extra.impactedCount} nodes impacted within 2 hops — ` +
        "review callers and dependents carefully."
    );
  }
  if (extra && (extra.inheritanceCount ?? 0) > 0) {
    lines.push(
      `\nINHERITANCE: ${extra.inheritanceCount} inheritance/implementation relationship(s) ` +
        "affected — check for Liskov substitution violations."
    );
  }
  if (extra && (extra.changedFileCount ?? 0) > 3) {
    lines.push(
      `\nSPREAD: changes touch ${extra.changedFileCount} files — consider whether the change ` +
        "should be split into smaller PRs."
    );
  }
  if (extra && extra.churnHotspots && extra.churnHotspots.length > 0) {
    lines.push(
      "\nCHURN HOTSPOTS (changes in the last 90 days): " +
        extra.churnHotspots
          .slice(0, 5)
          .map((h) => `${h.file} (${h.commits} commits)`)
          .join(", ")
    );
  }

  lines.push(
    "\nFocus review on: backward compatibility for high-caller functions, " +
      "test coverage for untested changes, security implications for security-relevant code."
  );

  return lines.join("\n");
}

/**
 * Merge OCR review comments with CRG risk data.
 * Tags each comment with the risk level of the function it references.
 *
 * Path shapes (review round 2026-09-01): OCR comments carry git-style
 * REPO-RELATIVE paths (the preview's bullets, echoed back by the host model),
 * while `changes[].filePath` carries the graph's POSIX-ABSOLUTE identity.
 * Comparing them verbatim never matches — pass `projectRoot` so comment paths
 * are resolved into graph form before lookup.
 */
export function mergeReviewWithCrgRisk(
  reviewComments: { path: string; startLine: number; content: string; suggestionCode?: string }[],
  risks: CrgRiskData[],
  changes: CrgChangedFunction[],
  projectRoot?: string
): { path: string; startLine: number; content: string; suggestionCode?: string; crgRisk?: string }[] {
  const riskMap = new Map(risks.map((r) => [r.qualifiedName, r]));
  // Build a filePath → risk lookup from changes (keys in graph form).
  const fileRiskMap = new Map<string, CrgRiskData>();
  for (const c of changes) {
    const r = riskMap.get(c.qualifiedName);
    if (r) fileRiskMap.set(toGraphPath(c.filePath), r);
  }

  return reviewComments.map((comment) => {
    const inGraphForm = projectRoot
      ? toGraphPath(path.isAbsolute(comment.path) ? comment.path : path.resolve(projectRoot, comment.path))
      : comment.path;
    const risk = fileRiskMap.get(inGraphForm) ?? fileRiskMap.get(comment.path);
    let crgRisk: string | undefined;
    if (risk) {
      if (risk.riskScore >= 0.7) crgRisk = `HIGH (${risk.callerCount} callers)`;
      else if (risk.riskScore >= 0.3) crgRisk = `MEDIUM (${risk.callerCount} callers)`;
      else crgRisk = `LOW`;
    }
    return { ...comment, crgRisk };
  });
}
