/**
 * App-shell modal cluster (extracted from App.tsx to keep the composition
 * root under the file-length ceiling): fault / discard / trust / branch
 * confirm dialogs that render above the shell. All state lives in App.tsx —
 * this component only receives values and confirm callbacks.
 */

import type { JSX } from "react";
import { Button, Modal } from "../ui/index";
import { UndoModal } from "./UndoModal";
import { ShortcutsModal } from "./ShortcutsModal";
import { WorkspaceTrustDialog } from "./WorkspaceTrustDialog";
import { useI18n } from "../i18n";
import { formatBuildError } from "../lib/build-error";
import type { WorkspaceTrustLevel } from "../../shared/ipc";

type AppModalsProps = {
  modal: "undo" | "shortcuts" | "discard-settings" | "discard-editor" | null;
  onCloseModal: () => void;
  activeId: string | null;
  onUndoRestored: () => void;
  platform: string;
  modelFault: string | null;
  onDismissModelFault: () => void;
  /** Discard unsaved settings and close the settings tab. */
  onDiscardSettings: () => void;
  /** Discard the whole editor workspace (all dirty sub-tabs). */
  onDiscardEditorWorkspace: () => void;
  /** File path pending per-file dirty-close confirmation, or null. */
  editorFileClose: string | null;
  onDismissFileClose: () => void;
  onConfirmCloseFile: (file: string) => void;
  trustAskOpen: boolean;
  trustBusy: boolean;
  onTrustSelect: (level: WorkspaceTrustLevel) => void;
  branchConflict: string | null;
  onDismissBranchConflict: () => void;
  stashSwitching: boolean;
  onStashAndSwitch: () => void;
};

export function AppModals(props: AppModalsProps): JSX.Element {
  const { t } = useI18n();
  return (
    <>
      {props.modal === "undo" ? (
        <UndoModal sessionId={props.activeId} onClose={props.onCloseModal} onRestored={props.onUndoRestored} />
      ) : null}

      {/* Model-transport fault dialog — the build console keeps the full
          detail; this exists so a broken endpoint is impossible to miss. */}
      {props.modelFault ? (
        <Modal
          title={t("build.modelFaultTitle")}
          subtitle={t("build.modelFaultBody")}
          onClose={props.onDismissModelFault}
          actions={
            <Button variant="primary" onClick={props.onDismissModelFault}>
              {t("build.modelFaultOk")}
            </Button>
          }
        >
          <div className="ui-model-fault-detail">{formatBuildError(props.modelFault, t)}</div>
        </Modal>
      ) : null}

      {props.modal === "shortcuts" ? <ShortcutsModal platform={props.platform} onClose={props.onCloseModal} /> : null}

      {/* Settings close confirmed by Esc / scrim / tab ✕ while edits are
          unsaved — same dialog the panel's old close button used to show. */}
      {props.modal === "discard-settings" ? (
        <Modal
          title={t("settings.unsavedTitle")}
          subtitle={t("settings.unsavedBody")}
          onClose={props.onCloseModal}
          actions={
            <>
              <Button onClick={props.onCloseModal}>{t("common.cancel")}</Button>
              <Button variant="primary" onClick={props.onDiscardSettings}>
                {t("settings.unsavedDiscard")}
              </Button>
            </>
          }
        />
      ) : null}

      {/* Editor workspace close while any sub-tab has unsaved edits — the
          workspace-level guard (chip ✕ / Esc); per-file close guards live in
          the workspace itself. */}
      {props.modal === "discard-editor" ? (
        <Modal
          title={t("editor.workspace.closeDirtyTitle")}
          subtitle={t("editor.workspace.closeDirtyBody")}
          onClose={props.onCloseModal}
          actions={
            <>
              <Button onClick={props.onCloseModal}>{t("common.cancel")}</Button>
              <Button variant="primary" onClick={props.onDiscardEditorWorkspace}>
                {t("editor.discardAndClose")}
              </Button>
            </>
          }
        />
      ) : null}

      {/* Per-file close confirm (sub-tab ✕ on a dirty file) — same dialog the
          in-editor ✕ shows, so both close paths ask identically. */}
      {props.editorFileClose ? (
        <Modal
          title={t("editor.closeDirtyTitle")}
          subtitle={t("editor.closeDirtyBody")}
          onClose={props.onDismissFileClose}
          actions={
            <>
              <Button onClick={props.onDismissFileClose}>{t("common.cancel")}</Button>
              <Button variant="primary" onClick={() => props.onConfirmCloseFile(props.editorFileClose!)}>
                {t("editor.discardAndClose")}
              </Button>
            </>
          }
        />
      ) : null}

      {props.trustAskOpen ? <WorkspaceTrustDialog busy={props.trustBusy} onSelect={props.onTrustSelect} /> : null}

      {props.branchConflict ? (
        <Modal
          title={t("scm.dirtySwitchTitle")}
          subtitle={t("scm.dirtySwitchBody", { branch: props.branchConflict })}
          onClose={props.onDismissBranchConflict}
          actions={
            <>
              <Button onClick={props.onDismissBranchConflict}>{t("common.cancel")}</Button>
              <Button variant="primary" disabled={props.stashSwitching} onClick={props.onStashAndSwitch}>
                {props.stashSwitching ? t("scm.stashSwitchBusy") : t("scm.stashAndSwitch")}
              </Button>
            </>
          }
        />
      ) : null}
    </>
  );
}
