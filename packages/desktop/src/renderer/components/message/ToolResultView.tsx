/**
 * tool-result-view — 工具结果富渲染（user ask 2026-09-03 四轮）。
 * bash/cli → 终端帧（.ui-term）；read 的 .md/.html → 正文渲染；write/edit
 * → diff 预览红绿着色；纯 JSON → JsonView 交互树；其余 → markdown。
 * 会话流展开体（FlowEventRow .ev-body）与右侧活动小窗（ActivityRail
 * pipwin）共用 —— 文件类操作必须看到具体内容，不是一句 Updated file。
 */
import { type JSX } from "react";
import { getDiffLines, type ToolSummary } from "../../lib/messages";
import { useI18n } from "../../i18n";
import { JsonView } from "../JsonView";
import { Md } from "./shared";

/** Strip a single wrapping ``` fence the wrapPlainStructured pass may add. */
function stripCodeFence(text: string): string {
  return text
    .replace(/^```[a-zA-Z0-9]*\n/, "")
    .replace(/\n```\s*$/, "")
    .trim();
}

/** Strip the "     N\t" prefix core's Read handler prepends to every line. */
function stripReadLineNumbers(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+\t/, ""))
    .join("\n");
}

/**
 * Detect a result that is one pure JSON payload (single ```json fence or bare
 * JSON) — only composites qualify; bare scalars go the markdown path.
 */
function tryParseJsonResult(resultMd: string): unknown | undefined {
  const trimmed = resultMd.trim();
  const fenced = trimmed.match(/^```json\s*\n([\s\S]*?)\n?```$/);
  const body = (fenced ? fenced[1] : trimmed).trim();
  if (!body.startsWith("{") && !body.startsWith("[")) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed !== null && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** File extension from a file tool's params (path is the first token). */
function fileExtensionFromParams(toolName: string, params: string): string {
  if (!["read", "write", "edit"].includes(toolName)) return "";
  const cleaned = params.replace(/^['"`\s]+|['"`\s]+$/g, "").split(/\s+/)[0] ?? "";
  const match = cleaned.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1]!.toLowerCase() : "";
}

/** Terminal frame for bash/cli results (rendering-engine spec card #8). */
function BashTerminalFrame({ command, resultMd }: { command: string; resultMd: string }): JSX.Element {
  const { t } = useI18n();
  const output = stripCodeFence(resultMd);
  return (
    <div className="ui-term">
      <div className="ui-term-head">
        <span className="ui-term-dot red" aria-hidden="true" />
        <span className="ui-term-dot amber" aria-hidden="true" />
        <span className="ui-term-dot green" aria-hidden="true" />
        <span className="ui-term-title">{t("msg.bashTerminal")}</span>
      </div>
      <div className="ui-term-body">
        <div className="ui-term-cmd">
          <span className="ui-term-user">agent@deeporca</span>
          <span className="ui-term-punc">:</span>
          <span className="ui-term-path">~</span>
          <span className="ui-term-punc">$ </span>
          <span className="ui-term-input">{command}</span>
        </div>
        {output ? <div className="ui-term-out">{output}</div> : null}
      </div>
    </div>
  );
}

/**
 * Render a tool call's result by family. `summary` carries the tool name +
 * metadata (diff preview); `resultMd` is the markdown-shaped result
 * (getResultMd). Returns null when there is nothing to show.
 */
export function ToolResultView({ summary, resultMd }: { summary: ToolSummary; resultMd: string }): JSX.Element | null {
  const name = summary.name.toLowerCase();

  // bash/cli → terminal frame (command comes from the full params).
  if (name === "bash" || name === "cli") {
    if (!resultMd && !summary.params.trim()) return null;
    return <BashTerminalFrame command={summary.params.trim()} resultMd={resultMd} />;
  }

  // read of a document → render the file as it was meant to be read (line
  // numbers stripped); code files keep the numbered view via the md path.
  const ext = fileExtensionFromParams(name, summary.params);
  if (name === "read" && ["md", "markdown", "html", "htm"].includes(ext) && resultMd) {
    return <Md text={stripReadLineNumbers(resultMd)} streaming={false} />;
  }

  // write/edit → colored diff preview (metadata.diff_preview), the concrete
  // content the user asked to see — with the plain result note above it.
  // (No memo: summaries are immutable and getDiffLines is a cheap string
  // split — a conditional hook here would violate the rules of hooks.)
  const diff = getDiffLines(summary);
  if (diff.length > 0) {
    return (
      <>
        {resultMd && resultMd.length <= 200 ? <div className="ev-result-note">{resultMd}</div> : null}
        <div className="ui-diff">
          {diff.map((line, i) => (
            <div key={i} className={line.kind === "added" ? "add" : line.kind === "removed" ? "del" : "ctx"}>
              {line.content}
            </div>
          ))}
        </div>
      </>
    );
  }

  // Pure JSON payload → interactive tree/raw JsonView card.
  const json = resultMd ? tryParseJsonResult(resultMd) : undefined;
  if (json !== undefined) {
    return <JsonView data={json} />;
  }

  if (!resultMd) return null;
  return <Md text={resultMd} streaming={false} />;
}
