/**
 * Risk map DATA (main side) — the risk-ranked node set, CALLS edges, and
 * community metadata for the review tab's native flat board (RiskGraphView,
 * renderer). The 2026-09-01 canvas force-directed wheel was retired (user
 * ask: 平铺布局如索引关系图，弃球图) — main now ships STRUCTURE only;
 * layout, theme and i18n live renderer-side with the rest of the UI.
 *
 * `opinions` (finding ↔ node bindings) are NOT built here: the renderer
 * already receives them through review:readReport (`bindings`), so the board
 * stays report-agnostic — switching reports re-binds without refetching.
 */

import { existsSync, statSync } from "node:fs";
import * as path from "node:path";
import { createCrgGraphQuery, CRG_DATA_DIR, CRG_LEGACY_DIR, type CrgRiskEdge, type CrgRiskNode } from "@deeporca/core";
import type { RiskCommunity, RiskGraphData, RiskGraphEdge, RiskGraphNode } from "../../shared/ipc";

/** How many top-risk nodes the board shows. */
export const OVERVIEW_LIMIT = 60;
/**
 * Binding set size (user report 2026-09-01: findings with CRG enrichment
 * could not be located on the graph) — the review-report binding used to run
 * against the SAME top-60 set the graph displays, so any finding whose CRG
 * node ranked outside it was silently unbindable. Bindings now match against
 * a much deeper ranking (core caps at 200); the graph still DISPLAYS 60 and
 * pulls report-focus nodes in on demand.
 */
export const BINDING_LIMIT = 200;

/** graph.db's on-disk path (canonical or legacy location), null when absent. */
function graphDbPath(root: string): string | null {
  for (const dir of [CRG_DATA_DIR, CRG_LEGACY_DIR]) {
    const p = path.join(root, dir, "graph.db");
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Overview cache (review round 2026-09-01): the six-factor ranking is the
 * heaviest query in the module, and it used to re-run on EVERY report
 * selection AND again for the map. Keyed by `root#limit` (the binding path
 * queries a different limit than the display board), invalidated by graph.db
 * mtime — a rebuild refreshes naturally, no TTL heuristics. Callers get the
 * cached arrays BY REFERENCE for reads; buildRiskGraphData must copy before
 * extending (an in-place push once permanently polluted the cached top-N).
 */
const overviewCache = new Map<string, { mtimeMs: number; overview: { nodes: CrgRiskNode[]; edges: CrgRiskEdge[] } }>();

export function getRiskOverviewCached(root: string, limit: number): { nodes: CrgRiskNode[]; edges: CrgRiskEdge[] } {
  const dbPath = graphDbPath(root);
  if (!dbPath) return { nodes: [], edges: [] };
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(dbPath).mtimeMs;
  } catch {
    // unreadable — skip the cache, query cold
  }
  const hit = overviewCache.get(`${root}#${limit}`);
  if (hit && mtimeMs > 0 && hit.mtimeMs === mtimeMs) return hit.overview;
  const overview = createCrgGraphQuery().getRiskOverview(root, limit);
  if (mtimeMs > 0) overviewCache.set(`${root}#${limit}`, { mtimeMs, overview });
  return overview;
}

/**
 * The board's full dataset, or null when no graph / no risk data exists
 * (callers turn that into the "build the graph first" empty state).
 * Edges are restricted to pairs whose BOTH endpoints are in the node set —
 * a dangling reference would render as a chip-less coupling.
 */
export function buildRiskGraphData(root: string, focusQns?: string[]): RiskGraphData | null {
  if (!createCrgGraphQuery().hasGraph(root)) return null;
  // The cache returns its arrays BY REFERENCE — copy before extending, or the
  // focus pull below would push into the cached top-N and every later plain
  // fetch of this root would render the previous report's located nodes.
  const { nodes: cachedNodes, edges } = getRiskOverviewCached(root, OVERVIEW_LIMIT);
  const nodes = [...cachedNodes];
  if (nodes.length === 0) return null;

  // Report → graph locate (user report 2026-09-01: 有 CRG 节点却无法定位):
  // a bound finding's node may rank outside the displayed top-N — pull those
  // EXACT nodes into the dataset so the locate jump always has a target.
  const known = new Set(nodes.map((n) => n.qualifiedName));
  const missing = [...new Set((focusQns ?? []).filter((qn) => qn && !known.has(qn)))];
  if (missing.length > 0) {
    nodes.push(...createCrgGraphQuery().getRiskNodesByNames(root, missing));
  }

  // Community metadata for group labels (absent/failed reads keep the board
  // risk-only: fail-open, communities degrade to `#id` labels).
  const commIds = [...new Set(nodes.map((n) => n.communityId).filter((c): c is number => c != null))];
  let commMeta = new Map<number, string>();
  if (commIds.length > 0) {
    const comms = createCrgGraphQuery().getCommunities(root, commIds);
    commMeta = new Map(comms.map((c) => [c.id, c.name || `#${c.id}`]));
  }

  const mergedSet = new Set(nodes.map((n) => n.qualifiedName));
  const edgeSource = missing.length > 0 ? createCrgGraphQuery().getEdgesForNodes(root, [...mergedSet]) : edges;
  const outEdges: RiskGraphEdge[] = [];
  for (const e of edgeSource) {
    if (e.source !== e.target && mergedSet.has(e.source) && mergedSet.has(e.target))
      outEdges.push({ source: e.source, target: e.target });
  }

  return {
    nodes: nodes.map(
      (n): RiskGraphNode => ({
        qn: n.qualifiedName,
        name: n.name,
        filePath: n.filePath,
        lineStart: n.lineStart,
        risk: n.riskScore,
        callers: n.callerCount,
        security: n.securityRelevant,
        community: n.communityId ?? null,
        coverage: n.testCoverage,
      })
    ),
    edges: outEdges,
    communities: commIds.map((id): RiskCommunity => ({ id, name: commMeta.get(id) ?? `#${id}` })),
  };
}
