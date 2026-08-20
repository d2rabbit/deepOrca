// Work-order draft page (E7.3, ⌘N): the PlanCard's v3 form — title, editable
// steps, a gate per step. "Stamp & dispatch" compiles the draft into a
// structured prompt; the engine adopts the plan via UpdatePlan, which then
// drives the real step board (and the per-step gates keyed by step text).
import { useState, type JSX } from "react";
import { useI18n } from "../../i18n";
import { cycleGate, type StepGate } from "../lib/work-order";

type DraftStep = { text: string; gate: StepGate };

const STARTER_STEPS: DraftStep[] = [
  { text: "", gate: "auto" },
  { text: "", gate: "auto" },
  { text: "", gate: "auto" },
];

const GATE_LABEL: Record<StepGate, "deck.gate.auto" | "deck.gate.confirmBefore" | "deck.gate.confirmDone"> = {
  auto: "deck.gate.auto",
  "confirm-before": "deck.gate.confirmBefore",
  "confirm-done": "deck.gate.confirmDone",
};

/** Compile the draft into the structured prompt sent to the engine. */
export function buildWorkOrderPrompt(title: string, steps: DraftStep[]): string {
  const lines = steps
    .map((step, i) => step.text.trim())
    .filter(Boolean)
    .map((text, i) => `${i + 1}. [ ] ${text}`);
  return [
    `Work order: ${title.trim()}`,
    "",
    "Execute this work order. Track progress with the UpdatePlan tool using exactly these step labels:",
    ...lines,
    "",
    "Update the checklist as you go; do not rename or reorder the steps.",
  ].join("\n");
}

export function DraftPanel(props: { onDispatch(text: string): void }): JSX.Element {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState<DraftStep[]>(() => STARTER_STEPS.map((step) => ({ ...step })));

  const stepAt = (i: number, patch: Partial<DraftStep>) =>
    setSteps((prev) => prev.map((step, idx) => (idx === i ? { ...step, ...patch } : step)));

  const dispatchable = title.trim().length > 0 && steps.some((step) => step.text.trim().length > 0);

  const dispatch = () => {
    if (!dispatchable) return;
    props.onDispatch(buildWorkOrderPrompt(title, steps));
  };

  return (
    <div className="deck-panel">
      <input
        className="deck-draft-title"
        value={title}
        placeholder={t("deck.draft.namePlaceholder")}
        onChange={(e) => setTitle(e.target.value)}
        data-test-id="deck-draft-title"
      />
      {steps.map((step, i) => (
        <div key={i} className="deck-draft-step">
          <span className="deck-draft-num">{i + 1}</span>
          <input
            value={step.text}
            placeholder={t("deck.draft.stepPlaceholder")}
            onChange={(e) => stepAt(i, { text: e.target.value })}
          />
          <button
            type="button"
            className="deck-op"
            data-gate-step={i}
            onClick={() => stepAt(i, { gate: cycleGate(step.gate) })}
          >
            {t(GATE_LABEL[step.gate])}
          </button>
          <button
            type="button"
            className="deck-op"
            aria-label="Remove step"
            onClick={() => setSteps((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="deck-panel-ops">
        <button
          type="button"
          className="deck-op"
          onClick={() => setSteps((prev) => [...prev, { text: "", gate: "auto" }])}
        >
          {t("deck.draft.addStep")}
        </button>
        <button
          type="button"
          className="deck-op primary"
          disabled={!dispatchable}
          data-test-id="deck-draft-stamp"
          onClick={dispatch}
        >
          {t("deck.draft.stamp")}
        </button>
      </div>
    </div>
  );
}
