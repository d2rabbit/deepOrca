import type { JSX } from "react";

import { useI18n } from "../../i18n";
import type { PairLaneState } from "../../hooks/use-pair-lane";
import { PAIR_PHASE_KEYS } from "./pair-i18n";
import { fileBaseName } from "../../ui/path-utils";

type Props = {
  lane: PairLaneState;
  file: string | null;
  /** Git branch of the workspace (visual draft status bar ⑂ item). */
  branch?: string | null;
  onJumpDiagnostics?: () => void;
  /** Dedicated editor-palette trigger — ⌘K belongs to the app-level command
   *  palette, so the editor opens its own surface through this button. */
  onOpenPalette?: () => void;
  /** D7/⑦: live LSP diagnostics summary from the kernel. */
  diagnostics?: { errors: number; warnings: number; firstLine: number | null };
  /** Lane rail reopen affordance (re-audit #13: close had no way back). */
  onToggleLane?: () => void;
  laneOpen?: boolean;
};

/** Editor status bar (specs/editor-copilot B4, visual draft ⑦): git branch,
 *  AI presence (three-state lamp), live ±N while a run is up, checkpoint
 *  count, diagnostics and the keyboard affordances. */
export function EditorStatusBar({
  lane,
  file,
  branch,
  onJumpDiagnostics,
  onOpenPalette,
  diagnostics,
  onToggleLane,
  laneOpen,
}: Props): JSX.Element {
  const { t } = useI18n();
  const cls = lane.phase === "streaming" ? " live" : lane.phase === "review" ? " wait" : "";
  return (
    <div className="ui-edpair-status">
      <span className="it mono">{file ? fileBaseName(file) : "—"}</span>
      {branch ? (
        <span className="it mono" title={t("editor.pair.status.branch")}>
          ⑂ {branch}
        </span>
      ) : null}
      {diagnostics && (diagnostics.errors > 0 || diagnostics.warnings > 0) ? (
        <button type="button" className="it click" onClick={onJumpDiagnostics} title={t("editor.pair.status.diagJump")}>
          {diagnostics.errors > 0 ? <span className="err">⊗ {diagnostics.errors}</span> : null}
          {diagnostics.warnings > 0 ? <span className="warn">△ {diagnostics.warnings}</span> : null}
        </button>
      ) : null}
      <span className="grow" />
      {lane.stats.added > 0 || lane.stats.removed > 0 ? (
        <span className="it mono">
          <span className="add">+{lane.stats.added}</span> <span className="del">−{lane.stats.removed}</span>
        </span>
      ) : null}
      {lane.checkpoints.length > 0 ? (
        <span className="it mono">{t("editor.pair.status.cp", { n: String(lane.checkpoints.length) })}</span>
      ) : null}
      <span className={`it ai-pill${cls}`}>
        <span className="lamp" />
        {t(PAIR_PHASE_KEYS[lane.phase])}
      </span>
      <span className="it">
        <kbd>⌘I</kbd> {t("editor.pair.status.pair")}
      </span>
      {onOpenPalette ? (
        <button type="button" className="it click" onClick={onOpenPalette} title={t("editor.pair.status.palette")}>
          ⌘ {t("editor.pair.status.palette")}
        </button>
      ) : null}
      <span className="it">
        <kbd>⌘Z</kbd> {t("editor.pair.status.rollback")}
      </span>
      {onToggleLane ? (
        <button type="button" className="it click" onClick={onToggleLane} title={t("editor.pair.lane.toggle")}>
          ◧ {t("editor.pair.lane.toggle")}
        </button>
      ) : null}
    </div>
  );
}
