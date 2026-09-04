import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { SessionMessage } from "../../shared/ipc";
import { buildToolSummary, firstNonEmptyLine, getResultMd, toolThumbTarget } from "../lib/messages";
import { useI18n } from "../i18n";
import { toolCls, toolIcon } from "./message/shared";
import { ToolResultView } from "./message/ToolResultView";
import { IconBot, IconPulse } from "../ui/index";

type Props = {
  /** Transcript of the ACTIVE session/streaming buffer (same source the
   *  ToolActivityPanel used — this rail absorbs that float). */
  messages: SessionMessage[];
  /** A run is streaming — drives the think transient card. */
  busy: boolean;
  /** Right-side float tab (quick view) owns the edge — collapse to a sliver. */
  collapsed: boolean;
};

type ActivityKind = "bash" | "read" | "edit" | "grep" | "mcp" | "skill" | "doc";

function kindOf(name: string): ActivityKind {
  const n = name.toLowerCase();
  if (n.includes("skill")) return "skill";
  if (n === "bash" || n.includes("terminal")) return "bash";
  switch (toolCls(name)) {
    case "read":
      return "read";
    case "write":
    case "edit":
      return "edit";
    case "search":
      return "grep";
    case "mcp":
      return "mcp";
    default:
      return "doc";
  }
}

type ActivityWindow = {
  id: string;
  kind: ActivityKind;
  name: string;
  /** 短目标缩略：文件操作=文件名，bash=命令首行，其余=参数首行（可空）。 */
  thumb: string;
  /** Full tool summary — feeds ToolResultView (diff metadata, params). */
  summary: ReturnType<typeof buildToolSummary>;
  resultMd: string;
  ok: boolean;
};

/** Maximum live windows kept in the cascade store. */
const MAX_WINDOWS = 15;
/** Windows rendered in the rail — collapsed display (user ask 2026-09-03:
 *  窗体小/活动多时不再摊开，只显示最前一扇，其余在下拉清单按需调出). */
const VISIBLE = 1;

/**
 * ActivityRail — the RESIDENT right float of the chat stage
 * (designs/chat-redesign screen-chat §实时活动): mounted whenever the session
 * has any behavior record (App gates on hasLive = tool/script/skill/mcp/file
 * activity) — the cap pill + dropdown DIRECTORY persists like the left
 * instruction-TOC capsule (user ask 2026-09-03 三轮). Only the pip window and
 * the think transient card are LIVE-ONLY: the pip shows while busy (or after
 * a manual dropdown pick), hides when the run ends, and its ✕ dismisses the
 * current window; picking a log row brings that pip back. Pure overlay — the
 * conversation and composer keep full width at all times. Collapses to a 40px
 * sliver while a right-side float tab owns the edge.
 */
export function ActivityRail({ messages, busy, collapsed }: Props): JSX.Element {
  const { t } = useI18n();

  const windows = useMemo(() => {
    const out: ActivityWindow[] = [];
    for (let i = 0; i < messages.length; i += 1) {
      const m = messages[i];
      if (!m || m.role !== "tool") continue;
      const summary = buildToolSummary(m);
      if (!summary.name) continue;
      out.push({
        id: m.id,
        kind: kindOf(summary.name),
        name: summary.name,
        thumb: toolThumbTarget(summary),
        summary,
        resultMd: getResultMd(m),
        ok: summary.ok,
      });
    }
    return out.slice(-MAX_WINDOWS).reverse(); // newest first
  }, [messages]);

  // 下拉置顶（screen-chat 交互）：frontId 的活动提到 p0，其余按时间序跟随；
  // 小窗本身不再响应鼠标直操作（去 cursor/hover 抬升）。
  const [frontId, setFrontId] = useState<string | null>(null);
  // 手动关闭（×）：只隐藏当前这扇小窗，胶囊目录保留；下一扇活动到来
  // 或下拉重新点名时再出现（user ask 2026-09-03 二轮）。
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!logOpen) return;
    const onDown = (ev: MouseEvent): void => {
      if (!logRef.current?.contains(ev.target as Node)) setLogOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [logOpen]);

  const ordered = useMemo(() => {
    if (!frontId) return windows;
    const front = windows.find((w) => w.id === frontId);
    return front ? [front, ...windows.filter((w) => w.id !== frontId)] : windows;
  }, [windows, frontId]);
  const visible = ordered.slice(0, VISIBLE);

  // 新活动到来时解除下拉置顶 —— 小窗回到跟随最新（"有活动就出现"），
  // 同时被 × 的那扇自然让位（deckId 变了，不再等于 dismissedId）。
  const newestId = windows[0]?.id ?? null;
  const prevNewestRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevNewestRef.current !== null && newestId !== prevNewestRef.current) {
      setFrontId(null);
    }
    prevNewestRef.current = newestId;
  }, [newestId]);

  // 悬浮小窗是瞬态（user ask 2026-09-03 三轮）：运行中（busy）随最新活动
  // 亮出，空闲时只有手动从下拉点名（frontId）才亮；✕ 收起当前这扇。
  // 目录胶囊本身常驻 —— 由 App 的 hasLive（有行为记录即挂载）保证。
  const deckId = visible[0]?.id ?? null;
  const deckShown = (busy || frontId !== null) && deckId !== null && deckId !== dismissedId;

  // Live think transient card state — chars grow while the run streams.
  // Effective text 兜底 messageParams.reasoning_content（StepFun 等模型把
  // 思考放 params、content 为空——直接取 content 会得到 "0 字" 空气泡，
  // user ask 2026-09-03 六轮）。无有效文本的思考消息不亮卡。
  const lastThinking = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role !== "assistant" || !m.meta?.asThinking) continue;
      const params = m.messageParams as { reasoning_content?: unknown } | null | undefined;
      const viaParams = typeof params?.reasoning_content === "string" ? params.reasoning_content : "";
      const text = typeof m.content === "string" && m.content ? m.content : viaParams;
      if (text) return { message: m, text };
    }
    return null;
  }, [messages]);
  const thinkText = lastThinking?.text ?? "";
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => setElapsed((s) => s + 0.1), 100);
    return () => clearInterval(timer);
  }, [busy]);
  const thinkChars = thinkText.length;

  return (
    <aside className={`ui-actcol${collapsed ? " collapsed" : ""}`} aria-label={t("activity.title")}>
      {collapsed ? (
        <div className="ui-actcol-label">
          <IconPulse />
          <span>{t("activity.title")}</span>
          <span>{windows.length}</span>
        </div>
      ) : (
        <>
          {busy && lastThinking ? (
            <div className="ui-think-card">
              <div className="h">
                <IconBot />
                {t("activity.thinking")}
                <span className="cnt">
                  {thinkChars} {t("activity.chars")} · {elapsed.toFixed(1)}s
                </span>
              </div>
              {/* 思考尾巴放长 + 内滚（user ask 2026-09-03 六轮：这里就是
                  展示思考内容的地方，160 字太抠） */}
              <div className="bd">{thinkText.slice(-480)}</div>
            </div>
          ) : null}

          {/* 实时活动 cap + 下拉清单（screen-chat .live 同款交互） */}
          <div className="cap-row" ref={logRef}>
            <button
              type="button"
              className="cap"
              onClick={() => setLogOpen((v) => !v)}
              aria-expanded={logOpen}
              title={t("activity.cap")}
            >
              <IconPulse />
              {t("activity.title")} · {Math.min(windows.length, MAX_WINDOWS)} / {MAX_WINDOWS}
              <span className="chev" aria-hidden>
                ▾
              </span>
            </button>
            {logOpen ? (
              <div className="log" role="listbox">
                {ordered.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    className={`lr${w.ok ? "" : " err"}`}
                    title={firstNonEmptyLine(w.summary.params) || w.name}
                    onClick={() => {
                      setFrontId(w.id);
                      setDismissedId(null);
                      setLogOpen(false);
                    }}
                  >
                    <span className={`ic k-${w.kind}`} aria-hidden>
                      {toolIcon(w.name)}
                    </span>
                    <span className="tt">
                      {w.name}
                      {w.thumb ? <span className="th"> · {w.thumb}</span> : null}
                    </span>
                    <span className={`dot ${w.ok ? "ok" : "err"}`} aria-hidden />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {deckShown ? (
            <div className="deck">
              {visible.map((w, i) => (
                <article key={w.id} className={`pipwin p${i} k-${w.kind}${w.ok ? "" : " err"}`}>
                  <div className="ph">
                    <span className="ic">{toolIcon(w.name)}</span>
                    <span className="tt" title={firstNonEmptyLine(w.summary.params) || w.name}>
                      {w.name}
                      {w.thumb ? <span className="th"> · {w.thumb}</span> : null}
                    </span>
                    <span className="done-dot" aria-hidden />
                    <button
                      type="button"
                      className="pip-close"
                      onClick={() => setDismissedId(w.id)}
                      aria-label={t("common.close")}
                      title={t("common.close")}
                    >
                      ✕
                    </button>
                  </div>
                  {/* 小窗与展开体同一富渲染（user ask 2026-09-03 四轮）：
                      bash 终端帧 / write-edit diff / JSON 树 / markdown ——
                      文件操作看到具体内容，不是一句 Updated file。 */}
                  <div className="pb">
                    <ToolResultView summary={w.summary} resultMd={w.resultMd} />
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}
