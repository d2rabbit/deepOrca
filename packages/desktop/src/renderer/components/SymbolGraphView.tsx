/**
 * SymbolGraphView (specs/index-knowledge-rework R3-6) — a display-only
 * relationship graph over the CodeGraph index: callers | focus | callees in
 * three columns, edges colored by kind (calls/references/instantiates/
 * implements). Clicking a node re-centers the graph on it.
 *
 * Pure visualization for HUMANS — the data comes from a dedicated read-only
 * IPC (knowledge:symbolGraph); the agent-facing CodeGraph MCP tools and the
 * indexed content itself are untouched.
 *
 * Responsive (real-machine feedback): the SVG size used to be hardcoded
 * (~786×N) so the graph ignored window resizes — columns now stretch to the
 * measured container width via ResizeObserver (clamped to a readable band),
 * and node text truncation follows the live column width.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import type { KnowledgeSymbolGraph, KnowledgeSymbolGraphNode } from "../../shared/ipc";

type Props = {
  root: string;
  query: string;
  /** Center the graph on this symbol name (re-fetch). */
  onRecenter: (name: string) => void;
};

/** Column layout band — below MIN the graph scrolls horizontally instead of
 *  becoming unreadable; above MAX extra window width goes to text, not cols. */
const MIN_COL_W = 220;
const MAX_COL_W = 480;
/** Fallback before the ResizeObserver reports (and in the DOM test harness). */
const DEFAULT_COL_W = 230;
const COL_GAP = 40;
const NODE_H = 34;
const PAD_X = 8;
const PAD_Y = 16;

const EDGE_STYLE: Record<string, { stroke: string; dash?: string }> = {
  calls: { stroke: "#4a9eff" },
  references: { stroke: "#8a94a6", dash: "5 3" },
  instantiates: { stroke: "#b07cf0", dash: "2 3" },
  implements: { stroke: "#57c98b", dash: "2 3" },
};

const KIND_COLOR: Record<string, string> = {
  function: "#4a9eff",
  method: "#57c98b",
  class: "#f0a04b",
  interface: "#b07cf0",
  type_alias: "#8a94a6",
  constant: "#e377c2",
  variable: "#8a94a6",
  property: "#8a94a6",
  component: "#ff9896",
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function nodeFill(node: KnowledgeSymbolGraphNode): string {
  if (node.role === "focus") return "rgba(74, 158, 255, 0.16)";
  return "rgba(127, 140, 166, 0.08)";
}

export function SymbolGraphView({ root, query, onRecenter }: Props): JSX.Element {
  const { t } = useI18n();
  const [graph, setGraph] = useState<KnowledgeSymbolGraph | null>(null);
  const [loading, setLoading] = useState(false);
  // Back stack (R3-8): every recenter pushes the previous center; the
  // "返回上一层" button pops it — browsing the graph becomes non-destructive.
  const [history, setHistory] = useState<string[]>([]);
  const currentRef = useRef(query);
  currentRef.current = query;
  // Live container width — drives the responsive three-column layout.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [availW, setAvailW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setAvailW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const recenter = (name: string): void => {
    if (name === query) return;
    setHistory((h) => [...h, query]);
    onRecenter(name);
  };
  const back = (): void => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (prev !== undefined) onRecenter(prev);
      return h.slice(0, -1);
    });
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const result = await api.knowledgeSymbolGraph(root, query || undefined);
        if (alive) setGraph(result);
      } catch {
        if (alive) setGraph({ nodes: [], edges: [], truncated: false });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [root, query]);

  const layout = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return null;
    // Responsive columns: split the measured container width across the three
    // columns (clamped) so the graph fills the window at any size.
    const colW =
      availW > 0
        ? Math.max(MIN_COL_W, Math.min(MAX_COL_W, Math.floor((availW - PAD_X * 2 - 2 * COL_GAP) / 3)))
        : DEFAULT_COL_W;
    // Text budget follows the live column width (~7px/char at 11.5px font,
    // node card leaves 46px for the kind dot + padding).
    const nameMax = Math.max(10, Math.floor((colW - 46) / 7));
    const fileMax = Math.max(10, Math.floor((colW - 46) / 6));
    const edgeCount = (id: string): number => graph.edges.filter((e) => e.source === id || e.target === id).length;
    const pick = (role: KnowledgeSymbolGraphNode["role"], cap: number): KnowledgeSymbolGraphNode[] =>
      graph.nodes
        .filter((n) => n.role === role)
        .sort((a, b) => edgeCount(b.id) - edgeCount(a.id))
        .slice(0, cap);
    const focus = graph.nodes.filter((n) => n.role === "focus").slice(0, 10);
    const callers = pick("caller", 14);
    const callees = pick("callee", 16);

    const columns: Array<{ x: number; nodes: KnowledgeSymbolGraphNode[]; label: string }> = [
      { x: PAD_X, nodes: callers, label: "调用方" },
      { x: colW + COL_GAP + PAD_X, nodes: focus, label: "焦点符号" },
      { x: 2 * (colW + COL_GAP) + PAD_X, nodes: callees, label: "被调用" },
    ];
    const height = Math.max(...columns.map((c) => c.nodes.length)) * NODE_H + PAD_Y * 2 + 26;
    const width = 3 * colW + 2 * COL_GAP + PAD_X * 2;
    const pos = new Map<string, { x: number; y: number }>();
    for (const col of columns) {
      col.nodes.forEach((n, i) => {
        pos.set(n.id, { x: col.x, y: PAD_Y + 26 + i * NODE_H });
      });
    }
    const visibleEdges = graph.edges.filter((e) => pos.has(e.source) && pos.has(e.target));
    const beyond = (role: KnowledgeSymbolGraphNode["role"], shown: KnowledgeSymbolGraphNode[]): number =>
      graph.nodes.filter((n) => n.role === role).length - shown.length;
    const hidden = beyond("caller", callers) + beyond("callee", callees) + beyond("focus", focus);
    return { columns, pos, visibleEdges, width, height, hidden, colW, nameMax, fileMax };
  }, [graph, availW]);

  if (loading && !graph) {
    return (
      <div className="ui-side-panel-empty">
        <span className="ui-spinner" />
      </div>
    );
  }
  if (!layout) {
    return <div className="ui-side-panel-empty">{t("index.symbolsEmpty")}</div>;
  }

  return (
    <div className="ui-symbol-graph">
      <div className="ui-symbol-graph-toolbar">
        <button
          type="button"
          className="ui-symbol-graph-back"
          onClick={back}
          disabled={history.length === 0}
          title={history.length > 0 ? `返回 ${history[history.length - 1] || "全局"}` : "已是最顶层"}
        >
          ← 返回上一层{history.length > 1 ? ` (${history.length})` : ""}
        </button>
        <span className="ui-symbol-graph-center">{query.trim() ? `◈ ${query.trim()}` : "◈ 全局枢纽视图"}</span>
      </div>
      <div className="ui-symbol-graph-legend">
        {Object.entries(EDGE_STYLE).map(([kind, style]) => (
          <span key={kind} className="ui-symbol-graph-legend-item">
            <svg width="22" height="6">
              <line x1="0" y1="3" x2="22" y2="3" stroke={style.stroke} strokeWidth="2" strokeDasharray={style.dash} />
            </svg>
            {kind}
          </span>
        ))}
        {layout.hidden > 0 || graph?.truncated ? (
          <span className="ui-symbol-graph-truncated">已截断显示最高连接度节点</span>
        ) : null}
      </div>
      <div className="ui-symbol-graph-scroll" ref={scrollRef}>
        <svg width={layout.width} height={layout.height} role="img" aria-label="symbol relationship graph">
          <defs>
            {Object.entries(EDGE_STYLE).map(([kind, style]) => (
              <marker
                key={kind}
                id={`arrow-${kind}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 9 5 L 0 9 z" fill={style.stroke} fillOpacity={0.7} />
              </marker>
            ))}
          </defs>
          {layout.columns.map((col) =>
            col.nodes.length > 0 ? (
              <text key={col.label} x={col.x + 4} y={PAD_Y + 10} className="ui-symbol-graph-col-label">
                {col.label} · {col.nodes.length}
              </text>
            ) : null
          )}
          {layout.visibleEdges.map((e, i) => {
            const from = layout.pos.get(e.source);
            const to = layout.pos.get(e.target);
            if (!from || !to) return null;
            const style = EDGE_STYLE[e.kind] ?? EDGE_STYLE.references;
            const fromRight = to.x > from.x;
            const x1 = from.x + (fromRight ? layout.colW - 16 : 0);
            const x2 = to.x + (fromRight ? 0 : layout.colW - 16);
            const midX = (x1 + x2) / 2;
            return (
              <path
                key={i}
                d={`M ${x1} ${from.y + NODE_H / 2} C ${midX} ${from.y + NODE_H / 2}, ${midX} ${to.y + NODE_H / 2}, ${x2} ${to.y + NODE_H / 2}`}
                fill="none"
                stroke={style.stroke}
                strokeWidth={1.2}
                strokeOpacity={0.55}
                strokeDasharray={style.dash}
                markerEnd={`url(#arrow-${e.kind})`}
              />
            );
          })}
          {layout.columns.map((col) =>
            col.nodes.map((n) => {
              const p = layout.pos.get(n.id);
              if (!p) return null;
              return (
                <g
                  key={n.id}
                  className="ui-symbol-graph-node"
                  onClick={() => recenter(n.name)}
                  role="button"
                  aria-label={`${n.name} (${n.kind})`}
                >
                  <rect x={p.x} y={p.y} width={layout.colW - 16} height={NODE_H - 6} rx={7} fill={nodeFill(n)} />
                  <circle cx={p.x + 12} cy={p.y + (NODE_H - 6) / 2} r={4} fill={KIND_COLOR[n.kind] ?? "#8a94a6"} />
                  <text x={p.x + 22} y={p.y + NODE_H / 2 - 2} className="ui-symbol-graph-node-name">
                    {truncate(n.name, layout.nameMax)}
                  </text>
                  <text x={p.x + 22} y={p.y + NODE_H / 2 + 9} className="ui-symbol-graph-node-kind">
                    {truncate(n.filePath.split("/").pop() ?? n.kind, layout.fileMax)}
                  </text>
                </g>
              );
            })
          )}
        </svg>
      </div>
      <div className="ui-symbol-graph-hint">点击节点以该符号为中心重新展开</div>
    </div>
  );
}
