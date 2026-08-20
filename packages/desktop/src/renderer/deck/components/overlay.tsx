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
}): JSX.Element {
  return (
    <div
      className="deck-overlay-scrim"
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
          <button type="button" className="deck-overlay-close" onClick={props.onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="deck-overlay-body">{props.children}</div>
      </div>
    </div>
  );
}
