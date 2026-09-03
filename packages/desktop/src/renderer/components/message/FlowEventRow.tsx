/**
 * flow — 行为流缩略行（designs/chat-redesign demo-flow §.flow/.ev，一比一）。
 * 一行式活动摘要：类型色图标 + 动宾 + MCP 徽章 + 目标 + 耗时 + 状态；
 * 连接线由容器 .ui-flow 的 .ui-ev::before 绘制。完整内部内容只出现在
 * 右侧活动小窗（ActivityRail 的 pipwin，同一消息的 result 投影）。
 */
import { useMemo, type JSX } from "react";
import type { SessionMessage } from "../../../shared/ipc";
import { buildToolSummary, formatToolParams } from "../../lib/messages";
import { useI18n } from "../../i18n";
import { IconCheck, IconClose } from "../../ui/index";
import { FLOW_VERB_KEY, formatElapsed, toolCls, toolIcon } from "./shared";

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
  const toolClass = toolCls(summary.name);
  const kind = EV_KIND[toolClass] ?? "doc";
  const isMcp = toolClass === "mcp";
  const elapsed =
    message.createTime && message.updateTime && message.createTime !== message.updateTime
      ? formatElapsed(message.createTime, message.updateTime)
      : "";

  return (
    <div className={`ui-ev k-${kind}${summary.ok ? "" : " err"}`}>
      <span className="ic" aria-hidden="true">
        {toolIcon(summary.name)}
      </span>
      <span className="verb">{t(FLOW_VERB_KEY[toolClass] ?? "msg.flow.other")}</span>
      {isMcp ? <span className="badge">MCP</span> : null}
      <span className="arg">{arg || summary.name}</span>
      {elapsed ? <span className="ms">{elapsed}</span> : null}
      <span className="ok" aria-hidden="true">
        {summary.ok ? <IconCheck /> : <IconClose />}
      </span>
    </div>
  );
}
