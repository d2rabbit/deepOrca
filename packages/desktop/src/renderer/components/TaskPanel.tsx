import { useMemo, type JSX } from "react";
import type { SessionMessage } from "../../shared/ipc";
import { useI18n } from "../i18n";
import { buildToolSummary, getPlanLines } from "../lib/messages";
import { StreamdownView } from "./StreamdownView";

type Props = {
  messages: SessionMessage[];
};

/** Extract the markdown plan from the newest UpdatePlan tool message, if any. */
function findLatestPlan(messages: SessionMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "tool") {
      continue;
    }
    const summary = buildToolSummary(message);
    const lines = getPlanLines(summary);
    if (lines.length > 0) {
      return lines.join("\n");
    }
  }
  return null;
}

/** Parse checkbox stats from markdown plan text. */
function parseCheckboxProgress(plan: string): { done: number; total: number } {
  const lines = plan.split("\n");
  let done = 0;
  let total = 0;
  for (const line of lines) {
    if (/^\s*[-*]\s+\[x\]/i.test(line)) {
      done += 1;
      total += 1;
    } else if (/^\s*[-*]\s+\[\s?\]/.test(line)) {
      total += 1;
    }
  }
  return { done, total };
}

/** Left-panel Task view: renders the current session's latest plan checklist. */
export function TaskPanel({ messages }: Props): JSX.Element {
  const { t } = useI18n();
  const plan = useMemo(() => findLatestPlan(messages), [messages]);
  const progress = useMemo(() => (plan ? parseCheckboxProgress(plan) : null), [plan]);

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("task.title")}</span>
        {progress && progress.total > 0 ? (
          <span className="ui-task-progress-badge">
            {progress.done}/{progress.total}
          </span>
        ) : null}
      </div>
      {progress && progress.total > 0 ? (
        <div className="ui-task-progress-bar">
          <div
            className="ui-task-progress-fill"
            style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
          />
        </div>
      ) : null}
      <div className="ui-side-panel-body">
        {plan ? (
          <StreamdownView className="ui-task-plan ui-md" markdown={plan} />
        ) : (
          <div className="ui-side-panel-empty">{t("task.empty")}</div>
        )}
      </div>
    </div>
  );
}
