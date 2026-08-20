// Step board: renders the newest UpdatePlan checklist from the message stream
// as the work order's steps. E7 makes it interactive: per-step gates
// (auto / confirm-before / confirm-done) and striking — both Deck-side
// policy, persisted per session; the engine still owns the plan itself.
import type { JSX } from "react";
import type { SessionMessage } from "../../../shared/ipc";
import { buildToolSummary, getPlanLines } from "../../lib/messages";
import { useI18n } from "../../i18n";
import type { StepGate } from "../lib/work-order";

export type PlanStep = { text: string; done: boolean; level: number };

/** Extract plan steps from the newest UpdatePlan tool message, if any. */
export function extractPlanSteps(messages: SessionMessage[]): PlanStep[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "tool") continue;
    const lines = getPlanLines(buildToolSummary(message));
    if (lines.length === 0) continue;
    const steps: PlanStep[] = [];
    for (const line of lines) {
      const match = line.match(/^(\s*)[-*]\s*\[([ xX])\]\s+(.*)$/);
      if (match) {
        steps.push({ text: match[3].trim(), done: match[2].toLowerCase() === "x", level: match[1].length });
      }
    }
    return steps;
  }
  return [];
}

const GATE_LABEL: Record<StepGate, "deck.gate.auto" | "deck.gate.confirmBefore" | "deck.gate.confirmDone"> = {
  auto: "deck.gate.auto",
  "confirm-before": "deck.gate.confirmBefore",
  "confirm-done": "deck.gate.confirmDone",
};

export function StepBoard(props: {
  steps: PlanStep[];
  /** E7 work-order policy — omit for read-only rendering. */
  gates?: Record<string, StepGate>;
  struck?: string[];
  onCycleGate?: (step: string) => void;
  onStrike?: (step: string) => void;
}): JSX.Element | null {
  const { t } = useI18n();
  if (props.steps.length === 0) return null;
  const interactive = Boolean(props.onCycleGate);

  return (
    <section className="deck-steps deck-gc" aria-label={t("deck.steps.title")}>
      <div className="deck-steps-title">{t("deck.steps.title")}</div>
      <ol className="deck-steps-list">
        {props.steps.map((step, i) => {
          const gate = props.gates?.[step.text];
          const struck = props.struck?.includes(step.text) ?? false;
          return (
            <li
              key={i}
              className={`${step.done ? "done" : ""}${struck ? " struck" : ""}`}
              style={{ paddingLeft: step.level * 2 }}
            >
              <span className={`deck-step-check${step.done ? " done" : ""}`}>{step.done ? "✓" : ""}</span>
              <span className="deck-step-text">{step.text}</span>
              {interactive ? (
                <span className="deck-step-ops">
                  <button
                    type="button"
                    className={`deck-op gate${gate ? " set" : ""}`}
                    data-gate-step={i}
                    title={t("deck.steps.gate")}
                    onClick={() => props.onCycleGate?.(step.text)}
                  >
                    {gate ? t(GATE_LABEL[gate]) : t("deck.steps.gate")}
                  </button>
                  <button
                    type="button"
                    className={`deck-op strike${struck ? " set" : ""}`}
                    title={t("deck.steps.strike")}
                    onClick={() => props.onStrike?.(step.text)}
                  >
                    ⌫
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
