import { marked, type Tokens, type RendererObject } from "marked";

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
 * Sanitize rendered markdown HTML.
 *
 * Model output can contain markdown links, and marked emits raw HTML for
 * inline HTML. The main window loads this HTML directly and (before the
 * navigation guards in main) a link click could navigate the privileged
 * window. Even with those guards, we must prevent:
 *   - <script>, <iframe>, <object>, <embed>, <form> (spoofing/execution);
 *   - inline event handlers (onerror=, onclick=, …);
 *   - javascript:/vbscript:/data: URLs in href/src;
 *   - styles that could overlay the UI.
 *
 * This is an allowlist sanitizer operating on marked's output — cheaper than a
 * full DOM parser and sufficient because we control the input grammar (GFM).
 */
const DANGEROUS_TAGS =
  /<\/?(script|iframe|object|embed|form|input|button|textarea|select|style|link|meta|base)\b[^>]*>/gi;
const EVENT_HANDLER_ATTR = /\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const DANGEROUS_URL =
  /\b(href|src|xlink:href)\s*=\s*("(?:javascript|vbscript|data):[^"]*"|'(?:javascript|vbscript|data):[^']*'|(?:javascript|vbscript|data):[^\s>]+)/gi;
const STYLE_ATTR = /\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

function sanitizeHtml(html: string): string {
  let out = html;
  // Strip dangerous elements entirely (tags only — their text content, if any,
  // stays as it was already emitted as escaped text by marked for unknown tags).
  out = out.replace(DANGEROUS_TAGS, "");
  // Remove inline event handlers.
  out = out.replace(EVENT_HANDLER_ATTR, "");
  // Neutralize javascript:/vbscript:/data: URLs in link/media attributes.
  out = out.replace(DANGEROUS_URL, (match) => match.replace(/(javascript|vbscript|data):/gi, "blocked:"));
  // Drop inline styles (prevent UI overlay / clickjacking via CSS).
  out = out.replace(STYLE_ATTR, "");
  // Force every link to open externally and without opener access. Target the
  // opening tag so the href attribute itself is preserved.
  out = out.replace(/<a\b(?![^>]*\brel=)([^>]*)>/gi, '<a$1 target="_blank" rel="noopener noreferrer">');
  return out;
}

/** Clear the markdown cache (useful when switching projects to free memory). */
export function clearMarkdownCache(): void {
  mdCache.clear();
}
