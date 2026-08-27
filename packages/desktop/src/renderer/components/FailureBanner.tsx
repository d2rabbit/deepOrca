/**
 * FailureBanner (closure gap #7, extracted from App.tsx for the 2500-line
 * limit): a failed LLM call previously surfaced only as an assistant
 * "request failed" bubble — no retry, no path to settings for a bad key.
 * Driven by the live session status so restarts are covered too (failReason
 * persists). Retry re-sends the last user message; settings jumps to the
 * endpoints tab; dismissal resets on session switch or a new failure.
 */

import { useEffect, useMemo, useState, useCallback, type JSX } from "react";
import { useI18n } from "../i18n";
import { IconClose } from "../ui/index";
import type { SessionMessage } from "../../shared/ipc";

type Props = {
  /** Live messages of the active session (read-only; scanned for retry text). */
  messages: SessionMessage[];
  /** True while a prompt run is in flight — hides the banner. */
  busy: boolean;
  /** Whether the active session entry is in the failed state. */
  sessionFailed: boolean;
  /** Re-send path from App (showUser:false — the message is already on stage). */
  onRetry: (text: string) => void;
  /** Jump to the settings surface (endpoint/API key diagnosis). */
  onOpenSettings: () => void;
};

export function FailureBanner({ messages, busy, sessionFailed, onRetry, onOpenSettings }: Props): JSX.Element | null {
  const { t } = useI18n();
  const lastUserPromptText = useMemo(() => {
    if (!sessionFailed) return null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role === "user" && typeof m.content === "string" && m.content.trim()) return m.content.trim();
    }
    return null;
  }, [messages, sessionFailed]);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    // Any transition out of the failed state (new run, session switch) clears
    // the dismissal so the NEXT failure can show again.
    if (!sessionFailed) setDismissed(false);
  }, [sessionFailed]);
  const retry = useCallback(() => {
    if (!lastUserPromptText) return;
    setDismissed(true);
    onRetry(lastUserPromptText);
  }, [lastUserPromptText, onRetry]);

  if (busy || !sessionFailed || dismissed) return null;
  return (
    <div className="ui-fault-banner" role="alert">
      <span className="ui-fault-banner-text">{t("session.failed.title")}</span>
      {lastUserPromptText ? (
        <button type="button" className="ui-fault-banner-action" onClick={retry}>
          {t("session.failed.retry")}
        </button>
      ) : null}
      <button type="button" className="ui-fault-banner-action" onClick={onOpenSettings}>
        {t("session.failed.settings")}
      </button>
      <button
        type="button"
        className="ui-fault-banner-dismiss"
        aria-label={t("common.hide")}
        onClick={() => setDismissed(true)}
      >
        <IconClose />
      </button>
    </div>
  );
}
