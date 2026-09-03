import { useMemo, type JSX } from "react";
import type { SessionMessage } from "../../shared/ipc";
import type { ReasoningMode } from "../lib/appearance";
import { extractStoreReferences } from "../lib/store-refs";
import { Message } from "./Message";
import { FlowEventRow } from "./message/FlowEventRow";
import { ReferenceSegments } from "./message/ReferenceSegments";
import { SkillAttachmentCard } from "./message/UserMessage";
import { useI18n } from "../i18n";

/**
 * 会话回合（designs/chat-redesign demo-flow，一比一）：
 * 每条用户指令 = 右对齐用户卡（.ui-user-card，引用芯片行内渲染）；其后
 * 的 AI 名牌行、行为流时间线（.ui-flow 内的 .ui-ev 缩略行）、思考缩略、
 * 权限卡等始终完整展开 —— 折叠汇总条不是本设计的行为，完整内部内容
 * 只出现在右侧活动小窗。
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

/** 渲染一个回合的执行体：连续的 tool 消息合入同一个 .ui-flow 时间线
 *  （连接线由 .ui-ev::before 绘制），其余消息按类型独立渲染。 */
function renderBody(
  body: SessionMessage[],
  opts: {
    streaming: boolean;
    isLive: boolean;
    reasoningMode: ReasoningMode;
    expandedThinkingId?: string | null;
    lastVisibleId: string | null;
  }
): JSX.Element[] {
  const out: JSX.Element[] = [];
  let flow: SessionMessage[] = [];
  const flush = (): void => {
    if (flow.length === 0) return;
    out.push(
      <div className="ui-flow" key={`flow-${flow[0]!.id}`}>
        {flow.map((m) => (
          <FlowEventRow key={m.id} message={m} />
        ))}
      </div>
    );
    flow = [];
  };
  for (const m of body) {
    if (!m.visible) continue;
    if (m.role === "tool") {
      flow.push(m);
      continue;
    }
    flush();
    out.push(
      <Message
        key={m.id}
        message={m}
        reasoningMode={opts.reasoningMode}
        expandedThinkingId={opts.expandedThinkingId}
        streaming={opts.streaming && opts.isLive && m.id === opts.lastVisibleId}
      />
    );
  }
  flush();
  return out;
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
  const visible = useMemo(() => body.filter((m) => m.visible), [body]);
  const lastVisibleId = visible[visible.length - 1]?.id ?? null;

  const content = command.content?.trim() || t("msg.noContent");
  const refs = command.content ? extractStoreReferences(command.content) : { hasRefs: false, refs: [] };
  const skills = command.meta?.userPrompt?.skills ?? [];

  return (
    <div className="ui-turn">
      {/* 用户卡 —— 右对齐，accent 淡染，引用芯片行内渲染（demo .user-card） */}
      <div className="ui-user-row">
        <div className="ui-user-stack">
          {skills.length > 0 ? (
            <div className="ui-msg-skills">
              {skills.map((skill) => (
                <SkillAttachmentCard key={skill.name} skill={skill} />
              ))}
            </div>
          ) : null}
          <div className="ui-user-card">
            <div className="txt">
              {refs.hasRefs ? (
                <span style={{ whiteSpace: "pre-wrap" }}>
                  <ReferenceSegments text={command.content ?? ""} refs={refs.refs} />
                </span>
              ) : (
                <span style={{ whiteSpace: "pre-wrap" }}>{content}</span>
              )}
            </div>
            <div className="meta">{formatClock(command.createTime)}</div>
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        isLive ? (
          <div className="ui-task-waiting">
            <span className="ui-spinner" />
            <span>{t("msg.taskWaiting")}</span>
          </div>
        ) : null
      ) : (
        <div className="ui-task-body">
          {renderBody(body, { streaming, isLive, reasoningMode, expandedThinkingId, lastVisibleId })}
        </div>
      )}
    </div>
  );
}
