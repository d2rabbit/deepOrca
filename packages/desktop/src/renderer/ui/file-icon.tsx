import type { JSX } from "react";

/**
 * File-type icon — a tiny colored language badge (label + accent color per
 * type, palette loosely following the linguist/Seti hues VSCode shows).
 * Drawn as SVG text on a 16×16 canvas: crisp at any DPI, no external icon
 * font, and degrades to the caller's generic file icon for unknown types.
 */

type FileGlyph = {
  /** Short badge label (1–3 chars). */
  label: string;
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

function glyphFor(name: string): FileGlyph | null {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  return EXT_GLYPHS[ext] ?? null;
}

export function FileIcon({ name, fallback }: { name: string; fallback?: JSX.Element }): JSX.Element | null {
  const glyph = glyphFor(name);
  if (!glyph) return fallback ?? null;
  const size = glyph.label.length >= 3 ? 6.2 : glyph.label.length === 2 ? 8.4 : 10.5;
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
      <text
        x="8"
        y="8"
        textAnchor="middle"
        dominantBaseline="central"
        fill={glyph.color ?? "currentColor"}
        fontSize={size}
        fontWeight="700"
        fontStyle="normal"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        letterSpacing="-0.2"
      >
        {glyph.label}
      </text>
    </svg>
  );
}
