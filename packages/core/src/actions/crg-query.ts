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
  testCoverage: string; // "unknown" | "covered" | "uncovered" | "partial"
  securityRelevant: boolean;
}

/** A risk-ranked node for the overview graph (simplified in-app risk map). */
export interface CrgRiskNode {
  qualifiedName: string;
  name: string;
  filePath: string;
  kind: string;
  lineStart: number;
  riskScore: number;
  callerCount: number;
  testCoverage: string;
  securityRelevant: boolean;
}

/** A CALLS edge between two overview nodes (both endpoints in the set). */
export interface CrgRiskEdge {
  source: string;
  target: string;
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
  /** Detect which graph nodes are in the given changed files. */
  detectChanges(root: string, changedFiles: string[]): CrgChangedFunction[];
  /** BFS from changed nodes through CALLS/REFERENCES edges. */
  getImpactRadius(root: string, qualifiedNames: string[], maxDepth: number): CrgImpactNode[];
  /** Read risk_index for the given nodes. */
  getRiskData(root: string, qualifiedNames: string[]): CrgRiskData[];
  /**
   * Risk overview for the simplified in-app risk map: the top-N nodes by
   * risk_score (with their risk attributes) plus the CALLS edges whose BOTH
   * endpoints are in that set. Empty when the graph or risk_index is absent.
   */
  getRiskOverview(root: string, limit: number): { nodes: CrgRiskNode[]; edges: CrgRiskEdge[] };
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

    detectChanges(root: string, changedFiles: string[]): CrgChangedFunction[] {
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
          return rows.map((r) => ({
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
          // Top-N by risk; the JOIN keeps only nodes that actually carry risk
          // data (an absent risk_index degrades to an empty overview).
          let nodeRows: Record<string, unknown>[];
          try {
            nodeRows = db
              .prepare(
                `SELECT n.qualified_name, n.name, n.file_path, n.kind, n.line_start,
                        r.risk_score, r.caller_count, r.test_coverage, r.security_relevant
                 FROM nodes n
                 JOIN risk_index r ON r.qualified_name = n.qualified_name
                 WHERE n.kind IN ('Function', 'Class')
                 ORDER BY r.risk_score DESC, r.caller_count DESC
                 LIMIT ${capped}`
              )
              .all() as Record<string, unknown>[];
          } catch {
            return { nodes: [], edges: [] };
          }
          const nodes: CrgRiskNode[] = nodeRows.map((r) => ({
            qualifiedName: String(r.qualified_name),
            name: String(r.name),
            filePath: String(r.file_path),
            kind: String(r.kind),
            lineStart: Number(r.line_start ?? 0),
            riskScore: Number(r.risk_score ?? 0),
            callerCount: Number(r.caller_count ?? 0),
            testCoverage: String(r.test_coverage ?? "unknown"),
            securityRelevant: Boolean(r.security_relevant),
          }));
          if (nodes.length === 0) return { nodes: [], edges: [] };
          // CALLS edges whose BOTH endpoints are in the overview set — the
          // skeleton the simplified rendering draws; edges to the rest of the
          // graph are deliberately dropped (that is the simplification).
          const names = nodes.map((n) => n.qualifiedName);
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
          return { nodes, edges };
        } finally {
          db.close();
        }
      } catch {
        return { nodes: [], edges: [] };
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

// ── Formatting helpers (for OCR delegation background injection) ────────────

/**
 * Format CRG structural analysis as a concise background string for OCR.
 * Delegation mode (2026-08-31): the string rides in two places — as
 * `--background` on `ocr delegate preview` (run metadata) and, verbatim, in
 * the host reviewer's prompt ("Business background" section), so the LLM
 * reviewer knows which functions are high-risk before it starts.
 */
export function formatCrgContextForOcr(
  changes: CrgChangedFunction[],
  risks: CrgRiskData[],
  testGaps: string[]
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
