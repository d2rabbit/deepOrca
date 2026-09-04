import { useMemo, useState, type JSX } from "react";
import type { SessionMessage } from "../../shared/ipc";
import type { ReasoningMode } from "../lib/appearance";
import { Message } from "./Message";
import { FlowEventRow } from "./message/FlowEventRow";
import { UserDirective } from "./message/UserMessage";
import { useI18n } from "../i18n";

/**
 * 会话回合（designs/chat-redesign demo-flow）：
 * 每条用户指令 = 整幅左起的指令条（.ui-directive，弱化聊天感，
 * user ask 2026-09-03 七轮）；其后的 AI 名牌行、行为流时间线（.ui-flow
 * 内的 .ui-ev 缩略行）、思考缩略、权限卡等始终完整展开 —— 折叠汇总条
 * 不是本设计的行为；行为行与思考行均可点开查看完整内容（传统方式），
 * 运行中的实时投影在右侧活动小窗。
 * 回合完成后的底部有 fork 操作行（user ask 2026-09-03 十一轮：fork 入口
 * 下沉到每个指令执行完的地方，不再只藏在任务树弹层里）。
 */

export type TurnForkMode = "worktree" | "branch";

/** 回合底部的操作行（user ask 2026-09-03 十二轮：收缩到纯图标）：
 *  ⑂ 一枚 fork 图标（点开紧凑表单 why + 双模式）+ ⧉ 复制本回合全部
 *  LLM 输出。提交走 App 的 onFork（绑树的会话直接 fork 该树；未绑树的
 *  先以本回合指令为根落地一棵树再 fork）。 */
function TurnForkBar({
  commandText,
  llmText,
  onFork,
}: {
  commandText: string;
  /** 本回合全部 assistant 正文（思考除外），供复制。 */
  llmText: string;
  onFork: (commandText: string, why: string, mode: TurnForkMode) => Promise<string | null>;
}): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const [mode, setMode] = useState<TurnForkMode>("worktree");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copyTurn = (): void => {
    if (!llmText) return;
    void navigator.clipboard
      .writeText(llmText)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  if (!open) {
    return (
      <div className="ui-turn-actions">
        <button
          type="button"
          className="ui-turn-action-btn icon"
          onClick={() => setOpen(true)}
          title={t("taskhub.fork")}
          aria-label={t("taskhub.fork")}
        >
          ⑂
        </button>
        {llmText ? (
          <button
            type="button"
            className="ui-turn-action-btn icon"
            onClick={copyTurn}
            title={t("msg.copy")}
            aria-label={t("msg.copy")}
          >
            {copied ? "✓" : "⧉"}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="ui-turn-actions ui-turn-fork-open">
      <input
        className="ui-turn-fork-why"
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        placeholder={t("taskhub.forkWhy")}
        autoFocus
      />
      <button
        type="button"
        className={`ui-turn-mode-pill${mode === "worktree" ? " on" : ""}`}
        onClick={() => setMode("worktree")}
        title={t("taskhub.forkMode.worktreeNote")}
      >
        {t("taskhub.forkMode.worktree")}
      </button>
      <button
        type="button"
        className={`ui-turn-mode-pill${mode === "branch" ? " on" : ""}`}
        onClick={() => setMode("branch")}
        title={t("taskhub.forkMode.branchNote")}
      >
        {t("taskhub.forkMode.branch")}
      </button>
      <button
        type="button"
        className="ui-turn-action-btn go"
        disabled={busy || !why.trim()}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const err = await onFork(commandText, why.trim(), mode);
          setBusy(false);
          if (err) setError(err);
          else setOpen(false);
        }}
      >
        ⑂ {t("taskhub.forkGo")}
      </button>
      <button type="button" className="ui-turn-action-btn" onClick={() => setOpen(false)}>
        {t("common.cancel")}
      </button>
      {error ? <span className="ui-turn-fork-error">{error}</span> : null}
    </div>
  );
}

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
  onFork,
}: {
  command: SessionMessage;
  body: SessionMessage[];
  /** True while this turn is the one currently executing. */
  isLive: boolean;
  streaming: boolean;
  reasoningMode: ReasoningMode;
  expandedThinkingId?: string | null;
  /** 回合完成后的 fork 入口（十一轮）：App 注入的树定位/建树编排。 */
  onFork?: (commandText: string, why: string, mode: TurnForkMode) => Promise<string | null>;
}): JSX.Element {
  const { t } = useI18n();
  const visible = useMemo(() => body.filter((m) => m.visible), [body]);
  const lastVisibleId = visible[visible.length - 1]?.id ?? null;

  return (
    <div className="ui-turn">
      {/* 人类指令条（user ask 2026-09-03 七轮：弱化聊天感）—— 整幅左起
          的指令头开启回合，不再是右侧聊天气泡。 */}
      <UserDirective message={command} />

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
          {/* 回合完成后的 fork 操作行（user ask 2026-09-03 十一轮）。 */}
          {!isLive && onFork ? (
            <TurnForkBar
              commandText={(command.content ?? "").trim()}
              llmText={visible
                .filter(
                  (m) => m.role === "assistant" && !m.meta?.asThinking && typeof m.content === "string" && m.content
                )
                .map((m) => m.content)
                .join("\n\n")}
              onFork={onFork}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
