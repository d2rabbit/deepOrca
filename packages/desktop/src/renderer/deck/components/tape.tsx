// Tape (对话记录): the full message stream as a read-only transcript overlay.
// Assistant content renders through the shared markdown pipeline; tool
// messages collapse to one-line summaries. Auto-sticks to the bottom while
// streaming unless the user scrolls up.
import { useEffect, useMemo, useRef, type JSX } from "react";
import type { SessionMessage } from "../../../shared/ipc";
import { StreamdownView } from "../../components/StreamdownView";
import { buildToolSummary } from "../../lib/messages";
import { useI18n } from "../../i18n";

function toolLine(message: SessionMessage): string {
  try {
    const summary = buildToolSummary(message);
    return `${summary.ok ? "✓" : "✗"} ${summary.name}`;
  } catch {
    return "tool";
  }
}

export function DeckTape(props: { messages: SessionMessage[] }): JSX.Element {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const items = useMemo(
    () => props.messages.filter((m) => m.visible !== false && m.role !== "system"),
    [props.messages]
  );

  useEffect(() => {
    const el = bodyRef.current;
    if (el && stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items.length]);

  return (
    <div
      className="deck-tape"
      ref={bodyRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {items.length === 0 ? <div className="deck-empty">{t("deck.tape.empty")}</div> : null}
      {items.map((message) => {
        if (message.role === "user") {
          return (
            <div key={message.id} className="deck-tape-row user">
              <div className="deck-tape-bubble user">{message.content}</div>
            </div>
          );
        }
        if (message.role === "assistant") {
          return (
            <div key={message.id} className="deck-tape-row assistant">
              <div className="deck-tape-bubble assistant deck-md">
                {/* Shared Streamdown pipeline — same sanitization path as the classic message view. */}
                <StreamdownView markdown={message.content ?? ""} />
              </div>
            </div>
          );
        }
        return (
          <div key={message.id} className="deck-tape-row tool">
            <span className="deck-tape-tool">{toolLine(message)}</span>
          </div>
        );
      })}
    </div>
  );
}
