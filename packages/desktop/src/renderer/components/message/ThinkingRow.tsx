/**
 * think — 思考缩略行（designs/chat-redesign demo-flow .ev.k-think）：
 * 一行式（摘要 + 时长 + 字数），点击展开完整思考内容；运行中的实时
 * 思考瞬态卡在右侧活动区（ActivityRail 的 ui-think-card）。
 */
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { ReasoningMode } from "../../lib/appearance";
import { buildThinkingSummary } from "../../lib/messages";
import { useI18n } from "../../i18n";
import { IconBrain } from "../../ui/index";
import { Md, truncate, formatCharCount } from "./shared";

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
  // Effective reasoning text: some model families (e.g. StepFun) deliver the
  // trace via messageParams.reasoning_content while message.content stays
  // EMPTY — summary already falls back there, but the body/char-count used
  // raw content, so those rows showed a summary yet could never expand
  // (user report 2026-09-03 五轮). One effective text feeds all three.
  const params = messageParams as { reasoning_content?: unknown } | null | undefined;
  const reasoningParam = typeof params?.reasoning_content === "string" ? params.reasoning_content : "";
  const text = content || reasoningParam;
  const summary = buildThinkingSummary(content, messageParams);
  const charCount = text.length;
  // demo 形态：默认一行缩略；reasoningMode "expanded" 强制展开，"hidden"
  // 整块隐藏（/raw 循环切换 normal → expanded → hidden）。
  const [expanded, setExpanded] = useState(reasoningMode === "expanded");
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExpanded(reasoningMode === "expanded");
  }, [reasoningMode]);

  // 展开旧思考块时把顶部滚入视野。block: "nearest" 不劫持滚动位置。
  // scrollIntoView optional-call：非浏览器宿主（测试/jsdom）缺该方法时
  // 不能让展开效果抛错——effect 抛错会把整棵子树打回重挂、视觉上弹回复折。
  useEffect(() => {
    if (expanded && bodyRef.current && !isLatest) {
      bodyRef.current.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    }
  }, [expanded, isLatest]);

  if (reasoningMode === "hidden") return null;

  return (
    <div className="ui-flow">
      <div className={`ui-ev k-think${expanded ? " think-open" : ""}`}>
        <button
          type="button"
          className="ui-ev-think-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className="ic" aria-hidden="true">
            <IconBrain />
          </span>
          <span className="verb">{t("msg.thinking")}</span>
          {summary ? <span className="arg">{truncate(summary, 80)}</span> : null}
          {elapsed ? <span className="ms">{elapsed}</span> : null}
          {charCount > 0 ? <span className="think-chars">{formatCharCount(charCount)}</span> : null}
          <span className="think-chev" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
        </button>
        {expanded && text ? (
          <div className="think-body" ref={bodyRef}>
            <Md text={text} isAnimating={streaming} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
