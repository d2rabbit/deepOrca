import { marked, type Tokens, type RendererObject } from "marked";
import DOMPurify from "dompurify";

/** Pretty-print fenced ```json blocks so model output reads cleanly. */
function prettyPrintJsonBlocks(token: Tokens.Generic): void {
  if (token.type !== "code") return;
  const code = token as Tokens.Code;
  const lang = (code.lang ?? "").trim().toLowerCase();
  if (lang !== "json" && lang !== "jsonc") return;
  try {
    code.text = JSON.stringify(JSON.parse(code.text), null, 2);
  } catch {
    // Leave malformed JSON untouched.
  }
}

/**
 * Custom renderer: adds `data-lang` attribute and language-specific CSS class
 * to fenced code blocks so the UI can show a language label and apply
 * specialised styling (e.g. JSON amber border, HTML purple border).
 */
const customRenderer: RendererObject = {
  code({ text, lang: rawLang }: Tokens.Code): string {
    const lang = (rawLang ?? "").trim().toLowerCase();
    const langClass = lang ? ` code-${lang}` : "";
    const dataLang = lang ? ` data-lang="${lang}"` : "";
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const langLabel = lang ? `<span class="code-block-lang">${lang}</span>` : "";
    return `<div class="code-block-wrap${langClass}"${dataLang}>${langLabel}<button class="code-block-copy" type="button" aria-label="Copy code">⧉</button><pre class="code-block"><code class="language-${lang || "text"}">${escaped}</code></pre></div>\n`;
  },
};

marked.setOptions({
  gfm: true,
  breaks: true,
});

marked.use({ walkTokens: prettyPrintJsonBlocks, renderer: customRenderer });

/**
 * Render markdown to a sanitized-enough HTML string for our trusted CSP.
 * The renderer runs with a strict CSP (no inline scripts, no remote origins),
 * and content originates from the local model session, so we allow inline HTML
 * off but strip nothing beyond what `marked` produces.
 *
 * Results are cached in a small LRU (128 entries) keyed by text hash, so
 * re-renders of the same message (tick-driven, list scroll) skip re-parsing.
 * This is critical for long sessions with hundreds of messages.
 */

// Simple LRU cache: Map preserves insertion order in JS, so we delete+set
// to move a key to the end (most-recently-used) on access.
const MD_CACHE_MAX = 128;
const mdCache = new Map<string, string>();

function getCached(text: string): string | undefined {
  const hit = mdCache.get(text);
  if (hit !== undefined) {
    // Move to end (most recently used).
    mdCache.delete(text);
    mdCache.set(text, hit);
  }
  return hit;
}

function setCached(text: string, html: string): void {
  if (mdCache.size >= MD_CACHE_MAX) {
    // Evict oldest entry (first key in the Map).
    const oldest = mdCache.keys().next().value;
    if (oldest !== undefined) mdCache.delete(oldest);
  }
  mdCache.set(text, html);
}

export function renderMarkdown(text: string): string {
  if (!text) {
    return "";
  }
  const cached = getCached(text);
  if (cached !== undefined) {
    return cached;
  }
  const html = marked.parse(text, { async: false }) as string;
  const safe = sanitizeHtml(html);
  setCached(text, safe);
  return safe;
}

/**
 * Sanitize rendered markdown HTML with DOMPurify.
 *
 * Model output (and plugin docs, wiki pages, task plans) can contain markdown
 * links, and `marked` emits raw HTML for inline HTML. The main window loads
 * this HTML via `dangerouslySetInnerHTML`, and the preload exposes
 * file/settings/Git/MCP/prompt capabilities through `window.deeporca` — so an
 * XSS in rendered markdown is a path to privileged IPC. CSP and the
 * main-process navigation guards are defense-in-depth, but the sanitizer is
 * the primary boundary.
 *
 * Previous implementation was a regex denylist (strip dangerous tags, on*
 * handlers, javascript:/vbscript:/data: URLs, style attributes). HTML is not
 * regular, and parser differentials (malformed tags, entity-encoded schemes,
 * SVG/MathML payloads) defeat regex approaches. DOMPurify parses the HTML with
 * the real browser DOM parser and walks the resulting tree against an
 * allowlist, which is robust against parser-differential attacks.
 *
 * Allowlist policy:
 *  - Only Markdown-output tags are permitted (no <script>, <iframe>,
 *    <object>, <embed>, <form>, <style>, <link>, <meta>, <base>, SVG, MathML).
 *  - Only `class`, `href`, `src`, `title`, `alt`, `data-lang` attributes pass;
 *    everything else (including `style` and all `on*` handlers) is stripped.
 *  - URI schemes are restricted to http, https, mailto and relative refs.
 *  - Every link is forced to `target="_blank" rel="noopener noreferrer"` via an
 *    afterSanitizeAttributes hook so model-authored links can't reach back into
 *    the privileged window via `window.opener`.
 */
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    // Block / paragraph structure.
    "p",
    "br",
    "hr",
    "blockquote",
    "pre",
    "code",
    "span",
    "div",
    // Headings.
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    // Lists.
    "ul",
    "ol",
    "li",
    "dl",
    "dt",
    "dd",
    // Tables (GFM).
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    // Inline formatting.
    "a",
    "strong",
    "em",
    "del",
    "s",
    "sup",
    "sub",
    "mark",
    "abbr",
    "code",
    "b",
    "i",
    "u",
    "kbd",
    "small",
    // Custom blocks emitted by the marked renderer below (code-block copy
    // button, language label). No form/input elements.
    "button",
  ],
  ALLOWED_ATTR: ["class", "href", "src", "title", "alt", "data-lang", "type", "aria-label"],
  // Restrict URI schemes. Empty string allows relative refs (e.g. "#section").
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#|\/[^/\\]|[^:/?#]+(?:[?#]|$))/i,
  // Forbid all custom data- attributes except the explicit allowlist above.
  ALLOW_DATA_ATTR: false,
  // Explicitly keep SVG/MathML off — they are common XSS vectors and the
  // markdown surface never needs them.
  FORBID_TAGS: ["svg", "math", "use"],
  FORBID_ATTR: ["style", "srcset", "formaction", "xlink:href"],
};

// After-attribute hook: force safe link target/rel on every anchor. DOMPurify
// runs hooks after it has already stripped dangerous attributes, so we only
// add the safe ones here.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as unknown as string;
}

/** Clear the markdown cache (useful when switching projects to free memory). */
export function clearMarkdownCache(): void {
  mdCache.clear();
}
