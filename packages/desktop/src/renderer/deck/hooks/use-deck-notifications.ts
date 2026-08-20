// Notification archive (E3, 通知抽屉 ⌘⇧N): engine events worth noticing are
// archived in a ring buffer so "missed ≠ lost" — session status transitions
// (permission asks, completions, failures) and MCP changes. In-memory only:
// the archive covers the current run, capped like every other deck stream.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { SerializableSessionEntry } from "../../../shared/ipc";
import type { SessionStatus } from "@deeporca/core";

export type DeckNotificationKind = "permission" | "status" | "mcp";

/** Visual level for the toast twin (E5.3): how urgent the event reads. */
export type DeckNotificationLevel = "info" | "ok" | "warn" | "bad";

export type DeckNotification = {
  id: number;
  ts: string;
  kind: DeckNotificationKind;
  level: DeckNotificationLevel;
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

function levelForStatus(status: SessionStatus): DeckNotificationLevel {
  if (status === "failed" || status === "permission_denied") return "bad";
  if (status === "completed") return "ok";
  return "warn";
}

export type DeckNotifications = {
  items: DeckNotification[];
  unread: number;
  markAllRead(): void;
  clear(): void;
};

export function useDeckNotifications(onPush?: (notification: DeckNotification) => void): DeckNotifications {
  const [items, setItems] = useState<DeckNotification[]>([]);
  const [readUpTo, setReadUpTo] = useState(0);
  const nextId = useRef(1);
  const onPushRef = useRef(onPush);
  onPushRef.current = onPush;

  const push = useCallback((kind: DeckNotificationKind, level: DeckNotificationLevel, text: string) => {
    const notification: DeckNotification = {
      id: nextId.current++,
      ts: new Date().toISOString(),
      kind,
      level,
      text,
    };
    setItems((prev) => {
      const next = [...prev, notification];
      return next.length > MAX_NOTIFICATIONS ? next.slice(next.length - MAX_NOTIFICATIONS) : next;
    });
    onPushRef.current?.(notification);
  }, []);

  useEffect(() => {
    const offEntry = api.onSessionEntryUpdated((entry: SerializableSessionEntry) => {
      if (!NOTIFY_STATUSES.has(entry.status)) return;
      const kind = entry.status === "ask_permission" ? "permission" : "status";
      push(kind, levelForStatus(entry.status), `session ${entry.id.slice(0, 8)} → ${entry.status}`);
    });
    const offMcp = api.onMcpStatusChanged(() => push("mcp", "info", "mcp status changed"));
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
