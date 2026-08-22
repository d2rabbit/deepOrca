// The Deck engine hook: one place owning the active session, its entry
// (status / askPermissions / usage), the message stream, and every action the
// Deck UI can take (send / interrupt / approve / deny / switch session).
//
// Mirrors the classic App.tsx prompt lifecycle (sendPrompt → re-fetch
// entry+messages; streaming via onAssistantMessage; entry updates via
// onSessionEntryUpdated) but stripped of preview/skills/design concerns —
// E1's goal is the core loop only.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { SessionStatus } from "@deeporca/core";
import type { AskPermissionRequest, SerializableSessionEntry, SessionMessage, SkillInfo } from "../../../shared/ipc";
import type { PermissionResult } from "../../lib/permissions";

/** Extras carried by a Deck-originated prompt (E13/E14 deep integration). */
export type DeckSendOptions = {
  planMode?: boolean;
  /** Force-loaded skills picked in the directive input (real SkillInfo objects). */
  skills?: SkillInfo[];
};

export type DeckEngine = {
  activeId: string | null;
  entry: SerializableSessionEntry | null;
  status: SessionStatus | null;
  /** True while the engine loop is running (send button → interrupt). */
  busy: boolean;
  askPermissions: AskPermissionRequest[] | undefined;
  messages: SessionMessage[];
  sessions: SerializableSessionEntry[];
  /** Every prompt the user sent from the Deck (指令留痕, newest last). */
  commandLog: Array<{ ts: string; text: string }>;
  selectSession(id: string | null): Promise<void>;
  /** Send a prompt; opts.planMode flips plan mode, opts.skills force-loads skills. */
  send(text: string, opts?: DeckSendOptions): Promise<void>;
  interrupt(): Promise<void>;
  /**
   * Brake (E5.2): freeze at the next loop checkpoint while running, resume a
   * paused/interrupted session — the scene is preserved, unlike interrupt.
   */
  brake(): Promise<void>;
  /** Approve the pending ask: resume with /continue + the decision payload. */
  approve(result: PermissionResult): Promise<void>;
  /** Deny the pending ask. */
  deny(reason?: string): Promise<void>;
};

function syntheticUserMessage(sessionId: string, content: string): SessionMessage {
  const now = new Date().toISOString();
  return {
    id: `synthetic-${Date.now()}`,
    sessionId,
    role: "user",
    content,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: now,
    updateTime: now,
  };
}

export function useDeckEngine(): DeckEngine {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [entry, setEntry] = useState<SerializableSessionEntry | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [sessions, setSessions] = useState<SerializableSessionEntry[]>([]);
  const [commandLog, setCommandLog] = useState<Array<{ ts: string; text: string }>>([]);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await api.listSessions());
    } catch {
      // Session list is best-effort.
    }
  }, []);

  const loadSession = useCallback(async (id: string) => {
    const [msgs, sessionEntry] = await Promise.all([api.listMessages(id), api.getSession(id)]);
    setMessages(msgs);
    setEntry(sessionEntry);
  }, []);

  // Boot: adopt the currently active session, then subscribe to the engine.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const id = await api.getActiveSession();
        if (!cancelled && id) {
          activeIdRef.current = id;
          setActiveId(id);
          await loadSession(id);
        }
        if (!cancelled) await refreshSessions();
      } catch {
        // Boot is best-effort; the stage renders its empty state.
      }
    })();

    const offMessage = api.onAssistantMessage((message) => {
      if (activeIdRef.current === null) {
        // A brand-new session created by the in-flight prompt — adopt it.
        activeIdRef.current = message.sessionId;
        setActiveId(message.sessionId);
      }
      if (message.sessionId === activeIdRef.current) {
        setMessages((prev) => [...prev, message]);
      }
    });
    const offEntry = api.onSessionEntryUpdated((updated) => {
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === updated.id);
        if (idx === -1) return [updated, ...prev];
        const next = [...prev];
        next[idx] = updated;
        return next;
      });
      if (updated.id === activeIdRef.current) {
        setEntry(updated);
      }
    });
    return () => {
      cancelled = true;
      offMessage();
      offEntry();
    };
  }, [loadSession, refreshSessions]);

  const selectSession = useCallback(
    async (id: string | null) => {
      activeIdRef.current = id;
      setActiveId(id);
      setEntry(null);
      setMessages([]);
      try {
        await api.setActiveSession(id);
        if (id) await loadSession(id);
      } catch {
        // Selection is best-effort.
      }
    },
    [loadSession]
  );

  const send = useCallback(
    async (text: string, opts?: DeckSendOptions) => {
      const trimmed = text.trim();
      if (!trimmed && !(opts?.skills && opts.skills.length > 0)) return;
      setCommandLog((prev) => [...prev, { ts: new Date().toISOString(), text: trimmed }]);
      const sessionId = activeIdRef.current ?? "";
      setMessages((prev) => [...prev, syntheticUserMessage(sessionId, trimmed)]);
      try {
        const result = await api.sendPrompt({
          text: trimmed,
          ...(opts?.planMode !== undefined ? { planMode: opts.planMode } : {}),
          ...(opts?.skills && opts.skills.length > 0 ? { skills: opts.skills } : {}),
        });
        if (!result.ok) return;
        const finalId = await api.getActiveSession();
        if (finalId) {
          activeIdRef.current = finalId;
          setActiveId(finalId);
          await loadSession(finalId);
        }
        await refreshSessions();
      } catch {
        // Send failures surface via the session entry status.
      }
    },
    [loadSession, refreshSessions]
  );

  const interrupt = useCallback(async () => {
    try {
      await api.interrupt();
    } catch {
      // Best-effort.
    }
  }, []);

  const approve = useCallback(
    async (result: PermissionResult) => {
      try {
        await api.sendPrompt({
          text: "/continue",
          permissions: result.permissions,
          alwaysAllows: result.alwaysAllows,
          alwaysAllowPaths: result.alwaysAllowPaths,
        });
        const finalId = await api.getActiveSession();
        if (finalId) await loadSession(finalId);
      } catch {
        // Best-effort.
      }
    },
    [loadSession]
  );

  const deny = useCallback(async (reason?: string) => {
    try {
      await api.denyPermission(reason);
    } catch {
      // Best-effort.
    }
  }, []);

  const status = entry?.status ?? null;
  const busy = status === "processing" || status === "pending";

  const brake = useCallback(async () => {
    try {
      if (status === "paused" || status === "interrupted") {
        const id = activeIdRef.current;
        if (id) await api.resumePrompt(id);
      } else if (busy) {
        await api.pausePrompt();
      }
    } catch {
      // Best-effort — entry status transitions surface the outcome.
    }
  }, [status, busy]);

  return {
    activeId,
    entry,
    status,
    busy,
    askPermissions: entry?.askPermissions,
    messages,
    sessions,
    commandLog,
    selectSession,
    send,
    interrupt,
    brake,
    approve,
    deny,
  };
}
