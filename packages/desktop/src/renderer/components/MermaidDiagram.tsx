import { useEffect, useState, type JSX } from "react";

// Mermaid is imported dynamically so it only loads when a diagram is actually
// rendered — keeping the initial bundle smaller. The library is a bundled
// dependency (not CDN — CSP in index.html forbids remote scripts).
let mermaidLoaded = false;
let mermaidLoadPromise: Promise<void> | null = null;

async function ensureMermaid(): Promise<void> {
  if (mermaidLoaded) return;
  if (mermaidLoadPromise) return mermaidLoadPromise;
  mermaidLoadPromise = (async () => {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      securityLevel: "strict",
      fontFamily: "inherit",
      flowchart: {
        htmlLabels: true,
        curve: "basis",
      },
    });
    mermaidLoaded = true;
  })();
  return mermaidLoadPromise;
}

let diagramCounter = 0;

/**
 * Renders a Mermaid diagram from a chart definition string.
 *
 * Uses `mermaid.render()` to produce an SVG, displayed via
 * `dangerouslySetInnerHTML`. The SVG is self-contained (inline styles only),
 * so it complies with the strict CSP in index.html.
 *
 * If mermaid fails to load or render, falls back to showing the raw chart text.
 */
export function MermaidDiagram({ chart }: { chart: string }): JSX.Element {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${++diagramCounter}`;

    ensureMermaid()
      .then(async () => {
        const mermaid = (await import("mermaid")).default;
        if (cancelled) return;
        const { svg: rendered } = await mermaid.render(id, chart);
        if (!cancelled) {
          setSvg(rendered);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
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
