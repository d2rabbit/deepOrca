/**
 * Common UI glyphs — the shared vocabulary used across panels: status marks
 * (check/warn/info/clock), actions (plus/trash/pencil/undo-close-external),
 * file-tree shapes (folder/file), chat-flow ornaments (bot/chat bubble/
 * sparkle/bolt) and misc affordances (menu bars, chevron, refresh, terminal).
 * Default 20×20 canvas at 18px unless noted.
 */
import type { JSX } from "react";
import { C, S } from "./presets";

/** Chat bubble — session item (16×16 viewBox, rendered at 12px) */
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

/** Outlined folder — dense file rows (file-mention menu, 14px on 16×16) */
export function IconFolderOutline(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.586a1 1 0 0 1 .707.293l1.414 1.414a1 1 0 0 0 .707.293h4.586a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Outlined document — dense file rows (file-mention menu, 14px on 16×16) */
export function IconFileOutline(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M3.5 2.5h6l3 3v7a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9.5 2.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
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

/** Cross — dismiss (fault banner, panels) */
export function IconClose(): JSX.Element {
  return (
    <svg {...S}>
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** External window — popout preview */
export function IconExternal(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3M12 4h4v4M16 4l-6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Canopy tree over a ground line — workspace task hub tab */
export function IconTaskHub(): JSX.Element {
  return (
    <svg {...S}>
      <circle cx="10" cy="6.3" r="3.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9.7V17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 17h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 6.3V4.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Speech bubble with ellipsis — user prompt in task traces */
export function IconChatBubble(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H8.5L5 16.2v-2.7H4A1.5 1.5 0 0 1 2.5 12V6A1.5 1.5 0 0 1 4 4.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="9" r="0.9" fill="currentColor" />
      <circle cx="10" cy="9" r="0.9" fill="currentColor" />
      <circle cx="13" cy="9" r="0.9" fill="currentColor" />
    </svg>
  );
}

/** Robot head — subagent block in task traces */
export function IconBot(): JSX.Element {
  return (
    <svg {...S}>
      <rect x="4" y="6.2" width="12" height="9" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6.2V3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="10" cy="3" r="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 10.2h.01M13 10.2h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 13.4h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** Shield with check — review report reference chip */
export function IconShield(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M10 2.8l5.5 2v5c0 3.4-2.4 5.7-5.5 7-3.1-1.3-5.5-3.6-5.5-7v-5l5.5-2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M7.2 9.6l1.9 1.9 3.7-3.9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Four-point star — sparkle markers (PRD / prototype / model tabs) */
export function IconSparkle(): JSX.Element {
  return (
    <svg {...S}>
      <path
        d="M10 2.8l1.9 5.3 5.3 1.9-5.3 1.9L10 17.2l-1.9-5.3-5.3-1.9 5.3-1.9L10 2.8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Bulleted list — instruction TOC head */
export function IconList(): JSX.Element {
  return (
    <svg {...S}>
      <path d="M7 5.5h10M7 10h10M7 14.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="3.8" cy="5.5" r="1.1" fill="currentColor" />
      <circle cx="3.8" cy="10" r="1.1" fill="currentColor" />
      <circle cx="3.8" cy="14.5" r="1.1" fill="currentColor" />
    </svg>
  );
}

/** Terminal prompt — shell / script execution */
export function IconTerminal(): JSX.Element {
  return (
    <svg {...S}>
      <path d="M4 5l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 15h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Chevron down — expandable affordances (pinned plan, dropdowns) */
export function IconChevronDown(): JSX.Element {
  return (
    <svg {...S}>
      <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Two curved arrows — refresh (skill re-scan) */
export function IconRefresh(): JSX.Element {
  return (
    <svg {...S}>
      <path d="M16.9 7.6A7.4 7.4 0 0 0 3.6 6.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M17 3.4v3.6h-3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.1 12.4A7.4 7.4 0 0 0 16.4 13.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 16.6V13h3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
