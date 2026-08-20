// Step board: renders the newest UpdatePlan checklist from the message stream
// as the work order's steps. Read-only in E1 (the engine owns the plan).
import type { JSX } from "react";
import type { SessionMessage } from "../../../shared/ipc";
import { buildToolSummary, getPlanLines } from "../../lib/messages";
import { useI18n } from "../../i18n";

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

export function StepBoard(props: { steps: PlanStep[] }): JSX.Element | null {
  const { t } = useI18n();
  if (props.steps.length === 0) return null;
  return (
    <section className="deck-steps deck-gc" aria-label={t("deck.steps.title")}>
      <div className="deck-steps-title">{t("deck.steps.title")}</div>
      <ol className="deck-steps-list">
        {props.steps.map((step, i) => (
          <li key={i} className={step.done ? "done" : ""} style={{ paddingLeft: step.level * 2 }}>
            <span className={`deck-step-check${step.done ? " done" : ""}`}>{step.done ? "✓" : ""}</span>
            <span className="deck-step-text">{step.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
