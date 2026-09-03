/**
 * Message — 主会话消息分发壳（落地实施方案 §八：六文件拆分后的组合根）。
 * 各消息类型的渲染见 ./message/ 下的职责文件。
 */
import { memo, Suspense, lazy, type JSX } from "react";
import type { SessionMessage } from "../../shared/ipc";
import { useI18n } from "../i18n";
import { buildToolSummary } from "../lib/messages";
import type { ReasoningMode } from "../lib/appearance";
import { Avatar, formatElapsed } from "./message/shared";
import { UserMessage } from "./message/UserMessage";
import { ThinkingBlock } from "./message/ThinkingRow";
import { AssistantMessage } from "./message/AssistantMessage";
import { FlowEventRow } from "./message/FlowEventRow";
import { SystemNote, SkillLoadedCard } from "./message/SystemNote";
import { extractA2uiPayload, extractA2uiSummary } from "./message/a2ui";

// Lazy-load A2UI Surface renderer — only needed when agent produces A2UI output.
const A2uiMessage = lazy(() => import("../a2ui/A2uiMessage").then((m) => ({ default: m.A2uiMessage })));
// Lazy-load comparison matrix — only needed when agent uses <comparison> tags.
// ComparisonMatrix 懒加载声明移至 message/AssistantMessage.tsx（唯一使用处）。

export const Message = memo(function Message({
  message,
  reasoningMode = "normal",
  expandedThinkingId,
  streaming = false,
}: {
  message: SessionMessage;
  reasoningMode?: ReasoningMode;
  expandedThinkingId?: string | null;
  /** True on the last message while the session is busy — shows the caret. */
  streaming?: boolean;
}): JSX.Element | null {
  const { t } = useI18n();
  if (!message.visible) return null;

  if (message.role === "user") {
    return <UserMessage message={message} />;
  }

  if (message.role === "assistant") {
    if (message.meta?.asThinking) {
      return (
        <ThinkingBlock
          content={(message.content || "").trim()}
          messageParams={message.messageParams}
          reasoningMode={reasoningMode}
          isLatest={message.id === expandedThinkingId}
          elapsed={
            message.createTime && message.updateTime && message.createTime !== message.updateTime
              ? formatElapsed(message.createTime, message.updateTime)
              : undefined
          }
          streaming={streaming}
        />
      );
    }
    return <AssistantMessage message={message} streaming={streaming} />;
  }

  if (message.role === "tool") {
    // A2UI tool results — render as interactive Surface instead of a flow row.
    const toolName = buildToolSummary(message).name.toLowerCase();
    if (toolName.includes("a2ui") || toolName.includes("render_surface") || toolName.includes("update_surface")) {
      const a2uiJson = extractA2uiPayload(message);
      if (a2uiJson) {
        const summary = extractA2uiSummary(message);
        return (
          <div className="ui-bubble-row tool">
            <Avatar role="mcp" />
            <Suspense fallback={<div className="ui-tool-card">{t("msg.loadingSurface")}</div>}>
              <A2uiMessage a2uiJson={a2uiJson} summary={summary} />
            </Suspense>
          </div>
        );
      }
    }

    // demo-flow: EVERY tool call is a one-line flow row — the full internal
    // content lives only in the activity-rail pip window (same message).
    return <FlowEventRow message={message} />;
  }

  if (message.role === "system") {
    if (message.meta?.isModelChange) {
      return <SystemNote>{message.content || ""}</SystemNote>;
    }
    if (message.meta?.skill) {
      return <SkillLoadedCard skill={message.meta.skill} />;
    }
    if (message.meta?.isSummary) {
      return <SystemNote>› {t("msg.summaryInserted")}</SystemNote>;
    }
    return null;
  }

  return null;
});
