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
  // One-hop popover: clicking an outer chip no longer navigates — it opens a
  // floating sub-graph preview with a "center here" action (deliberate drill).
  const [pop, setPop] = useState<{ name: string; kind: string; x: number; y: number } | null>(null);
  const [popGraph, setPopGraph] = useState<KnowledgeSymbolGraph | null>(null);
  const [popLoading, setPopLoading] = useState(false);
  const popSeqRef = useRef(0);

  // Any navigation/context change invalidates the popover.
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
  const bands = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return null;
    const roleMap = new Map(graph.nodes.map((n) => [n.id, n.role]));
    const byRole = (role: KnowledgeSymbolGraphNode["role"]): KnowledgeSymbolGraphNode[] =>
      graph.nodes
        .filter((n) => n.role === role)
        .map((n) => ({ ...n, _heaviness: graph.edges.filter((e) => e.source === n.id || e.target === n.id).length }))
        .sort((a, b) => b._heaviness - a._heaviness)
        .map(({ _heaviness, ...n }) => n) as unknown as KnowledgeSymbolGraphNode[];
    const callers = byRole("caller").slice(0, 16);
    const focus = byRole("focus").slice(0, 10);
    const callees = byRole("callee").slice(0, 16);
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
      callers,
      focus,
      callees,
      up: summarize("caller", "focus"),
      down: summarize("focus", "callee"),
      hidden:
        graph.nodes.filter((n) => n.role === "caller").length -
        callers.length +
        graph.nodes.filter((n) => n.role === "callee").length -
        callees.length,
    };
  }, [graph]);

  const chip = (n: KnowledgeSymbolGraphNode, flowRole: "caller" | "focus" | "callee"): JSX.Element => (
    <button
      key={n.id}
      type="button"
      className={`ui-sym-chip role-${flowRole}`}
      onClick={(e) => {
        if (flowRole === "focus") onRecenter(n.name);
        else openPopover(n, e.clientX, e.clientY);
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
        <section className="ui-sym-band">
          <header className="ui-sym-band-head caller">
            {t("symbols.callers")} · {bands.callers.length}
          </header>
          <div className="ui-sym-chips">{bands.callers.map((n) => chip(n, "caller"))}</div>
        </section>
        {connector(t("symbols.flowDown"), bands.up, "down")}
        <section className="ui-sym-band focus">
          <header className="ui-sym-band-head focus">
            {query.trim() ? query.trim() : t("symbols.focus")} · {bands.focus.length}
          </header>
          <div className="ui-sym-chips">{bands.focus.map((n) => chip(n, "focus"))}</div>
        </section>
        {connector(t("symbols.flowUp"), bands.down, "up")}
        <section className="ui-sym-band">
          <header className="ui-sym-band-head callee">
            {t("symbols.callees")} · {bands.callees.length}
          </header>
          <div className="ui-sym-chips">{bands.callees.map((n) => chip(n, "callee"))}</div>
        </section>
        {bands.hidden > 0 || graph?.truncated ? (
          <div className="ui-symbol-graph-truncated">{t("symbols.truncated")}</div>
        ) : null}
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
