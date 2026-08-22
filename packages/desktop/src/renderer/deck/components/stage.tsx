// Deck stage: the work-order surface — goal head (h1 + meta), the inline
// pending-approval card, the AskUserQuestion decision block, the gate-hold
// confirm card (E7), the step board (chips + 选中步骤卡), and the autonomy
// dial + brake control row. Everything flows top-down in one scroll column,
// mirroring the design demo's #wrap — there is deliberately NO bottom
// composer here: 下达指令 lives in the control center (⌘⇧O), and new goals
// start from the draft page (⌘N).
import { useMemo, type JSX } from "react";
import { useI18n } from "../../i18n";
import {
  findPendingAskUserQuestion,
  formatAskUserQuestionAnswers,
  formatAskUserQuestionDecline,
} from "../../lib/ask-question";
import type { DeckEngine } from "../hooks/use-deck-engine";
import type { WorkOrder } from "../hooks/use-work-order";
import { GiIcon } from "../icons";
import { StepBoard, recentToolEvents, type PlanStep } from "./step-board";
import { PermissionCard } from "./permission-card";
import { QuestionBlock } from "./question-card";

const AUTONOMY_LABEL: Record<number, "deck.autonomy.full" | "deck.autonomy.key" | "deck.autonomy.each"> = {
  0: "deck.autonomy.full",
  1: "deck.autonomy.key",
  2: "deck.autonomy.each",
};

export function DeckStage(props: {
  engine: DeckEngine;
  steps: PlanStep[];
  workOrder?: WorkOrder;
  /** Selected step index (lifted so j/k keyboard nav can drive it). */
  selectedStep?: number | null;
  onSelectStep?: (index: number | null) => void;
  /** Empty-state CTA — opens the work-order draft overlay (⌘N). */
  onNewGoal?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const { engine } = props;
  const workOrder = props.workOrder;

  const paused = engine.status === "paused" || engine.status === "interrupted";
  const brakeable = engine.busy || paused;

  // AskUserQuestion: the engine parked at waiting_for_user — without this
  // block there is no answer surface in the Deck and the session stalls.
  const pendingQuestion = useMemo(
    () => findPendingAskUserQuestion(engine.messages, engine.status),
    [engine.messages, engine.status]
  );

  const recentEvents = useMemo(() => recentToolEvents(engine.messages), [engine.messages]);

  // 目标头（设计稿 goal-head）：h1 标题 + 会话/步骤/状态 meta。
  const entry = engine.entry;
  const steps = props.steps;
  const doneCount = steps.filter((step) => step.done).length;
  const currentStep =
    steps.find((step) => !step.done && !(workOrder?.struck.includes(step.text) ?? false))?.text ?? null;
  const allDone = steps.length > 0 && doneCount === steps.length;
  // 待决（权限询问 / agent 提问）是"待你定夺"，不是"施工中"。
  const needsAttention = engine.status === "ask_permission" || engine.status === "waiting_for_user";
  const goalStatus = paused
    ? "frozen"
    : allDone
      ? "done"
      : needsAttention
        ? "attention"
        : engine.busy || currentStep
          ? "live"
          : "idle";
  const goalStatusText =
    goalStatus === "frozen"
      ? t("deck.goal.frozen")
      : goalStatus === "done"
        ? t("deck.goal.status.done")
        : goalStatus === "attention"
          ? t("deck.goal.status.attention")
          : goalStatus === "idle"
            ? t("deck.goal.status.idle")
            : currentStep
              ? `${t("deck.goal.status.live")} · ${currentStep}`
              : t("deck.goal.status.live");

  return (
    <main className="deck-stage">
      <div className="deck-stage-column">
        {entry ? (
          <div className="deck-goal-head">
            <h1>{entry.summary ?? t("deck.goal.empty")}</h1>
            <span className="deck-goal-head-meta">
              {entry.id ? `#${entry.id.slice(0, 8)}` : ""}
              {steps.length > 0
                ? ` · ${t("deck.goal.steps", { done: String(doneCount), total: String(steps.length) })}`
                : ""}
              {` · ${goalStatusText}`}
            </span>
            {entry.planMode ? <span className="deck-wo-tag b">Plan</span> : null}
          </div>
        ) : null}

        {engine.askPermissions && engine.askPermissions.length > 0 ? (
          <PermissionCard
            requests={engine.askPermissions}
            onApprove={(result) => void engine.approve(result)}
            onDeny={() => void engine.deny()}
          />
        ) : null}

        {pendingQuestion ? (
          <QuestionBlock
            key={pendingQuestion.messageId}
            questions={pendingQuestion.questions}
            onSubmit={(answers) => void engine.send(formatAskUserQuestionAnswers(answers))}
            onDecline={() => void engine.send(formatAskUserQuestionDecline())}
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
          steps={steps}
          gates={workOrder?.gates}
          struck={workOrder?.struck}
          onCycleGate={workOrder?.cycleStepGate}
          onStrike={workOrder?.toggleStrike}
          selected={props.selectedStep}
          onSelect={props.onSelectStep}
          recentEvents={recentEvents}
          busy={engine.busy}
        />

        {!engine.activeId && steps.length === 0 ? (
          <div className="deck-stage-empty">
            <span className="badge">{t("deck.stage.badge")}</span>
            <p>{t("deck.stage.empty")}</p>
            {props.onNewGoal ? (
              <button type="button" className="deck-op primary" onClick={props.onNewGoal}>
                {t("deck.dock.newGoal")} · ⌘N
              </button>
            ) : null}
          </div>
        ) : null}

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
                <i style={{ width: `${(workOrder.autonomy / 2) * 100}%` }} />
                <b style={{ left: `${(workOrder.autonomy / 2) * 100}%` }} />
              </span>
              <b className="deck-dial-label">{t(AUTONOMY_LABEL[workOrder.autonomy])}</b>
              <span className="deck-dial-hint">{t("deck.autonomy.scope")}</span>
            </button>
            <button
              type="button"
              className={`deck-brake${engine.busy ? "" : paused ? " frozen" : ""}`}
              data-test-id="deck-brake"
              disabled={!brakeable}
              title="Space"
              onClick={() => void engine.brake()}
            >
              <GiIcon id="pause" /> {paused ? t("deck.brake.resume") : t("deck.brake.pause")}
            </button>
            {paused ? <span className="deck-brake-note">{t("deck.brake.frozen")}</span> : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
