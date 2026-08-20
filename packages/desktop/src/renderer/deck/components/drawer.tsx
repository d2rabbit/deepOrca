// Edge-docked drawer shell (E6.1): files/changes dock left, notifications/
// processes dock right — no scrim, so the stage and centered overlays stay
// visible and interactive. The stack still owns open/close order (Esc closes
// centered layers first, drawers last).
import type { JSX, ReactNode } from "react";

export function DrawerShell(props: {
  title: string;
  side: "left" | "right";
  layer: string;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <aside className={`deck-drawer ${props.side} deck-gcd`} data-layer={props.layer} role="complementary">
      <div className="deck-drawer-head">
        <span className="deck-drawer-title">{props.title}</span>
        <button type="button" className="deck-overlay-close" onClick={props.onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="deck-drawer-body">{props.children}</div>
    </aside>
  );
}
