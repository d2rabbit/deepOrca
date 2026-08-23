/**
 * SerenaPanel (specs/index-knowledge-rework R3-6) — a floating right-side
 * panel that renders Serena MCP tool results as TARGETED views, extracted
 * per tool behavior (symbol lookup → code panel, overview → file/symbol
 * tree, references → grouped list, pattern search → match list).
 *
 * Display-layer only: the raw tool output still flows to the agent
 * untouched; this panel just mirrors what the agent is currently looking at,
 * so the user can follow along without reading raw tool dumps.
 */

import { useEffect, useState, type JSX } from "react";
import type { SerenaEvent, SerenaView } from "../lib/serena-extract";

type Props = {
  events: SerenaEvent[];
  onClose: () => void;
};

function shortPath(p: string): string {
  const parts = p.split("/");
  return parts.slice(-2).join("/");
}

function SymbolBody({
  name,
  kind,
  filePath,
  line,
  body,
}: {
  name: string;
  kind?: string;
  filePath?: string;
  line?: number;
  body?: string;
}): JSX.Element {
  return (
    <div className="ui-serena-symbol">
      <div className="ui-serena-symbol-head">
        {kind ? <span className="ui-knowledge-sym-kind">{kind}</span> : null}
        <strong>{name}</strong>
        {filePath ? (
          <span className="ui-serena-loc">
            {shortPath(filePath)}
            {line != null ? `:${line}` : ""}
          </span>
        ) : null}
      </div>
      {body ? <pre className="ui-serena-code">{body}</pre> : null}
    </div>
  );
}

function ViewBody({ view }: { view: SerenaView }): JSX.Element {
  switch (view.kind) {
    case "symbols":
      return (
        <div className="ui-serena-stack">
          {view.symbols.map((s, i) => (
            <SymbolBody key={`${s.name}-${i}`} {...s} />
          ))}
        </div>
      );
    case "overview":
      return (
        <div className="ui-serena-stack">
          {view.files.map((f) => (
            <div key={f.filePath} className="ui-serena-file-group">
              <div className="ui-serena-file-label" title={f.filePath}>
                {f.filePath} <span className="ui-serena-count">{f.symbols.length}</span>
              </div>
              <div className="ui-serena-symbol-list">
                {f.symbols.map((s, i) => (
                  <div key={`${s.name}-${i}`} className="ui-serena-symbol-row">
                    {s.kind ? <span className="ui-knowledge-sym-kind">{s.kind}</span> : null}
                    <span>{s.name}</span>
                    {s.line != null ? <span className="ui-serena-loc">:{s.line}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    case "references": {
      const byFile = new Map<string, typeof view.references>();
      for (const r of view.references) {
        const list = byFile.get(r.filePath) ?? [];
        list.push(r);
        byFile.set(r.filePath, list);
      }
      return (
        <div className="ui-serena-stack">
          {[...byFile.entries()].map(([filePath, refs]) => (
            <div key={filePath} className="ui-serena-file-group">
              <div className="ui-serena-file-label" title={filePath}>
                {filePath} <span className="ui-serena-count">{refs.length}</span>
              </div>
              <div className="ui-serena-ref-lines">
                {refs.map((r, i) => (
                  <span key={i} className="ui-serena-loc">
                    {r.line != null ? `L${r.line}` : "—"}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }
    case "matches":
      return (
        <div className="ui-serena-stack">
          {view.matches.map((m, i) => (
            <div key={i} className="ui-serena-match">
              <div className="ui-serena-loc">
                {m.filePath}
                {m.line != null ? `:${m.line}` : ""}
              </div>
              <pre className="ui-serena-code">{m.snippet}</pre>
            </div>
          ))}
        </div>
      );
    default:
      return <pre className="ui-serena-code ui-serena-raw">{view.text}</pre>;
  }
}

export function SerenaPanel({ events, onClose }: Props): JSX.Element | null {
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  // Default to the newest event; keep the user's manual selection while it
  // stays in range.
  useEffect(() => {
    setActiveIndex(events.length - 1);
  }, [events.length]);
  if (events.length === 0) return null;
  const safeIndex = activeIndex >= 0 && activeIndex < events.length ? activeIndex : events.length - 1;
  const active = events[safeIndex];

  return (
    <div className="ui-serena-panel">
      <div className="ui-serena-panel-head">
        <span className="ui-serena-panel-title">⚡ Serena</span>
        <div className="ui-serena-panel-tabs">
          {events.map((e, i) => (
            <button
              key={e.id}
              type="button"
              className={`ui-serena-tab${i === safeIndex ? " active" : ""}`}
              onClick={() => setActiveIndex(i)}
              title={`${e.tool}${e.ok ? "" : " (failed)"}`}
            >
              {e.tool.replace(/_/g, " ")}
            </button>
          ))}
        </div>
        <button type="button" className="ui-serena-close" onClick={onClose} title="关闭（新的 Serena 结果会再次弹出）">
          ✕
        </button>
      </div>
      <div className="ui-serena-panel-body">
        {active ? <ViewBody view={active.view} /> : <div className="ui-side-panel-empty">暂无 Serena 结果</div>}
      </div>
    </div>
  );
}
