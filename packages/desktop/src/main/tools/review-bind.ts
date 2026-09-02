/**
 * Finding ↔ CRG node binding — the graph/report bidirectional-locate link
 * (design spec §4.3).
 *
 * Matching rules:
 *   1. PATH must equal the node's file (compared in the graph's POSIX
 *      identity — `file_path` rows are forward-slash absolute, wheel
 *      invariant #774; comment paths may arrive repo-relative, so the caller
 *      resolves them against the project root first);
 *   2. the finding's startLine must OVERLAP the node's [lineStart, lineEnd]
 *      definition range (upstream's `map_changes_to_nodes` semantics);
 *   3. fallback: the nearest PRECEDING node in the file (a finding aimed at a
 *      header comment or a gap before the next symbol still lands);
 *   4. no candidate → the finding is UNBOUND (the report renders no locate
 *      affordance and the map side shows no opinions for it).
 *
 * Pure + fs/electron-free so it unit-tests cold.
 */

import * as path from "node:path";
import type { FindingBinding } from "../../shared/ipc";

/** The subset of the graph node the binder needs (structural typing keeps
 *  the seam small: callers pass `CrgRiskNode`s from crg-query). */
export interface BindableNode {
  qualifiedName: string;
  name: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
}

/** CRG stores `file_path` in POSIX spelling on every OS (#774). */
export function toGraphPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** The finding subset the binder consumes. `crgQn` (enrichment-time exact
 *  node) takes precedence over path+line re-derivation when present. */
export interface BindableFinding {
  path: string;
  startLine: number;
  crgQn?: string;
}

/**
 * Bind findings to risk-graph nodes. Binding order per finding:
 *   0. `crgQn` — the enrichment's exact node (deterministic; survives graph
 *      rebuilds and OCR path/line drift);
 *   1. path equal to the node's file (graph POSIX identity) + line-range
 *      overlap (upstream's `map_changes_to_nodes` semantics);
 *   2. fallback: the nearest PRECEDING node in the file;
 *   3. no candidate → the finding is UNBOUND (the report renders no locate
 *      affordance and the map side shows no opinions for it).
 */
export function bindFindingsToNodes(
  findings: BindableFinding[],
  nodes: BindableNode[],
  projectRoot?: string
): FindingBinding[] {
  if (findings.length === 0 || nodes.length === 0) return [];

  const byQn = new Map(nodes.map((n) => [n.qualifiedName, n]));

  // One sorted (by lineStart) list per file, in graph identity.
  const byFile = new Map<string, BindableNode[]>();
  for (const n of nodes) {
    const key = toGraphPath(n.filePath);
    const list = byFile.get(key);
    if (list) list.push(n);
    else byFile.set(key, [n]);
  }
  for (const list of byFile.values()) list.sort((a, b) => a.lineStart - b.lineStart);

  const out: FindingBinding[] = [];
  findings.forEach((f, index) => {
    // 0. Enrichment-time exact node — pin it when it exists in the candidate set.
    if (typeof f.crgQn === "string") {
      const exact = byQn.get(f.crgQn);
      if (exact) {
        out.push({
          index,
          qn: exact.qualifiedName,
          name: exact.name,
          filePath: exact.filePath,
          lineStart: exact.lineStart,
          lineEnd: exact.lineEnd,
        });
        return;
      }
    }

    // Tolerant skip (review round 2026-09-01): OCR output quality varies —
    // a finding with a bad path/line is UNBOUND but must still occupy its
    // index, so the caller's full-array positions stay stable.
    if (typeof f.path !== "string" || f.path.length === 0 || !Number.isFinite(f.startLine)) return;
    const key = toGraphPath(projectRoot && !path.isAbsolute(f.path) ? path.resolve(projectRoot, f.path) : f.path);
    const list = byFile.get(key);
    if (!list || list.length === 0) return;

    // 1. line-range overlap (exact interval semantics).
    const overlap = list.find((n) => n.lineStart <= f.startLine && f.startLine <= n.lineEnd);
    // 2. nearest preceding node in the same file.
    const hit = overlap ?? nearestPreceding(list, f.startLine);
    if (!hit) return;
    out.push({
      index,
      qn: hit.qualifiedName,
      name: hit.name,
      filePath: hit.filePath,
      lineStart: hit.lineStart,
      lineEnd: hit.lineEnd,
    });
  });
  return out;
}

/** Nearest node whose definition STARTS at or before the line (sorted list). */
function nearestPreceding(sorted: BindableNode[], line: number): BindableNode | null {
  let best: BindableNode | null = null;
  for (const n of sorted) {
    if (n.lineStart <= line) best = n;
    else break;
  }
  return best;
}
