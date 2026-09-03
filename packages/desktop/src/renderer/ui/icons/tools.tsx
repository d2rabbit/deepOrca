/**
 * Tool-type icons — per-tool-family glyphs shown on tool avatars in the
 * conversation flow (read/write/edit/ask/plan/search/MCP plus the bash
 * terminal). 16×16 viewBox rendered at 13px.
 */
import type { JSX } from "react";
import { T } from "./presets";

/** Open book — read tool */
export function IconToolRead(): JSX.Element {
  return (
    <svg {...T}>
      <path d="M2 3h5v10H2V3Zm12 0H9v10h5V3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 3v10" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/** Pencil on paper — write tool */
export function IconToolWrite(): JSX.Element {
  return (
    <svg {...T}>
      <path d="M4 2h6l3 3v9H4V2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6 8h4M6 11h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Pencil — edit tool */
export function IconToolEdit(): JSX.Element {
  return (
    <svg {...T}>
      <path
        d="M11 2.5a1.5 1.5 0 0 1 2.1 2.1L6 11.7 3.5 12.5l.8-2.5L11 2.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Question mark in circle — ask tool */
export function IconToolAsk(): JSX.Element {
  return (
    <svg {...T}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M6.2 6.2a1.8 1.8 0 0 1 3.5.7c0 1.2-1.7 1.5-1.7 2.6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

/** Clipboard with check — plan tool */
export function IconToolPlan(): JSX.Element {
  return (
    <svg {...T}>
      <rect x="3" y="2.5" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 2.5V1.5h4v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M5.5 7l1.5 1.5 3-3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5.5 11h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Magnifying glass — web search tool */
export function IconToolSearch(): JSX.Element {
  return (
    <svg {...T}>
      <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Plug — MCP tool */
export function IconToolMcp(): JSX.Element {
  return (
    <svg {...T}>
      <path d="M6 2v4M10 2v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="4" y="6" width="8" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 10v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Gear — generic tool */
export function IconToolGeneric(): JSX.Element {
  return (
    <svg {...T}>
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M12.2 3.8l-1 1M4.8 11.2l-1 1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Inline-SVG terminal glyph: a window with a chevron prompt and a cursor —
    bash/CLI tool family (was message/shared's BashTerminalIcon). */
export function IconBashTerminal(): JSX.Element {
  return (
    <svg {...T}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M4 6.5 L6 8 L4 9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="7" y1="9.5" x2="10.5" y2="9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
