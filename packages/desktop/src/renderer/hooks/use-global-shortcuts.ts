import { useEffect, useRef } from "react";

/**
 * ⌘K command palette + global keyboard shortcuts.
 *
 * Extracted from App.tsx verbatim.
 *
 * The handlers are latched into a ref that is refreshed on every render, and the
 * effect keeps an empty dep array, so `addEventListener("keydown")` runs exactly
 * once for the app's lifetime — as it did inline. Putting the handlers (or an
 * options object) in the dep array instead would remove and re-add the listener on
 * every render, i.e. on every stream tick.
 */
export type ShortcutHandlers = {
  togglePalette: () => void;
  toggleProcessPanel: () => void;
  togglePanel: () => void;
  newSession: () => void;
  openSettings: () => void | Promise<void>;
  toggleShortcutsModal: () => void;
};

export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const h = ref.current;
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        h.togglePalette();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        h.toggleProcessPanel();
      }
      // ⌘B / Ctrl+B — toggle sidebar panel
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        h.togglePanel();
      }
      // ⌘J / Ctrl+J — toggle bottom process panel
      if ((e.metaKey || e.ctrlKey) && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        h.toggleProcessPanel();
      }
      // ⌘N / Ctrl+N — new session
      if ((e.metaKey || e.ctrlKey) && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        h.newSession();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        void h.openSettings();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "?" || e.key === "/")) {
        e.preventDefault();
        h.toggleShortcutsModal();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
