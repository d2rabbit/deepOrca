import { useEffect, useMemo, useState, type JSX } from "react";
import type { SessionMessage } from "../../shared/ipc";
import { buildToolSummary, formatToolParams, getResultMd } from "../lib/messages";
import { useI18n } from "../i18n";
import {
  IconBolt,
  IconBot,
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
  if (n === "bash" || n.includes("terminal")) return "bash";
  if (n.includes("read")) return "read";
  if (n.includes("write") || n.includes("edit")) return "edit";
  if (n.includes("grep") || n.includes("search")) return "grep";
  if (n.startsWith("mcp") || n.includes("mcp")) return "mcp";
  if (n.includes("skill")) return "skill";
  return "doc";
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
/** Windows rendered on screen — older ones live behind the +N badge. */
const VISIBLE = 4;

/**
 * ActivityRail — the resident right column of the chat stage
 * (designs/chat-redesign V4): think transient card on top, the live activity
 * stream as a cascade of square windows (newest front-top, 4 on screen,
 * 15-cap), the subagent group pinned to the bottom. Collapses to a 40px
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
        arg: formatToolParams(summary),
        result: getResultMd(m).replace(/```\w*\n?/g, "").trimEnd(),
        ok: summary.ok,
      });
    }
    return out.slice(-MAX_WINDOWS).reverse(); // newest first
  }, [messages]);

  const total = windows.length;
  const visible = windows.slice(0, VISIBLE);
  const hidden = Math.max(0, total - VISIBLE);

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
          <IconBolt />
          <span>{total}</span>
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

          <div className="cap" title={t("activity.cap")}>
            <IconBolt />
            {t("activity.title")} · {Math.min(total, MAX_WINDOWS)} / {MAX_WINDOWS}
          </div>

          <div className="deck">
            {visible.map((w) => (
              <article key={w.id} className={`ui-pip k-${w.kind}${w.ok ? "" : " err"}`}>
                <div className="ph">
                  <span className="ic"><KindIcon kind={w.kind} /></span>
                  <span className="tt">{w.name}</span>
                  <span className={`dot ${w.ok ? "ok" : "err"}`} />
                </div>
                <div className="pb">
                  <div className="arg">{w.arg}</div>
                  {w.result ? <pre>{w.result}</pre> : null}
                </div>
              </article>
            ))}
            {hidden > 0 ? (
              <button type="button" className="more">
                +{hidden}
              </button>
            ) : null}
          </div>
        </>
      )}
    </aside>
  );
}
