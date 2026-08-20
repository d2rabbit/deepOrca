// Notification drawer (⌘⇧N): the archived feed from useDeckNotifications —
// permission asks, status transitions, MCP changes. Newest first; opening the
// drawer marks everything read (the dock badge drops).
import type { JSX } from "react";
import { useI18n } from "../../i18n";
import { GiIcon, type DeckIconId } from "../icons";
import type { DeckNotifications, DeckNotificationKind } from "../hooks/use-deck-notifications";

const KIND_ICON: Record<DeckNotificationKind, DeckIconId> = {
  permission: "shield",
  status: "activity",
  mcp: "zap",
};

export function NotificationsPanel(props: { notifications: DeckNotifications }): JSX.Element {
  const { t } = useI18n();
  const items = [...props.notifications.items].reverse();

  return (
    <div className="deck-panel">
      {items.length === 0 ? (
        <div className="deck-empty">{t("deck.notif.empty")}</div>
      ) : (
        <>
          <div className="deck-panel-ops">
            <button type="button" className="deck-op" onClick={props.notifications.clear}>
              {t("deck.notif.clear")}
            </button>
          </div>
          {items.map((item) => (
            <div key={item.id} className="deck-row static">
              <GiIcon id={KIND_ICON[item.kind]} />
              <span className="deck-row-main">{item.text}</span>
              <span className="deck-row-meta">{item.ts.slice(11, 19)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
