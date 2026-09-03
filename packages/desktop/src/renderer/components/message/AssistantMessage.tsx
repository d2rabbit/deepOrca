/**
 * assistant — 拆分自 Message.tsx（落地实施方案 §八）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, Suspense, lazy, type JSX } from "react";
import type { SessionMessage } from "../../../shared/ipc";
import { useI18n } from "../../i18n";
import { Md, formatTime } from "./shared";

export function AssistantMessage({
  message,
  streaming = false,
}: {
  message: SessionMessage;
  streaming?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const content = (message.content || "").trim();
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Extract <comparison> blocks for rich rendering.
  const comparisonBlocks = useMemo(() => {
    const matches: string[] = [];
    const regex = /<comparison>\s*([\s\S]*?)\s*<\/comparison>/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null) {
      matches.push(m[1]!);
    }
    return matches;
  }, [content]);
  // Content without comparison blocks (rendered as markdown).
  const contentWithoutComparisons =
    comparisonBlocks.length > 0 ? content.replace(/<comparison>[\s\S]*?<\/comparison>/g, "").trim() : content;

  // Clear the pending copy-feedback reset when the bubble unmounts.
  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    []
  );

  const handleCopy = useCallback(() => {
    if (!content) return;
    void navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
      })
      // Clipboard can be locked — swallow so the unhandled rejection
      // doesn't hit the console; the copied flag simply never flips.
      .catch(() => {});
  }, [content]);

  return (
    <div className="ui-ai-row">
      <div className="ui-ai-id">
        <span className="ui-ai-mark" aria-hidden="true">
          orc
        </span>
        <span className="who">{t("app.name")}</span>
        {message.createTime ? <span className="tm">{formatTime(message.createTime)}</span> : null}
        {streaming ? (
          <span className="st">
            <span className="ui-spinner" />
          </span>
        ) : null}
        {content ? (
          <button
            type="button"
            className={`ui-msg-copy${copied ? " copied" : ""}`}
            onClick={handleCopy}
            title={copied ? t("msg.copied") : t("msg.copy")}
            aria-label={t("msg.copy")}
          >
            {copied ? "✓" : "⧉"}
          </button>
        ) : null}
      </div>
      <div className="ui-md">
        {contentWithoutComparisons ? <Md text={contentWithoutComparisons} isAnimating={streaming} /> : null}
        {comparisonBlocks.length > 0
          ? comparisonBlocks.map((block, i) => (
              <Suspense key={`cmp-${i}`} fallback={<div>{t("msg.loadingComparison")}</div>}>
                <ComparisonMatrix content={block} />
              </Suspense>
            ))
          : null}
      </div>
    </div>
  );
}

// ── Tool card (differentiated by tool type) ───────────────────────────────────
// Collapsible tool families: read/write/edit/bash/cli. Their cards default
// to folded so the chat stays scannable; the header doubles as an expand
// toggle and surfaces the file path / command inline so the user can
// identify the operation without expanding. Bash cards additionally show
// the result hint (exit code / first line) in the header so the outcome
// is visible at a glance — no need to expand to see "did it work?".
// Other tools (ask/plan/search/mcp) keep their content visible — their
// result remains individually collapsible as before.

// Lazy-load comparison matrix — only needed when agent uses <comparison> tags.
const ComparisonMatrix = lazy(() => import("../ComparisonMatrix").then((m) => ({ default: m.ComparisonMatrix })));
