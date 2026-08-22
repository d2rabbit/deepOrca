// Generic deck overlay: a glass panel floating over the stage with a title
// bar and close affordance, rendered as one layer of the unified overlay
// stack. Esc/⌘⇧Esc handling lives in deck-app's single listener; this
// component is purely presentational, stacking via its depth in the stack.
import type { JSX, ReactNode } from "react";

export function DeckOverlay(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Wider variant for data-heavy panels (floor wall, tape, editor). */
  wide?: boolean;
  /** Position in the overlay stack — sets the stacking order. */
  depth?: number;
  /** Layer kind, exposed as data-layer for tests and styling. */
  layer?: string;
  /** E8: load this module's full-body view into a stage tab. */
  onExpand?: () => void;
  /** Accessible label / tooltip for the expand button. */
  expandLabel?: string;
  /** Only the topmost floating layer dims the stage (设计稿单 scrim) —
   *  lower layers get a transparent click-catcher instead of stacking shade. */
  dimmed?: boolean;
}): JSX.Element {
  return (
    <div
      className={`deck-overlay-scrim${props.dimmed === false ? " ghost" : ""}`}
      style={{ zIndex: 40 + (props.depth ?? 0) * 10 }}
      data-layer={props.layer}
      onClick={props.onClose}
    >
      <div
        className={`deck-overlay deck-gc${props.wide ? " wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={props.title}
      >
        <div className="deck-overlay-head">
          <span className="deck-overlay-title">{props.title}</span>
          <span className="deck-kbd deck-overlay-esc">Esc</span>
          {props.onExpand ? (
            <button
              type="button"
              className="deck-overlay-expand"
              onClick={props.onExpand}
              aria-label={props.expandLabel ?? "Open in tab"}
              title={props.expandLabel}
            >
              ⇱
            </button>
          ) : null}
          <button type="button" className="deck-overlay-close" onClick={props.onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="deck-overlay-body">{props.children}</div>
      </div>
    </div>
  );
}
