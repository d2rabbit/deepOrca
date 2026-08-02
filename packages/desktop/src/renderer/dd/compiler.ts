/**
 * OrcaDesign (.dd) → HTML compiler.
 *
 * Takes a parsed DdDocument and produces a self-contained HTML string that
 * can be loaded in an iframe srcDoc or exported as a standalone .html file.
 *
 * The compiled HTML includes:
 * 1. `:root` CSS custom properties from the design tokens
 * 2. The seed CSS (layout primitives, components, responsive rules)
 * 3. Inlined Tailwind JIT script (if provided) for utility class generation
 * 4. The section HTML body
 */

import type { DdDocument, DdTokens } from "./parser";

/**
 * Compile a .dd document into a self-contained HTML string.
 *
 * @param doc - The parsed .dd document
 * @param tailwindScript - The raw Tailwind JIT JS (optional; if omitted, no Tailwind)
 * @returns Complete HTML document string
 */
export function compileDdToHtml(doc: DdDocument, tailwindScript?: string): string {
  const tokensCss = tokensToCss(doc.meta.tokens);
  const seedCss = getSeedCss();
  const tailwindTag = tailwindScript ? `<script>${tailwindScript}</script>` : "";
  const title = doc.meta.name || "DeepDesign";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
${tokensCss}
${seedCss}
</style>
${tailwindTag}
</head>
<body>
${doc.body}
</body>
</html>`;
}

/** Convert token key-value pairs to `:root { --key: value; }` CSS. */
function tokensToCss(tokens: DdTokens): string {
  const entries = Object.entries(tokens);
  if (entries.length === 0) return "";
  const lines = entries.map(([key, value]) => `  --${key}: ${value};`);
  return `:root {\n${lines.join("\n")}\n}`;
}

/** Escape HTML special characters in text content. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Minimal seed CSS — covers the core classes used in DeepDesign layouts:
 * reset, body, container, section, grid, topnav, typography, btn, card, footer.
 * Extracted from the seed.html template and kept in sync.
 */
function getSeedCss(): string {
  return `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg,#0a0a0a);color:var(--text,#f5f5f5);font-family:var(--font-body,system-ui,sans-serif);line-height:1.6;-webkit-font-smoothing:antialiased}
.container{max-width:var(--max-width,1200px);margin:0 auto;padding:0 24px}
.section{padding:var(--section-pad-y,80px) 0}
.section-sm{padding:40px 0}
.grid{display:grid;gap:var(--gap,24px)}
.grid-2{grid-template-columns:repeat(2,1fr)}
.grid-3{grid-template-columns:repeat(3,1fr)}
.grid-4{grid-template-columns:repeat(4,1fr)}
.topnav{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg,#0a0a0a) 85%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid color-mix(in srgb,var(--muted,#888) 20%,transparent)}
.topnav-inner{display:flex;align-items:center;justify-content:space-between;height:60px}
.topnav-brand{font-family:var(--font-display,var(--font-body));font-weight:700;font-size:18px;color:var(--text,#f5f5f5);text-decoration:none}
.topnav-links{display:flex;gap:24px}
.topnav-links a{color:var(--muted,#888);text-decoration:none;font-size:14px;transition:color .15s}
.topnav-links a:hover{color:var(--text,#f5f5f5)}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent,#3b82f6);margin-bottom:12px}
.display{font-family:var(--font-display,var(--font-body));font-size:clamp(32px,5vw,56px);font-weight:800;line-height:1.1;letter-spacing:-.02em;color:var(--text,#f5f5f5)}
.lead{font-size:clamp(16px,2vw,20px);color:var(--muted,#888);line-height:1.6;max-width:60ch}
.mono{font-family:var(--font-mono,monospace);font-size:13px;background:color-mix(in srgb,var(--muted,#888) 10%,transparent);padding:2px 6px;border-radius:4px}
h1,h2,h3{font-family:var(--font-display,var(--font-body));color:var(--text,#f5f5f5);line-height:1.2}
h1{font-size:clamp(28px,4vw,48px);font-weight:800}
h2{font-size:clamp(24px,3vw,36px);font-weight:700}
h3{font-size:18px;font-weight:600}
p{color:var(--muted,#888)}
.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 24px;border-radius:var(--radius,8px);font-size:14px;font-weight:600;text-decoration:none;transition:all .15s;cursor:pointer;border:none}
.btn-primary{background:var(--accent,#3b82f6);color:#fff}
.btn-primary:hover{filter:brightness(1.1);transform:translateY(-1px)}
.btn-ghost{background:transparent;color:var(--text,#f5f5f5);border:1px solid color-mix(in srgb,var(--muted,#888) 30%,transparent)}
.btn-ghost:hover{background:color-mix(in srgb,var(--muted,#888) 10%,transparent)}
.card{background:var(--surface,#1a1a1a);border:1px solid color-mix(in srgb,var(--muted,#888) 15%,transparent);border-radius:var(--radius,8px);padding:24px;transition:border-color .15s}
.card:hover{border-color:color-mix(in srgb,var(--muted,#888) 30%,transparent)}
.card-icon{font-size:28px;margin-bottom:12px}
.card-title{font-size:16px;font-weight:600;margin-bottom:8px;color:var(--text,#f5f5f5)}
.card-desc{font-size:14px;color:var(--muted,#888);line-height:1.5}
.ph-img{width:100%;aspect-ratio:16/9;background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--muted,#888) 8%,transparent),color-mix(in srgb,var(--muted,#888) 8%,transparent) 10px,color-mix(in srgb,var(--muted,#888) 4%,transparent) 10px,color-mix(in srgb,var(--muted,#888) 4%,transparent) 20px);border-radius:var(--radius,8px);display:flex;align-items:center;justify-content:center;color:var(--muted,#888);font-size:13px}
.footer{border-top:1px solid color-mix(in srgb,var(--muted,#888) 15%,transparent);padding:32px 0;color:var(--muted,#888);font-size:13px}
@media(max-width:920px){.grid-2,.grid-3,.grid-4{grid-template-columns:1fr}.topnav-links{display:none}}`;
}
