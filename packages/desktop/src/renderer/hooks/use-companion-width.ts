import { useCallback, useState } from "react";

const W_KEY = "deeporca.companion.width";
export const COMPANION_WIDTH_MIN = 320;
export const COMPANION_WIDTH_MAX = 720;
const DEFAULT_WIDTH = 480;

/** localStorage may be absent (tests, hardened contexts) — persistence is
 *  best-effort chrome state and must never break rendering. */
function readWidth(): number {
  try {
    const raw = Number(window.localStorage?.getItem(W_KEY));
    return Number.isFinite(raw) && raw >= COMPANION_WIDTH_MIN && raw <= COMPANION_WIDTH_MAX ? raw : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/**
 * Companion card (right floating island: prototype/design preview,
 * architecture graph) width — drag its left edge to resize, mirroring the
 * hub sheet's right-edge handle. The committed width persists across
 * launches: resize once, it stays resized.
 */
export function useCompanionWidth(): {
  companionWidth: number;
  handleCompanionResizeStart: (e: React.MouseEvent) => void;
} {
  const [companionWidth, setCompanionWidth] = useState<number>(readWidth);

  const handleCompanionResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = companionWidth;
      const onMove = (ev: MouseEvent) => {
        // Dragging the left edge LEFT widens the card (delta negative → wider).
        const delta = ev.clientX - startX;
        setCompanionWidth(Math.max(COMPANION_WIDTH_MIN, Math.min(COMPANION_WIDTH_MAX, startWidth - delta)));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        // Persist the committed width (not every mousemove).
        setCompanionWidth((w) => {
          try {
            window.localStorage?.setItem(W_KEY, String(w));
          } catch {
            // ignore — best-effort persistence
          }
          return w;
        });
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [companionWidth]
  );

  return { companionWidth, handleCompanionResizeStart };
}
