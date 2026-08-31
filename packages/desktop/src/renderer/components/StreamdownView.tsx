import { memo, useMemo, type JSX } from "react";
import {
  Streamdown,
  defaultRemarkPlugins,
  type ControlsConfig,
  type CustomRenderer,
  type CustomRendererProps,
  type LinkSafetyConfig,
  type PluginConfig,
} from "streamdown";
import remarkBreaks from "remark-breaks";
import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import { stripFrontmatter } from "../lib/frontmatter";
import { MermaidDiagram } from "./MermaidDiagram";

/**
 * Streamdown-based markdown renderer — replaces the old marked + DOMPurify
 * string pipeline (`renderer/markdown.ts`).
 *
 * Why: Streamdown (Vercel) renders markdown to a React element tree instead
 * of an HTML string, so `dangerouslySetInnerHTML` disappears from the chat
 * surface entirely. Sanitization is rehype-sanitize + rehype-harden (URL
 * allowlists), and streaming mode parses incrementally with remend, so
 * unclosed fences/tables/links mid-stream render as-is instead of flashing
 * broken markup on every token.
 *
 * Security notes (the old pipeline's boundary, carried over):
 *  - Raw HTML is parsed then filtered by the GitHub sanitize schema — script,
 *    iframe, svg, style and on* attributes never reach the DOM.
 *  - Anchors render with target="_blank" rel="noreferrer"; the main process
 *    routes window.open to the system browser, so model-authored links can't
 *    reach back into the privileged window.
 *  - The link-safety modal is disabled: in a desktop shell the per-click
 *    confirm is friction without changing where the link ends up.
 *  - Images: streamdown's harden defaults admit any http(s) and data:image/*
 *    <img> source (the old DOMPurify config blocked data: URLs). The window
 *    CSP (`img-src 'self' data:`) remains the load-bearing restriction on
 *    remote loads; data:image in <img> executes no script.
 */

/** Pretty-print fenced ```json blocks so model output reads cleanly. */
function remarkPrettyJsonBlocks() {
  return (tree: Root) => {
    visit(tree, "code", (node) => {
      const lang = (node.lang ?? "").trim().toLowerCase();
      if (lang !== "json" && lang !== "jsonc") return;
      try {
        node.value = JSON.stringify(JSON.parse(node.value), null, 2);
      } catch {
        // Leave malformed JSON untouched.
      }
    });
  };
}

// The remarkPlugins prop REPLACES streamdown's defaults, so GFM + codeMeta
// are re-included explicitly. remark-breaks preserves the old marked
// `breaks: true` behaviour (single newlines become <br>) that chat text and
// tool results rely on.
const REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), remarkBreaks, remarkPrettyJsonBlocks];

/** Mermaid fences render through the app's own themed pipeline (mermaid.ts). */
function MermaidBlock({ code, isIncomplete }: CustomRendererProps): JSX.Element {
  // The fence is still streaming — rendering half a chart would throw and
  // flash the error fallback on every chunk, so show the source until closed.
  if (isIncomplete) {
    return (
      <pre className="ui-mermaid-pending">
        <code>{code}</code>
      </pre>
    );
  }
  return <MermaidDiagram chart={code} />;
}

const RENDERERS: CustomRenderer[] = [{ language: "mermaid", component: MermaidBlock }];
const PLUGINS: PluginConfig = { renderers: RENDERERS };

// Syntax palette is PINNED to github-light for BOTH shiki variants (hard
// product rule 2026-08-31: code wells are always the fixed light gray
// --ui-code-well, 严禁黑色). The default second theme (github-dark) paints
// near-black token colors + well background whenever Tailwind's `dark:`
// variant matches — and that variant keys off its own strategy, NOT the app's
// appearance system, so it can fire while the app renders its light theme.
// With both slots github-light, every `dark:` fallback resolves to the same
// readable dark-on-gray palette.
const SHIKI_THEME: [string, string] = ["github-light", "github-light"];

// Match the old chrome: code blocks get a copy button; download buttons,
// table controls and mermaid controls stay off (mermaid has its own renderer).
const CONTROLS: ControlsConfig = { table: false, code: { copy: true, download: false }, mermaid: false };
const LINK_SAFETY: LinkSafetyConfig = { enabled: false };

type Props = {
  markdown: string;
  className?: string;
  /** Streaming mode: block-level incremental parsing + remend for unclosed syntax. */
  streaming?: boolean;
  /** True while the owning message is still receiving tokens — shows the caret. */
  isAnimating?: boolean;
};

export const StreamdownView = memo(function StreamdownView({
  markdown,
  className,
  streaming = false,
  isAnimating = false,
}: Props): JSX.Element {
  const source = useMemo(() => stripFrontmatter(markdown), [markdown]);
  const cls = `ui-streamdown${isAnimating ? " is-animating" : ""}${className ? ` ${className}` : ""}`;
  return (
    <div className={cls}>
      <Streamdown
        mode={streaming ? "streaming" : "static"}
        isAnimating={isAnimating}
        remarkPlugins={REMARK_PLUGINS}
        plugins={PLUGINS}
        controls={CONTROLS}
        shikiTheme={SHIKI_THEME}
        lineNumbers={false}
        linkSafety={LINK_SAFETY}
      >
        {source}
      </Streamdown>
    </div>
  );
});
