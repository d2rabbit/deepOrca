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
import { createPortal } from "react-dom";
import { api } from "../api";
import { useI18n } from "../i18n";
import type { KnowledgeSymbolGraph, KnowledgeSymbolGraphNode } from "../../shared/ipc";

type Props = {
  root: string;
  query: string;
  /** Center the graph on this symbol name (re-fetch). */
  onRecenter: (name: string) => void;
};

/** Edge kinds, in legend order. Paint + dash patterns live in ui.css. */
const EDGE_KINDS = ["calls", "references", "instantiates", "implements"] as const;

/**
 * Progressive band disclosure (2026-08-28, "性能好 + 方便看"): bands start
 * small (initial counts — the old hard caps) so a hub symbol still paints
 * fast, but a "show more" pill at the end of each band expands it by
 * BAND_STEP. All nodes are already in memory (the fetch is unchanged — no
 * extra IPC), so expanding is a pure render-count change; the sort stays
 * connectivity-desc, so later batches are simply less-connected. The footer
 * note now reports ONLY the backend edge cap (true data incompleteness) —
 * display truncation is disclosed per band instead.
 */
const BAND_INITIAL = { caller: 16, focus: 10, callee: 16 } as const;
const BAND_STEP = 24;
const POP_LIMIT = 12;
type BandRole = keyof typeof BAND_INITIAL;

export function SymbolGraphView({ root, query, onRecenter }: Props): JSX.Element {
  const { t } = useI18n();
  const [graph, setGraph] = useState<KnowledgeSymbolGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One-hop popover: clicking an outer chip no longer navigates — it opens a
  // floating sub-graph preview with a "center here" action (deliberate drill).
  const [pop, setPop] = useState<{ name: string; kind: string; x: number; y: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popGraph, setPopGraph] = useState<KnowledgeSymbolGraph | null>(null);
  const [popLoading, setPopLoading] = useState(false);
  const popSeqRef = useRef(0);
  // Visible chip count per band; reset with every navigation/context change.
  const [bandCounts, setBandCounts] = useState<Record<BandRole, number>>({ ...BAND_INITIAL });

  // Any navigation/context change invalidates the popover AND the expansion.
  useEffect(() => {
    setPop(null);
    setPopGraph(null);
    setBandCounts({ ...BAND_INITIAL });
  }, [root, query]);

  // Esc / any scroll / outside press closes the popover — it is viewport-
  // fixed, so without the scroll hook it detaches from its anchor chip and
  // floats stranded over the board once the canvas scrolls.
  useEffect(() => {
    if (!pop) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setPop(null);
    };
    const onScroll = (): void => setPop(null);
    const onPointerDown = (e: MouseEvent): void => {
      if (!popRef.current?.contains(e.target as Node)) setPop(null);
    };
    window.addEventListener("keydown", onKey);
    // Capture phase: the graph canvas is an inner scroller; window-level
    // capture sees its scroll events without wiring each container.
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [pop]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // Drop the previous query's board immediately: the focus band header
    // already shows the NEW query, so rendering the old bands under it until
    // the response lands reads as wrong data, not as loading.
    setGraph(null);
    (async () => {
      try {
        const result = await api.knowledgeSymbolGraph(root, query || undefined);
        if (alive) {
          setGraph(result);
          setError(null);
        }
      } catch (err) {
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

  // Band data + flow summaries. The redesign (audit 2026-08-26, "still messy
  // and spreads downward"): the three-column bezier graph is gone. The view
  // is now a VERTICAL FLOW — callers band on top, focus hub in the middle,
  // callees at the bottom — chips wrap responsively (the canvas follows the
  // window, content never sprawls), and per-edge curves are replaced by an
  // aggregate flow summary between bands (real per-edge detail lives in the
  // click popover). No absolute positioning, no SVG geometry.
  //
  // Full lists are returned (sorted connectivity-desc); the RENDER count is
  // governed by bandCounts — see BAND_INITIAL.
  const bands = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return null;
    const roleMap = new Map(graph.nodes.map((n) => [n.id, n.role]));
    const byRole = (role: KnowledgeSymbolGraphNode["role"]): KnowledgeSymbolGraphNode[] =>
      graph.nodes
        .filter((n) => n.role === role)
        .map((n) => ({ ...n, _heaviness: graph.edges.filter((e) => e.source === n.id || e.target === n.id).length }))
        .sort((a, b) => b._heaviness - a._heaviness)
        .map(({ _heaviness, ...n }) => n) as unknown as KnowledgeSymbolGraphNode[];
    const summarize = (fromRole: "caller" | "focus", toRole: "focus" | "callee"): Array<[string, number]> => {
      const counts = new Map<string, number>();
      for (const e of graph.edges) {
        const s = roleMap.get(e.source);
        const tg = roleMap.get(e.target);
        if (s === fromRole && tg === toRole) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    };
    return {
      caller: byRole("caller"),
      focus: byRole("focus"),
      callee: byRole("callee"),
      up: summarize("caller", "focus"),
      down: summarize("focus", "callee"),
    };
  }, [graph]);

  const chip = (n: KnowledgeSymbolGraphNode, flowRole: "caller" | "focus" | "callee"): JSX.Element => (
    <button
      key={n.id}
      type="button"
      className={`ui-sym-chip role-${flowRole}`}
      // Names can CSS-ellipsis inside the 260px chip — the full identity
      // (name + file) stays reachable on hover.
      title={`${n.name} · ${n.filePath}`}
      onClick={(e) => {
        if (flowRole === "focus") {
          // The current query's own symbol is already the focus hub —
          // recentering onto it would push a duplicate entry into the
          // parent's navigation history (Back would no-op and burn a step).
          if (n.name !== query.trim()) onRecenter(n.name);
        } else {
          openPopover(n, e.clientX, e.clientY);
        }
      }}
    >
      <span className={`sym-dot kind-${n.kind}`} />
      <span className="ui-sym-chip-name">{n.name}</span>
      <span className="ui-sym-chip-meta">
        {n.filePath.split(/[\\/]/).pop()} · {n.kind}
      </span>
    </button>
  );

  const connector = (labelKey: string, summaries: Array<[string, number]>, dir: "down" | "up"): JSX.Element => (
    <div className="ui-sym-flowgap" aria-hidden>
      <span className="ui-sym-flowgap-line" />
      <div className="ui-sym-flowgap-pills">
        <span className="ui-sym-flowgap-label">{labelKey}</span>
        {summaries.map(([kind, count]) => (
          <span key={kind} className={`ui-sym-flowgap-pill edge-${kind}`}>
            {count} · {kind}
          </span>
        ))}
      </div>
      <span className="ui-sym-flowgap-arrow">{dir === "down" ? "▼" : "▲"}</span>
    </div>
  );

  // One band: header (label · visible count), chips up to bandCounts[role],
  // and a "show more" pill while anything remains hidden.
  const bandSection = (role: BandRole, label: string): JSX.Element => {
    const list = bands![role];
    const shown = list.slice(0, bandCounts[role]);
    const rest = list.length - shown.length;
    return (
      <section className={`ui-sym-band${role === "focus" ? " focus" : ""}`}>
        <header className={`ui-sym-band-head ${role}`}>
          {label} · {shown.length}
          {rest > 0 ? <span className="ui-sym-band-rest">/{list.length}</span> : null}
        </header>
        <div className="ui-sym-chips">
          {shown.map((n) => chip(n, role))}
          {rest > 0 ? (
            <button
              type="button"
              className="ui-sym-more"
              onClick={() => setBandCounts((c) => ({ ...c, [role]: c[role] + BAND_STEP }))}
            >
              {t("symbols.showMore", { n: Math.min(BAND_STEP, rest), total: rest })}
            </button>
          ) : null}
        </div>
      </section>
    );
  };

  // Empty/loading/error render INSIDE the canvas — the panel toolbar (Back/
  // Home, legend) always stays mounted above (dead-end drill never strands).
  const boardInner =
    loading && !graph ? (
      <div className="ui-symbol-graph-boardstate">
        <span className="ui-spinner" />
      </div>
    ) : error ? (
      <div className="ui-symbol-graph-boardstate">{t("symbols.error")}</div>
    ) : !bands ? (
      <div className="ui-symbol-graph-boardstate">{t("index.symbolsEmpty")}</div>
    ) : (
      <div className="ui-sym-flow">
        {bandSection("caller", t("symbols.callers"))}
        {connector(t("symbols.flowDown"), bands.up, "down")}
        {bandSection("focus", query.trim() ? query.trim() : t("symbols.focus"))}
        {connector(t("symbols.flowUp"), bands.down, "down")}
        {bandSection("callee", t("symbols.callees"))}
        {graph?.truncated ? <div className="ui-symbol-graph-truncated">{t("symbols.truncated")}</div> : null}
      </div>
    );

  return (
    <div className="ui-symbol-graph">
      <div className="ui-symbol-graph-legend">
        {EDGE_KINDS.map((kind) => (
          <span key={kind} className="ui-symbol-graph-legend-item">
            <svg width="22" height="6">
              <line x1="0" y1="3" x2="22" y2="3" className={`sym-edge edge-${kind}`} strokeWidth="2" />
            </svg>
            {kind}
          </span>
        ))}
      </div>
      <div className="ui-symbol-graph-scroll">{boardInner}</div>
      <div className="ui-symbol-graph-hint">{t("symbols.clickHint")}</div>
      {pop
        ? // Portal to <body> (audit 2026-08-28, real-machine "浮窗离得太远"):
          // .ui-knowledge-body carries container-type: inline-size (container
          // queries), whose implied `contain: layout` makes IT the containing
          // block for fixed descendants — viewport-coords positioning then
          // landed offset by the pane's origin. At body level, position:fixed
          // + clientX/Y is viewport-true again (same escape as ui/tooltip).
          createPortal(
            <div ref={popRef} className="ui-sym-pop" style={{ left: pop.x, top: pop.y }} role="dialog">
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
                    // POP_LIMIT keeps the popover light; the hidden count is
                    // DISCLOSED (the board's old sin was cutting silently).
                    const all = popGraph.nodes.filter((n) => n.role === role);
                    const items = all.slice(0, POP_LIMIT);
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
                                title={`${n.name} · ${n.filePath}`}
                                onClick={() => {
                                  setPop(null);
                                  onRecenter(n.name);
                                }}
                              >
                                <span className={`sym-dot kind-${n.kind}`} />
                                <span className="ui-sym-pop-chip-name">{n.name}</span>
                              </button>
                            ))}
                            {all.length > items.length ? (
                              <span className="ui-sym-pop-more">
                                {t("symbols.moreHidden", { n: all.length - items.length })}
                              </span>
                            ) : null}
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
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
