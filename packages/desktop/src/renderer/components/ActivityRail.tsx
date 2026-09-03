import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { SessionMessage } from "../../shared/ipc";
import { buildToolSummary, formatToolParams, getResultMd } from "../lib/messages";
import { useI18n } from "../i18n";
import { toolCls } from "./message/shared";
import {
  IconBot,
  IconPulse,
  IconSparkle,
  IconToolGeneric,
  IconToolMcp,
  IconToolRead,
  IconToolSearch,
  IconToolWrite,
} from "../ui/index";

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

function KindIcon({ kind }: { kind: ActivityKind }): JSX.Element {
  switch (kind) {
    case "bash":
      return <IconToolGeneric />;
    case "read":
      return <IconToolRead />;
    case "edit":
      return <IconToolWrite />;
    case "grep":
      return <IconToolSearch />;
    case "mcp":
      return <IconToolMcp />;
    case "skill":
      return <IconSparkle />;
    default:
      return <IconToolGeneric />;
  }
}

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
  arg: string;
  result: string;
  ok: boolean;
};

/** Maximum live windows kept in the cascade store. */
const MAX_WINDOWS = 15;
/** Windows rendered in the rail — collapsed display (user ask 2026-09-03:
 *  窗体小/活动多时不再摊开，只显示最前一扇，其余在下拉清单按需调出). */
const VISIBLE = 1;

/**
 * ActivityRail — the resident right column of the chat stage
 * (designs/chat-redesign screen-chat §实时活动): the live-activity cap pill
 * toggles a DROPDOWN log (`.log`) listing every activity — clicking a row
 * brings that pip to the front of the cascade. The pips themselves are
 * display-only (user ask 2026-09-03: 切换一律走下拉，不走小窗直操作).
 * Think transient card on top; collapses to a 40px sliver while a right-side
 * float tab owns the edge.
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
        arg: formatToolParams(summary),
        result: getResultMd(m)
          .replace(/```\w*\n?/g, "")
          .trimEnd(),
        ok: summary.ok,
      });
    }
    return out.slice(-MAX_WINDOWS).reverse(); // newest first
  }, [messages]);

  // 下拉置顶（screen-chat 交互）：frontId 的活动提到 p0，其余按时间序跟随；
  // 小窗本身不再响应鼠标直操作（去 cursor/hover 抬升）。
  const [frontId, setFrontId] = useState<string | null>(null);
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

  // Live think transient card state — chars grow while the run streams.
  const lastThinking = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      // thinking = assistant 消息 + asThinking 标记（core 无独立 thinking 角色）
      if (m.role === "assistant" && m.meta?.asThinking && typeof m.content === "string") return m;
    }
    return null;
  }, [messages]);
  const thinkText = lastThinking?.content ?? "";
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
              <div className="bd">{thinkText.slice(-160)}</div>
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
                    onClick={() => {
                      setFrontId(w.id);
                      setLogOpen(false);
                    }}
                  >
                    <span className="ic" aria-hidden>
                      <KindIcon kind={w.kind} />
                    </span>
                    <span className="tt">{w.name}</span>
                    <span className={`dot ${w.ok ? "ok" : "err"}`} aria-hidden />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="deck">
            {visible.map((w, i) => (
              <article key={w.id} className={`pipwin p${i} k-${w.kind}${w.ok ? "" : " err"}`}>
                <div className="ph">
                  <span className="ic">
                    <KindIcon kind={w.kind} />
                  </span>
                  <span className="tt">{w.name}</span>
                  <span className="done-dot" aria-hidden />
                </div>
                <div className="pb">
                  <div className="arg">{w.arg}</div>
                  {w.result ? <pre>{w.result}</pre> : null}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
