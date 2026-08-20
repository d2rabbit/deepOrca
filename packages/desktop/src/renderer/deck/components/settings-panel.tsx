// Deck settings (⌘,): layout (with the always-reachable back-to-classic
// switch), theme (the six design-spec themes), and language. Same data
// sources as the classic layer — localStorage layout key, deck theme key,
// i18n locale — so the two shells stay in sync.
import type { JSX } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { switchLayout } from "../../lib/layout";
import type { DeckTheme } from "../lib/appearance";
import { ThemeSwatches } from "./theme-panel";

const LOCALE_OPTIONS: Array<{ code: string; labelKey: MessageKey }> = [
  { code: "zh", labelKey: "lang.zh" },
  { code: "zh-TW", labelKey: "lang.zh-TW" },
  { code: "zh-HK", labelKey: "lang.zh-HK" },
  { code: "en", labelKey: "lang.en" },
  { code: "ja", labelKey: "lang.ja" },
  { code: "ko", labelKey: "lang.ko" },
];

export function DeckSettingsPanel(props: { theme: DeckTheme; onPickTheme(theme: DeckTheme): void }): JSX.Element {
  const { t, locale, setLocale } = useI18n();

  return (
    <div className="deck-panel">
      <div className="deck-panel-group-title">{t("deck.settings.theme")}</div>
      <ThemeSwatches theme={props.theme} onPick={props.onPickTheme} />

      <div className="deck-panel-group-title">{t("deck.settings.language")}</div>
      <div className="deck-lang-grid" role="radiogroup" aria-label={t("deck.settings.language")}>
        {LOCALE_OPTIONS.map((option) => (
          <button
            key={option.code}
            type="button"
            role="radio"
            aria-checked={locale === option.code}
            className={`deck-op chip${locale === option.code ? " primary" : ""}`}
            onClick={() => setLocale(option.code as typeof locale)}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>

      <div className="deck-panel-group-title">{t("deck.settings.layout")}</div>
      <div className="deck-settings-layout">
        <div className="deck-row static">
          <span className="deck-row-main">
            {t("deck.settings.layoutDeck")}
            <span className="deck-row-sub">{t("deck.settings.layoutHint")}</span>
          </span>
          <span className="deck-row-ops">
            <button type="button" className="deck-op primary" onClick={() => switchLayout("classic")}>
              {t("deck.backToClassic")}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
