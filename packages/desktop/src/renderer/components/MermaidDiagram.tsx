import { useEffect, useState, type JSX } from "react";
import { renderMermaidSvg } from "../mermaid";

/**
 * Renders a Mermaid diagram from a chart definition string.
 *
 * If mermaid fails to load or the chart fails to parse, falls back to showing
 * the raw chart text instead of crashing the panel.
 */
export function MermaidDiagram({ chart }: { chart: string }): JSX.Element {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    renderMermaidSvg(chart)
      .then((rendered) => {
        if (cancelled) return;
        setSvg(rendered);
        setError("");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) {
    return <pre className="ui-mermaid-fallback">{chart}</pre>;
  }

  return (
    <div className="ui-mermaid-container" dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}>
      {!svg ? <span className="ui-mermaid-loading">…</span> : null}
    </div>
  );
}
