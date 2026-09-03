/**
 * Primary navigation icons — the vertical activity rail and top-level panel
 * affordances. 20×20 viewBox rendered at 18px; 1.5px stroke gives clean lines
 * on both Retina and standard displays.
 */
import type { JSX } from "react";
import { S } from "./presets";

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
