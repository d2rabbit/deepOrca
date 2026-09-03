import { useMemo, type JSX } from "react";
import type { SessionMessage } from "../../shared/ipc";

type Props = {
  /** Full transcript of the active session — entries derive from user turns. */
  messages: SessionMessage[];
};

/** First meaningful line of a user message, for the TOC entry title. */
function entryText(message: SessionMessage): string {
  const raw = typeof message.content === "string" ? message.content : "";
  const line = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (line ?? "").slice(0, 48);
}

/** 指令目录 — 会话区左列：每条用户指令一个条目，点击定位对应回合
 *  （designs/chat-redesign V4）。无边框隐形容器，仅条目有表面；
 *  没有指令时整列不渲染（默认隐藏，开始对话后才出现），也不带标题。 */
export function InstructionToc({ messages }: Props): JSX.Element | null {
  const entries = useMemo(
    () =>
      messages
        .filter((m) => m.role === "user")
        .map((m) => ({ id: m.id, text: entryText(m) }))
        .filter((e) => e.text.length > 0),
    [messages]
  );

  if (entries.length === 0) return null;

  const jump = (id: string): void => {
    document.querySelector(`[data-mid="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <aside className="ui-toc" aria-label="toc">
      <div className="ui-toc-list">
        {entries.map((e, i) => (
          <div
            key={e.id}
            className="ui-toc-item"
            onClick={() => jump(e.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") jump(e.id);
            }}
          >
            <span className="n">{i + 1}</span>
            <span className="tt">{e.text}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
