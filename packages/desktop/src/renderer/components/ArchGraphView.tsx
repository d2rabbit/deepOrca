/**
 * ArchGraphView — the architecture diagram rendered as a DOM graph, mirroring
 * SymbolGraphView's interaction grammar exactly (user directive 2026-08-30:
 * 类似索引关系图的效果，不要 iframe / 独立窗口 / 覆盖层).
 *
 *   - reads the typed-IR JSON (components / connections / boundaries)
 *   - BANDS: upstream → focus → downstream (like symbol graph's caller/focus/callee)
 *   - each component is a CHIP (type-hued, sublabel, boundary tag)
 *   - click a chip → POPOVER near the chip with its connections + "center here"
 *   - progressive disclosure (show more pill per band)
 *   - component-type legend
 *   - all rendered directly in the panel — zero iframes, zero OS windows
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { useI18n } from "../i18n";

interface IRComponent {
  id: string;
  type?: string;
  label?: string;
  sublabel?: string;
}
interface IRBoundary {
  kind?: string;
  label?: string;
  wraps?: string[];
}
interface IRConnection {
  from: string;
  to: string;
  label?: string;
}
interface IRDoc {
  components: IRComponent[];
  boundaries?: IRBoundary[];
  connections: IRConnection[];
  meta?: { title?: string };
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
const labelOf = (c: IRComponent): string => c.label ?? c.id;

/** Initial chips shown per band before "show more". */
const BAND_INITIAL = 14;
const BAND_STEP = 24;

export function ArchGraphView({ jsonPath }: { jsonPath: string }): JSX.Element {
  const { t } = useI18n();
  const [doc, setDoc] = useState<IRDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [bandCounts, setBandCounts] = useState({ up: BAND_INITIAL, down: BAND_INITIAL });
  const [pop, setPop] = useState<{ comp: IRComponent; x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load the IR document
  useEffect(() => {
    let alive = true;
    setDoc(null);
    setError(null);
    setFocusId(null);
    setPop(null);
    (async () => {
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
        // Auto-focus the first component with the most connections
        const degree = new Map<string, number>();
        for (const c of parsed.connections) {
          degree.set(c.from, (degree.get(c.from) ?? 0) + 1);
          degree.set(c.to, (degree.get(c.to) ?? 0) + 1);
        }
        const best = [...parsed.components].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0];
        if (best) setFocusId(best.id);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [jsonPath, t]);

  // Reset expansion on focus change
  useEffect(() => {
    setBandCounts({ up: BAND_INITIAL, down: BAND_INITIAL });
    setPop(null);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [focusId]);

  // Derive: lookup maps + band partitions
  const derived = useMemo(() => {
    if (!doc) return null;
    const byId = new Map(doc.components.map((c) => [c.id, c]));
    const boundaryOf = new Map<string, string>();
    for (const b of doc.boundaries ?? []) {
      for (const id of b.wraps ?? []) boundaryOf.set(id, b.label ?? "");
    }
    const incoming = new Map<string, IRConnection[]>();
    const outgoing = new Map<string, IRConnection[]>();
    for (const c of doc.connections) {
      if (!byId.has(c.from) || !byId.has(c.to)) continue;
      if (!outgoing.has(c.from)) outgoing.set(c.from, []);
      outgoing.get(c.from)!.push(c);
      if (!incoming.has(c.to)) incoming.set(c.to, []);
      incoming.get(c.to)!.push(c);
    }
    return { byId, boundaryOf, incoming, outgoing };
  }, [doc]);

  const recenter = useCallback((id: string): void => {
    setFocusId(id);
    setPop(null);
  }, []);

  if (error) return <div className="ui-knowledge-preview-error">{error}</div>;
  if (!doc || !derived) return <div className="ui-knowledge-preview-loading" />;
  const { byId, boundaryOf, incoming, outgoing } = derived;

  const focus = focusId ? byId.get(focusId) : null;
  const upList = (incoming.get(focusId ?? "") ?? []).map((c) => ({
    conn: c,
    comp: byId.get(c.from)!,
  }));
  const downList = (outgoing.get(focusId ?? "") ?? []).map((c) => ({
    conn: c,
    comp: byId.get(c.to)!,
  }));

  const chip = (c: IRComponent, opts: { connLabel?: string; isFocus?: boolean }): JSX.Element => (
    <button
      type="button"
      key={`${c.id}-${opts.connLabel ?? ""}`}
      className={`ui-sym-chip${opts.isFocus ? " focus" : ""}`}
      onClick={(e) => {
        const host = scrollRef.current?.getBoundingClientRect();
        setPop({
          comp: c,
          x: e.clientX - (host?.left ?? 0),
          y: e.clientY - (host?.top ?? 0),
        });
      }}
    >
      <span className="sym-dot" style={{ background: hueOf(c.type) }} />
      <span className="ui-sym-chip-name">{labelOf(c)}</span>
      {c.sublabel ? <span className="ui-sym-chip-meta">{c.sublabel}</span> : null}
      {opts.connLabel ? <span className="ui-arch-chip-conn">{opts.connLabel}</span> : null}
      {boundaryOf.get(c.id) ? <span className="ui-arch-chip-bnd">{boundaryOf.get(c.id)}</span> : null}
    </button>
  );

  const bandSection = (
    role: "up" | "down",
    label: string,
    list: Array<{ conn: IRConnection; comp: IRComponent }>
  ): JSX.Element => {
    const shown = list.slice(0, bandCounts[role]);
    const rest = list.length - shown.length;
    return (
      <section className={`ui-sym-band${role === "up" ? " callers" : " callees"}`}>
        <header className={`ui-sym-band-head ${role === "up" ? "callers" : "callees"}`}>
          {label} · {shown.length}
          {rest > 0 ? <span className="ui-sym-band-rest">/{list.length}</span> : null}
        </header>
        <div className="ui-sym-chips">
          {shown.map((x) => chip(x.comp, { connLabel: x.conn.label }))}
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

  const popConnections = pop
    ? {
        in: (incoming.get(pop.comp.id) ?? []).map((c) => ({ conn: c, comp: byId.get(c.from)! })),
        out: (outgoing.get(pop.comp.id) ?? []).map((c) => ({ conn: c, comp: byId.get(c.to)! })),
      }
    : null;

  return (
    <div className="ui-arch-graph">
      <div className="ui-symbol-graph-toolbar">
        <div className="ui-sym-legend">
          {[...new Set(doc.components.map((c) => c.type ?? "other"))].map((type) => (
            <span key={type} className="ui-sym-legend-item">
              <span className="sym-dot" style={{ background: hueOf(type) }} />
              {type}
            </span>
          ))}
        </div>
      </div>
      <div className="ui-symbol-graph-scroll" ref={scrollRef} onClick={() => setPop(null)}>
        {focus ? (
          <>
            {bandSection("up", t("symbols.callers"), upList)}
            <div className="ui-sym-flowgap">
              <span className="ui-sym-flowgap-line" />
              <span className="ui-sym-flowgap-arrow">▼</span>
              <span className="ui-sym-flowgap-label">{t("symbols.focus")}</span>
              <span className="ui-sym-flowgap-arrow">▼</span>
              <span className="ui-sym-flowgap-line" />
            </div>
            <section className="ui-sym-band focus">
              <header className="ui-sym-band-head focus">
                {labelOf(focus)} · {upList.length + downList.length} connections
              </header>
              <div className="ui-sym-chips">{chip(focus, { isFocus: true })}</div>
            </section>
            <div className="ui-sym-flowgap">
              <span className="ui-sym-flowgap-line" />
              <span className="ui-sym-flowgap-arrow">▼</span>
              <span className="ui-sym-flowgap-label">{t("symbols.callees")}</span>
              <span className="ui-sym-flowgap-arrow">▼</span>
              <span className="ui-sym-flowgap-line" />
            </div>
            {bandSection("down", t("symbols.callees"), downList)}
          </>
        ) : (
          <div className="ui-side-panel-empty">No components found</div>
        )}
      </div>
      <div className="ui-symbol-graph-hint">{t("symbols.clickHint")}</div>
      {pop && popConnections
        ? createPortal(
            <div
              ref={null}
              className="ui-sym-pop"
              style={{
                left: Math.min(Math.max(pop.x, 180), window.innerWidth - 180),
                top: Math.max(pop.y, 190),
              }}
              role="dialog"
            >
              <div className="ui-sym-pop-head">
                <span className={`sym-dot`} style={{ background: hueOf(pop.comp.type) }} />
                <span className="ui-sym-pop-name">{labelOf(pop.comp)}</span>
                <button type="button" className="ui-sym-pop-close" aria-label="close" onClick={() => setPop(null)}>
                  ✕
                </button>
              </div>
              {(["in", "out"] as const).map((dir) => {
                const list = popConnections[dir];
                return (
                  <div className="ui-sym-pop-sec" key={dir}>
                    <div className="ui-sym-pop-sec-label">
                      {dir === "in" ? t("symbols.callers") : t("symbols.callees")} ({list.length})
                    </div>
                    {list.length === 0 ? (
                      <span className="ui-sym-pop-none">{t("symbols.noRelations")}</span>
                    ) : (
                      <div className="ui-sym-pop-chips">
                        {list.slice(0, 12).map((x, i) => (
                          <button
                            key={i}
                            type="button"
                            className="ui-sym-pop-chip"
                            title={x.conn.label ?? ""}
                            onClick={() => recenter(x.comp.id)}
                          >
                            <span className="sym-dot" style={{ background: hueOf(x.comp.type), alignSelf: "center" }} />
                            <span className="ui-sym-pop-chip-name">{labelOf(x.comp)}</span>
                            {x.conn.label ? <em className="ui-arch-mm-rel">{x.conn.label}</em> : null}
                          </button>
                        ))}
                        {list.length > 12 ? (
                          <span className="ui-sym-pop-more">{t("symbols.moreHidden", { n: list.length - 12 })}</span>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
              <button type="button" className="ui-sym-pop-center" onClick={() => recenter(pop.comp.id)}>
                ◈ {t("symbols.recenter")}
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
