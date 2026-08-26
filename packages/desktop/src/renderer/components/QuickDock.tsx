import type { JSX } from "react";
import { useI18n } from "../i18n";
import { cx } from "../ui/class-names";
import { IconChat, IconFolder, IconPlus } from "../ui/index";

type QuickDockProps = {
  /** Active session title (may be null on a fresh slate). */
  sessionTitle?: string | null;
  /** True while a prompt is in flight — dims the new-session affordance. */
  busy?: boolean;
  modKey: string;
  /** Open the hub pre-extended on the sessions view (fast switching). */
  onOpenSessions: () => void;
  onNewSession: () => void;
  onNewWorkspace: () => void;
};

/**
 * Stage quick dock — the always-visible top-left capsule holding the three
 * everyday moves that must never sit behind a navigation layer:
 *
 *   · chat bubble — sessions (opens the hub extended onto the session list)
 *   · plus — new session
 *   · folder — open workspace
 *
 * Hidden while the hub rail is up — the two live in the same corner and the
 * rail already covers browsing; the dock is the fast path when it's away.
 */
export function QuickDock({
  sessionTitle,
  busy = false,
  modKey,
  onOpenSessions,
  onNewSession,
  onNewWorkspace,
}: QuickDockProps): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ui-quickdock" role="toolbar" aria-label={t("quickdock.title")}>
      <button
        type="button"
        className="ui-quickdock-btn ui-quickdock-sessions"
        onClick={onOpenSessions}
        data-tip={t("rail.sessions")}
        aria-label={t("rail.sessions")}
      >
        <IconChat />
      </button>
      <span className="ui-quickdock-title">{sessionTitle ?? t("sidebar.untitled")}</span>
      <span className="ui-quickdock-sep" aria-hidden />
      <button
        type="button"
        className="ui-quickdock-btn"
        onClick={onNewSession}
        disabled={busy}
        data-tip={`${t("command.new.label")} (${modKey}N)`}
        aria-label={t("command.new.label")}
      >
        <IconPlus />
      </button>
      <button
        type="button"
        className={cx("ui-quickdock-btn", "ui-quickdock-workspace")}
        onClick={onNewWorkspace}
        disabled={busy}
        data-tip={t("sidebar.newWorkspace")}
        aria-label={t("sidebar.newWorkspace")}
      >
        <IconFolder />
      </button>
    </div>
  );
}
