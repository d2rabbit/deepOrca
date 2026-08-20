// Deck stage: the work-order surface — step board (UpdatePlan), the inline
// pending-approval card when the engine asks, the gate-hold confirm card
// (E7), the autonomy dial + brake control row, and the command input bar.
import { useState, type JSX } from "react";
import { useI18n } from "../../i18n";
import type { DeckEngine } from "../hooks/use-deck-engine";
import type { WorkOrder } from "../hooks/use-work-order";
import { StepBoard, type PlanStep } from "./step-board";
import { PermissionCard } from "./permission-card";

const AUTONOMY_LABEL: Record<number, "deck.autonomy.full" | "deck.autonomy.key" | "deck.autonomy.each"> = {
  0: "deck.autonomy.full",
  1: "deck.autonomy.key",
  2: "deck.autonomy.each",
};

export function DeckStage(props: { engine: DeckEngine; steps: PlanStep[]; workOrder?: WorkOrder }): JSX.Element {
  const { t } = useI18n();
  const { engine } = props;
  const workOrder = props.workOrder;
  const [draft, setDraft] = useState("");

  const submit = () => {
    const text = draft.trim();
    if (!text || engine.busy) return;
    setDraft("");
    void engine.send(text);
  };

  const paused = engine.status === "paused" || engine.status === "interrupted";
  const brakeable = engine.busy || paused;

  return (
    <main className="deck-stage">
      <div className="deck-stage-column">
        {engine.askPermissions && engine.askPermissions.length > 0 ? (
          <PermissionCard
            requests={engine.askPermissions}
            onApprove={(result) => void engine.approve(result)}
            onDeny={() => void engine.deny()}
          />
        ) : null}

        {workOrder?.hold ? (
          <section className="deck-gate-card deck-gc anchor" data-test-id="deck-gate-card">
            <div className="deck-pending-title">
              {t(workOrder.hold.phase === "done" ? "deck.gate.card.done" : "deck.gate.card.before", {
                step: workOrder.hold.step,
              })}
            </div>
            <div className="deck-pending-submit">
              <button type="button" className="deck-op primary" onClick={workOrder.confirmHold}>
                {t("deck.gate.resume")}
              </button>
              <button type="button" className="deck-op" onClick={workOrder.keepFrozen}>
                {t("deck.gate.stay")}
              </button>
            </div>
          </section>
        ) : null}

        <StepBoard
          steps={props.steps}
          gates={workOrder?.gates}
          struck={workOrder?.struck}
          onCycleGate={workOrder?.cycleStepGate}
          onStrike={workOrder?.toggleStrike}
        />

        {!engine.activeId && props.steps.length === 0 ? (
          <div className="deck-stage-empty">
            <span className="badge">{t("deck.stage.badge")}</span>
            <p>{t("deck.stage.empty")}</p>
          </div>
        ) : null}
      </div>

      {workOrder ? (
        <div className="deck-control-row">
          <button
            type="button"
            className="deck-dial deck-gc"
            data-test-id="deck-autonomy"
            title={t("deck.autonomy.hint")}
            onClick={workOrder.cycleAutonomyDial}
          >
            {t("deck.autonomy.label")}
            <span className="deck-dial-track">
              <i style={{ width: `${((workOrder.autonomy + 1) / 3) * 100}%` }} />
            </span>
            <b className="deck-dial-label">{t(AUTONOMY_LABEL[workOrder.autonomy])}</b>
          </button>
        </div>
      ) : null}

      {brakeable ? (
        <div className="deck-control-row">
          <button
            type="button"
            className={`deck-brake${engine.busy ? "" : " frozen"}`}
            data-test-id="deck-brake"
            onClick={() => void engine.brake()}
          >
            {engine.busy ? t("deck.brake.pause") : t("deck.brake.resume")}
          </button>
          {engine.busy ? null : <span className="deck-brake-note">{t("deck.brake.frozen")}</span>}
        </div>
      ) : null}

      <div className="deck-composer deck-gc">
        <input
          value={draft}
          placeholder={t("deck.composer.placeholder")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          disabled={engine.busy}
        />
        {engine.busy ? (
          <button type="button" className="deck-send stop" onClick={() => void engine.interrupt()}>
            ⏸
          </button>
        ) : (
          <button type="button" className="deck-send" onClick={submit} disabled={!draft.trim()}>
            ➤
          </button>
        )}
      </div>
    </main>
  );
}
