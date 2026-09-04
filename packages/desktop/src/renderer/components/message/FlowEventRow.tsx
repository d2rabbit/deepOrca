/**
 * flow — 行为流缩略行（designs/chat-redesign demo-flow §.flow/.ev）。
 * 一行式活动摘要：类型色图标 + 动宾 + MCP 徽章 + 目标 + 耗时 + 状态；
 * 连接线由容器 .ui-flow 的 .ui-ev::before 绘制。整行可点：展开完整
 * 参数与结果（user ask 2026-09-03 —— 主会话里也能用传统方式点开查看，
 * 不必依赖右侧活动小窗；运行中的实时投影仍在 ActivityRail）。
 * 展开体按工具族富渲染（user ask 2026-09-03 四轮）：bash 终端帧、
 * write/edit diff 着色、纯 JSON 树、markdown —— 见 ToolResultView。
 */
import { useMemo, useState, type JSX } from "react";
import type { SessionMessage } from "../../../shared/ipc";
import { buildToolSummary, formatToolParams, getResultMd } from "../../lib/messages";
import { useI18n } from "../../i18n";
import { IconCheck, IconClose, IconFile } from "../../ui/index";
import { FLOW_VERB_KEY, formatElapsed, toolCls, toolIcon } from "./shared";
import { ToolResultView } from "./ToolResultView";

/** toolCls 家族 → demo .ev 的 k-* 类型色（k-think 属思考行）。 */
const EV_KIND: Record<string, string> = {
  bash: "bash",
  read: "read",
  write: "edit",
  edit: "edit",
  search: "grep",
  mcp: "mcp",
};

export function FlowEventRow({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  const summary = useMemo(() => buildToolSummary(message), [message]);
  const arg = useMemo(() => formatToolParams(summary), [summary]);
  // 展开体用完整参数（formatToolParams 是截断版，只够缩略行）。
  const params = summary.params.trim();
  const result = useMemo(() => getResultMd(message), [message]);
  const hasDetail = params.length > 0 || result.length > 0;
  const [open, setOpen] = useState(false);
  const toolClass = toolCls(summary.name);
  const kind = EV_KIND[toolClass] ?? "doc";
  const isMcp = toolClass === "mcp";
  const isFileOp = toolClass === "read" || toolClass === "write" || toolClass === "edit";
  const elapsed =
    message.createTime && message.updateTime && message.createTime !== message.updateTime
      ? formatElapsed(message.createTime, message.updateTime)
      : "";

  const head = (
    <>
      <span className="ic" aria-hidden="true">
        {toolIcon(summary.name)}
      </span>
      <span className="verb">{t(FLOW_VERB_KEY[toolClass] ?? "msg.flow.other")}</span>
      {isMcp ? <span className="badge">MCP</span> : null}
      {/* 文件类操作的目标渲染成文件芯片（icon + 文件名，tooltip 全路径；
          user ask 2026-09-03 五轮——裸等宽长路径读不动）。 */}
      {isFileOp && arg ? (
        <span className="ui-ref-chip file ev-file" title={arg}>
          <span className="ui-ref-chip-icon" aria-hidden="true">
            <IconFile />
          </span>
          <span className="ui-ref-chip-label">{arg.split(/[\\/]/).pop() || arg}</span>
        </span>
      ) : (
        <span className="arg">{arg || summary.name}</span>
      )}
      {elapsed ? <span className="ms">{elapsed}</span> : null}
      <span className="ok" aria-hidden="true">
        {summary.ok ? <IconCheck /> : <IconClose />}
      </span>
      {hasDetail ? (
        <span className="ev-chev" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      ) : null}
    </>
  );

  // 无可展开内容的行保持纯展示（例如空结果的元工具调用）。
  if (!hasDetail) {
    return <div className={`ui-ev k-${kind}${summary.ok ? "" : " err"}`}>{head}</div>;
  }

  return (
    <div className={`ui-ev k-${kind}${summary.ok ? "" : " err"}${open ? " ev-open" : ""}`}>
      <button type="button" className="ui-ev-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {head}
      </button>
      {open ? (
        <div className="ev-body">
          {params && toolClass !== "bash" ? <pre className="ev-params">{params}</pre> : null}
          <ToolResultView summary={summary} resultMd={result} />
        </div>
      ) : null}
    </div>
  );
}
