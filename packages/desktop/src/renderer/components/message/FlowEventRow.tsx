/**
 * flow — 拆分自 Message.tsx（落地实施方案 §八）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import type { SessionMessage } from "../../../shared/ipc";
import { buildToolSummary } from "../../lib/messages";
import { formatToolParams } from "../../lib/messages";
import { getDiffLines } from "../../lib/messages";
import { getPlanLines } from "../../lib/messages";
import { getResultMd } from "../../lib/messages";
import { useI18n } from "../../i18n";
import { IconToolPlan } from "../../ui/index";
import { BashTerminal, FLOW_VERB_KEY, ResultHint, ToolResult, formatElapsed, toolCls, toolIcon } from "./shared";

export const COLLAPSIBLE_TOOLS = new Set(["read", "write", "edit", "bash", "cli"]);
export const SHOW_RESULT_HINT_IN_HEADER = new Set(["bash", "cli"]);

export function ToolCard({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  // Memoize derived data — tool messages are immutable after creation, so
  // these computations never change. Without useMemo, every parent re-render
  // (tick, scroll, sidebar refresh) re-parses JSON and re-computes diffs.
  const summary = useMemo(() => buildToolSummary(message), [message]);
  const params = useMemo(() => formatToolParams(summary), [summary]);
  const resultMd = useMemo(() => getResultMd(message), [message]);
  const diffLines = useMemo(() => getDiffLines(summary), [summary]);
  const planLines = useMemo(() => getPlanLines(summary), [summary]);
  const toolClass = toolCls(summary.name);
  const isMcp = summary.name.toLowerCase().startsWith("mcp__");
  const isBash = toolClass === "bash";
  // Rendering-engine spec: tool names are mono "tool::<name>" (amber) and
  // MCP calls are "mcp::<server>/<tool>" (purple) with an "MCP Server" badge.
  const displayName = isMcp
    ? `mcp::${summary.name.replace(/^mcp__/, "").replace(/__/g, "/")}`
    : `tool::${summary.name.toLowerCase()}`;
  const isFileTool = COLLAPSIBLE_TOOLS.has(summary.name.toLowerCase());
  const showHeaderHint = SHOW_RESULT_HINT_IN_HEADER.has(summary.name.toLowerCase());
  const [bodyOpen, setBodyOpen] = useState(!isFileTool);
  const [resultOpen, setResultOpen] = useState(false);
  const [resultCopied, setResultCopied] = useState(false);
  const resultCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the pending copy-feedback reset when the card unmounts.
  useEffect(
    () => () => {
      if (resultCopyTimerRef.current) clearTimeout(resultCopyTimerRef.current);
    },
    []
  );

  const handleCopyResult = useCallback(() => {
    if (!resultMd) return;
    void navigator.clipboard
      .writeText(resultMd)
      .then(() => {
        setResultCopied(true);
        if (resultCopyTimerRef.current) clearTimeout(resultCopyTimerRef.current);
        resultCopyTimerRef.current = setTimeout(() => setResultCopied(false), 1500);
      })
      .catch(() => {});
  }, [resultMd]);

  // The header element is a button for collapsible tools (so the whole
  // card is clickable to expand/collapse) and a plain div for other
  // tools, where the header is just visual metadata.
  const headerInner = (
    <>
      <span className="ui-tool-icon">{toolIcon(summary.name)}</span>
      <span className="ui-tool-verb">{t(FLOW_VERB_KEY[toolClass] ?? "msg.flow.other")}</span>
      {/* 目标内联：文件工具给路径，终端给命令；MCP 保留 server/tool 全名 */}
      {(isFileTool || isBash) && params && !(isBash && bodyOpen) ? (
        <span className="ui-tool-params-inline">{params}</span>
      ) : null}
      {!isMcp && !isFileTool && !isBash ? <span className="ui-tool-name">{displayName}</span> : null}
      {isMcp ? <span className="ui-tool-badge mcp">{t("msg.mcpServer")}</span> : null}
      {/* Status badge — ✓ success / ✗ failure, per the rendering-engine spec. */}
      {summary.ok ? (
        <span className="ui-tool-badge ok">✓ {t("msg.toolOk")}</span>
      ) : (
        <span className="ui-tool-badge err">✗ {t("msg.toolFail")}</span>
      )}
      {/* Elapsed time badge — how long the tool took to execute. */}
      {message.createTime && message.updateTime && message.createTime !== message.updateTime ? (
        <span className="ui-tool-elapsed">{formatElapsed(message.createTime, message.updateTime)}</span>
      ) : null}
      {/* Bash cards show the result hint (exit code, first line) in the
         header — the user shouldn't have to expand to know whether the
         command succeeded. */}
      {showHeaderHint && resultMd && !bodyOpen ? (
        <ResultHint toolName={summary.name} metadata={summary.metadata} resultMd={resultMd} />
      ) : null}
      {isFileTool ? <span className="ui-tool-chevron">{bodyOpen ? "▾" : "▸"}</span> : null}
    </>
  );

  return (
    <div
      className={`ui-tool-card ${toolClass}${summary.ok ? "" : " err"}${isFileTool ? " collapsible" : ""}${isFileTool && bodyOpen ? " open" : ""}`}
    >
      {isFileTool ? (
        <button type="button" className="ui-tool-head" onClick={() => setBodyOpen((v) => !v)} aria-expanded={bodyOpen}>
          {headerInner}
        </button>
      ) : (
        <div className="ui-tool-head">{headerInner}</div>
      )}
      {/* Non-file tools keep the params in a dark PARAMS panel (spec card #3). */}
      {!isFileTool && params ? (
        <div className="ui-tool-params-panel">
          <div className="ui-tool-params-label">
            <span>{t("msg.params")}</span>
            <span className="ui-tool-params-fmt">{isMcp ? "MCP" : "JSON"}</span>
          </div>
          <div className="ui-tool-params">{params}</div>
        </div>
      ) : null}
      {/* Body — for file tools, only rendered when expanded. */}
      {(!isFileTool || bodyOpen) && (
        <>
          {/* Bash renders as a terminal frame: command + output inline. */}
          {isBash ? <BashTerminal command={summary.params.trim()} resultMd={resultMd} /> : null}
          {/* Diff preview for edit/write */}
          {diffLines.length > 0 ? (
            <div className="ui-diff">
              {diffLines.map((line, i) => (
                <div key={i} className={line.kind === "added" ? "add" : line.kind === "removed" ? "del" : "ctx"}>
                  {line.marker}
                  {line.content}
                </div>
              ))}
            </div>
          ) : null}
          {/* Interactive plan checklist for UpdatePlan */}
          {planLines.length > 0 ? (
            <div className="ui-tool-plan">
              <div className="ui-tool-plan-label">
                <IconToolPlan /> {t("msg.plan")}
                <span className="ui-tool-plan-count">
                  {planLines.filter((l) => l.match(/^\s*[-*]\s*\[x\]/i)).length}/{planLines.length}
                </span>
              </div>
              <div className="ui-tool-plan-body">
                {planLines.map((line, i) => {
                  const checked = /^\s*[-*]\s*\[x\]/i.test(line);
                  const text = line.replace(/^\s*[-*]\s*\[[ xX]\]\s*/, "");
                  const isSubItem = /^\s{2,}/.test(line);
                  return (
                    <label key={i} className={`ui-plan-item${checked ? " done" : ""}${isSubItem ? " sub" : ""}`}>
                      <input type="checkbox" checked={checked} readOnly />
                      <span className="ui-plan-item-text">{text}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
          {/* Collapsible result — bash output already lives in the terminal frame. */}
          {resultMd && !isBash ? (
            <div className="ui-tool-result-wrap">
              <button
                className="ui-tool-result-toggle"
                onClick={() => setResultOpen((v) => !v)}
                aria-expanded={resultOpen}
              >
                <span>{resultOpen ? "▾" : "▸"}</span>
                <span>{t("msg.result")}</span>
                {!resultOpen ? (
                  <ResultHint toolName={summary.name} metadata={summary.metadata} resultMd={resultMd} />
                ) : null}
              </button>
              {resultOpen ? (
                <div className="ui-tool-result">
                  <button
                    type="button"
                    className={`ui-tool-result-copy${resultCopied ? " copied" : ""}`}
                    onClick={handleCopyResult}
                    title={resultCopied ? t("msg.copied") : t("msg.copy")}
                    aria-label={t("msg.copy")}
                  >
                    {resultCopied ? "✓" : "⧉"}
                  </button>
                  <ToolResult toolName={summary.name} params={params} resultMd={resultMd} />
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// ── System note (centered, muted) ─────────────────────────────────────────────
