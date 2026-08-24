import { useEffect, useMemo, useRef, type JSX, type MouseEvent as ReactMouseEvent } from "react";
import { renderMarkdown } from "../markdown";
import { renderMermaidSvg } from "../mermaid";

/**
 * Markdown view with post-render Mermaid hydration.
 *
 * renderMarkdown() is a synchronous string pipeline (sanitized HTML +
 * LRU cache) consumed via dangerouslySetInnerHTML — React components can't
 * be spliced into that. So ```mermaid fences first render as regular code
 * blocks (`.code-block-wrap[data-lang="mermaid"]`), and this component then
 * swaps each one for the rendered SVG in an effect. If rendering fails the
 * code block stays as the fallback — the user still sees the chart source.
 *
 * On content change React rewrites the container's innerHTML, the effect
 * re-runs, and hydration repeats for the fresh nodes.
 */

type Props = {
  markdown: string;
  className?: string;
  onClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
};

export function MarkdownView({ markdown, className, onClick }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let cancelled = false;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('.code-block-wrap[data-lang="mermaid"]'));
    for (const wrap of blocks) {
      const code = wrap.querySelector<HTMLElement>("pre code");
      if (!code) continue;
      const chart = code.textContent ?? "";
      renderMermaidSvg(chart)
        .then((svg) => {
          if (cancelled) return;
          const holder = document.createElement("div");
          holder.className = "ui-mermaid-container";
          holder.innerHTML = svg;
          wrap.replaceWith(holder);
        })
        .catch(() => {
          // Chart failed to parse — keep the code block as the fallback.
          if (!cancelled) wrap.classList.add("ui-mermaid-failed");
        });
    }
    return () => {
      cancelled = true;
    };
  }, [html]);

  return <div ref={ref} className={className} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
