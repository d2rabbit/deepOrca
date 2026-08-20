// Notification archive (E3, 通知抽屉 ⌘⇧N): engine events worth noticing are
// archived in a ring buffer so "missed ≠ lost" — session status transitions
// (permission asks, completions, failures) and MCP changes. In-memory only:
// the archive covers the current run, capped like every other deck stream.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { SerializableSessionEntry } from "../../../shared/ipc";
import type { SessionStatus } from "@deeporca/core";

export type DeckNotificationKind = "permission" | "status" | "mcp";

export type DeckNotification = {
  id: number;
  ts: string;
  kind: DeckNotificationKind;
  text: string;
};

const MAX_NOTIFICATIONS = 200;

/** Statuses that deserve a drawer entry (busy-churn states are skipped). */
const NOTIFY_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "ask_permission",
  "permission_denied",
  "completed",
  "failed",
  "interrupted",
  "paused",
]);

export type DeckNotifications = {
  items: DeckNotification[];
  unread: number;
  markAllRead(): void;
  clear(): void;
};

export function useDeckNotifications(): DeckNotifications {
  const [items, setItems] = useState<DeckNotification[]>([]);
  const [readUpTo, setReadUpTo] = useState(0);
  const nextId = useRef(1);

  const push = useCallback((kind: DeckNotificationKind, text: string) => {
    setItems((prev) => {
      const next = [...prev, { id: nextId.current++, ts: new Date().toISOString(), kind, text }];
      return next.length > MAX_NOTIFICATIONS ? next.slice(next.length - MAX_NOTIFICATIONS) : next;
    });
  }, []);

  useEffect(() => {
    const offEntry = api.onSessionEntryUpdated((entry: SerializableSessionEntry) => {
      if (!NOTIFY_STATUSES.has(entry.status)) return;
      const kind = entry.status === "ask_permission" ? "permission" : "status";
      push(kind, `session ${entry.id.slice(0, 8)} → ${entry.status}`);
    });
    const offMcp = api.onMcpStatusChanged(() => push("mcp", "mcp status changed"));
    return () => {
      offEntry();
      offMcp();
    };
  }, [push]);

  const lastId = items.length > 0 ? items[items.length - 1].id : 0;
  const unread = items.filter((n) => n.id > readUpTo).length;

  // Stable identities: deck-app's openLayer/keyboard wiring depends on them.
  const markAllRead = useCallback(() => setReadUpTo(lastId), [lastId]);
  const clear = useCallback(() => {
    setItems([]);
    setReadUpTo(0);
  }, []);

  return {
    items,
    unread,
    markAllRead,
    clear,
  };
}
