// Goal band: current goal (active session summary), mini-step progress dots
// driven by the real UpdatePlan checklist, and the always-reachable
// back-to-classic escape hatch. Clicking the goal opens the workshop wall
// (session switcher) — the chevron advertises exactly that.
import type { JSX } from "react";
import { useI18n } from "../../i18n";
import { switchLayout } from "../../lib/layout";
import type { PlanStep } from "./step-board";

export function GoalBand(props: { goal: string | null; steps: PlanStep[]; onOpenFloor?: () => void }): JSX.Element {
  const { t } = useI18n();
  const { steps } = props;

  return (
    <header className="deck-ribbon deck-gc">
      <button
        type="button"
        className="deck-goal"
        onClick={props.onOpenFloor}
        title={t("deck.dock.floor")}
        disabled={!props.onOpenFloor}
      >
        <span className="dot">◉</span> {props.goal ?? t("deck.goal.empty")} <span className="chev">▾</span>
      </button>
      {steps.length > 0 ? (
        <span className="deck-mini-steps" aria-hidden="true">
          {steps.map((step, i) => {
            const live = !step.done && steps.findIndex((s) => !s.done) === i;
            return (
              <span key={i} style={{ display: "contents" }}>
                {i > 0 ? <span className={`ml${steps[i - 1]?.done ? " done" : ""}`} /> : null}
                <span
                  className={`mn${step.done ? " done" : live ? " live" : " todo"}`}
                  title={`${i + 1}. ${step.text}`}
                />
              </span>
            );
          })}
        </span>
      ) : null}
      <button type="button" className="deck-back" onClick={() => switchLayout("classic")}>
        ← {t("deck.backToClassic")}
      </button>
    </header>
  );
}
