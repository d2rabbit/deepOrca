import { useState, type JSX } from "react";

import { useI18n } from "../../i18n";
import { FileIcon } from "../../ui/icons";
import type { PairLaneState } from "../../hooks/use-pair-lane";
import { PAIR_PHASE_KEYS, PAIR_PLAN_STEP_KEYS } from "./pair-i18n";
import { fileBaseName } from "../../ui/path-utils";

type Props = {
  lane: PairLaneState;
  file: string | null;
  /** Open files for the changed-files section (D9). */
  openFiles: string[];
  onOpenFile(file: string): void;
  onToggle(): void;
  /** Lane follow-up composer (visual draft ⑦ footer): 追加指令 rides the
   *  MAIN session — the lane never runs an inline agent. */
  onAskAgent?: (prompt: string) => void;
};

/** Pair lane (specs/editor-copilot D8/D9, visual draft ④): the right rail
 *  giving the AI run its plan/tool-activity/files surface. The approval
 *  queue slot renders only when a cross-file task is in flight — those
 *  launches ride the main session today, so the lane shows their landing
 *  point instead of faking a queue. */
export function LanePanel({ lane, file, openFiles, onOpenFile, onToggle, onAskAgent }: Props): JSX.Element {
  const { t } = useI18n();
  const [followup, setFollowup] = useState("");
  const busy = lane.phase === "streaming";
  const cls = busy ? " live" : lane.phase === "review" ? " wait" : "";
  const activeName = file ? fileBaseName(file) : "—";
  const sendFollowup = (): void => {
    const text = followup.trim();
    if (!text || !onAskAgent) return;
    onAskAgent(`【编辑器追加指令】${file ?? ""}\n${text}`);
    setFollowup("");
  };
  return (
    <div className="ui-edlane">
      <div className="ui-edlane-head">
        <span className="t">✦ {t("editor.pair.lane.title")}</span>
        <span className="file mono">{activeName}</span>
        <button type="button" className="x" onClick={onToggle} aria-label={t("common.close")}>
          ✕
        </button>
      </div>
      <div className={`ui-edlane-status${cls}`}>
        <span className="lamp" />
        {t(PAIR_PHASE_KEYS[lane.phase])}
      </div>

      <section className="ui-edlane-sec">
        <h4>{t("editor.pair.lane.plan")}</h4>
        <div className="plan">
          {PAIR_PLAN_STEP_KEYS.map((key, i) => (
            <div key={key} className={`row ${i < lane.stage.step ? "done" : i === lane.stage.step ? "doing" : ""}`}>
              <span className="dot">{i < lane.stage.step ? "✓" : i + 1}</span>
              {t(key)}
            </div>
          ))}
        </div>
      </section>

      <section className="ui-edlane-sec">
        <h4>{t("editor.pair.lane.files")}</h4>
        <div className="flist">
          <button
            type="button"
            className={`frow${file ? " active" : ""}`}
            disabled={!file}
            onClick={() => file && onOpenFile(file)}
          >
            <span className="fn mono">
              <FileIcon name={activeName} />
              {activeName}
            </span>
            {lane.stats.added > 0 || lane.stats.removed > 0 ? (
              <span className="pm mono">
                +{lane.stats.added} −{lane.stats.removed}
              </span>
            ) : null}
            {lane.phase === "review" ? <span className="st-pill pending">{t("editor.pair.lane.pending")}</span> : null}
            {lane.phase === "streaming" ? (
              <span className="st-pill pending">{t("editor.pair.lane.streaming")}</span>
            ) : null}
          </button>
          {openFiles
            .filter((f) => f !== file)
            .map((f) => (
              <button key={f} type="button" className="frow" onClick={() => onOpenFile(f)}>
                <span className="fn mono">
                  <FileIcon name={fileBaseName(f)} />
                  {fileBaseName(f)}
                </span>
              </button>
            ))}
        </div>
      </section>

      <section className="ui-edlane-sec">
        <h4>{t("editor.pair.lane.approval")}</h4>
        <div className="ui-edlane-note">{t("editor.pair.lane.approvalHint")}</div>
      </section>

      {onAskAgent ? (
        <div className="ui-edlane-followup">
          <input
            className="ui-edlane-followup-input"
            value={followup}
            onChange={(e) => setFollowup(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendFollowup();
              }
            }}
            placeholder={t("editor.pair.lane.followup")}
          />
          <button type="button" className="ui-edlane-followup-go" disabled={!followup.trim()} onClick={sendFollowup}>
            {t("editor.pair.toChat")}
          </button>
        </div>
      ) : null}
      <p className="ui-edlane-foot">{t("editor.pair.lane.foot")}</p>
    </div>
  );
}
