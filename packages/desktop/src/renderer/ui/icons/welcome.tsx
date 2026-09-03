/**
 * Welcome-card icons — the quick-start action chips on the empty session
 * screen. 20×20 viewBox rendered at 22px for a larger, calmer presence.
 */
import type { JSX } from "react";
import { W } from "./presets";

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
