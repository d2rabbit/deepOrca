/**
 * RiskGraphView — the review tab's risk graph (user ask 2026-09-01, round 3:
 * 按层划分、铺满画布；悬浮窗带颜色标记). A real node-link DIAGRAM drawn as
 * one SVG with a deterministic TIER-LAYERED layout — no physics blob:
 *   - RISK TIERS are full-width horizontal bands (高风险 on top, 中风险,
 *     低风险 below) — the map reads as risk stratification and fills the
 *     canvas instead of clustering top-left;
 *   - within a band, each group (community / file, toggled) is a side-by-side
 *     hue-tinted block with its nodes on one risk-desc row; cross-block
 *     edges draw as violet beziers with direction arrows;
 *   - hover a node to light its neighborhood (the rest dims); click opens
 *     the floating window — tier-accented, with color-coded metrics
 *     (score by tier, coverage by state, security check), the community hue
 *     dot, callers/callees and the RELATED FINDINGS of the selected report
 *     (each jumps back to the report view).
 *
 * Data: structure comes from review:riskGraph (report-agnostic, refetched
 * only when the graph rebuilds); finding bindings arrive per-report through
 * review:readReport — the graph itself never refetches on report switches.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import type { FindingBinding, RiskGraphData, RiskGraphNode } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import {
  buildOpinions,
  buildRiskGroups,
  edgePath,
  LAYER,
  layoutBoard,
  neighborsOf,
  tierOf,
  type BoardMode,
  type OpinionFinding,
  type RiskTier,
} from "../lib/risk-board";

/** Neighbor chips cap per popover section (hidden count is disclosed). */
const POP_LIMIT = 10;
/** Node label cap in the diagram. */
/** i18n label per tier band (the lib stays UI-free — bands carry tiers). */
const TIER_LABEL_KEY: Record<RiskTier, "review.rgLegendHigh" | "review.rgLegendMid" | "review.rgLegendLow"> = {
  hi: "review.rgLegendHigh",
  md: "review.rgLegendMid",
  lo: "review.rgLegendLow",
};

/** Coverage value → color class (two vocabularies, crg-query's rule). */
function covClassOf(coverage: string): "no" | "mid" | "ok" {
  const c = coverage.toLowerCase();
  if (c === "untested" || c === "uncovered") return "no";
  if (c === "partial") return "mid";
  return "ok";
}

/** A report→graph locate request; `seq` makes repeated targets re-fire. */
export interface RiskFocusRequest {
  qn: string;
  seq: number;
}

type Props = {
  root: string;
  /** The selected report's parsed findings — the popover's opinions source. */
  findings: OpinionFinding[];
  /** Per-report finding→node bindings (reviewReadReport's `bindings`). */
  bindingsByIndex: Record<number, FindingBinding>;
  /** Report → graph: select this node (scroll + popover + flash). */
  focusReq: RiskFocusRequest | null;
  /** Popover → report: jump back to one finding (index into `findings`). */
  onJumpToFinding: (findex: number) => void;
};

export function RiskGraphView({ root, findings, bindingsByIndex, focusReq, onJumpToFinding }: Props): JSX.Element {
  const { t } = useI18n();
  const [data, setData] = useState<RiskGraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<BoardMode>("community");
  // Floating window (SymbolGraphView's popover pattern): viewport-fixed
  // portal at the click point; Esc / outside press / any scroll closes.
  const [pop, setPop] = useState<{ qn: string; x: number; y: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Hover drives the neighborhood highlight; the popover anchors selection.
  const [hoverQn, setHoverQn] = useState<string | null>(null);
  // A locate that raced the fetch — delivered once nodes render.
  const pendingFocusRef = useRef<string | null>(null);
  // Severity filters (user report 2026-09-02: 图例长得像筛选但点了没反应 —
  // make them REAL toggles): hi/md/lo show/hide their tier; secOnly narrows
  // to security-relevant nodes. All-on + secOnly-off = unfiltered.
  const [tierFilter, setTierFilter] = useState({ hi: true, md: true, lo: true, secOnly: false });
  const filterActive = !tierFilter.hi || !tierFilter.md || !tierFilter.lo || tierFilter.secOnly;

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await api.reviewRiskGraph(root);
      setData(res.data);
      setError(res.data ? null : (res.error ?? t("app.requestFailed")));
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [root, t]);

  useEffect(() => {
    setData(null);
    setPop(null);
    void load();
  }, [load]);

  // Out-of-band CRG rebuilds refresh the graph (same hook the panel rows use).
  useEffect(() => {
    return api.onCrgProgress((evt: { done?: boolean }) => {
      if (evt.done) void load();
    });
  }, [load]);

  // Popover dismissal — capture-phase scroll so inner scrollers close it too.
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
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [pop]);

  // Pane observation (user report 2026-09-01: 占据位置不够且堆积) — the
  // layout fills the OBSERVED pane: blocks stretch with width, leftover
  // height spreads into band gaps.
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [pane, setPane] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setPane({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byQn = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.qn, n])), [data]);
  const visibleNodes = useMemo(() => {
    const nodes = data?.nodes ?? [];
    if (!filterActive) return nodes;
    return nodes.filter((n) => {
      const tier = tierOf(n.risk);
      if (tier === "hi" && !tierFilter.hi) return false;
      if (tier === "md" && !tierFilter.md) return false;
      if (tier === "lo" && !tierFilter.lo) return false;
      if (tierFilter.secOnly && !n.security) return false;
      return true;
    });
  }, [data, tierFilter, filterActive]);
  const visibleQns = useMemo(() => new Set(visibleNodes.map((n) => n.qn)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => (data?.edges ?? []).filter((e) => visibleQns.has(e.source) && visibleQns.has(e.target)),
    [data, visibleQns]
  );
  const opinions = useMemo(() => buildOpinions(findings, bindingsByIndex), [findings, bindingsByIndex]);
  const groups = useMemo(
    () => (data && visibleNodes.length > 0 ? buildRiskGroups({ ...data, nodes: visibleNodes }, mode) : []),
    [data, visibleNodes, mode]
  );
  const layout = useMemo(
    () => layoutBoard(groups, pane.w > 300 ? { width: pane.w, height: pane.h } : undefined),
    [groups, pane]
  );
  // Undirected adjacency for the hover/selection dimming pass — within the
  // FILTERED board, so hover never lights nodes the user filtered away.
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of visibleEdges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [visibleEdges]);

  /** Select a node: scroll it into view, open the popover at it. When the
   *  node ranks outside the displayed top-N (a bound finding on the deep
   *  binding set) refetch WITH that qn so the graph pulls it in; when it is
   *  merely hidden by the severity filter, reveal it and retry. */
  const focusNode = useCallback(
    (qn: string, coords?: { x: number; y: number }): void => {
      const el = document.querySelector(`[data-qn="${CSS.escape(qn)}"]`);
      if (!el) {
        if (data && !byQn.has(qn)) {
          pendingFocusRef.current = qn;
          setLoading(true);
          void api
            .reviewRiskGraph(root, [qn])
            .then((res) => {
              setData(res.data);
              setError(res.data ? null : (res.error ?? t("app.requestFailed")));
            })
            .catch(() => setError(t("app.requestFailed")))
            .finally(() => setLoading(false));
          return;
        }
        // In the graph but hidden by the severity filter — reveal, then the
        // pending-focus effect re-selects once the diagram re-renders.
        if (byQn.has(qn)) setTierFilter({ hi: true, md: true, lo: true, secOnly: false });
        pendingFocusRef.current = qn;
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("rb-flash");
      void el.getBoundingClientRect(); /* force layout so the animation restarts */
      el.classList.add("rb-flash");
      const r = el.getBoundingClientRect();
      setPop({
        qn,
        x: Math.max(8, Math.min((coords?.x ?? r.right) + 12, window.innerWidth - 336)),
        y: Math.max(8, Math.min((coords?.y ?? r.bottom) + 10, window.innerHeight - 380)),
      });
    },
    [data, byQn, root, t]
  );

  // Report → graph locate (the seq token re-fires on repeated targets).
  useEffect(() => {
    if (!focusReq) return;
    focusNode(focusReq.qn);
  }, [focusReq, focusNode]);

  // A locate stashed while loading — deliver once the diagram rendered.
  useEffect(() => {
    if (!pendingFocusRef.current || loading || !data) return;
    const qn = pendingFocusRef.current;
    pendingFocusRef.current = null;
    focusNode(qn);
  }, [loading, data, focusNode]);

  const focus = hoverQn ?? pop?.qn ?? null;
  const focusNeighbors = focus ? (adjacency.get(focus) ?? null) : null;
  // Label budget = slot width in glyphs (~6.2px/char) minus the score suffix
  // — labels must NEVER bleed into the neighboring slot (narrow-pane overlap).
  const nodeLabel = (name: string): string => {
    const max = Math.max(8, Math.floor(layout.slotW / 6.2) - 5);
    return name.length > max ? `${name.slice(0, max - 1)}…` : name;
  };

  const popNode = pop ? byQn.get(pop.qn) : null;
  const popNeighbors = pop && data ? neighborsOf(data.edges, pop.qn) : null;
  const popOps = pop ? (opinions.get(pop.qn) ?? []) : [];

  return (
    <div className="ui-risk-board">
      <div className="ui-risk-board-top">
        <div className="ui-risk-board-meta">
          {data ? t("review.rgMeta", { n: visibleNodes.length, m: visibleEdges.length, g: groups.length }) : ""}
        </div>
        <span className="ui-risk-seg">
          <button
            type="button"
            className={`ui-risk-seg-btn${mode === "community" ? " on" : ""}`}
            onClick={() => setMode("community")}
          >
            {t("review.rgByCommunity")}
          </button>
          <button
            type="button"
            className={`ui-risk-seg-btn${mode === "file" ? " on" : ""}`}
            onClick={() => setMode("file")}
          >
            {t("review.rgByFile")}
          </button>
        </span>
      </div>
      <div className="ui-risk-board-legend">
        <button
          type="button"
          className={`ui-risk-legend-chip${tierFilter.hi ? " on" : ""}`}
          aria-pressed={tierFilter.hi}
          onClick={() => setTierFilter((f) => ({ ...f, hi: !f.hi }))}
        >
          <i className="rb-dot tier-hi" /> {t("review.rgLegendHigh")}
        </button>
        <button
          type="button"
          className={`ui-risk-legend-chip${tierFilter.md ? " on" : ""}`}
          aria-pressed={tierFilter.md}
          onClick={() => setTierFilter((f) => ({ ...f, md: !f.md }))}
        >
          <i className="rb-dot tier-md" /> {t("review.rgLegendMid")}
        </button>
        <button
          type="button"
          className={`ui-risk-legend-chip${tierFilter.lo ? " on" : ""}`}
          aria-pressed={tierFilter.lo}
          onClick={() => setTierFilter((f) => ({ ...f, lo: !f.lo }))}
        >
          <i className="rb-dot tier-lo" /> {t("review.rgLegendLow")}
        </button>
        <button
          type="button"
          className={`ui-risk-legend-chip${tierFilter.secOnly ? " on" : ""}`}
          aria-pressed={tierFilter.secOnly}
          onClick={() => setTierFilter((f) => ({ ...f, secOnly: !f.secOnly }))}
        >
          <i className="rb-dot tier-lo sec" /> {t("review.rgLegendSecurity")}
        </button>
        <span className="ui-risk-board-hint">{t("review.rgHint")}</span>
      </div>

      <div className="ui-risk-board-scroll" ref={paneRef}>
        {loading && !data ? (
          <div className="ui-risk-board-state">
            <span className="ui-spinner" />
          </div>
        ) : error ? (
          <div className="ui-risk-board-state">
            {error}{" "}
            <button
              type="button"
              className="ui-review-retry"
              onClick={() => {
                setError(null);
                void load();
              }}
            >
              {t("error.retry")}
            </button>
          </div>
        ) : layout.tiers.length === 0 ? (
          <div className="ui-risk-board-state">{t("review.noReports")}</div>
        ) : (
          <svg
            className="ui-risk-svg"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
          >
            <defs>
              {/* Soft lift under every node disc — depth without decoration. */}
              <filter id="rb-glow" x="-60%" y="-60%" width="220%" height="220%">
                <feDropShadow dx="0" dy="1.2" stdDeviation="1.6" floodColor="#0b1220" floodOpacity="0.28" />
              </filter>
              {/* Call-direction arrowheads, one fill per edge state (picked by
                  class in CSS — marker-end is stylable in Chromium). */}
              {(
                [
                  ["rb-arrow", "var(--rb-edge-base)"],
                  ["rb-arrow-x", "var(--rb-edge-cross)"],
                  ["rb-arrow-lit", "var(--ui-accent, #3b82f6)"],
                ] as const
              ).map(([id, fill]) => (
                <marker
                  key={id}
                  id={id}
                  viewBox="0 0 8 8"
                  markerWidth="6.5"
                  markerHeight="6.5"
                  refX="6.5"
                  refY="4"
                  orient="auto-start-reverse"
                >
                  <path d="M0.5,0.8 L7.2,4 L0.5,7.2 Z" fill={fill} />
                </marker>
              ))}
            </defs>
            {/* Tier bands — full-width risk layers (hi above md above lo). */}
            {layout.tiers.map((band) => (
              <g key={band.tier} className={`rb-tier tier-${band.tier}`}>
                <rect
                  x={LAYER.padX}
                  y={band.y}
                  width={layout.width - LAYER.padX * 2}
                  height={band.h}
                  rx={12}
                  className="rb-tier-bg"
                />
                <circle
                  cx={LAYER.padX + LAYER.bandPadX + 4}
                  cy={band.y + 17}
                  r={4}
                  className={`rb-tier-dot tier-${band.tier}`}
                />
                <text x={LAYER.padX + LAYER.bandPadX + 14} y={band.y + 21} className="rb-tier-label">
                  {t(TIER_LABEL_KEY[band.tier])}
                </text>
                <text
                  x={LAYER.padX + layout.width - LAYER.padX * 2 - LAYER.bandPadX}
                  y={band.y + 21}
                  textAnchor="end"
                  className="rb-tier-count"
                >
                  {band.count}
                </text>
              </g>
            ))}
            {/* Group blocks — hue-tinted community/file tiles inside a band. */}
            {layout.blocks.map((b) => {
              const hueVar = b.hueIndex != null ? `var(--ui-diagram-hue-${b.hueIndex % 8})` : null;
              const label = b.label || t("review.rgNoCommunity");
              const maxChars = Math.max(4, Math.floor((b.w - 46) / 6.4));
              const head = label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label;
              return (
                <g
                  key={`${b.key}@${b.y}`}
                  className="rb-block"
                  style={hueVar ? ({ "--lane-hue": hueVar } as React.CSSProperties) : undefined}
                >
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={9} className="rb-block-bg" />
                  <circle cx={b.x + 13} cy={b.y + 13} r={3.5} className="rb-block-hue-dot" />
                  <text x={b.x + 22} y={b.y + 17} className="rb-block-head">
                    <title>{label}</title>
                    {head}
                  </text>
                  <text x={b.x + b.w - 9} y={b.y + 17} textAnchor="end" className="rb-block-count">
                    {b.count}
                  </text>
                </g>
              );
            })}
            {/* Edges — under the nodes; cross-block violet, neighborhood lit.
                Only edges whose BOTH endpoints survive the severity filter. */}
            {visibleEdges.map((e, i) => {
              const a = layout.nodes.get(e.source);
              const b = layout.nodes.get(e.target);
              if (!a || !b) return null;
              const cross = a.blockKey !== b.blockKey;
              const lit = focus != null && (e.source === focus || e.target === focus);
              return (
                <path
                  key={i}
                  d={edgePath(a, b)}
                  className={`rb-edge${cross ? " cross" : ""}${lit ? " lit" : ""}${focus != null && !lit ? " dim" : ""}`}
                />
              );
            })}
            {/* Nodes — risk-tier discs, security ring, label to the right. */}
            {groups.flatMap((g) =>
              g.nodes.map((n) => {
                const p = layout.nodes.get(n.qn);
                if (!p) return null;
                const dimmed = focus != null && focusNeighbors != null && n.qn !== focus && !focusNeighbors.has(n.qn);
                const selected = pop?.qn === n.qn;
                return (
                  <g
                    key={n.qn}
                    data-qn={n.qn}
                    className={`rb-node${dimmed ? " dim" : ""}${selected ? " sel" : ""}`}
                    onMouseEnter={() => setHoverQn(n.qn)}
                    onMouseLeave={() => setHoverQn((cur) => (cur === n.qn ? null : cur))}
                    onClick={(e) =>
                      setPop({
                        qn: n.qn,
                        x: Math.max(8, Math.min(e.clientX + 14, window.innerWidth - 336)),
                        y: Math.max(8, Math.min(e.clientY + 12, window.innerHeight - 380)),
                      })
                    }
                  >
                    <title>{`${n.name} · ${n.filePath}:${n.lineStart}`}</title>
                    {selected ? <circle cx={p.x} cy={p.y} r={p.r + 4.5} className="rb-sel-ring" /> : null}
                    {n.security ? <circle cx={p.x} cy={p.y} r={p.r + 3.5} className="rb-sec-ring" /> : null}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={p.r}
                      filter="url(#rb-glow)"
                      className={`rb-node-dot tier-${tierOf(n.risk)}`}
                    />
                    <text x={p.x} y={p.y + p.r + 12} textAnchor="middle" className="rb-node-label">
                      {nodeLabel(n.name)} <tspan className="rb-node-score">{n.risk.toFixed(2)}</tspan>
                    </text>
                  </g>
                );
              })
            )}
          </svg>
        )}
      </div>

      {pop && popNode
        ? createPortal(
            <div
              ref={popRef}
              className={`ui-risk-pop tier-${tierOf(popNode.risk)}`}
              style={{ left: pop.x, top: pop.y }}
              role="dialog"
            >
              <div className="ui-risk-pop-head">
                <span className={`rb-dot tier-${tierOf(popNode.risk)}${popNode.security ? " sec" : ""}`} />
                <span className="ui-risk-pop-name">{popNode.name}</span>
                <button type="button" className="ui-risk-pop-close" aria-label="close" onClick={() => setPop(null)}>
                  ✕
                </button>
              </div>
              <div className="ui-risk-pop-file" title={`${popNode.filePath}:${popNode.lineStart}`}>
                {popNode.filePath.split(/[\\/]/).pop()}:{popNode.lineStart}
              </div>
              <div className="ui-risk-pop-rows">
                <div className="row">
                  <span className="k">{t("review.rgScore")}</span>
                  <span className={`val tier-${tierOf(popNode.risk)}`}>{popNode.risk.toFixed(2)}</span>
                </div>
                <div className="row">
                  <span className="k">{t("review.rgCallers")}</span>
                  <span className="val num">{popNode.callers}</span>
                </div>
                <div className="row">
                  <span className="k">{t("review.rgCoverage")}</span>
                  <span className={`val cov-${covClassOf(popNode.coverage)}`}>{popNode.coverage}</span>
                </div>
                <div className="row">
                  <span className="k">{t("review.rgSecurity")}</span>
                  <span className={popNode.security ? "val ok" : "val dim"}>{popNode.security ? "✓" : "—"}</span>
                </div>
                <div className="row">
                  <span className="k">{t("review.rgCommunityLabel")}</span>
                  <span className="val comm">
                    {(() => {
                      const idx =
                        popNode.community != null
                          ? (data?.communities.findIndex((c) => c.id === popNode.community) ?? -1)
                          : -1;
                      const hue = idx >= 0 ? `var(--ui-diagram-hue-${idx % 8})` : null;
                      return (
                        <>
                          {hue ? <i className="comm-dot" style={{ background: hue }} /> : null}
                          {popNode.community != null
                            ? (data?.communities.find((c) => c.id === popNode.community)?.name ??
                              `#${popNode.community}`)
                            : t("review.rgNoCommunity")}
                        </>
                      );
                    })()}
                  </span>
                </div>
              </div>
              {popNeighbors ? (
                <NeighborSection
                  label={t("review.rgCalledBy")}
                  qns={popNeighbors.callers}
                  byQn={byQn}
                  onPick={(qn) => focusNode(qn, pop)}
                />
              ) : null}
              {popNeighbors ? (
                <NeighborSection
                  label={t("review.rgCalls")}
                  qns={popNeighbors.callees}
                  byQn={byQn}
                  onPick={(qn) => focusNode(qn, pop)}
                />
              ) : null}
              <div className="ui-risk-pop-sec">
                <div className="ui-risk-pop-sec-label">{t("review.rgRelated")}</div>
                {popOps.length === 0 ? (
                  <div className="ui-risk-pop-none">{t("review.rgNoRelated")}</div>
                ) : (
                  <>
                    {popOps.map((op) => (
                      <button
                        key={op.findex}
                        type="button"
                        className="ui-risk-pop-finding"
                        onClick={() => {
                          setPop(null);
                          onJumpToFinding(op.findex);
                        }}
                      >
                        <span className={`rb-dot tier-${op.sev}`} />
                        <span className="ui-risk-pop-finding-label">{op.label}</span>
                      </button>
                    ))}
                    <div className="ui-risk-pop-jumphint">{t("review.rgJumpHint")}</div>
                  </>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function NeighborSection({
  label,
  qns,
  byQn,
  onPick,
}: {
  label: string;
  qns: string[];
  byQn: Map<string, RiskGraphNode>;
  onPick: (qn: string) => void;
}): JSX.Element | null {
  const { t } = useI18n();
  if (qns.length === 0) return null;
  const shown = qns.slice(0, POP_LIMIT);
  return (
    <div className="ui-risk-pop-sec">
      <div className="ui-risk-pop-sec-label">{label}</div>
      <div className="ui-risk-pop-chips">
        {shown.map((qn) => {
          const risk = byQn.get(qn)?.risk ?? 0;
          return (
            <button
              key={qn}
              type="button"
              className={`ui-risk-pop-chip tier-${tierOf(risk)}`}
              title={qn}
              onClick={() => onPick(qn)}
            >
              <span className={`rb-dot tier-${tierOf(risk)}`} />
              <span className="ui-risk-pop-chip-name">{byQn.get(qn)?.name ?? qn}</span>
              <span className="ui-risk-pop-chip-score">{risk.toFixed(2)}</span>
            </button>
          );
        })}
        {qns.length > shown.length ? (
          <span className="ui-risk-pop-more">{t("review.rgMoreHidden", { n: qns.length - shown.length })}</span>
        ) : null}
      </div>
    </div>
  );
}
