import type { JSX } from "react";

/**
 * File-type icons — tiny colored language badges (label + accent color per
 * type, palette loosely following the linguist/Seti hues VSCode shows),
 * plus hand-drawn mini-glyphs for the iconic files (README book, LICENSE
 * copyright, AGENTS robot, CLAUDE starburst) and well-known directories
 * (.git branch, node_modules, build outputs…). Everything renders on a
 * 16×16 canvas; unknown names fall back to the caller's generic icon.
 */

type GlyphShape = "book" | "copyright" | "robot" | "starburst" | "branch";

type FileGlyph = {
  /** Short badge label (1–3 chars) — or a drawn shape instead. */
  label?: string;
  shape?: GlyphShape;
  /** Accent color; empty = inherit currentColor (dim default). */
  color?: string;
};

const EXT_GLYPHS: Record<string, FileGlyph> = {
  ts: { label: "TS", color: "#3178c6" },
  tsx: { label: "TS", color: "#3178c6" },
  mts: { label: "TS", color: "#3178c6" },
  cts: { label: "TS", color: "#3178c6" },
  js: { label: "JS", color: "#cbcb41" },
  jsx: { label: "JS", color: "#cbcb41" },
  mjs: { label: "JS", color: "#cbcb41" },
  cjs: { label: "JS", color: "#cbcb41" },
  json: { label: "{}", color: "#cbcb41" },
  jsonc: { label: "{}", color: "#cbcb41" },
  md: { label: "MD", color: "#519aba" },
  markdown: { label: "MD", color: "#519aba" },
  py: { label: "PY", color: "#3572a5" },
  pyi: { label: "PY", color: "#3572a5" },
  rs: { label: "RS", color: "#dea584" },
  go: { label: "GO", color: "#00add8" },
  java: { label: "JV", color: "#b07219" },
  kt: { label: "KT", color: "#a97bff" },
  kts: { label: "KT", color: "#a97bff" },
  swift: { label: "SW", color: "#f05138" },
  c: { label: "C", color: "#8a8a8a" },
  h: { label: "C", color: "#8a8a8a" },
  cpp: { label: "C+", color: "#f34b7d" },
  cc: { label: "C+", color: "#f34b7d" },
  cxx: { label: "C+", color: "#f34b7d" },
  hpp: { label: "C+", color: "#f34b7d" },
  cs: { label: "C#", color: "#178600" },
  rb: { label: "RB", color: "#701516" },
  php: { label: "PH", color: "#4f5d95" },
  sh: { label: "SH", color: "#89e051" },
  bash: { label: "SH", color: "#89e051" },
  zsh: { label: "SH", color: "#89e051" },
  yml: { label: "YM", color: "#cb171e" },
  yaml: { label: "YM", color: "#cb171e" },
  toml: { label: "TM", color: "#9c4221" },
  ini: { label: "TM", color: "#9c4221" },
  css: { label: "#", color: "#519aba" },
  scss: { label: "SC", color: "#c6538c" },
  less: { label: "LS", color: "#563d7c" },
  html: { label: "<>", color: "#e34c26" },
  htm: { label: "<>", color: "#e34c26" },
  vue: { label: "V", color: "#41b883" },
  svelte: { label: "SV", color: "#ff3e00" },
  xml: { label: "X", color: "#0060a9" },
  svg: { label: "SV", color: "#ffb13b" },
  png: { label: "IM", color: "#a074c4" },
  jpg: { label: "IM", color: "#a074c4" },
  jpeg: { label: "IM", color: "#a074c4" },
  gif: { label: "IM", color: "#a074c4" },
  webp: { label: "IM", color: "#a074c4" },
  ico: { label: "IM", color: "#a074c4" },
  pdf: { label: "PD", color: "#e04b4b" },
  zip: { label: "ZP", color: "#6a737d" },
  tar: { label: "ZP", color: "#6a737d" },
  gz: { label: "ZP", color: "#6a737d" },
  "7z": { label: "ZP", color: "#6a737d" },
  lock: { label: "LK", color: "#519aba" },
  sql: { label: "SQ", color: "#e38c00" },
  dart: { label: "DA", color: "#00b4ab" },
  lua: { label: "LU", color: "#000080" },
  txt: { label: "TX", color: "#8a8a8a" },
};

/** Iconic files matched by exact (lowercased) name — before any ext lookup. */
const NAME_GLYPHS: Record<string, FileGlyph> = {
  // Open-source license family — gold circle-c mark.
  license: { shape: "copyright", color: "#c9a227" },
  licence: { shape: "copyright", color: "#c9a227" },
  copying: { shape: "copyright", color: "#c9a227" },
  unlicense: { shape: "copyright", color: "#c9a227" },
  "license.md": { shape: "copyright", color: "#c9a227" },
  "license.txt": { shape: "copyright", color: "#c9a227" },
  "licence.md": { shape: "copyright", color: "#c9a227" },
  // Agent instruction files — the robot glyph.
  "agents.md": { shape: "robot", color: "#a97bff" },
  "agent.md": { shape: "robot", color: "#a97bff" },
  "agents.local.md": { shape: "robot", color: "#a97bff" },
  // Claude config — its starburst, in Claude orange.
  "claude.md": { shape: "starburst", color: "#d97757" },
  "claude.local.md": { shape: "starburst", color: "#d97757" },
};

const README_PREFIX = "readme";

/** Well-known directories matched by exact (lowercased) name. */
const DIR_GLYPHS: Record<string, FileGlyph> = {
  ".git": { shape: "branch", color: "#f14e32" },
  ".github": { label: "GH", color: "#8a9ba8" },
  ".deeporca": { label: "DO", color: "#3b82f6" },
  ".deepcode": { label: "DC", color: "#3b82f6" },
  ".serena": { label: "SE", color: "#3572a5" },
  ".claude": { shape: "starburst", color: "#d97757" },
  ".vscode": { label: "VS", color: "#0098ff" },
  ".idea": { label: "IJ", color: "#db5c5c" },
  node_modules: { label: "NM", color: "#8a8a8a" },
  vendor: { label: "VD", color: "#8a8a8a" },
  dist: { label: "DI", color: "#6a737d" },
  out: { label: "OU", color: "#6a737d" },
  build: { label: "BU", color: "#6a737d" },
  target: { label: "TA", color: "#6a737d" },
  coverage: { label: "CV", color: "#89e051" },
  docs: { shape: "book", color: "#519aba" },
};

function glyphFor(name: string): FileGlyph | null {
  const lower = name.toLowerCase();
  if (NAME_GLYPHS[lower]) return NAME_GLYPHS[lower]!;
  if (lower.startsWith(README_PREFIX)) return { shape: "book", color: "#519aba" };
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  return EXT_GLYPHS[ext] ?? null;
}

/** Copyright mark — drawn circle-c (SVG-only icon rule; no text symbols). */
function CopyrightGlyph({ color }: { color: string }): JSX.Element {
  return (
    <g stroke={color} strokeWidth="1.1" fill="none">
      <circle cx="8" cy="8" r="4.6" />
      <path d="M9.9 6.6a2.3 2.3 0 1 0 0 2.8" strokeLinecap="round" />
    </g>
  );
}

/** Open book — README. */
function BookGlyph({ color }: { color: string }): JSX.Element {
  return (
    <g stroke={color} strokeWidth="1.2" strokeLinejoin="round" fill="none">
      <path d="M2.5 3.5h4a1.8 1.8 0 0 1 1.5 1.6v7.4a1.6 1.6 0 0 0-1.5-1.3h-4z" />
      <path d="M13.5 3.5h-4a1.8 1.8 0 0 0-1.5 1.6v7.4a1.6 1.6 0 0 1 1.5-1.3h4z" />
    </g>
  );
}

/** Robot head — agent instruction files. */
function RobotGlyph({ color }: { color: string }): JSX.Element {
  return (
    <g stroke={color} strokeWidth="1.2" fill="none">
      <rect x="3.5" y="6" width="9" height="6.5" rx="1.5" />
      <path d="M8 6V4.4" strokeLinecap="round" />
      <circle cx="8" cy="3.4" r="0.9" />
      <circle cx="6.2" cy="9.2" r="0.8" fill={color} stroke="none" />
      <circle cx="9.8" cy="9.2" r="0.8" fill={color} stroke="none" />
    </g>
  );
}

/** Eight-spoke starburst — Claude. */
function StarburstGlyph({ color }: { color: string }): JSX.Element {
  return (
    <g stroke={color} strokeWidth="1.2" strokeLinecap="round" fill="none">
      <path d="M8 2.2v11.6M2.2 8h11.6M3.9 3.9l8.2 8.2M12.1 3.9l-8.2 8.2" />
    </g>
  );
}

/** Git branch — the .git directory. */
function BranchGlyph({ color }: { color: string }): JSX.Element {
  return (
    <g stroke={color} strokeWidth="1.2" fill="none" strokeLinecap="round">
      <circle cx="5" cy="4.2" r="1.6" />
      <circle cx="5" cy="11.8" r="1.6" />
      <circle cx="11.5" cy="6" r="1.6" />
      <path d="M5 5.8v4.4M6.6 6.2c2.4.3 3.3 1 3.3 2.4 0 .8-.6 1.4-1.6 1.7" />
    </g>
  );
}

const SHAPES: Record<GlyphShape, (props: { color: string }) => JSX.Element> = {
  book: BookGlyph,
  copyright: CopyrightGlyph,
  robot: RobotGlyph,
  starburst: StarburstGlyph,
  branch: BranchGlyph,
};

function GlyphSvg({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      className="ui-file-icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Type-aware icon for a FILE name (iconic names first, then extension). */
export function FileIcon({ name, fallback }: { name: string; fallback?: JSX.Element }): JSX.Element | null {
  const glyph = glyphFor(name);
  if (!glyph) return fallback ?? null;
  if (glyph.shape) {
    const Shape = SHAPES[glyph.shape];
    return (
      <GlyphSvg>
        <Shape color={glyph.color ?? "currentColor"} />
      </GlyphSvg>
    );
  }
  const label = glyph.label ?? "";
  const size = label.length >= 3 ? 6.2 : label.length === 2 ? 8.4 : 10.5;
  return (
    <GlyphSvg>
      <text
        x="8"
        y="8"
        textAnchor="middle"
        dominantBaseline="central"
        fill={glyph.color ?? "currentColor"}
        fontSize={size}
        fontWeight="700"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        letterSpacing="-0.2"
      >
        {label}
      </text>
    </GlyphSvg>
  );
}

/** Type-aware icon for a DIRECTORY name (well-known dirs; fallback folder). */
export function DirIcon({ name, fallback }: { name: string; fallback?: JSX.Element }): JSX.Element | null {
  const glyph = DIR_GLYPHS[name.toLowerCase()];
  if (!glyph) return fallback ?? null;
  if (glyph.shape) {
    const Shape = SHAPES[glyph.shape];
    return (
      <GlyphSvg>
        <Shape color={glyph.color ?? "currentColor"} />
      </GlyphSvg>
    );
  }
  return (
    <GlyphSvg>
      <text
        x="8"
        y="8"
        textAnchor="middle"
        dominantBaseline="central"
        fill={glyph.color ?? "currentColor"}
        fontSize="7.4"
        fontWeight="700"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        letterSpacing="-0.2"
      >
        {glyph.label}
      </text>
    </GlyphSvg>
  );
}
