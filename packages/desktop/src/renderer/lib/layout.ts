// Layout mode switch for the desktop renderer.
//
// "classic" is the existing App shell (default, fallback). "deck" is the
// experimental Orca Deck workbench (see docs/research/ui-ux/design/). The
// choice is persisted in localStorage like the theme preference — it never
// touches settings.json or IPC. Switching reloads the window; session data
// lives in the core layer so nothing is lost across a switch.

export type LayoutMode = "classic" | "deck";

const LAYOUT_KEY = "deeporca.layout";

/** The persisted layout choice. Anything unexpected falls back to classic. */
export function resolveLayout(): LayoutMode {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "deck" ? "deck" : "classic";
  } catch {
    return "classic";
  }
}

/** Persist the choice and reload so the window remounts the other root. */
export function switchLayout(mode: LayoutMode): void {
  try {
    localStorage.setItem(LAYOUT_KEY, mode);
  } catch {
    // Persisting is best-effort.
  }
  window.location.reload();
}

/**
 * Force-persist classic WITHOUT reloading. Used by the bootstrap fallback when
 * the deck chunk fails to load — the next launch must come up classic even if
 * the user never touches the setting again.
 */
export function resetLayoutToClassic(): void {
  try {
    localStorage.setItem(LAYOUT_KEY, "classic");
  } catch {
    // Persisting is best-effort.
  }
}
