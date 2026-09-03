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
  togglePanel: () => void;
  newSession: () => void;
  openSettings: () => void | Promise<void>;
  toggleShortcutsModal: () => void;
  /** True while a blocking dialog (workspace trust) must swallow shortcuts. */
  blocked?: () => boolean;
};

export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const h = ref.current;
      // Guards: (a) Alt-modified combos must pass through — AltGr on Windows
      // reports ctrlKey+altKey and would otherwise fire shortcuts while the
      // user types special characters; (b) auto-repeat must not machine-gun
      // (hold Ctrl+N opening sessions); (c) a blocking trust dialog owns the
      // keyboard — shortcuts must not act behind it.
      if (e.altKey || e.repeat) return;
      if (h.blocked?.()) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        h.togglePalette();
      }
      // ⌘B / Ctrl+B — toggle sidebar panel
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        h.togglePanel();
      }
      // ⌘N / Ctrl+N — new session
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        h.newSession();
      }
      if (e.key === ",") {
        e.preventDefault();
        void h.openSettings();
      }
      if (e.shiftKey && (e.key === "?" || e.key === "/")) {
        e.preventDefault();
        h.toggleShortcutsModal();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
