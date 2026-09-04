/**
 * Window caption glyphs — Windows 11 Fluent-style title-bar controls
 * (minimize / maximize-restore / close). 12×12 viewBox rendered at 12px;
 * 1.5px stroke gives a crisp 1.5px line, and `currentColor` lets the theme
 * dictate the foreground via the --ui-text-dim / --ui-text / --ui-danger
 * palette.
 */
import type { JSX } from "react";

/** Horizontal line — minimize */
export function IconWindowMin(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Square outline — maximize / restore */
export function IconWindowMaxRestore(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Diagonal cross — close window */
export function IconWindowClose(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
