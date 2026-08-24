import { memo, useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { SessionMessage } from "../../shared/ipc";
import type { ReasoningMode } from "../lib/appearance";
import { findExpandedThinkingId } from "../lib/messages";
import { Message } from "./Message";
import { useI18n } from "../i18n";
import { IconWelcomePlan, IconWelcomeInit, IconWelcomeSkills, IconWelcomeUndo } from "../ui/index";

/** Format an ISO date string as a short locale date (e.g. "Jul 21, 2026"). */
const dateSepCache = new Map<string, string>();
function formatDateSeparator(iso: string): string {
  const cached = dateSepCache.get(iso);
  if (cached !== undefined) return cached;
  let result = "";
  try {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) result = "Today";
    else if (d.toDateString() === yesterday.toDateString()) result = "Yesterday";
    else result = d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  } catch {
    result = "";
  }
  dateSepCache.set(iso, result);
  return result;
}

/** Get the date key (YYYY-MM-DD) from an ISO string for grouping. */
function dateKey(iso: string | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

type Props = {
  messages: SessionMessage[];
  hasActiveSession: boolean;
  /** How assistant reasoning/thinking blocks are displayed. */
  reasoningMode: ReasoningMode;
  /** Quick-start actions surfaced on the welcome screen. */
  onQuickAction?: (action: "plan" | "init" | "skills" | "undo") => void;
  /** Interactive prompt cards (permission / question / plan) shown after the messages. */
  footer?: React.ReactNode;
  /** Whether the session is currently compacting its context. */
  compacting?: boolean;
  /** True while the session is busy (tokens, tools, compaction) — forwarded
   *  to the last message so its markdown can show the streaming caret. */
  streaming?: boolean;
};

// Memoized: every prop is a stable reference from App (messages array identity
// only changes on real updates, callbacks are useCallback'd, footer is a
// memoized ReactNode), so busy/stream ticks in App skip this whole subtree.
export const MessageList = memo(function MessageList({
  messages,
  hasActiveSession,
  reasoningMode,
  onQuickAction,
  footer,
  compacting = false,
  streaming = false,
}: Props): JSX.Element {
  const { t } = useI18n();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const expandedThinkingId = useMemo(() => findExpandedThinkingId(messages), [messages]);
  // Stickiness tracks whether the user is parked at the bottom of the
  // conversation. The auto-scroll effect only follows the stream when
  // they are; if they've scrolled up to read something, new content
  // arrives silently instead of yanking them back down.
  //
  // We mirror `stuckToBottom` into a ref so the auto-scroll effect can
  // read the current value without re-running on every scroll tick.
  // (If the effect listed `stuckToBottom` in its deps, the act of
  // scrolling toward the bottom would flip state to true, re-run the
  // effect, and call `scrollIntoView({ behavior: "smooth" })` —
  // yanking the user to the very bottom and preventing them from
  // stopping at an intermediate position. The reported bug.)
  const [stuckToBottom, setStuckToBottom] = useState(true);
  const stuckToBottomRef = useRef(true);
  // Track how many messages arrived while the user was scrolled up.
  const [unreadCount, setUnreadCount] = useState(0);
  const prevMsgCountRef = useRef(0);

  // Recompute stuck-state on scroll, on resize, and on content changes
  // (because the scroll position is now in a different "place" relative
  // to the new content height). 80px of slack matches how the rest of
  // the UI (slack toasts, jump-to-bottom buttons) treats "near the end".
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const next = distance < 80;
      stuckToBottomRef.current = next;
      setStuckToBottom(next);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [hasActiveSession]);

  // Auto-scroll when new content arrives — gated on the *ref* so that
  // a manual scroll toward the bottom (which sets stuckToBottom = true)
  // does NOT immediately re-trigger a smooth scroll. The next content
  // change is the moment we follow; pure scroll motion is left alone.
  useEffect(() => {
    const delta = messages.length - prevMsgCountRef.current;
    prevMsgCountRef.current = messages.length;
    if (!stuckToBottomRef.current && delta > 0) {
      setUnreadCount((c) => c + delta);
      return;
    }
    if (stuckToBottomRef.current) {
      setUnreadCount(0);
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, footer]);

  // If the user clicks into the conversation from elsewhere (or expands
  // a thinking block and then scrolls back), keep them pinned by
  // manually forcing a re-evaluation. A dedicated "jump to latest" pill
  // is rendered in the JSX below; clicking it re-engages follow mode.
  const handleJumpToLatest = (): void => {
    stuckToBottomRef.current = true;
    setStuckToBottom(true);
    setUnreadCount(0);
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  if (!hasActiveSession) {
    const cards: { action: "plan" | "init" | "skills" | "undo"; icon: JSX.Element; title: string; desc: string }[] = [
      { action: "plan", icon: <IconWelcomePlan />, title: t("welcome.planTitle"), desc: t("welcome.planDesc") },
      { action: "init", icon: <IconWelcomeInit />, title: t("welcome.initTitle"), desc: t("welcome.initDesc") },
      { action: "skills", icon: <IconWelcomeSkills />, title: t("welcome.skillsTitle"), desc: t("welcome.skillsDesc") },
      { action: "undo", icon: <IconWelcomeUndo />, title: t("welcome.undoTitle"), desc: t("welcome.undoDesc") },
    ];
    return (
      <div className="ui-conversation">
        <div className="ui-welcome">
          <h1>{t("app.name")}</h1>
          <div className="ui-welcome-subtitle">{t("empty.subtitle")}</div>
          <div className="ui-welcome-tips">{t("empty.tips")}</div>
          <div className="ui-welcome-quickstart">
            <div className="ui-welcome-quickstart-label">{t("welcome.quickStart")}</div>
            <div className="ui-welcome-cards">
              {cards.map((card) => (
                <button
                  key={card.action}
                  type="button"
                  className="ui-welcome-card"
                  onClick={() => onQuickAction?.(card.action)}
                >
                  <span className="ui-welcome-card-icon">{card.icon}</span>
                  <span className="ui-welcome-card-title">{card.title}</span>
                  <span className="ui-welcome-card-desc">{card.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="ui-welcome-hints">
            <kbd>⌘N</kbd> {t("welcome.hintNew")} · <kbd>⌘K</kbd> {t("welcome.hintPalette")} · <kbd>⌘?</kbd>{" "}
            {t("welcome.hintShortcuts")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ui-conversation" ref={scrollerRef}>
      <div className="ui-conversation-inner">
        {messages.length === 0 && !footer ? (
          <div className="ui-empty" style={{ padding: "60px 0" }}>
            {t("empty.newSession")}
          </div>
        ) : messages.length > 0 ? (
          <div className="ui-msg-count-indicator">
            {messages.length} {messages.length === 1 ? "message" : "messages"}
          </div>
        ) : null}
        {messages.map((message, idx) => {
          // Insert a date separator when the day changes between messages.
          const prevMsg = idx > 0 ? messages[idx - 1] : null;
          const showSep = prevMsg && dateKey(prevMsg.createTime) !== dateKey(message.createTime);
          return (
            <div key={message.id} className="ui-msg-wrap">
              {showSep ? (
                <div className="ui-date-separator">
                  <span className="ui-date-separator-line" />
                  <span className="ui-date-separator-label">{formatDateSeparator(message.createTime)}</span>
                  <span className="ui-date-separator-line" />
                </div>
              ) : null}
              <Message
                message={message}
                reasoningMode={reasoningMode}
                expandedThinkingId={expandedThinkingId}
                streaming={streaming && idx === messages.length - 1}
              />
            </div>
          );
        })}
        {footer}
        {/* Compaction notification — shown while the engine compresses context */}
        {compacting ? (
          <div className="ui-compaction-banner">
            <span className="ui-compaction-spinner" />
            <span>{t("context.compacting")}</span>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
      {/* Floating jump-to-latest pill — appears when the user has scrolled
         up to read something and the stream keeps producing. Clicking it
         re-engages follow mode and snaps back to the bottom. */}
      {stuckToBottom || messages.length === 0 ? null : (
        <button
          type="button"
          className="ui-jump-to-latest"
          onClick={handleJumpToLatest}
          aria-label={t("msg.jumpToLatest")}
        >
          <span className="ui-jump-to-latest-arrow" aria-hidden="true">
            ↓
          </span>
          {unreadCount > 0 ? <span className="ui-jump-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
          <span>{t("msg.jumpToLatest")}</span>
        </button>
      )}
    </div>
  );
});
