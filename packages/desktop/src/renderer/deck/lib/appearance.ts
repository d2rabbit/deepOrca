// Deck theme mechanism (E3): the six design-spec themes, hot-swapped by
// flipping the data-deck-theme attribute on the deck root. Every theme sheet
// is a token-only block scoped to that attribute, so switching is zero-reload
// and the choice persists like every other UI preference (localStorage only).

export type DeckTheme = "liquid" | "flat" | "glass" | "neu" | "clay" | "vern";

export const DECK_THEMES: readonly DeckTheme[] = ["liquid", "flat", "glass", "neu", "clay", "vern"];

const THEME_KEY = "deeporca.deck.theme";

export function resolveDeckTheme(): DeckTheme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return DECK_THEMES.includes(stored as DeckTheme) ? (stored as DeckTheme) : "liquid";
  } catch {
    return "liquid";
  }
}

export function persistDeckTheme(theme: DeckTheme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Persisting is best-effort.
  }
}
