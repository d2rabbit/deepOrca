import type { JSX } from "react";
import { useI18n } from "../i18n";
import type { WorkspaceTrustLevel } from "../../shared/ipc";

/**
 * First-open trust question (specs/sandbox/design.md §10.3). One explicit
 * choice, persisted to the project settings — the quarantined repo gets no
 * path to approve its way out of the boundary afterwards.
 */
export function WorkspaceTrustDialog({
  onSelect,
  busy,
}: {
  onSelect: (level: WorkspaceTrustLevel) => void;
  busy: boolean;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ui-modal-overlay">
      <div className="ui-trust-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="ui-trust-title">{t("trust.title")}</div>
        <p className="ui-trust-body">{t("trust.body")}</p>
        <div className="ui-trust-actions">
          <button className="ui-trust-btn ui-trust-btn--trusted" disabled={busy} onClick={() => onSelect("trusted")}>
            {t("trust.trusted")}
          </button>
          <button
            className="ui-trust-btn ui-trust-btn--quarantine"
            disabled={busy}
            onClick={() => onSelect("quarantine")}
          >
            {t("trust.quarantine")}
          </button>
        </div>
      </div>
    </div>
  );
}
