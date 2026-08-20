// Goal band: current goal (active session summary), mini-step progress dots
// driven by the real UpdatePlan checklist, and the always-reachable
// back-to-classic escape hatch.
import type { JSX } from "react";
import { useI18n } from "../../i18n";
import { switchLayout } from "../../lib/layout";
import type { PlanStep } from "./step-board";

export function GoalBand(props: { goal: string | null; steps: PlanStep[] }): JSX.Element {
  const { t } = useI18n();
  const { steps } = props;

  return (
    <header className="deck-ribbon deck-gc">
      <span className="deck-goal">
        <span className="dot">◉</span> {props.goal ?? t("deck.goal.empty")} <span className="chev">▾</span>
      </span>
      {steps.length > 0 ? (
        <span className="deck-mini-steps" aria-hidden="true">
          {steps.map((step, i) => (
            <span key={i} style={{ display: "contents" }}>
              {i > 0 ? <span className={`ml${steps[i - 1]?.done ? " done" : ""}`} /> : null}
              <span className={`mn${step.done ? " done" : " todo"}`} />
            </span>
          ))}
        </span>
      ) : null}
      <button type="button" className="deck-back" onClick={() => switchLayout("classic")}>
        ← {t("deck.backToClassic")}
      </button>
    </header>
  );
}
