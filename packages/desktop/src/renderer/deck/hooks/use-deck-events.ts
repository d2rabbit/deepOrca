// Status-observation stream for the control center: a ring buffer of engine
// events (session entry transitions, process stdout lines, MCP status
// changes), newest last, capped so long sessions can't grow memory.
import { useEffect, useState } from "react";
import { api } from "../../api";
import type { DeckEvent } from "../types";

const MAX_EVENTS = 200;

export function useDeckEvents(): DeckEvent[] {
  const [events, setEvents] = useState<DeckEvent[]>([]);

  useEffect(() => {
    const push = (text: string) =>
      setEvents((prev) => {
        const next = [...prev, { ts: new Date().toISOString(), text }];
        return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
      });

    const offEntry = api.onSessionEntryUpdated((entry) => {
      push(`session ${entry.id.slice(0, 8)} → ${entry.status}`);
    });
    const offStdout = api.onProcessStdout((event) => {
      const line = event.chunk.trim().split("\n").pop() ?? "";
      if (line) push(`proc ${event.pid}: ${line.slice(0, 120)}`);
    });
    const offMcp = api.onMcpStatusChanged(() => {
      push("mcp status changed");
    });
    return () => {
      offEntry();
      offStdout();
      offMcp();
    };
  }, []);

  return events;
}
