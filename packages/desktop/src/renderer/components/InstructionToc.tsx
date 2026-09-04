import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { SessionMessage } from "../../shared/ipc";
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

/** 指令目录 — 会话区左上角的下拉胶囊（参考 screen-chat 实时活动流的
 *  cap+log 下拉交互）：不再独占一个整列；没有指令时整组不渲染。
 *  点胶囊展开目录清单，点条目定位对应回合，点外部收起。 */
export function InstructionToc({ messages }: Props): JSX.Element | null {
  const entries = useMemo(
    () =>
      messages
        .filter((m) => m.role === "user")
        .map((m) => ({ id: m.id, text: entryText(m) }))
        .filter((e) => e.text.length > 0),
    [messages]
  );
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent): void => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (entries.length === 0) return null;

  const jump = (id: string): void => {
    document.querySelector(`[data-mid="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setOpen(false);
  };

  return (
    <div className={`ui-toc${open ? " open" : ""}`} ref={wrapRef}>
      <button type="button" className="ui-toc-pill" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <IconList />
        <span>{entries.length}</span>
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="ui-toc-list" role="listbox">
          {entries.map((e, i) => (
            <div
              key={e.id}
              className="ui-toc-item"
              onClick={() => jump(e.id)}
              role="option"
              aria-selected={false}
              tabIndex={0}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  jump(e.id);
                }
              }}
            >
              <span className="n">{i + 1}</span>
              <span className="tt">{e.text}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
