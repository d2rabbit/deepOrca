/**
 * ArchifyMiniMap — sub-level architecture artifacts drawn by OUR renderer,
 * symbol-graph style (user decision 2026-08-29: 一级直出内嵌、子级采用类似
 * 索引关系图的动态绘制). The hero artifact embeds archify's validated HTML;
 * SUB-level maps (module/dataflow/sequence/…) render here from the typed IR
 * with the same interaction grammar as SymbolGraphView:
 *   - components as type-hued boxes at their authored positions;
 *   - boundaries as translucent group frames;
 *   - connections as curved edges with labels;
 *   - click a component → popover listing its incoming/outgoing relations.
 *
 * The archify CLI remains the validation/render authority (HTML embed); this
 * pane is the NAVIGABLE OVERVIEW of a sub-level's structure.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { useI18n } from "../i18n";
import type { JSX } from "react";

/** Minimal typed-IR shapes the minimap consumes (defensive: unknown fields ignored). */
interface IRComponent {
  id: string;
  type?: string;
  label?: string;
  sublabel?: string;
  pos?: [number, number];
  size?: [number, number];
}
interface IRBoundary {
  id?: string;
  kind?: string;
  label?: string;
  wraps?: string[];
}
interface IRConnection {
  id?: string;
  from: string;
  to: string;
  label?: string;
}
interface IRDoc {
  components: IRComponent[];
  boundaries?: IRBoundary[];
  connections: IRConnection[];
  meta?: { title?: string; viewBox?: number[] };
}

const TYPE_HUES: Record<string, string> = {
  frontend: "#22d3ee",
  backend: "#2dd4bf",
  database: "#a78bfa",
  cloud: "#818cf8",
  security: "#f87171",
  messagebus: "#fbbf24",
  external: "#94a3b8",
};
const hueOf = (t?: string): string => TYPE_HUES[t ?? ""] ?? "#60a5fa";

/** Edge anchor: nearest point on the box border toward the other endpoint. */
function anchor(pos: [number, number], size: [number, number], toward: [number, number]): [number, number] {
  const [x, y] = pos;
  const [w, h] = size;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  if ((dx === 0 && dy === 0) || w <= 0 || h <= 0) return [cx, cy];
  if (Math.abs(dx) * h > Math.abs(dy) * w) {
    return dx > 0 ? [x + w, cy + (dy / Math.abs(dx)) * (w / 2)] : [x, cy - (dy / Math.abs(dx)) * (w / 2)];
  }
  return dy > 0 ? [cx + (dx / Math.abs(dy)) * (h / 2), y + h] : [cx - (dx / Math.abs(dy)) * (h / 2), y];
}

interface PopState {
  x: number;
  y: number;
  comp: IRComponent;
}

export function ArchifyMiniMap({ jsonPath }: { jsonPath: string }): JSX.Element {
  const { t } = useI18n();
  const [doc, setDoc] = useState<IRDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pop, setPop] = useState<PopState | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setDoc(null);
    setError(null);
    // Context switch closes the popover (SymbolGraphView does the same) — a
    // stale popover filtering the NEW doc with the OLD component id is worse
    // than none (review round 7).
    setPop(null);
    (async () => {
      // The await previously sat OUTSIDE the try (review round 7): a rejected
      // invoke left the pane on the loading spinner forever.
      try {
        const res = await api.knowledgeArchReadJson(jsonPath);
        if (!alive) return;
        if (!res.ok || !res.json) {
          setError(res.error ?? t("app.requestFailed"));
          return;
        }
        const parsed = JSON.parse(res.json) as IRDoc;
        if (!Array.isArray(parsed.components) || !Array.isArray(parsed.connections)) {
          setError("artifact is not a typed-IR document");
          return;
        }
        setDoc(parsed);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [jsonPath, t]);

  // Layout: authored positions when present; otherwise a simple grid fallback.
  const layout = useMemo(() => {
    if (!doc) return null;
    const boxes = new Map<string, { c: IRComponent; pos: [number, number]; size: [number, number] }>();
    let i = 0;
    for (const c of doc.components) {
      const pos: [number, number] =
        Array.isArray(c.pos) && c.pos.length === 2 && c.pos.every((n) => Number.isFinite(n))
          ? c.pos
          : [(i % 4) * 230 + 20, Math.floor(i / 4) * 130 + 20];
      const size: [number, number] =
        Array.isArray(c.size) && c.size.length === 2 && c.size.every((n) => Number.isFinite(n)) ? c.size : [170, 60];
      boxes.set(c.id, { c, pos, size });
      i++;
    }
    let w = 0;
    let h = 0;
    for (const b of boxes.values()) {
      w = Math.max(w, b.pos[0] + b.size[0]);
      h = Math.max(h, b.pos[1] + b.size[1]);
    }
    const vb = doc.meta?.viewBox;
    const W = Array.isArray(vb) && vb.length >= 2 && vb[0] >= w ? vb[0] : w + 40;
    const H = Array.isArray(vb) && vb.length >= 2 && vb[1] >= h ? vb[1] : h + 40;
    return { boxes, W: Math.max(W, 320), H: Math.max(H, 240) };
  }, [doc]);

  if (error) return <div className="ui-knowledge-preview-error">{error}</div>;
  if (!doc || !layout) return <div className="ui-knowledge-preview-loading" />;

  const { boxes, W, H } = layout;
  const connections = doc.connections.filter((c) => boxes.has(c.from) && boxes.has(c.to));

  return (
    <div ref={wrapRef} className="ui-arch-minimap" onClick={() => setPop(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="ui-arch-minimap-svg" style={{ minWidth: `${W}px` }} role="img">
        {/* boundaries */}
        {(doc.boundaries ?? []).map((b, bi) => {
          const members = (b.wraps ?? []).map((id) => boxes.get(id)).filter(Boolean) as Array<
            NonNullable<ReturnType<typeof boxes.get>>
          >;
          if (members.length === 0) return null;
          const x1 = Math.min(...members.map((m) => m.pos[0])) - 14;
          const y1 = Math.min(...members.map((m) => m.pos[1])) - 26;
          const x2 = Math.max(...members.map((m) => m.pos[0] + m.size[0])) + 14;
          const y2 = Math.max(...members.map((m) => m.pos[1] + m.size[1])) + 14;
          return (
            <g key={b.id ?? `b-${bi}`}>
              <rect
                x={x1}
                y={y1}
                width={x2 - x1}
                height={y2 - y1}
                rx={12}
                className={`ui-arch-mm-boundary ${b.kind === "security-group" ? "security" : ""}`}
              />
              <text x={x1 + 8} y={y1 + 15} className="ui-arch-mm-boundary-label">
                {b.label ?? ""}
              </text>
            </g>
          );
        })}
        {/* connections */}
        {connections.map((c, ci) => {
          const a = boxes.get(c.from)!;
          const b = boxes.get(c.to)!;
          const ac = [a.pos[0] + a.size[0] / 2, a.pos[1] + a.size[1] / 2] as [number, number];
          const bc = [b.pos[0] + b.size[0] / 2, b.pos[1] + b.size[1] / 2] as [number, number];
          const p1 = anchor(a.pos, a.size, bc);
          const p2 = anchor(b.pos, b.size, ac);
          const mx = (p1[0] + p2[0]) / 2;
          const path = `M ${p1[0]} ${p1[1]} C ${mx} ${p1[1]}, ${mx} ${p2[1]}, ${p2[0]} ${p2[1]}`;
          return (
            <g key={c.id ?? `c-${ci}`}>
              <path d={path} className="ui-arch-mm-edge" markerEnd="url(#ui-arch-mm-arrow)" />
              {c.label ? (
                <text x={mx} y={(p1[1] + p2[1]) / 2 - 4} className="ui-arch-mm-edge-label" textAnchor="middle">
                  {c.label}
                </text>
              ) : null}
            </g>
          );
        })}
        <defs>
          <marker
            id="ui-arch-mm-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" className="ui-arch-mm-arrow" />
          </marker>
        </defs>
        {/* components */}
        {[...boxes.values()].map(({ c, pos, size }) => (
          <g
            key={c.id}
            className="ui-arch-mm-node"
            transform={`translate(${pos[0]}, ${pos[1]})`}
            onClick={(e) => {
              e.stopPropagation();
              // Raw VIEWPORT coords (review round 7): the popover is portaled
              // to body and position:fixed — subtracting the container offset
              // (the first cut) rendered it 400-700px off and clipped. Clamp
              // like SymbolGraphView so edge nodes stay on screen.
              setPop({
                x: Math.min(Math.max(e.clientX, 180), window.innerWidth - 180),
                y: Math.max(e.clientY, 190),
                comp: c,
              });
            }}
          >
            <rect
              width={size[0]}
              height={size[1]}
              rx={8}
              style={{ stroke: hueOf(c.type) }}
              className="ui-arch-mm-box"
            />
            <text x={size[0] / 2} y={size[1] / 2 - 2} className="ui-arch-mm-label" textAnchor="middle">
              {c.label ?? c.id}
            </text>
            {c.sublabel ? (
              <text x={size[0] / 2} y={size[1] / 2 + 14} className="ui-arch-mm-sublabel" textAnchor="middle">
                {c.sublabel}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      {pop
        ? createPortal(
            <div className="ui-sym-pop ui-arch-mm-pop" style={{ left: pop.x, top: pop.y }} role="dialog">
              <div className="ui-sym-pop-head">
                <span className="ui-sym-pop-name">{pop.comp.label ?? pop.comp.id}</span>
                <span className="ui-sym-pop-type-tag">{pop.comp.type ?? "component"}</span>
              </div>
              {pop.comp.sublabel ? <div className="ui-arch-mm-pop-sub">{pop.comp.sublabel}</div> : null}
              {(["in", "out"] as const).map((dir) => {
                const rel = connections.filter((c) => (dir === "in" ? c.to === pop.comp.id : c.from === pop.comp.id));
                return (
                  <div className="ui-sym-pop-sec" key={dir}>
                    <div className="ui-sym-pop-sec-label">
                      {dir === "in" ? t("symbols.callers") : t("symbols.callees")} ({rel.length})
                    </div>
                    {rel.length === 0 ? (
                      <span className="ui-sym-pop-none">{t("symbols.noRelations")}</span>
                    ) : (
                      <div className="ui-sym-pop-chips">
                        {rel.map((c, i) => {
                          const otherId = dir === "in" ? c.from : c.to;
                          const other = boxes.get(otherId)?.c;
                          return (
                            <span className="ui-sym-pop-chip" key={c.id ?? i} title={c.label ?? ""}>
                              <span className="sym-dot" style={{ background: hueOf(other?.type) }} />
                              <span className="ui-sym-pop-chip-name">{other?.label ?? otherId}</span>
                              {c.label ? <em className="ui-arch-mm-rel">{c.label}</em> : null}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
