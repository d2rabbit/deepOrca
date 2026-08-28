import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { SessionMessage } from "../../shared/ipc";
import type { ReasoningMode } from "../lib/appearance";
import { Message } from "./Message";
import { useI18n } from "../i18n";

/**
 * Task-style conversation rendering (real-machine redesign 2026-08-28):
 * each user submission is a COMMAND; everything the agent does in response
 * (thinking / text / tool calls) streams full-width directly beneath it as
 * one execution block. When the turn finishes, the block auto-collapses to
 * a one-line result report (status · duration · tool count · outcome
 * snippet) — expandable, never gone. The left/right arrangement is kept:
 * commands sit right, the execution body owns the full column.
 */

export type Turn = { command: SessionMessage; body: SessionMessage[] };

/** Group the flat message list into (command, execution body) turns. A user
 *  message opens a turn; every following non-user message joins it. Messages
 *  before the first command (session preambles) render standalone. */
export function groupTurns(messages: SessionMessage[]): { leading: SessionMessage[]; turns: Turn[] } {
  const leading: SessionMessage[] = [];
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role === "user") turns.push({ command: message, body: [] });
    else if (turns.length === 0) leading.push(message);
    else turns[turns.length - 1]!.body.push(message);
  }
  return { leading, turns };
}

function formatClock(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatDuration(from?: string, to?: string): string | undefined {
  if (!from || !to) return undefined;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  if (ms >= 60_000) return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export function TaskTurn({
  command,
  body,
  isLive,
  streaming,
  reasoningMode,
  expandedThinkingId,
}: {
  command: SessionMessage;
  body: SessionMessage[];
  /** True while this turn is the one currently executing. */
  isLive: boolean;
  streaming: boolean;
  reasoningMode: ReasoningMode;
  expandedThinkingId?: string | null;
}): JSX.Element {
  const { t } = useI18n();
  // Live turns render expanded; completed turns collapse into the result
  // report. The live→false TRANSITION auto-collapses exactly once — a manual
  // re-expand afterwards is never fought by the effect.
  const [collapsed, setCollapsed] = useState(!isLive && body.length > 0);
  const prevLive = useRef(isLive);
  useEffect(() => {
    if (prevLive.current && !isLive && body.length > 0) setCollapsed(true);
    prevLive.current = isLive;
  }, [isLive, body.length]);

  const visible = useMemo(() => body.filter((m) => m.visible), [body]);
  const first = visible[0];
  const last = visible[visible.length - 1];
  const duration = formatDuration(first?.createTime, last?.updateTime ?? last?.createTime);
  const toolCount = visible.filter((m) => m.role === "tool").length;
  // Outcome snippet: the last plain assistant text (thinking/tool noise skipped).
  const snippet = useMemo(() => {
    for (let i = visible.length - 1; i >= 0; i--) {
      const m = visible[i]!;
      if (m.role === "assistant" && !m.meta?.asThinking && (m.content ?? "").trim()) {
        return (m.content ?? "")
          .replace(/[#*`>[\]()]/g, "")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
    return "";
  }, [visible]);
  const lastVisibleId = last?.id ?? null;

  const hasBody = body.length > 0;
  const showBody = !hasBody ? isLive : !collapsed;

  return (
    <div className="ui-task-turn">
      {/* The command — right-aligned directive (left/right arrangement kept). */}
      <div className="ui-task-cmd-row">
        <div className="ui-task-cmd">
          <span className="ui-task-cmd-icon" aria-hidden="true">
            ▸
          </span>
          <span className="ui-task-cmd-text">{command.content?.trim() || t("msg.noContent")}</span>
          <span className="ui-task-cmd-time">{formatClock(command.createTime)}</span>
        </div>
      </div>

      {!hasBody ? (
        isLive ? (
          <div className="ui-task-waiting">
            <span className="ui-spinner" />
            <span>{t("msg.taskWaiting")}</span>
          </div>
        ) : null
      ) : showBody ? (
        <div className="ui-task-body">
          {body.map((message) => (
            <Message
              key={message.id}
              message={message}
              reasoningMode={reasoningMode}
              expandedThinkingId={expandedThinkingId}
              streaming={streaming && isLive && message.id === lastVisibleId}
            />
          ))}
          {!isLive ? (
            <button type="button" className="ui-task-collapse" onClick={() => setCollapsed(true)}>
              {t("common.hide")}
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="ui-task-report"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          title={t("common.show")}
        >
          <span className="ui-task-report-status" aria-hidden="true">
            ✓
          </span>
          {duration ? <span className="ui-task-report-duration">{duration}</span> : null}
          {toolCount > 0 ? <span className="ui-task-report-tools">{t("msg.taskTools", { n: toolCount })}</span> : null}
          <span className="ui-task-report-snippet">{snippet || t("msg.taskDone")}</span>
          <span className="ui-task-report-chevron" aria-hidden="true">
            ▸
          </span>
        </button>
      )}
    </div>
  );
}
