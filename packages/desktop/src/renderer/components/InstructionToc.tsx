import { useMemo, type JSX } from "react";
import type { SessionMessage } from "../../shared/ipc";
import { useI18n } from "../i18n";
import { IconList } from "../ui/index";

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

/** 指令目录 — left column of the chat stage: one entry per user instruction,
 *  click scrolls the conversation to that turn (designs/chat-redesign V4).
 *  Borderless resident column — only its entries carry surfaces. */
export function InstructionToc({ messages }: Props): JSX.Element {
  const { t } = useI18n();
  const entries = useMemo(
    () =>
      messages
        .filter((m) => m.role === "user")
        .map((m) => ({ id: m.id, text: entryText(m) }))
        .filter((e) => e.text.length > 0),
    [messages]
  );

  const jump = (id: string): void => {
    document.querySelector(`[data-mid="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <aside className="ui-toc" aria-label={t("toc.title")}>
      <div className="ui-toc-head">
        <IconList />
        <span>{t("toc.title")}</span>
      </div>
      <div className="ui-toc-list">
        {entries.length === 0 ? (
          <div className="ui-toc-empty">{t("toc.empty")}</div>
        ) : (
          entries.map((e, i) => (
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
          ))
        )}
      </div>
    </aside>
  );
}
