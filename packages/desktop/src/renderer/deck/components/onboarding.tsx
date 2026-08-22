// First-run onboarding (E6.4, coverage §5 "三步导览卡"): three teaching
// cards shown ONCE per install — ⌘K command layer / editable work orders /
// Space brake — plus the default-autonomy pick from the design demo (随时可改,
// so this is a starting stance, not a commitment). Dismissal persists in
// localStorage; it never nags again.
import { useCallback, useState, type JSX } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import type { AutonomyLevel } from "../lib/work-order";

const SEEN_KEY = "deeporca.deck.onboarded";

const AUTONOMY_OPTIONS: Array<{ level: AutonomyLevel; labelKey: MessageKey; descKey: MessageKey; glyph: string }> = [
  { level: 0, labelKey: "deck.autonomy.full", descKey: "deck.onboard.auto0", glyph: "○" },
  { level: 1, labelKey: "deck.autonomy.key", descKey: "deck.onboard.auto1", glyph: "◐" },
  { level: 2, labelKey: "deck.autonomy.each", descKey: "deck.onboard.auto2", glyph: "●" },
];

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true; // Storage broken → don't block the workbench with a modal.
  }
}

export function useDeckOnboarding(): { visible: boolean; dismiss(): void } {
  const [visible, setVisible] = useState(() => !seen());
  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Best-effort persistence.
    }
    setVisible(false);
  }, []);
  return { visible, dismiss };
}

export function OnboardingModal(props: {
  onDismiss(): void;
  /** Applies the chosen starting autonomy (default: 关键确认). */
  onPickAutonomy?: (level: AutonomyLevel) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [level, setLevel] = useState<AutonomyLevel>(1);

  const start = () => {
    props.onPickAutonomy?.(level);
    props.onDismiss();
  };

  return (
    <div className="deck-overlay-scrim" data-layer="onboarding">
      <div className="deck-onboard deck-gcd" role="dialog" aria-label={t("deck.onboard.title")}>
        <div className="deck-onboard-head">🐋</div>
        <b className="deck-onboard-title">{t("deck.onboard.title")}</b>
        <p className="deck-onboard-hint">{t("deck.onboard.hint")}</p>
        <ul className="deck-onboard-list">
          <li>{t("deck.onboard.item1")}</li>
          <li>{t("deck.onboard.item2")}</li>
          <li>{t("deck.onboard.item3")}</li>
        </ul>
        <div className="deck-panel-group-title">{t("deck.onboard.autonomy")}</div>
        <div className="deck-onboard-autonomy">
          {AUTONOMY_OPTIONS.map((option) => (
            <button
              key={option.level}
              type="button"
              className={`deck-ob-choice${level === option.level ? " sel" : ""}`}
              onClick={() => setLevel(option.level)}
            >
              <b>
                {option.glyph} {t(option.labelKey)}
              </b>
              <span>{t(option.descKey)}</span>
              {option.level === 1 ? <span className="deck-wo-tag b">{t("deck.onboard.recommended")}</span> : null}
            </button>
          ))}
        </div>
        <button type="button" className="deck-op primary" onClick={start} data-test-id="deck-onboard-start">
          {t("deck.onboard.start")}
        </button>
      </div>
    </div>
  );
}
