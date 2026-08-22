// Step board (完全体): the UpdatePlan checklist rendered as the work order's
// interactive surface — a chip row (click selects, double-click strikes) over
// per-step rows. The selected step expands into a card: gate selector
// (auto / confirm-before / confirm-done, Deck-side policy persisted per
// session), strike state, and — while it is the current step — the live tail
// of tool events from the message stream. Unselected steps collapse to a
// one-line summary (design demo's step-collapsed rows).
import type { JSX } from "react";
import type { SessionMessage } from "../../../shared/ipc";
import { buildToolSummary, getPlanLines } from "../../lib/messages";
import { useI18n } from "../../i18n";
import { GiIcon } from "../icons";
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

/** Live tail of tool events for the running step: tool messages since the
 *  last user message, newest last, capped. Real data — no mock rows. */
export function recentToolEvents(messages: SessionMessage[], cap = 5): Array<{ ok: boolean; text: string }> {
  const out: Array<{ ok: boolean; text: string }> = [];
  for (let i = messages.length - 1; i >= 0 && out.length < cap; i -= 1) {
    const message = messages[i];
    if (!message || message.visible === false) continue;
    if (message.role === "user") break;
    if (message.role !== "tool") continue;
    try {
      const summary = buildToolSummary(message);
      out.unshift({ ok: summary.ok, text: summary.name });
    } catch {
      // Unparseable tool payloads drop out of the tail.
    }
  }
  return out;
}

const NUMERALS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

function numeral(i: number): string {
  return NUMERALS[i] ?? `${i + 1}.`;
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
  /** Selected step index (null = none); the selected step renders expanded. */
  selected?: number | null;
  onSelect?: (index: number | null) => void;
  /** Live tool-event tail, shown only on the current step's expanded card. */
  recentEvents?: Array<{ ok: boolean; text: string }>;
  /** Engine is mid-loop — the last event reads as live (◉), not done (✓). */
  busy?: boolean;
}): JSX.Element | null {
  const { t } = useI18n();
  if (props.steps.length === 0) return null;
  const interactive = Boolean(props.onCycleGate);

  // The current step: first not-done, not-struck step — it owns the live tail.
  const currentIdx = props.steps.findIndex((step) => !step.done && !(props.struck?.includes(step.text) ?? false));
  const selected = props.selected ?? null;
  const selectedStep = selected !== null ? props.steps[selected] : undefined;

  const statusOf = (step: PlanStep, i: number): "done" | "live" | "todo" =>
    step.done ? "done" : i === currentIdx ? "live" : "todo";
  const statusGlyph = (status: "done" | "live" | "todo") => (status === "done" ? "✓" : status === "live" ? "◉" : "○");

  return (
    <section className="deck-steps" aria-label={t("deck.steps.title")}>
      <div className="deck-stepboard" role="group" aria-label={t("deck.steps.title")}>
        {props.steps.map((step, i) => {
          const status = statusOf(step, i);
          const struck = props.struck?.includes(step.text) ?? false;
          const gate = props.gates?.[step.text];
          return (
            <button
              key={i}
              type="button"
              className={`deck-schip ${status}${struck ? " struck" : ""}${selected === i ? " sel" : ""}`}
              onClick={() => props.onSelect?.(selected === i ? null : i)}
              onDoubleClick={() => props.onStrike?.(step.text)}
              title={struck ? t("deck.steps.struckHint") : t("deck.steps.strikeHint")}
            >
              <span className="n">{numeral(i)}</span>
              <span className="st">{statusGlyph(status)}</span>
              <span className="deck-schip-name">{step.text}</span>
              {gate && gate !== "auto" ? (
                <span className="gate-mark">
                  <GiIcon id="shield" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {props.steps.map((step, i) => {
        const status = statusOf(step, i);
        const struck = props.struck?.includes(step.text) ?? false;
        const gate = props.gates?.[step.text] ?? "auto";

        if (selected !== i) {
          return (
            <button
              key={`row-${i}`}
              type="button"
              className="deck-step-collapsed"
              style={{ marginLeft: step.level * 2 }}
              onClick={() => props.onSelect?.(i)}
            >
              <span
                className="st"
                style={{ color: status === "done" ? "var(--ok)" : status === "live" ? "var(--acc)" : "var(--ink3)" }}
              >
                {statusGlyph(status)}
              </span>
              <b>
                {numeral(i)} {step.text}
              </b>
              <span className="sum">{struck ? t("deck.steps.struck") : t(GATE_LABEL[gate])}</span>
              <span className="more">{t("deck.steps.expand")}</span>
            </button>
          );
        }

        return (
          <div key={`card-${i}`} className="deck-wocard sel" style={{ marginLeft: step.level * 2 }}>
            <div className="deck-wo-head">
              <span
                className="st"
                style={{ color: status === "done" ? "var(--ok)" : status === "live" ? "var(--acc)" : "var(--ink3)" }}
              >
                {statusGlyph(status)}
              </span>
              {numeral(i)} {selectedStep?.text}
              {struck ? <span className="deck-wo-tag r">{t("deck.steps.struck")}</span> : null}
              {interactive ? (
                <button
                  type="button"
                  className="deck-gate-sel"
                  data-gate-step={i}
                  title={t("deck.steps.gateHint")}
                  onClick={() => props.onCycleGate?.(step.text)}
                >
                  <GiIcon id="shield" />
                  {t("deck.steps.gate")} · {t(GATE_LABEL[gate])} ▾
                </button>
              ) : null}
            </div>
            <div className="deck-wo-body">
              {i === currentIdx && props.recentEvents && props.recentEvents.length > 0 ? (
                <div className="deck-prog-line">
                  {props.recentEvents.map((event, j) => {
                    const live = props.busy && j === props.recentEvents!.length - 1;
                    return (
                      <div key={j}>
                        <span className={live ? "lv" : event.ok ? "ok" : "lv"}>{live || !event.ok ? "◉" : "✓"}</span>{" "}
                        {event.text}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {interactive ? (
                <div className="deck-panel-ops">
                  <button
                    type="button"
                    className={`deck-op strike${struck ? " active" : ""}`}
                    onClick={() => props.onStrike?.(step.text)}
                  >
                    {struck ? t("deck.steps.unstrike") : t("deck.steps.strike")}
                  </button>
                  <span className="deck-row-meta">{t("deck.steps.gateHint")}</span>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}
