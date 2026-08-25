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
 *
 * Color: every fill/stroke is a CSS class (sym-card/sym-dot/sym-edge…) styled
 * in ui.css from the --ui-diagram-hue-* ramp — no hex colors live here, so
 * the graph follows the active theme AND matches the arch-map palette
 * (columns get identity hues: callers violet · focus blue · callees teal).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
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
 *  becoming unreadable. The old 520px MAX cap left a maximized window with
 *  three narrow columns hugging the left edge (real-machine feedback); the
 *  cap now only guards absurdity — the graph is expected to FILL the pane,
 *  with text budgets growing alongside the columns. */
const MIN_COL_W = 240;
const MAX_COL_W = 1200;
/** Fallback before the ResizeObserver reports (and in the DOM test harness). */
const DEFAULT_COL_W = 250;
const COL_GAP = 54;
const NODE_H = 40;
const PAD_X = 12;
const PAD_Y = 22;

/** Edge kinds, in legend order. Paint + dash patterns live in ui.css. */
const EDGE_KINDS = ["calls", "references", "instantiates", "implements"] as const;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function SymbolGraphView({ root, query, onRecenter }: Props): JSX.Element {
  const { t } = useI18n();
  const [graph, setGraph] = useState<KnowledgeSymbolGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One-hop popover (real-machine feedback round 5): clicking a NON-focus
  // node no longer navigates away — it opens a floating sub-graph preview
  // (the node's own callers/callees, fetched lazily) with a "center here"
  // action. Drilling is a deliberate choice, not a side effect of a click.
  const [pop, setPop] = useState<{ name: string; kind: string; x: number; y: number } | null>(null);
  const [popGraph, setPopGraph] = useState<KnowledgeSymbolGraph | null>(null);
  const [popLoading, setPopLoading] = useState(false);
  const popSeqRef = useRef(0);
  const currentRef = useRef(query);
  currentRef.current = query;

  // The CANVAS is fixed and follows the window (real-machine feedback: the
  // board must not resize with the graph). Belt-and-braces measurement —
  // direct getBoundingClientRect on mount/window-resize/graph-change plus
  // the observer (a lone contentRect observer missed a maximize transition).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [availW, setAvailW] = useState(0);
  const [availH, setAvailH] = useState(0);
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) setAvailW((prev) => (Math.abs(prev - rect.width) > 1 ? Math.floor(rect.width) : prev));
    if (rect.height > 0) setAvailH((prev) => (Math.abs(prev - rect.height) > 1 ? Math.floor(rect.height) : prev));
  }, []);
  useEffect(() => {
    measure();
    const el = scrollRef.current;
    let ro: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => measure());
      ro.observe(el);
    }
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // Any navigation or context change invalidates the open popover.
  useEffect(() => {
    setPop(null);
    setPopGraph(null);
  }, [root, query]);

  // Esc closes the popover.
  useEffect(() => {
    if (!pop) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setPop(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pop]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const result = await api.knowledgeSymbolGraph(root, query || undefined);
        if (alive) {
          setGraph(result);
          setError(null);
        }
      } catch (err) {
        // Distinguish failure from a genuinely empty graph — the old catch
        // faked an empty result and the user saw "no symbols" instead.
        if (alive) {
          setGraph(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [root, query]);

  const openPopover = useCallback(
    (node: KnowledgeSymbolGraphNode, clientX: number, clientY: number): void => {
      // Clamp so the card never leaves the viewport (estimated footprint).
      const x = Math.max(8, Math.min(clientX + 14, window.innerWidth - 316));
      const y = Math.max(8, Math.min(clientY + 14, window.innerHeight - 320));
      setPop({ name: node.name, kind: node.kind, x, y });
      setPopGraph(null);
      setPopLoading(true);
      const seq = ++popSeqRef.current;
      (async () => {
        try {
          const result = await api.knowledgeSymbolGraph(root, node.name);
          if (seq !== popSeqRef.current) return;
          setPopGraph(result);
        } catch {
          if (seq === popSeqRef.current) setPopGraph(null);
        } finally {
          if (seq === popSeqRef.current) setPopLoading(false);
        }
      })();
    },
    [root]
  );

  const layout = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return null;
    // Responsive columns: split the canvas width across the three columns
    // (clamped) so the graph fills the window at any size.
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

    const columns: Array<{ x: number; nodes: KnowledgeSymbolGraphNode[]; label: string; hue: string }> = [
      { x: PAD_X, nodes: callers, label: t("symbols.callers"), hue: "col-callers" },
      { x: colW + COL_GAP + PAD_X, nodes: focus, label: t("symbols.focus"), hue: "col-focus" },
      { x: 2 * (colW + COL_GAP) + PAD_X, nodes: callees, label: t("symbols.callees"), hue: "col-callees" },
    ];
    // Vertical sparsification: rows spread across the measured canvas
    // height — a maximized window breathes (rows up to 130px); a too-long
    // column keeps minimum density and the canvas scrolls.
    const headerH = 26;
    const minRow = NODE_H + 28;
    const maxNodes = Math.max(...columns.map((c) => c.nodes.length), 1);
    const rowH =
      availH > 0 ? Math.max(minRow, Math.min(130, Math.floor((availH - PAD_Y * 2 - headerH) / maxNodes))) : minRow;
    const contentH = headerH + (maxNodes - 1) * rowH + NODE_H + PAD_Y * 2;
    const width = 3 * colW + 2 * COL_GAP + PAD_X * 2;
    // The CANVAS is the pane; the drawing only grows past it when density
    // forces it (then it scrolls) — the board never shrinks to its content.
    const height = Math.max(availH, contentH);
    const pos = new Map<string, { x: number; y: number }>();
    for (const col of columns) {
      col.nodes.forEach((n, i) => {
        pos.set(n.id, { x: col.x, y: PAD_Y + headerH + i * rowH });
      });
    }
    const visibleEdges = graph.edges.filter((e) => pos.has(e.source) && pos.has(e.target));
    const beyond = (role: KnowledgeSymbolGraphNode["role"], shown: KnowledgeSymbolGraphNode[]): number =>
      graph.nodes.filter((n) => n.role === role).length - shown.length;
    const hidden = beyond("caller", callers) + beyond("callee", callees) + beyond("focus", focus);
    return { columns, pos, visibleEdges, width, height, hidden, colW, nameMax, fileMax };
  }, [graph, availW, availH, t]);

  const legend = (
    <div className="ui-symbol-graph-legend">
      {EDGE_KINDS.map((kind) => (
        <span key={kind} className="ui-symbol-graph-legend-item">
          <svg width="22" height="6">
            <line x1="0" y1="3" x2="22" y2="3" className={`sym-edge edge-${kind}`} strokeWidth="2" />
          </svg>
          {kind}
        </span>
      ))}
      {layout && (layout.hidden > 0 || graph?.truncated) ? (
        <span className="ui-symbol-graph-truncated">{t("symbols.truncated")}</span>
      ) : null}
    </div>
  );

  // Empty/loading/error render INSIDE the canvas — the panel toolbar (with
  // back/home) always stays mounted above, so a drilled-into dead end can
  // never strand the user (real-machine feedback: the whole-view early
  // return used to swallow the toolbar AND the legend).
  const boardInner =
    loading && !graph ? (
      <div className="ui-symbol-graph-boardstate">
        <span className="ui-spinner" />
      </div>
    ) : error ? (
      <div className="ui-symbol-graph-boardstate">{t("symbols.error")}</div>
    ) : !layout ? (
      <div className="ui-symbol-graph-boardstate">{t("index.symbolsEmpty")}</div>
    ) : (
      <svg
        width={Math.max(layout.width, availW)}
        height={layout.height}
        role="img"
        aria-label="symbol relationship graph"
        onClick={() => setPop(null)}
      >
        <defs>
          {EDGE_KINDS.map((kind) => (
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
              <path d="M 0 1 L 9 5 L 0 9 z" className={`sym-arrow arrow-${kind}`} />
            </marker>
          ))}
        </defs>
        {layout.columns.map((col) =>
          col.nodes.length > 0 ? (
            <text key={col.label} x={col.x + 4} y={PAD_Y + 10} className={`ui-symbol-graph-col-label ${col.hue}`}>
              {col.label} · {col.nodes.length}
            </text>
          ) : null
        )}
        {layout.visibleEdges.map((e, i) => {
          const from = layout.pos.get(e.source);
          const to = layout.pos.get(e.target);
          if (!from || !to) return null;
          const kind = (EDGE_KINDS as readonly string[]).includes(e.kind) ? e.kind : "references";
          const fromRight = to.x > from.x;
          const x1 = from.x + (fromRight ? layout.colW - 16 : 0);
          const x2 = to.x + (fromRight ? 0 : layout.colW - 16);
          const midX = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M ${x1} ${from.y + NODE_H / 2} C ${midX} ${from.y + NODE_H / 2}, ${midX} ${to.y + NODE_H / 2}, ${x2} ${to.y + NODE_H / 2}`}
              fill="none"
              className={`sym-edge edge-${kind}`}
              strokeWidth="1.2"
              strokeOpacity={0.55}
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
                role="button"
                aria-label={`${n.name} (${n.kind})`}
                onClick={(e) => {
                  e.stopPropagation();
                  // Focus-column clicks drill (that IS the center); outer
                  // columns open the one-hop popover instead of navigating.
                  if (n.role === "focus") onRecenter(n.name);
                  else openPopover(n, e.clientX, e.clientY);
                }}
              >
                <rect
                  x={p.x}
                  y={p.y}
                  width={layout.colW - 16}
                  height={NODE_H - 6}
                  rx={8}
                  className={`sym-card role-${n.role}`}
                />
                <circle cx={p.x + 13} cy={p.y + (NODE_H - 6) / 2} r={4.5} className={`sym-dot kind-${n.kind}`} />
                <text x={p.x + 24} y={p.y + NODE_H / 2 - 3} className="ui-symbol-graph-node-name">
                  {truncate(n.name, layout.nameMax)}
                </text>
                <text x={p.x + 24} y={p.y + NODE_H / 2 + 10} className="ui-symbol-graph-node-kind">
                  {truncate(n.filePath.split(/[\\/]/).pop() ?? n.kind, layout.fileMax)}
                </text>
              </g>
            );
          })
        )}
      </svg>
    );

  return (
    <div className="ui-symbol-graph">
      {legend}
      <div className="ui-symbol-graph-scroll" ref={scrollRef} onScroll={() => setPop(null)}>
        {boardInner}
      </div>
      <div className="ui-symbol-graph-hint">{t("symbols.clickHint")}</div>
      {pop ? (
        <div className="ui-sym-pop" style={{ left: pop.x, top: pop.y }} role="dialog">
          <div className="ui-sym-pop-head">
            <span className={`sym-dot kind-${pop.kind} ui-sym-pop-dot`} />
            <span className="ui-sym-pop-name">{pop.name}</span>
            <button type="button" className="ui-sym-pop-close" aria-label="close" onClick={() => setPop(null)}>
              ✕
            </button>
          </div>
          {popLoading ? (
            <div className="ui-sym-pop-loading">
              <span className="ui-spinner" />
            </div>
          ) : popGraph && popGraph.nodes.length > 0 ? (
            <>
              {(["caller", "callee"] as const).map((role) => {
                const items = popGraph.nodes.filter((n) => n.role === role).slice(0, 12);
                return (
                  <div className="ui-sym-pop-sec" key={role}>
                    <div className="ui-sym-pop-sec-label">
                      {role === "caller" ? t("symbols.callers") : t("symbols.callees")}
                    </div>
                    {items.length === 0 ? (
                      <span className="ui-sym-pop-none">{t("symbols.noRelations")}</span>
                    ) : (
                      <div className="ui-sym-pop-chips">
                        {items.map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            className="ui-sym-pop-chip"
                            onClick={() => {
                              setPop(null);
                              onRecenter(n.name);
                            }}
                          >
                            <span className={`sym-dot kind-${n.kind}`} />
                            {truncate(n.name, 26)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                className="ui-sym-pop-center"
                onClick={() => {
                  setPop(null);
                  onRecenter(pop.name);
                }}
              >
                ◈ {t("symbols.recenter")}
              </button>
            </>
          ) : (
            <div className="ui-sym-pop-none">{t("symbols.noRelations")}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
