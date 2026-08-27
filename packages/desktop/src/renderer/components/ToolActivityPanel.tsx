/**
 * ToolActivityPanel — right-side floating A2UI trace of agent tool activity
 * (real-machine ask 2026-08-27): every bash/read/write/edit/skill/MCP call
 * streams into ONE glass mini-window rendered by the same official v0.9
 * renderer as the build console, so "what is the agent doing right now" is
 * glanceable without scrolling the transcript.
 *
 * The surface is renderer-local (surfaceId "tool-activity"): never enters the
 * main-process server map, never collides with arch maps or design surfaces,
 * never persisted. The window shows the newest MAX_EVENTS calls, oldest first
 * like a log; a run without tool calls never mounts it.
 */

import { useMemo, type JSX } from "react";
import { A2uiSurface } from "../a2ui/A2uiSurface";
import type { SessionMessage } from "../../shared/ipc";
import { buildToolSummary } from "../lib/messages";
import { BASIC_CATALOG_ID } from "../../shared/a2ui-legacy";
import { useI18n } from "../i18n";

const SURFACE_ID = "tool-activity";
/** Cap the A2UI tree so a chatty run cannot balloon the re-render cost. */
const MAX_EVENTS = 12;
const HINT_MAX = 72;

type ToolEvent = {
  name: string;
  hint: string;
  ok: boolean;
};

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

type ToolActivity = {
  /** Oldest→newest slice of the most recent calls (capped at MAX_EVENTS). */
  readonly events: ToolEvent[];
  /** Total tool calls in the transcript — the header count, not the slice length. */
  readonly total: number;
};

/** Ordered (oldest→newest) tool-call slice plus the uncapped total. */
export function collectToolEvents(messages: SessionMessage[]): ToolActivity {
  const events: ToolEvent[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (!message || message.role !== "tool") continue;
    const summary = buildToolSummary(message);
    if (!summary.name) continue;
    events.push({
      name: summary.name,
      hint: truncate((summary.params.split(/\r?\n/)[0] ?? "").trim(), HINT_MAX),
      ok: summary.ok,
    });
  }
  return { events: events.slice(-MAX_EVENTS), total: events.length };
}

/** Build the official v0.9 batch: Column(root) → header + one Row per event. */
function buildMessages(
  events: ToolEvent[],
  totalCount: number,
  labels: { title: string; empty: string },
  format: (n: number) => string
): string {
  const components: Array<{ id: string; component: string; children?: string[] } & Record<string, unknown>> = [];
  const add = (id: string, component: string, props: Record<string, unknown> = {}, children?: string[]): void => {
    components.push({ id, component, ...props, ...(children ? { children } : {}) });
  };

  add("root", "Column", {}, ["title", "sep", ...(events.length > 0 ? events.map((_, i) => `row-${i}`) : ["empty"])]);
  add("title", "Text", { text: format(totalCount), variant: "h5" });
  add("sep", "Divider");
  if (events.length === 0) {
    add("empty", "Text", { text: labels.empty, variant: "caption" });
  }
  events.forEach((event, idx) => {
    add(`row-${idx}`, "Row", {}, [`mark-${idx}`, `label-${idx}`]);
    add(`mark-${idx}`, "Text", { text: event.ok ? "✓" : "✗", variant: "h5" });
    add(`label-${idx}`, "Text", {
      text: truncate(`${event.name}  ${event.hint}`.trim(), HINT_MAX),
      variant: "caption",
    });
  });

  return JSON.stringify([
    { version: "v0.9", createSurface: { surfaceId: SURFACE_ID, catalogId: BASIC_CATALOG_ID } },
    { version: "v0.9", updateComponents: { surfaceId: SURFACE_ID, components } },
  ]);
}

type Props = {
  /** Transcript for the ACTIVE session/streaming buffer. */
  messages: SessionMessage[];
  onClose: () => void;
};

export function ToolActivityPanel({ messages, onClose }: Props): JSX.Element {
  const { t } = useI18n();
  const { events, total } = useMemo(() => collectToolEvents(messages), [messages]);

  const messagesJson = useMemo(
    () =>
      buildMessages(
        events,
        total,
        { title: t("activity.title"), empty: t("activity.none") },
        (count) => `${t("activity.title")} · ${count}`
      ),
    [events, t, total]
  );

  return (
    <div className="ui-tool-activity">
      <div className="ui-tool-activity-head">
        <span className="ui-tool-activity-dot" aria-hidden />
        <span className="ui-tool-activity-title">{t("activity.title")}</span>
        <button type="button" className="ui-tool-activity-close" onClick={onClose} aria-label={t("common.close")}>
          ✕
        </button>
      </div>
      <div className="ui-tool-activity-body">
        <A2uiSurface messagesJson={messagesJson} surfaceId={SURFACE_ID} />
      </div>
    </div>
  );
}
