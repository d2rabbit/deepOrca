/**
 * think — 拆分自 Message.tsx（落地实施方案 §八）。
 */
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { ReasoningMode } from "../../lib/appearance";
import { buildThinkingSummary } from "../../lib/messages";
import { useI18n } from "../../i18n";
import { Md, Avatar, truncate, formatCharCount } from "./shared";

export function ThinkingBlock({
  content,
  messageParams,
  reasoningMode,
  isLatest,
  elapsed,
  streaming = false,
}: {
  content: string;
  messageParams: unknown;
  reasoningMode: ReasoningMode;
  isLatest: boolean;
  elapsed?: string;
  streaming?: boolean;
}): JSX.Element | null {
  const { t } = useI18n();
  const summary = buildThinkingSummary(content, messageParams);
  const charCount = content.length;
  // Reasoning is shown expanded by default — the user wants to see the
  // model's working, not just a one-line summary. reasoningMode === "hidden"
  // suppresses the block entirely; otherwise the block is visible and the
  // user can collapse it manually if they want a quieter view.
  const [expanded, setExpanded] = useState(reasoningMode !== "hidden");
  const bodyRef = useRef<HTMLDivElement>(null);

  // Respect the global reasoningMode toggle (e.g. /raw cycles between
  // normal → expanded → hidden) without dragging the local collapse state
  // around when the latest message changes.
  useEffect(() => {
    setExpanded(reasoningMode !== "hidden");
  }, [reasoningMode]);

  // When the user expands an older thinking block, scroll the top of the
  // body into view. block: "nearest" avoids hijacking scroll position
  // when the body is already fully on screen, so this is a non-intrusive
  // nudge rather than a forced jump.
  useEffect(() => {
    if (expanded && bodyRef.current && !isLatest) {
      bodyRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [expanded, isLatest]);

  if (reasoningMode === "hidden") return null;

  return (
    <div className="ui-bubble-row assistant">
      <Avatar role="thinking" />
      <div className="ui-bubble thinking">
        <button className="ui-thinking-toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          <span className="ui-thinking-icon">{expanded ? "◉" : "◎"}</span>
          <span className="ui-thinking-label">{t("msg.thinking")}</span>
          <span className="ui-thinking-summary">{truncate(summary || t("msg.reasoning"), 80)}</span>
          {elapsed ? <span className="ui-thinking-elapsed">{elapsed}</span> : null}
          {charCount > 0 ? <span className="ui-thinking-chars">{formatCharCount(charCount)}</span> : null}
          <span className="ui-thinking-chevron">{expanded ? "▾" : "▸"}</span>
        </button>
        {expanded && content ? (
          <div className="ui-thinking-body" ref={bodyRef}>
            <Md text={content} isAnimating={streaming} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Assistant bubble ──────────────────────────────────────────────────────────
/** Format a timestamp as a short time string (HH:MM). */
