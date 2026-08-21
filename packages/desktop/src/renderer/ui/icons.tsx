import type { JSX } from "react";

/**
 * Crisp SVG icons for the vertical icon rail. Each icon is designed for a
 * 20×20 viewBox rendered at 18px — 1.5px stroke gives clean lines on both
 * Retina and standard displays. `currentColor` inherits the rail button's
 * text color so active/hover states work automatically.
 */

const S = { width: 18, height: 18, viewBox: "0 0 20 20", fill: "none", "aria-hidden": true, focusable: false } as const;

/** Pencil — new session */
export function IconNewSession(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M13.5 3.5a2.12 2.12 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Stacked list — sessions/explorer */
export function IconSessions(): JSX.Element {
  return (
    <svg {...S}>
      <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Branch fork — git/SCM */
export function IconGit(): JSX.Element {
  return (
    <svg {...S}>
      <circle cx="6" cy="5" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6" cy="15" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="14" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 7v6M8 8h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Checkmark in circle — tasks/plan */
export function IconTasks(): JSX.Element {
  return (
    <svg {...S}>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 10l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Command key — command palette */
export function IconCommand(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M7 7V5a2 2 0 1 0-2 2h2Zm0 0v6m0-6h6m-6 6v2a2 2 0 1 1-2-2h2Zm6-6h2a2 2 0 1 0-2-2v2Zm0 0v6m0-6V5a2 2 0 1 1 2 2h-2Zm0 6h2a2 2 0 1 1-2 2v-2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Puzzle piece — plugins */
export function IconPlugins(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M8 3H5a2 2 0 0 0-2 2v3a2 2 0 0 1 0 4v3a2 2 0 0 0 2 2h3a2 2 0 0 0 4 0h3a2 2 0 0 0 2-2v-3a2 2 0 0 0-4 0V5a2 2 0 0 0-2-2h-3a2 2 0 0 0-4 0Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Bar chart — token stats */
export function IconTokens(): JSX.Element {
  return (
    <svg {...S}>
      <path d="M4 16V10M10 16V4M16 16V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Database/index — codegraph index library */
export function IconIndex(): JSX.Element {
  return (
    <svg {...S}>
      <ellipse cx="10" cy="5" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 5v10c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 10c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Magnifier with checkmark — code review */
export function IconReview(): JSX.Element {
  return (
    <svg {...S}>
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M7 9l1.5 1.5L11.5 7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Layout wireframe — designer panel (prototypes & design docs) */
export function IconDesign(): JSX.Element {
  return (
    <svg {...S}>
      <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 7.5h14" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 7.5V17" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/** Rooted node tree — task tree panel */
export function IconTaskTree(): JSX.Element {
  return (
    <svg {...S}>
      <circle cx="10" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 5.8V9M5.5 9h9M5.5 9v2.8M14.5 9v2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="5.5" cy="13.6" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="14.5" cy="13.6" r="1.8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** Repo book with branch — GitMCP repositories */
export function IconGitmcp(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M6.5 3h9v14h-9A1.5 1.5 0 0 1 5 15.5v-11A1.5 1.5 0 0 1 6.5 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M5 14.5A1.5 1.5 0 0 1 6.5 13h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="9.5" cy="6.5" r="1.1" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12.5" cy="10" r="1.1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.5 7.6c0 1.6 3 .8 3 1.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Book with nodes — wiki knowledge graph */
export function IconWiki(): JSX.Element {
  return (
    <svg {...S}>
      <path d="M4 4h12v13H4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7 4v13" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="8" r="1.2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="13" r="1.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M12 9.2v2.6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/** Eye with slash — reasoning hidden */
export function IconReasoningHidden(): JSX.Element {
  return (
    <svg {...S}>
      <path d="M3 3l14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M8.5 8.5a2.5 2.5 0 0 0 3.5 3.5M6 6C4 7.5 2.5 10 2.5 10s3 5.5 7.5 5.5c1.5 0 2.8-.5 4-1.2M14 14c2-1.5 3.5-4 3.5-4s-3-5.5-7.5-5.5c-.5 0-1 .05-1.5.15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Eye open — reasoning normal */
export function IconReasoningNormal(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M2.5 10s3-5.5 7.5-5.5S17.5 10 17.5 10s-3 5.5-7.5 5.5S2.5 10 2.5 10Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Eye with rays — reasoning expanded */
export function IconReasoningExpanded(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M2.5 10s3-5.5 7.5-5.5S17.5 10 17.5 10s-3 5.5-7.5 5.5S2.5 10 2.5 10Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.5" fill="currentColor" />
    </svg>
  );
}

/** Moon — dark mode */
export function IconMoon(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M16 11.5A6.5 6.5 0 0 1 8.5 4 6.5 6.5 0 1 0 16 11.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Sun — light mode */
export function IconSun(): JSX.Element {
  return (
    <svg {...S}>
      <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 2v2M10 16v2M2 10h2M16 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Diamond/gem — glass theme */
export function IconGlass(): JSX.Element {
  return (
    <svg {...S}>
      <path d="M10 2l6 5-6 11L4 7l6-5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M4 7h12M10 2l-2 5 2 11 2-11-2-5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

/** Lightning bolt — Line theme punk (2077) variant toggle */
export function IconPunk(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M11.5 2 5 11h4l-1.5 7L15 9h-4l.5-7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Undo arrow — undo/restore */
export function IconUndo(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M4 8h9a4 4 0 0 1 0 8H9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7 5L4 8l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Gear — settings */
export function IconSettings(): JSX.Element {
  return (
    <svg {...S}>
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── Welcome card icons (16×16 viewBox, rendered at 22px) ─────────────────── */

const W = { width: 22, height: 22, viewBox: "0 0 20 20", fill: "none", "aria-hidden": true, focusable: false } as const;

/** Half-circle gauge — plan mode */
export function IconWelcomePlan(): JSX.Element {
  return (
    <svg {...W}>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Document with lines — init/AGENTS.md */
export function IconWelcomeInit(): JSX.Element {
  return (
    <svg {...W}>
      <path
        d="M5 3h7l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 3v4h4M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Puzzle piece — skills */
export function IconWelcomeSkills(): JSX.Element {
  return (
    <svg {...W}>
      <path
        d="M8 3H5a2 2 0 0 0-2 2v3a2 2 0 0 1 0 4v3a2 2 0 0 0 2 2h3a2 2 0 0 0 4 0h3a2 2 0 0 0 2-2v-3a2 2 0 0 0-4 0V5a2 2 0 0 0-2-2h-3a2 2 0 0 0-4 0Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Undo arrow — restore */
export function IconWelcomeUndo(): JSX.Element {
  return (
    <svg {...W}>
      <path
        d="M4 8h9a4 4 0 0 1 0 8H9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7 5L4 8l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Tool-type icons (16×16 viewBox, rendered at 13px) ───────────────────── */

const T = { width: 13, height: 13, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true, focusable: false } as const;

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

/** Chat bubble — session item (12×12 inline) */
export function IconChat(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M2.5 3h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-3 2.5V11h-.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Code brackets — editor */
export function IconEditor(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M8 3H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8M8 3v5h5M8 3l5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 12l-2-2 2-2M12 12l2-2-2-2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Magic wand with sparkles — prompt enhancement */
export function IconMagicWand(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M13.2 6.8 3.5 16.5M15 5l-1.8 1.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 9.5v3M14 11h3M6.5 2.5v3M5 4h3M17 15.5v2M16 16.5h2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Folder — file-tree directory */
export function IconFolder(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M3 5.5A1.5 1.5 0 0 1 4.5 4h3.2l1.6 2h6.2A1.5 1.5 0 0 1 17 7.5v7A1.5 1.5 0 0 1 15.5 16h-11A1.5 1.5 0 0 1 3 14.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Document — file-tree file */
export function IconFile(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M5.5 3h5L15 7.5v8A1.5 1.5 0 0 1 13.5 17h-8A1.5 1.5 0 0 1 4 15.5v-11A1.5 1.5 0 0 1 5.5 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10.5 3v4.5H15" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
