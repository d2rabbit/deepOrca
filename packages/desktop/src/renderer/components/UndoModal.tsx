import { useEffect, useState, type JSX } from "react";
import type { UndoTarget } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, Modal } from "../ui/index";

type Props = {
  sessionId: string | null;
  onClose: () => void;
  /** Called after a successful restore so the parent can reload messages. */
  onRestored: () => void;
};

function preview(target: UndoTarget): string {
  const raw = (target.message.content ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "(empty)";
  return raw.length > 96 ? `${raw.slice(0, 96)}…` : raw;
}

export function UndoModal({ sessionId, onClose, onRestored }: Props): JSX.Element {
  const { t } = useI18n();
  const [targets, setTargets] = useState<UndoTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      if (!sessionId) {
        setLoading(false);
        return;
      }
      try {
        const list = await api.listUndoTargets(sessionId);
        if (!disposed) setTargets(list);
      } catch (err) {
        // A failed load must not masquerade as "no checkpoints" — surface it.
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [sessionId]);

  const restore = async (target: UndoTarget, mode: "conversation" | "code-and-conversation"): Promise<void> => {
    if (!sessionId) return;
    setBusyId(target.message.id);
    setError(null);
    try {
      const result = await api.restoreUndo(sessionId, target.message.id, mode);
      if (result.ok) {
        onRestored();
        onClose();
      } else {
        setError(result.error ?? t("undo.failed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={t("undo.title")}
      subtitle={t("undo.subtitle")}
      actions={
        <Button size="sm" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      {error ? <div className="ui-undo-error">{error}</div> : null}
      <div className="ui-undo-list">
        {!sessionId ? (
          <div className="ui-undo-empty">{t("undo.needSession")}</div>
        ) : loading ? (
          <div className="ui-undo-empty">…</div>
        ) : targets.length === 0 ? (
          <div className="ui-undo-empty">{t("undo.none")}</div>
        ) : (
          targets.map((target) => (
            <div className="ui-undo-item" key={target.message.id}>
              <div className="ui-undo-preview">
                <span className="ui-undo-index">#{target.index + 1}</span> {preview(target)}
              </div>
              {target.canRestoreCode ? <div className="ui-undo-label">{t("undo.codeAvailable")}</div> : null}
              <div className="ui-undo-mode">
                <Button size="sm" disabled={busyId !== null} onClick={() => void restore(target, "conversation")}>
                  {t("undo.restoreConversation")}
                </Button>
                {target.canRestoreCode ? (
                  <Button
                    size="sm"
                    disabled={busyId !== null}
                    onClick={() => void restore(target, "code-and-conversation")}
                  >
                    {t("undo.restoreBoth")}
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
