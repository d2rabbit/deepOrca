// Status-observation stream for the control center: a ring buffer of engine
// events (session entry transitions, tool activity from the message stream,
// process stdout lines, MCP status changes), newest last, capped so long
// sessions can't grow memory.
import { useEffect, useState } from "react";
import { api } from "../../api";
import { buildToolSummary, formatToolParams } from "../../lib/messages";
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
    // E14: tool activity from the message stream — the 状态观测 stream finally
    // shows what the engine is actually doing (edit permissions.ts ✓ …).
    const offMessage = api.onAssistantMessage((message) => {
      if (message.role !== "tool") return;
      try {
        const summary = buildToolSummary(message);
        const params = formatToolParams(summary);
        push(`${summary.ok ? "✓" : "✗"} ${summary.name}${params ? ` ${params.slice(0, 60)}` : ""}`);
      } catch {
        // Unparseable tool payloads stay out of the stream.
      }
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
      offMessage();
      offStdout();
      offMcp();
    };
  }, []);

  return events;
}
