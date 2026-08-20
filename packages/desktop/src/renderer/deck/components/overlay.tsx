// Generic deck overlay: a glass panel floating over the stage with a title
// bar and close affordance. Esc handling lives in deck-app (single listener
// closes the topmost overlay); this component is purely presentational.
import type { JSX, ReactNode } from "react";

export function DeckOverlay(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Wider variant for data-heavy panels (floor wall, tape). */
  wide?: boolean;
}): JSX.Element {
  return (
    <div className="deck-overlay-scrim" onClick={props.onClose}>
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
