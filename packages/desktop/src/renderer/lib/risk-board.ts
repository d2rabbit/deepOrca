/**
 * Risk-graph pure helpers (RiskGraphView's model layer) — grouping, risk
 * tiers, neighbor lists, finding aggregation and the deterministic PLANAR
 * layout. UI-free so the rules unit-test cold.
 *
 * The view (user ask 2026-09-01, round 3: 按层划分，铺满画布) is a real
 * node-link diagram with NO physics: RISK TIERS are full-width horizontal
 * bands (高/中/低, top→bottom), and within each band the community/file
 * groups sit side by side as tinted blocks — the map reads as risk
 * stratification and the canvas fills, instead of lanes crammed top-left.
 */

import type { FindingBinding, RiskGraphData, RiskGraphNode } from "../../shared/ipc";

export type RiskTier = "hi" | "md" | "lo";

/** Wheel thresholds (same cut points the retired canvas used). */
export function tierOf(risk: number): RiskTier {
  return risk >= 0.66 ? "hi" : risk >= 0.33 ? "md" : "lo";
}

export type BoardMode = "community" | "file";

export interface RiskGroup {
  key: string;
  label: string;
  /** Index into the hue ramp (community mode); null → neutral file mode. */
  hueIndex: number | null;
  nodes: RiskGraphNode[];
  /** Edges with exactly one endpoint inside this group — the coupling the
   *  社区 view exists to expose (drawn as violet cross-lane edges). */
  cross: number;
}

/**
 * Group + sort the dataset for one board mode. Groups sort by their max
 * node risk (the eye should meet the hottest group first); nodes inside a
 * group sort by risk desc. Community mode degrades to `#id` labels when the
 * communities table has no row; nodes without community data land in the
 * trailing 未归类 group.
 */
export function buildRiskGroups(data: RiskGraphData, mode: BoardMode): RiskGroup[] {
  const commName = new Map(data.communities.map((c) => [c.id, c.name]));
  const commHue = new Map(data.communities.map((c, i) => [c.id, i]));

  const buckets = new Map<string, RiskGraphNode[]>();
  const meta = new Map<string, { label: string; hueIndex: number | null; order: number }>();
  for (const n of data.nodes) {
    let key: string;
    let label: string;
    let hueIndex: number | null;
    if (mode === "community") {
      if (n.community == null) {
        // Collates AFTER named groups (the sentinel key sorts last).
        key = "\u0000unassigned";
        label = "";
        hueIndex = null;
      } else {
        key = `c${n.community}`;
        label = commName.get(n.community) ?? `#${n.community}`;
        hueIndex = commHue.get(n.community) ?? null;
      }
    } else {
      key = `f${n.filePath}`;
      label = n.filePath.split(/[\\/]/).pop() ?? n.filePath;
      hueIndex = null;
    }
    if (!buckets.has(key)) {
      buckets.set(key, []);
      meta.set(key, { label, hueIndex, order: mode === "community" && n.community != null ? n.community : 0 });
    }
    buckets.get(key)!.push(n);
  }

  const groupOf = new Map<string, string>();
  for (const [key, list] of buckets) for (const n of list) groupOf.set(n.qn, key);

  const groups: RiskGroup[] = [...buckets.entries()].map(([key, nodes]) => {
    nodes.sort((a, b) => b.risk - a.risk);
    // Cross-group coupling: edges leaving/entering the group (undirected
    // count — direction is meaningless for the coupling signal).
    let cross = 0;
    for (const e of data.edges) {
      const s = groupOf.get(e.source);
      const t = groupOf.get(e.target);
      if ((s === key) !== (t === key)) cross++;
    }
    return {
      key,
      label: meta.get(key)!.label,
      hueIndex: meta.get(key)!.hueIndex,
      nodes,
      cross,
    };
  });

  // Named communities keep their id order (stable across re-renders), the
  // unassigned bucket trails; file mode sorts purely by max risk.
  if (mode === "community") {
    groups.sort((a, b) => {
      const aU = a.key === "\u0000unassigned" ? 1 : 0;
      const bU = b.key === "\u0000unassigned" ? 1 : 0;
      if (aU !== bU) return aU - bU;
      if (aU === 0) return (meta.get(a.key)!.order ?? 0) - (meta.get(b.key)!.order ?? 0);
      return b.nodes[0].risk - a.nodes[0].risk;
    });
  } else {
    groups.sort((a, b) => b.nodes[0].risk - a.nodes[0].risk);
  }
  return groups;
}

/** A finding's popover line shape. */
export interface NodeOpinion {
  findex: number;
  sev: RiskTier;
  label: string;
}

/** The finding slice opinions are built from (ReviewWorkspace's parsed shape). */
export type OpinionFinding = { severity?: string; content: string };

/**
 * Aggregate finding→node bindings into per-node opinion lists (the popover's
 * 相关审查意见 section). Severity reuses the report's parsed chip tier;
 * the label is the finding text normalized to one line, capped for the pop.
 */
export function buildOpinions(
  findings: OpinionFinding[],
  bindingsByIndex: Record<number, FindingBinding>
): Map<string, NodeOpinion[]> {
  const out = new Map<string, NodeOpinion[]>();
  for (const [indexStr, binding] of Object.entries(bindingsByIndex)) {
    const f = findings[Number(indexStr)];
    if (!f) continue;
    const sev: RiskTier =
      f.severity === "critical" || f.severity === "high" ? "hi" : f.severity === "medium" ? "md" : "lo";
    const text = f.content.replace(/\s+/g, " ").trim();
    const list = out.get(binding.qn) ?? [];
    list.push({ findex: Number(indexStr), sev, label: text.length > 64 ? `${text.slice(0, 63)}…` : text });
    out.set(binding.qn, list);
  }
  return out;
}

/** Directed neighbor qns of one node: who calls it / whom it calls (deduped,
 *  edge order). Used by the popover's neighbor chips. */
export function neighborsOf(edges: RiskGraphData["edges"], qn: string): { callers: string[]; callees: string[] } {
  const callers = new Set<string>();
  const callees = new Set<string>();
  for (const e of edges) {
    if (e.target === qn && e.source !== qn) callers.add(e.source);
    if (e.source === qn && e.target !== qn) callees.add(e.target);
  }
  return { callers: [...callers], callees: [...callees] };
}

// ── Deterministic tier-layered layout ───────────────────────────────────────

/** Geometry constants of the layered diagram (px). */
export const LAYER = {
  /** The diagram is a FIXED-width canvas (user ask 2026-09-01, real-data
   *  round: a 60-node graph once laid a 19-node group out as one 2200px
   *  row that ran off-screen). Blocks wrap inside the band, nodes wrap
   *  inside the block; the canvas grows DOWN, never sideways. The SVG
   *  scales responsively to the pane (CSS width: 100%). */
  width: 1180,
  /** Outer horizontal padding of the whole diagram. */
  padX: 26,
  /** Top padding above the first band. */
  padTop: 6,
  /** Vertical gap between tier bands. */
  bandGap: 18,
  /** Inner horizontal padding of a tier band. */
  bandPadX: 16,
  /** Headroom for the tier label inside a band. */
  bandPadTop: 36,
  /** Inner bottom padding of a tier band. */
  bandPadBottom: 16,
  /** Horizontal gap between group blocks. */
  blockGapX: 12,
  /** Vertical gap between block rows inside a band. */
  blockGapY: 12,
  /** Inner horizontal padding of a block. */
  blockPadX: 12,
  /** Headroom for the block header inside a block. */
  blockHeadH: 26,
  /** Horizontal slot per node inside a block. */
  nodeSlotW: 108,
  /** Node row: dot on top, its centered label below. */
  nodeRowH: 46,
  /** Dot center offset from the row top. */
  nodeDotY: 13,
  /** Node columns per block row — 6 slots ≈ 648px, the widest block. */
  blockColsMax: 6,
} as const;

export interface LaidOutNode {
  qn: string;
  /** Node circle center. */
  x: number;
  y: number;
  /** Radius grows with risk (5.5..12.5). */
  r: number;
  tier: RiskTier;
  blockKey: string;
}

/** One group's tinted block inside a tier band. */
export interface LaidOutBlock {
  key: string;
  label: string;
  hueIndex: number | null;
  count: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One full-width risk band (hi above md above lo). Empty tiers are skipped. */
export interface LaidOutTier {
  tier: RiskTier;
  y: number;
  h: number;
  count: number;
}

export interface BoardLayout {
  nodes: Map<string, LaidOutNode>;
  blocks: LaidOutBlock[];
  tiers: LaidOutTier[];
  width: number;
  height: number;
  /** The elastic slot width this layout used — the renderer derives the
   *  per-node label character budget from it (labels must fit their slot). */
  slotW: number;
}

const TIER_ORDER: RiskTier[] = ["hi", "md", "lo"];

/**
 * Place every node at a deterministic position. Risk tiers form full-width
 * horizontal bands (top = hottest). Inside a band, each group is a block
 * whose nodes flow as a GRID (capped at blockColsMax columns — a 19-node
 * group becomes 4 rows, not one endless line); blocks wrap row by row
 * across the band's fixed width. Identical input lays out
 * pixel-identically.
 */
export interface LayoutTarget {
  /** Observed pane width (ResizeObserver) — blocks stretch to fill it. */
  width: number;
  /** Observed pane height — leftover space SPREADS into band/block gaps so
   *  the diagram fills the pane instead of clustering top-left (user report
   *  2026-09-01: 占据位置不够且堆积). */
  height?: number;
}

export function layoutBoard(groups: RiskGroup[], target?: LayoutTarget): BoardLayout {
  const nodes = new Map<string, LaidOutNode>();
  const blocks: LaidOutBlock[] = [];
  const tiers: LaidOutTier[] = [];
  let maxBandW = 0;

  // tier → groupKey → nodes (group iteration order preserved).
  const buckets = new Map<RiskTier, Map<string, RiskGraphNode[]>>();
  for (const tier of TIER_ORDER) buckets.set(tier, new Map());
  for (const g of groups) {
    for (const n of g.nodes) {
      const byGroup = buckets.get(tierOf(n.risk))!;
      const list = byGroup.get(g.key);
      if (list) list.push(n);
      else byGroup.set(g.key, [n]);
    }
  }

  // Pane width is AUTHORITATIVE once measured (user report 2026-09-01: 图谱
  // 必须自适应窗体) — a small window shrinks lanes/columns instead of
  // clipping. LAYER.width is only the unmeasured default.
  const paneW = target?.width != null && target.width >= 320 ? Math.floor(target.width) : LAYER.width;
  const paneH = Math.floor(target?.height ?? 0);
  const bandInnerW = Math.max(300, paneW - LAYER.padX * 2 - LAYER.bandPadX * 2);
  // Elastic node slot: wider panes get roomier slots (labels breathe), narrow
  // panes compress to keep blocks inside the viewport.
  const slotW = Math.max(96, Math.min(150, Math.floor(bandInnerW / 8)));
  let y = LAYER.padTop;
  for (const tier of TIER_ORDER) {
    const byGroup = buckets.get(tier)!;
    const entries = groups.filter((g) => (byGroup.get(g.key)?.length ?? 0) > 0);
    if (entries.length === 0) continue;

    // Shape blocks: the node-grid column count stretches with the pane width.
    const shaped = entries.map((g) => {
      const list = [...byGroup.get(g.key)!].sort((a, b) => b.risk - a.risk);
      const cols = Math.max(2, Math.min(list.length, Math.max(2, Math.floor(bandInnerW / slotW))));
      const rows = Math.ceil(list.length / cols);
      return {
        group: g,
        list,
        w: LAYER.blockPadX * 2 + cols * slotW,
        h: LAYER.blockHeadH + rows * LAYER.nodeRowH,
        cols,
        rows,
      };
    });

    const bandY = y;
    const bandX = LAYER.padX + LAYER.bandPadX;
    // Pack block rows across the band's full width.
    const bandRows: Array<{ items: typeof shaped; h: number }> = [];
    let cur: typeof shaped = [];
    let curH = 0;
    let curW = 0;
    for (const b of shaped) {
      const need = cur.length > 0 ? curW + LAYER.blockGapX + b.w : b.w;
      if (cur.length > 0 && need > bandInnerW) {
        bandRows.push({ items: cur, h: curH });
        cur = [];
        curH = 0;
        curW = 0;
      }
      cur.push(b);
      curH = Math.max(curH, b.h);
      curW = need;
    }
    if (cur.length > 0) bandRows.push({ items: cur, h: curH });

    // Vertical spread: leftover pane height goes into block-row gaps and the
    // band's top padding so short graphs fill tall panes.
    const naturalH = bandRows.reduce((s, r) => s + r.h, 0) + LAYER.blockGapY * (bandRows.length - 1);
    const bandPadH = LAYER.bandPadTop + LAYER.bandPadBottom;
    const extra = paneH > 0 ? Math.max(0, paneH - naturalH - bandPadH - LAYER.bandGap) : 0;
    const rowGap = bandRows.length > 1 ? LAYER.blockGapY + extra / Math.max(1, bandRows.length * 2) : extra / 4;
    const padTop = LAYER.bandPadTop + extra / 8;

    const bandH = padTop + naturalH + rowGap * (bandRows.length - 1) + LAYER.bandPadBottom;
    const bandW = paneW - LAYER.padX * 2;
    maxBandW = Math.max(maxBandW, bandW);
    tiers.push({
      tier,
      y: bandY,
      h: bandH,
      count: entries.reduce((s, g) => s + byGroup.get(g.key)!.length, 0),
    });

    let ry = bandY + padTop;
    for (const br of bandRows) {
      let bx = bandX;
      for (const b of br.items) {
        const bx0 = bx;
        const by0 = ry;
        blocks.push({
          key: b.group.key,
          label: b.group.label,
          hueIndex: b.group.hueIndex,
          count: b.list.length,
          x: bx0,
          y: by0,
          w: b.w,
          h: b.h,
        });
        b.list.forEach((n, i) => {
          const col = i % b.cols;
          const row = Math.floor(i / b.cols);
          nodes.set(n.qn, {
            qn: n.qn,
            x: bx0 + LAYER.blockPadX + (col + 0.5) * slotW,
            y: by0 + LAYER.blockHeadH + LAYER.nodeDotY + row * LAYER.nodeRowH,
            r: 5.5 + n.risk * 7,
            tier,
            blockKey: b.group.key,
          });
        });
        bx += b.w + LAYER.blockGapX;
      }
      ry += br.h + rowGap;
    }
    y += bandH + LAYER.bandGap;
  }

  return {
    nodes,
    blocks,
    tiers,
    width: paneW,
    height: Math.max(paneH, Math.max(1, y - LAYER.bandGap + LAYER.padTop)),
    slotW,
  };
}

/** Point on the a→b line pulled back `d` from `a` (edge endpoint trim). */
function trim(a: { x: number; y: number }, b: { x: number; y: number }, d: number): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: a.x + (dx / len) * d, y: a.y + (dy / len) * d };
}

export function edgePath(a: LaidOutNode, b: LaidOutNode): string {
  // Trim so the path starts at the source disc's rim and stops before the
  // target disc — room for the arrow marker, no line hiding under a node.
  const start = trim(a, b, a.r + 2);
  const end = trim(b, a, b.r + 5);
  if (a.blockKey === b.blockKey) {
    const bulge = LAYER.nodeSlotW * 1.4;
    return `M ${start.x} ${start.y} C ${a.x + bulge} ${a.y + 2}, ${b.x + bulge} ${b.y - 2}, ${end.x} ${end.y}`;
  }
  const midX = (a.x + b.x) / 2;
  return `M ${start.x} ${start.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${end.x} ${end.y}`;
}
