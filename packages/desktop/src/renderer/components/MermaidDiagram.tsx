import { useEffect, useState, type JSX } from "react";
import { renderMermaidSvg } from "../mermaid";
import { useI18n } from "../i18n";

/**
 * Renders a Mermaid diagram from a chart definition string.
 *
 * If mermaid fails to load or the chart fails to parse, falls back to showing
 * the raw chart text instead of crashing the panel — with the failure reason
 * above it, so the fallback isn't mistaken for the intended render.
 */
export function MermaidDiagram({ chart }: { chart: string }): JSX.Element {
  const { t } = useI18n();
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
    return (
      <div className="ui-mermaid-failed">
        <div className="ui-mermaid-failed-reason">
          {t("mermaid.renderFailed")}
          {error ? ` — ${error.slice(0, 200)}` : ""}
        </div>
        <pre className="ui-mermaid-fallback">{chart}</pre>
      </div>
    );
  }

  return (
    <div className="ui-mermaid-container" dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}>
      {!svg ? <span className="ui-mermaid-loading">…</span> : null}
    </div>
  );
}
