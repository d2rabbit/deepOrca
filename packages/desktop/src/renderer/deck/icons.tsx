// SVG stroke icons for the Deck module dock, ported from the design demo
// (docs/research/ui-ux/design/index.html). 24×24 viewBox, 1.7 stroke,
// currentColor — the six deck themes recolor them for free.
//
// E4 adds the .gi semantic icon class (orca-deck-v3_change.html): small inline
// icons for panel rows — notification kinds, asset types, decision blocks —
// replacing every emoji in the deck with theme-token-stroked SVG.
import type { JSX } from "react";

export type DeckIconId =
  | "bell"
  | "tape"
  | "theme"
  | "gear"
  | "files"
  | "git"
  | "proc"
  | "assets"
  | "review"
  | "db"
  | "ledger"
  | "tree"
  | "plug"
  | "undo"
  | "edit"
  | "keys"
  | "floor"
  | "plus"
  | "shield"
  | "activity"
  | "zap"
  | "target"
  | "ruler"
  | "alert"
  | "pause";

const PATHS: Record<DeckIconId, JSX.Element> = {
  bell: (
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 19a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  tape: <path d="M5 4h14M5 9h14M5 14h10M5 19h7" />,
  theme: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="9" cy="10" r=".9" fill="currentColor" />
      <circle cx="15" cy="10" r=".9" fill="currentColor" />
      <circle cx="10" cy="15" r=".9" fill="currentColor" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
    </>
  ),
  files: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  git: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="9" r="2" />
      <path d="M6 8v8M6 8c5 0 9 0 10-1" />
    </>
  ),
  proc: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </>
  ),
  assets: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  review: (
    <>
      <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  db: (
    <>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" />
      <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </>
  ),
  ledger: (
    <>
      <path d="M4 17l4-6 4 3 4-7 4 5" />
      <path d="M4 20h16" />
    </>
  ),
  tree: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 7v10M8 12h8" />
    </>
  ),
  plug: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  undo: (
    <>
      <path d="M4 10a8 8 0 1 1 2 6" />
      <path d="M4 4v6h6" />
    </>
  ),
  edit: (
    <>
      <path d="M14 5l5 5L8 21H3v-5z" />
      <path d="M12 7l5 5" />
    </>
  ),
  keys: (
    <path d="M9 9V7a2 2 0 1 0-2 2h2zm0 0v6m0-6h6m-6 6v2a2 2 0 1 1-2-2h2zm6-6h2a2 2 0 1 0-2-2v2zm0 6v2a2 2 0 1 0 2 2h-2zm0-6v6" />
  ),
  floor: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  plus: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
      <path d="M12 8v4M12 15.5v.5" />
    </>
  ),
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  zap: <path d="M13 2L4 14h6l-1 8 9-12h-6z" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r=".8" fill="currentColor" />
    </>
  ),
  ruler: (
    <>
      <rect x="3" y="9" width="18" height="6" rx="1.5" transform="rotate(-20 12 12)" />
      <path d="M8.2 12.6l.9 2.5M12 11.2l.9 2.5M15.8 9.8l.9 2.5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 11v4M12 17.6v.4" />
    </>
  ),
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </>
  ),
};

export function DeckIcon({ id }: { id: DeckIconId }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[id]}
    </svg>
  );
}

/** Inline .gi semantic icon (12px; `lg` = 17px) for panel rows and titles. */
export function GiIcon({ id, lg }: { id: DeckIconId; lg?: boolean }): JSX.Element {
  return (
    <svg
      className={lg ? "gi gi-lg" : "gi"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[id]}
    </svg>
  );
}
