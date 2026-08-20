// Theme picker (E3): the six design-spec themes as a swatch grid. Picking one
// hot-swaps data-deck-theme on the deck root — zero reload, persisted via
// lib/appearance. Shared by the standalone theme overlay and the settings panel.
import type { JSX } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { DECK_THEMES, type DeckTheme } from "../lib/appearance";

const THEME_LABEL: Record<DeckTheme, MessageKey> = {
  liquid: "deck.theme.name.liquid",
  flat: "deck.theme.name.flat",
  glass: "deck.theme.name.glass",
  neu: "deck.theme.name.neu",
  clay: "deck.theme.name.clay",
  vern: "deck.theme.name.vern",
};

export function ThemeSwatches(props: { theme: DeckTheme; onPick(theme: DeckTheme): void }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="deck-themes">
      {DECK_THEMES.map((theme) => (
        <button
          key={theme}
          type="button"
          data-theme-swatch={theme}
          className={`deck-theme-card${props.theme === theme ? " active" : ""}`}
          onClick={() => props.onPick(theme)}
        >
          <span className={`deck-theme-chip chip-${theme}`} />
          <span className="deck-theme-name">{t(THEME_LABEL[theme])}</span>
        </button>
      ))}
    </div>
  );
}
