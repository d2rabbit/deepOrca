/**
 * Spec → Marp slides (specs/artifact-landing 链路 B).
 *
 * Pure + Electron-free — the transform unit-tests cold. @marp-team/marp-core
 * runs HERE in the main process; the renderer only ever receives {html, css}
 * strings, so marp never enters the renderer bundle (B8).
 *
 * Slide splitting relies on Marpit's native `headingDivider: 2` directive —
 * officially equivalent to hand-inserted `---` rulers at every `## ` — which
 * operates on the markdown-it token stream: a fenced code block is one fence
 * token, so a `## ` inside it structurally cannot split a slide (no hand
 * rolled line scanner; pinned by a unit test). Documents that already carry
 * `marp: true` front-matter pass through byte-for-byte.
 */

export type SpecSlidesAppearance = "light" | "dark";

/** Lazily-loaded marp-core — a top-level import would pay the
 *  mathjax/highlight.js/katex cold-start cost on every app launch for a
 *  feature most sessions never open. Cached so concurrent renders share one
 *  module load; the render itself stays synchronous CPU work in the main
 *  process (kept out of the renderer bundle, B8). */
let marpModulePromise: Promise<typeof import("@marp-team/marp-core")> | null = null;
function loadMarp(): Promise<typeof import("@marp-team/marp-core")> {
  marpModulePromise ??= import("@marp-team/marp-core").catch((error) => {
    // A transient load failure must not poison the cache for the whole
    // process lifetime — clear it so the next render retries.
    marpModulePromise = null;
    throw error;
  });
  return marpModulePromise;
}

export interface SpecSlidesRender {
  html: string;
  css: string;
  /** Number of `<section>` slides in the rendered deck. */
  pages: number;
  /** `http(s)://` image references found in the markdown — CSP-blocked on
   *  export and reported to the user (B10). */
  remoteImages: number;
}

/** True when the document opens with its own `marp: true` front-matter.
 *  Deliberately token-based (indexOf/slice) rather than a capture regex. */
export function hasMarpFrontMatter(specMd: string): boolean {
  const text = specMd.trimStart();
  if (!text.startsWith("---")) return false;
  const closing = text.indexOf("\n---", 3);
  if (closing === -1) return false;
  const block = text.slice(3, closing);
  return block.split(/\r?\n/).some((line) => /^\s*marp:\s*true\s*$/.test(line));
}

/** First non-heading, non-list, non-quote paragraph — the title page's brief. */
function firstParagraph(markdown: string): string {
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#") || trimmed.startsWith(">")) continue;
    if (/^\s*[-*]\s/.test(line)) continue;
    if (/^([-*_]\s*){3,}$/.test(trimmed)) continue; // hr rule
    return trimmed;
  }
  return "";
}

/**
 * Wrap the spec for Marp: existing marp docs pass through untouched; plain
 * specs get deeporca front-matter (native splitting + pagination) and a title
 * page carrying the artifact title and its first paragraph.
 *
 * Separator policy (empirically pinned): headingDivider: 2 splits at levels
 * 1–2 only, and an explicit `---` immediately followed by a level-1/2 heading
 * doubles the boundary into an EMPTY slide — so the title-page separator is
 * emitted only when the spec does NOT open with a `# `/`## ` heading.
 */
export function buildSlidesMarkdown(specMd: string, title: string): { passthrough: boolean; markdown: string } {
  if (hasMarpFrontMatter(specMd)) return { passthrough: true, markdown: specMd };
  const brief = firstParagraph(specMd);
  const lines = [
    "---",
    "marp: true",
    "theme: deeporca",
    "paginate: true",
    "headingDivider: 2",
    "---",
    "",
    `# ${title}`,
  ];
  if (brief) lines.push("", brief);
  const firstNonBlank = specMd.split(/\r?\n/).find((line) => line.trim());
  if (/^#{1,2}\s/.test(firstNonBlank ?? "")) {
    // The spec opens with a level-1/2 heading: that heading is itself the
    // slide boundary (an explicit `---` here would double into an EMPTY
    // slide), it just needs a blank line to start its own block.
    lines.push("");
  } else {
    lines.push("---", "");
  }
  return { passthrough: false, markdown: `${lines.join("\n")}${specMd}` };
}

/** `http(s)://` image references: markdown `![](...)` and `<img src>`. */
export function countRemoteImages(markdown: string): number {
  const mdImages = markdown.match(/!\[[^\]]*\]\(https?:\/\/[^)\s]+\)/g)?.length ?? 0;
  const htmlImages = markdown.match(/<img\b[^>]*\bsrc=["']https?:\/\/[^"']+["']/gi)?.length ?? 0;
  return mdImages + htmlImages;
}

interface ThemeColors {
  bg: string;
  text: string;
  heading: string;
  accent: string;
  dim: string;
  border: string;
  codeBg: string;
  codeText: string;
}

const THEME_LIGHT: ThemeColors = {
  bg: "#fbfbfd",
  text: "#1f2328",
  heading: "#16233a",
  accent: "#3b82f6",
  dim: "#66707d",
  border: "#e3e6eb",
  codeBg: "#f0f2f5",
  codeText: "#c7254e",
};

const THEME_DARK: ThemeColors = {
  bg: "#16181d",
  text: "#e6e8ec",
  heading: "#f2f4f8",
  accent: "#6c9bff",
  dim: "#9aa4b2",
  border: "#333944",
  codeBg: "#22262e",
  codeText: "#ff9db8",
};

/** Product theme (deeporca) — colors baked per appearance so the exported
 *  HTML stands alone without CSS variables or webfonts (offline, B10). */
function themeCss(c: ThemeColors): string {
  return `/*!
 * @theme deeporca
 * @auto-scaling true
 */

section {
  width: 1280px;
  height: 720px;
  padding: 68px 88px;
  font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Hiragino Sans", sans-serif;
  background: ${c.bg};
  color: ${c.text};
  font-size: 27px;
  line-height: 1.55;
}
h1 {
  font-size: 52px;
  color: ${c.heading};
  border-bottom: 2px solid ${c.accent};
  padding-bottom: 14px;
  margin-bottom: 28px;
}
h2 { font-size: 38px; color: ${c.heading}; }
h3 { font-size: 30px; color: ${c.heading}; }
a { color: ${c.accent}; }
strong { color: ${c.heading}; }
code {
  background: ${c.codeBg};
  color: ${c.codeText};
  padding: 2px 7px;
  border-radius: 5px;
}
pre {
  background: ${c.codeBg};
  border: 1px solid ${c.border};
  border-radius: 10px;
  padding: 18px;
}
pre code { background: transparent; color: ${c.text}; padding: 0; }
blockquote {
  border-left: 4px solid ${c.accent};
  color: ${c.dim};
  padding: 2px 0 2px 18px;
}
table { border-collapse: collapse; }
th, td { border: 1px solid ${c.border}; padding: 7px 16px; }
th { background: ${c.codeBg}; }
section::after {
  content: attr(data-marpit-pagination) " / " attr(data-marpit-pagination-total);
  position: absolute;
  bottom: 22px;
  right: 40px;
  font-size: 15px;
  color: ${c.dim};
}`;
}

const THEMES: Record<SpecSlidesAppearance, string> = {
  light: themeCss(THEME_LIGHT),
  dark: themeCss(THEME_DARK),
};

/** Render one spec into a slide deck (main-process, offline, script-free). */
export async function renderSpecSlides(
  specMd: string,
  opts: { title: string; appearance?: SpecSlidesAppearance }
): Promise<SpecSlidesRender> {
  const { markdown } = buildSlidesMarkdown(specMd, opts.title);
  // script:false — marp-core's browser slide runner must not leak into our
  // static output; the preview iframe is sandboxed script-free and the export
  // is CSP `default-src 'none'`.
  const { Marp } = await loadMarp();
  const marp = new Marp({ script: false });
  marp.themeSet.add(THEMES[opts.appearance === "dark" ? "dark" : "light"]);
  const { html, css } = marp.render(markdown);
  const safeHtml = sanitizeSlidesHtml(html);
  return {
    html: safeHtml,
    css,
    pages: (safeHtml.match(/<section\b/g) ?? []).length,
    remoteImages: countRemoteImages(markdown),
  };
}

/** Marpit passes raw HTML in the markdown through untouched — and specs are
 *  LLM-generated content, so a planted `<meta http-equiv="refresh">` would
 *  navigate both the preview iframe and the exported deck with no user
 *  gesture. marp-core's own sanitizer currently escapes disallowed tags, but
 *  navigation is outside CSP's default-src reach either way, so this strips
 *  them at the one render chokepoint shared by preview and both exports —
 *  an invariant that must survive marp-core upgrades. Exported for the test. */
export function sanitizeSlidesHtml(html: string): string {
  return html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh\b[^>]*>/gi, "");
}

/** CSP for exported decks: self-contained, offline, remote content blocked
 *  (B10 — the default-deny leg of the remote-image policy). `form-action`
 *  does NOT fall back to default-src, so it is pinned explicitly — a planted
 *  `<form>` must not be able to submit anywhere either. */
const SLIDES_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'";

function escapeHtml(text: string): string {
  let out = "";
  for (const char of text) {
    if (char === "&") out += "&amp;";
    else if (char === "<") out += "&lt;";
    else if (char === ">") out += "&gt;";
    else if (char === '"') out += "&quot;";
    else out += char;
  }
  return out;
}

/** Wrap rendered slides into a standalone HTML document (preview + both
 *  exports share this exact byte output). */
export function buildSlidesHtml(html: string, css: string, title: string): string {
  return [
    "<!doctype html><html><head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${SLIDES_CSP}">`,
    `<title>${escapeHtml(title)}</title>`,
    `<style>html,body{margin:0;padding:0}${css}</style>`,
    "</head><body>",
    html,
    "</body></html>",
  ].join("");
}
