/**
 * CRG Graph Query Layer — Node.js direct SQLite read.
 *
 * Replaces the Python MCP server (`code-review-graph serve --mcp`) for all
 * query operations. Reads `.code-review-graph/graph.db` directly with
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
  /** Find functions with no TESTED_BY edge. */
  getTestGaps(root: string, qualifiedNames: string[]): string[];
  /** Get community info for node IDs. */
  getCommunities(root: string, nodeIds: number[]): CrgCommunity[];
  /** True when .code-review-graph/graph.db exists. */
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

const CRG_DIR = ".code-review-graph";
const GRAPH_DB = "graph.db";

/**
 * Create a CrgGraphQuery that reads the graph.db directly.
 * Uses dynamic import of node:sqlite (experimental in some Node versions,
 * but stable in Electron 43's bundled Node 24.18).
 */
export function createCrgGraphQuery(): CrgGraphQuery {
  return {
    hasGraph(root: string): boolean {
      return fs.existsSync(path.join(root, CRG_DIR, GRAPH_DB));
    },

    detectChanges(root: string, changedFiles: string[]): CrgChangedFunction[] {
      if (changedFiles.length === 0) return [];
      const dbPath = path.join(root, CRG_DIR, GRAPH_DB);
      if (!fs.existsSync(dbPath)) return [];
      try {
        const { DatabaseSync } = require("node:sqlite");
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          // Match nodes whose file_path is in the changed files list.
          // Normalize paths: CRG stores absolute paths; changedFiles may be relative.
          const absFiles = changedFiles.map((f) => (path.isAbsolute(f) ? f : path.resolve(root, f)));
          const placeholders = absFiles.map(() => "?").join(",");
          const stmt = db.prepare(
            `SELECT qualified_name, name, file_path, language, line_start, line_end, kind
             FROM nodes
             WHERE file_path IN (${placeholders}) AND kind IN ('Function', 'Class', 'Test', 'Type')
             ORDER BY file_path, line_start`
          );
          const rows = stmt.all(...absFiles) as Record<string, unknown>[];
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
      const dbPath = path.join(root, CRG_DIR, GRAPH_DB);
      if (!fs.existsSync(dbPath)) return [];
      try {
        const { DatabaseSync } = require("node:sqlite");
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
      const dbPath = path.join(root, CRG_DIR, GRAPH_DB);
      if (!fs.existsSync(dbPath)) return [];
      try {
        const { DatabaseSync } = require("node:sqlite");
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
      const dbPath = path.join(root, CRG_DIR, GRAPH_DB);
      if (!fs.existsSync(dbPath)) return [];
      try {
        const { DatabaseSync } = require("node:sqlite");
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

    getCommunities(root: string, nodeIds: number[]): CrgCommunity[] {
      if (nodeIds.length === 0) return [];
      const dbPath = path.join(root, CRG_DIR, GRAPH_DB);
      if (!fs.existsSync(dbPath)) return [];
      try {
        const { DatabaseSync } = require("node:sqlite");
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

// ── Formatting helpers (for OCR --background injection) ─────────────────────

/**
 * Format CRG structural analysis as a concise background string for OCR.
 * This is what gets passed as `--background` to `ocr review`, so the LLM
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
 */
export function mergeReviewWithCrgRisk(
  reviewComments: { path: string; startLine: number; content: string; suggestionCode?: string }[],
  risks: CrgRiskData[],
  changes: CrgChangedFunction[]
): { path: string; startLine: number; content: string; suggestionCode?: string; crgRisk?: string }[] {
  const riskMap = new Map(risks.map((r) => [r.qualifiedName, r]));
  // Build a filePath → risk lookup from changes.
  const fileRiskMap = new Map<string, CrgRiskData>();
  for (const c of changes) {
    const r = riskMap.get(c.qualifiedName);
    if (r) fileRiskMap.set(c.filePath, r);
  }

  return reviewComments.map((comment) => {
    const risk = fileRiskMap.get(comment.path);
    let crgRisk: string | undefined;
    if (risk) {
      if (risk.riskScore >= 0.7) crgRisk = `HIGH (${risk.callerCount} callers)`;
      else if (risk.riskScore >= 0.3) crgRisk = `MEDIUM (${risk.callerCount} callers)`;
      else crgRisk = `LOW`;
    }
    return { ...comment, crgRisk };
  });
}
