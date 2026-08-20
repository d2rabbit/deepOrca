// Deck stage: the work-order surface — step board (UpdatePlan), the inline
// pending-approval card when the engine asks, and the command input bar at
// the bottom. E1's core loop lives here.
import { useState, type JSX } from "react";
import { useI18n } from "../../i18n";
import type { DeckEngine } from "../hooks/use-deck-engine";
import { StepBoard, type PlanStep } from "./step-board";
import { PermissionCard } from "./permission-card";

export function DeckStage(props: { engine: DeckEngine; steps: PlanStep[] }): JSX.Element {
  const { t } = useI18n();
  const { engine } = props;
  const [draft, setDraft] = useState("");

  const submit = () => {
    const text = draft.trim();
    if (!text || engine.busy) return;
    setDraft("");
    void engine.send(text);
  };

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

        <StepBoard steps={props.steps} />

        {!engine.activeId && props.steps.length === 0 ? (
          <div className="deck-stage-empty">
            <span className="badge">{t("deck.stage.badge")}</span>
            <p>{t("deck.stage.empty")}</p>
          </div>
        ) : null}
      </div>

      {engine.busy || engine.status === "paused" || engine.status === "interrupted" ? (
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
