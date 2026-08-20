// First-run onboarding (E6.4, coverage §5 "三步导览卡"): three teaching
// cards shown ONCE per install — ⌘K command layer / editable work orders /
// Space brake. Dismissal persists in localStorage; it never nags again.
import { useCallback, useState, type JSX } from "react";
import { useI18n } from "../../i18n";

const SEEN_KEY = "deeporca.deck.onboarded";

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

export function OnboardingModal(props: { onDismiss(): void }): JSX.Element {
  const { t } = useI18n();
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
        <button type="button" className="deck-op primary" onClick={props.onDismiss}>
          {t("deck.onboard.start")}
        </button>
      </div>
    </div>
  );
}
