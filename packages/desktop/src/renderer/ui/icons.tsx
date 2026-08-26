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
      <path d="M4 16V10M10 16V4M16 16V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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

/** Document with pencil — prototype module (requirements doc → wireframe) */
export function IconPrototype(): JSX.Element {
  return (
    <svg {...S}>
      <path d="M5 3h6.5L16 7.5V17H5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M11.5 3v4.5H16" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M7.2 12.8l1.6-1.6 4.2 4.2-1.9.3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
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

/** Tuning sliders — settings (three rails with knobs; deliberately not a
    radial gear — that reads as a second sun next to the appearance toggle) */
export function IconSettings(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M3 5h5.2M12.8 5H17M3 10h1.2M8.8 10H17M3 15h8.2M15.8 15H17"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="10.5" cy="5" r="1.9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6" cy="10" r="1.9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13.5" cy="15" r="1.9" stroke="currentColor" strokeWidth="1.5" />
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

/** Book with graph nodes — knowledge (Wiki / arch maps / symbol index) */
export function IconWelcomeKnowledge(): JSX.Element {
  return (
    <svg {...W}>
      <path
        d="M3 4.5A1.5 1.5 0 0 1 4.5 3H9a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0-1.5-1.5H4.5A1.5 1.5 0 0 1 3 13V4.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M17 4.5A1.5 1.5 0 0 0 15.5 3H11a1.5 1.5 0 0 0-1.5 1.5V16a1.5 1.5 0 0 1 1.5-1.5h4.5a1.5 1.5 0 0 0 1.5-1.5V4.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="13.5" cy="8" r="1.4" fill="currentColor" />
      <circle cx="15.8" cy="11.4" r="1.1" fill="currentColor" />
      <path d="M13.5 8L15.8 11.4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

/** Shield with check — code review */
export function IconWelcomeReview(): JSX.Element {
  return (
    <svg {...W}>
      <path
        d="M10 2.5l6 2.2v4.6c0 3.9-2.6 6.9-6 8.2-3.4-1.3-6-4.3-6-8.2V4.7l6-2.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M7 10l2.2 2.2L13.4 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

/** Chat bubble — session item (16×16 viewBox, rendered at 12px) */
const C = { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true, focusable: false } as const;

export function IconChat(): JSX.Element {
  return (
    <svg {...C}>
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

/** Plus — generic add affordance (quick dock new-session, …) */
export function IconPlus(): JSX.Element {
  return (
    <svg {...S}>
      <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Circle-i — informational marker */
export function IconInfo(): JSX.Element {
  return (
    <svg {...S}>
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="6.4" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Clock — deadline / elapsed markers */
export function IconClock(): JSX.Element {
  return (
    <svg {...S}>
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 5.75V10l3 1.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Trash — destructive delete */
export function IconTrash(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M4.5 6h11M8 6V4.6c0-.6.5-1.1 1.1-1.1h1.8c.6 0 1.1.5 1.1 1.1V6m2.8 0-.55 9.05A1.6 1.6 0 0 1 12.96 16.5H7.04a1.6 1.6 0 0 1-1.6-1.45L4.9 6M8.3 9v4.4M11.7 9v4.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Triangle-alert — warning */
export function IconWarn(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M10 3.6 17.2 15.9a1.15 1.15 0 0 1-1 1.73H3.8a1.15 1.15 0 0 1-1-1.73L10 3.6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10 8v3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14.35" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Padlock — security-relevant marker */
export function IconLock(): JSX.Element {
  return (
    <svg {...S}>
      <rect x="4.75" y="8.75" width="10.5" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.25 8.5V6.9a2.75 2.75 0 0 1 5.5 0v1.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="12.4" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Flame — hot-risk marker */
export function IconFlame(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M10.4 2.9s.62 2.06-.86 3.85C8.22 8.31 6.4 9.3 6.4 11.9a3.98 3.98 0 0 0 7.96.18c.1-1.78-.72-3.02-1.36-3.87-.24.62-.6 1.1-1.08 1.44.28-2.6-.66-5.53-1.52-6.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Scales — comparison / review weighting */
export function IconBalance(): JSX.Element {
  return (
    <svg {...S}>
      <path d="M10 4v12M6.8 16h6.4M4 6.5h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M4 6.5 1.9 11a2.3 2.3 0 0 0 4.2 0L4 6.5ZM16 6.5 13.9 11a2.3 2.3 0 0 0 4.2 0L16 6.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Palette — design / materialize actions */
export function IconPalette(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M10 2.9a7.25 7.25 0 0 0 0 14.5c1.34 0 1.9-.76 1.9-1.55 0-.97-.78-1.44-.78-2.27 0-.86.7-1.33 1.83-1.33h1.2c2 0 3.15-1.06 3.15-3.05C17.3 5.5 14.1 2.9 10 2.9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="6.9" cy="8.2" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="6.4" r="1" fill="currentColor" stroke="none" />
      <circle cx="13.1" cy="8.2" r="1" fill="currentColor" stroke="none" />
      <circle cx="6.7" cy="11.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Bolt — live/agent activity (Serena badge, streaming avatar) */
export function IconBolt(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M11.2 2.75 4.8 11.1h4.1l-.9 6.15 6.6-8.65h-4.2l.8-5.85Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Checkmark — pass / success */
export function IconCheck(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="m4.5 10.5 3.6 3.6L15.5 6.7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Open book — documentation */
export function IconBook(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M10 5.2C8.8 4 7 3.5 4.9 3.5c-.8 0-1.4.06-1.9.16v11.2c.5-.1 1.1-.16 1.9-.16 2.1 0 3.9.5 5.1 1.7 1.2-1.2 3-1.7 5.1-1.7.8 0 1.4.06 1.9.16V3.66c-.5-.1-1.1-.16-1.9-.16-2.1 0-3.9.5-5.1 1.7ZM10 5.2v11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Pencil — rename / edit-in-editor (same glyph as new-session) */
export function IconPencil(): JSX.Element {
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

/** Three horizontal bars — menu / list toggle */
export function IconMenuBars(): JSX.Element {
  return (
    <svg {...S}>
      <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
