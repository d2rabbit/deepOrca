// Deck settings (⌘,): layout (with the always-reachable back-to-classic
// switch), theme (the six design-spec themes), and language. Same data
// sources as the classic layer — localStorage layout key, deck theme key,
// i18n locale — so the two shells stay in sync.
import { useMemo, type JSX } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { switchLayout } from "../../lib/layout";
import { readCorePathMetrics, type FunnelStats } from "../../lib/core-path-metrics";
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

function funnelLine(
  stats: FunnelStats | null,
  t: (key: MessageKey, params?: Record<string, string | number>) => string
): string {
  if (!stats || stats.completed === 0) return t("deck.metrics.none");
  return [
    t("deck.metrics.runs", { count: stats.completed }),
    t("deck.metrics.avgClicks", { count: stats.avgClicks.toFixed(1) }),
    t("deck.metrics.avgTime", { value: (stats.avgMs / 1000).toFixed(1) }),
  ].join(" · ");
}

/** §6 metrics readout — the data review points #1/#2 decide from. */
function MetricsSection(): JSX.Element {
  const { t } = useI18n();
  const summary = useMemo(() => readCorePathMetrics(), []);

  return (
    <>
      <div className="deck-panel-group-title">{t("deck.metrics.title")}</div>
      <div className="deck-row static">
        <span className="deck-row-main">{t("deck.metrics.boots")}</span>
        <span className="deck-row-meta">
          {summary.boots.classic} / {summary.boots.deck}
        </span>
      </div>
      <div className="deck-row static">
        <span className="deck-row-main">{t("deck.metrics.switches")}</span>
        <span className="deck-row-meta">
          → {summary.switches.toDeck} / → {summary.switches.toClassic}
        </span>
      </div>
      <div className="deck-row static">
        <span className="deck-row-main">
          {t("deck.metrics.funnel")} · {t("deck.metrics.classic")}
        </span>
        <span className="deck-row-meta">{funnelLine(summary.runs.classic, t)}</span>
      </div>
      <div className="deck-row static">
        <span className="deck-row-main">
          {t("deck.metrics.funnel")} · {t("deck.metrics.deck")}
        </span>
        <span className="deck-row-meta">{funnelLine(summary.runs.deck, t)}</span>
      </div>
      <div className="deck-row-sub">{t("deck.metrics.note")}</div>
    </>
  );
}

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

      <MetricsSection />
    </div>
  );
}
