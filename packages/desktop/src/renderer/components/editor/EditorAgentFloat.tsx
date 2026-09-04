import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type RefObject } from "react";
import type { editor } from "monaco-editor";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { A2uiSurface } from "../../a2ui/A2uiSurface";
import { extractSurfaceId, getSurfaceModel } from "../../a2ui/processor";
import { languageForFile } from "./monaco-loader";

/** JSON.stringify replacer: drop circular values instead of throwing. */
const safeReplacer = (_key: string, value: unknown): unknown =>
  typeof value === "object" && value !== null ? value : value;

export type Selection = { text: string; startLine: number; endLine: number };

/** One file's agent conversation (B-line E3: threads are keyed by path so
 *  sub-tab switches keep each file's exchange alive). */
type AgentThread = {
  open: boolean;
  input: string;
  busy: boolean;
  error: string | null;
  result: { content: string; code: string | null } | null;
  surface: { id: string; json: string } | null;
  /** Range recorded at submit time — apply lands here even if the cursor moved. */
  appliedRange: { startLine: number; endLine: number } | null;
  turns: Array<{ role: "user" | "entity"; text: string }>;
};

const EMPTY_THREAD: AgentThread = {
  open: false,
  input: "",
  busy: false,
  error: null,
  result: null,
  surface: null,
  appliedRange: null,
  turns: [],
};

type Props = {
  filePath: string;
  selection: Selection | null;
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>;
  /** 「到会话」旁路：选区指令注入主会话流式执行（交互保持不变）。 */
  onAskAgent?: (prompt: string) => void;
};

/**
 * 选区数字体浮窗（specs/editor-agent S2–S4）。主路径走专职 editor-agent
 * 后台实体（sessionless 零残留，editor:agentRun IPC）；结果就地渲染：
 * 带替换代码块时行级 diff + 「应用到选区」经 Monaco executeEdits 落回
 * （⌘S 才写盘）；含 ```a2ui 围栏时渲染 A2UI 反问 Surface，submit 读回
 * data model 作 follow-up 续跑。
 */
export function EditorAgentFloat({ filePath, selection, editorRef, onAskAgent }: Props): JSX.Element | null {
  const { t } = useI18n();
  const [threads, setThreads] = useState<Map<string, AgentThread>>(() => new Map());
  const thread = threads.get(filePath) ?? EMPTY_THREAD;

  const patchThread = useCallback(
    (file: string, patch: Partial<AgentThread> | ((prev: AgentThread) => Partial<AgentThread>)): void => {
      setThreads((current) => {
        const prev = current.get(file) ?? EMPTY_THREAD;
        const delta = typeof patch === "function" ? patch(prev) : patch;
        const next = new Map(current);
        next.set(file, { ...prev, ...delta });
        return next;
      });
    },
    []
  );

  /** 第一个非 a2ui 的 fenced 代码块 = 数字体给出的选区替换内容。 */
  const extractCode = useCallback((text: string): string | null => {
    const fences = [...text.matchAll(/```([a-zA-Z0-9]*)\n([\s\S]*?)```/g)];
    const hit = fences.find((f) => (f[1] ?? "") !== "a2ui");
    return hit ? (hit[2] ?? "").replace(/\n$/, "") : null;
  }, []);

  /** ```a2ui 围栏 = 数字体反问 Surface（v0.9 批次 JSON）。 */
  const extractA2ui = useCallback((text: string): string | null => {
    const m = text.match(/```a2ui\n([\s\S]*?)```/);
    return m ? (m[1] ?? "").trim() : null;
  }, []);

  /** S4：行级 diff（旧选区 vs 替换代码）——自写 LCS，避免引依赖。 */
  const diffLines = useCallback(
    (oldText: string, newText: string): Array<{ kind: "add" | "del" | "ctx"; text: string }> => {
      const a = oldText.replace(/\n$/, "").split("\n");
      const b = newText.replace(/\n$/, "").split("\n");
      const m = a.length;
      const n = b.length;
      // LCS 长度表（O(m·n)；选区体量小，可接受）。
      const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
      for (let i = m - 1; i >= 0; i -= 1) {
        for (let j = n - 1; j >= 0; j -= 1) {
          dp[i]![j] = a[i] === b[j] ? (dp[i + 1]![j + 1] ?? 0) + 1 : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
        }
      }
      const out: Array<{ kind: "add" | "del" | "ctx"; text: string }> = [];
      let i = 0;
      let j = 0;
      while (i < m && j < n) {
        if (a[i] === b[j]) {
          out.push({ kind: "ctx", text: a[i]! });
          i += 1;
          j += 1;
        } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
          out.push({ kind: "del", text: a[i]! });
          i += 1;
        } else {
          out.push({ kind: "add", text: b[j]! });
          j += 1;
        }
      }
      while (i < m) {
        out.push({ kind: "del", text: a[i]! });
        i += 1;
      }
      while (j < n) {
        out.push({ kind: "add", text: b[j]! });
        j += 1;
      }
      return out;
    },
    []
  );

  const runAgent = useCallback(
    async (instruction: string, history?: string): Promise<void> => {
      if (!selection || thread.busy) return;
      patchThread(filePath, {
        busy: true,
        error: null,
        result: null,
        surface: null,
        // 记录提交时的范围：结果返回前用户若移动了光标/选区，应用仍落在
        // 当初请求的位置。
        appliedRange: { startLine: selection.startLine, endLine: selection.endLine },
      });
      const prompt =
        history && history.trim()
          ? `${instruction}\n\n[clarification round — answers from the A2UI form]\n${history}`
          : instruction;
      try {
        const res = await api.editorAgentRun({
          filePath,
          startLine: selection.startLine,
          endLine: selection.endLine,
          selection: selection.text,
          instruction: prompt,
          lang: languageForFile(filePath),
        });
        if (!res.ok) {
          patchThread(filePath, { busy: false, error: res.error });
          return;
        }
        const content = res.content ?? "";
        const a2uiJson = extractA2ui(content);
        patchThread(filePath, { busy: false, result: { content, code: extractCode(content) } });
        if (a2uiJson) {
          patchThread(filePath, { surface: { id: extractSurfaceId(a2uiJson) ?? "", json: a2uiJson } });
        }
        patchThread(filePath, (prev) => ({
          turns: [...prev.turns, { role: "entity", text: content.slice(0, 1200) }],
        }));
      } catch (err) {
        patchThread(filePath, { busy: false, error: err instanceof Error ? err.message : String(err) });
      }
    },
    [selection, thread.busy, filePath, extractA2ui, extractCode, patchThread]
  );

  const submitAgent = useCallback(async (): Promise<void> => {
    const instruction = thread.input.trim();
    if (!instruction) return;
    patchThread(filePath, (prev) => ({ input: "", turns: [...prev.turns, { role: "user", text: instruction }] }));
    await runAgent(instruction);
  }, [thread.input, filePath, patchThread, runAgent]);

  /** S3 follow-up：A2UI 表单 submit → 读回 data model 答案 → 续跑。 */
  const handleSurfaceAction = useCallback(
    (surfaceId: string, actionName: string, _context: Record<string, unknown>): void => {
      if (actionName !== "submit") return;
      const model = getSurfaceModel(surfaceId);
      if (!model) return;
      const answers: Record<string, unknown> = {};
      for (const key of ["answer", "choice", "value", "text", "input"]) {
        const v = model.dataModel.get(key);
        if (v !== undefined && v !== "") answers[key] = v;
      }
      const history = JSON.stringify({ answers, model: model.dataModel }, safeReplacer, 2);
      patchThread(filePath, (prev) => ({
        turns: [...prev.turns, { role: "user", text: `[form answers] ${history}` }],
      }));
      void runAgent("Continue with the clarified answers from the A2UI form.", history);
    },
    [filePath, patchThread, runAgent]
  );

  /** 把数字体返回的替换代码经 executeEdits 落回原选区（undo 可撤销，
   *  落回后走正常 onChange → dirty → ⌘S 保存）。 */
  const applyAgentCode = useCallback((): void => {
    const ed = editorRef.current;
    if (!ed || !thread.result?.code || !selection) return;
    const model = ed.getModel();
    if (!model) return;
    const start = thread.appliedRange?.startLine ?? selection.startLine;
    const end = thread.appliedRange?.endLine ?? selection.endLine;
    ed.executeEdits("editor-agent", [
      {
        range: {
          startLineNumber: start,
          startColumn: 1,
          endLineNumber: end,
          endColumn: model.getLineMaxColumn(end),
        },
        text: thread.result.code,
      },
    ]);
    ed.focus();
    patchThread(filePath, { open: false, result: null });
  }, [editorRef, thread.result, thread.appliedRange, selection, filePath, patchThread]);

  // ── S4：diff 内联 ──────────────────────────────────────────────────────────
  const agentDiff = useMemo(() => {
    if (!thread.result?.code || !selection) return null;
    const lines = diffLines(selection.text, thread.result.code);
    const added = lines.filter((l) => l.kind === "add").length;
    const removed = lines.filter((l) => l.kind === "del").length;
    return { lines, added, removed };
  }, [thread.result, selection, diffLines]);

  // 提交范围在 Monaco 里挂 pending 装饰（淡底 + 左缘标记），应用或关闭
  // 浮窗即清除。装饰挂在创建时的 model 上 —— 切到别的子 tab 不会显示。
  const previewDecorationsRef = useRef<ReturnType<editor.IStandaloneCodeEditor["createDecorationsCollection"]> | null>(
    null
  );
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (!thread.result?.code || !thread.appliedRange) {
      previewDecorationsRef.current?.clear();
      previewDecorationsRef.current = null;
      return;
    }
    const start = thread.appliedRange.startLine;
    const end = thread.appliedRange.endLine;
    previewDecorationsRef.current?.clear();
    previewDecorationsRef.current = ed.createDecorationsCollection([
      {
        range: { startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: 1 },
        options: {
          isWholeLine: true,
          className: "edagent-pending-line",
          linesDecorationsClassName: "edagent-pending-mark",
        },
      },
    ]);
  }, [editorRef, thread.result, thread.appliedRange]);
  useEffect(
    () => () => {
      previewDecorationsRef.current?.clear();
    },
    []
  );

  if (!selection && !thread.open) return null;

  const submitToChat = (): void => {
    const instruction = thread.input.trim();
    if (!instruction || !selection || !onAskAgent) return;
    onAskAgent(
      `【编辑器选区指令】${filePath} L${selection.startLine}${
        selection.endLine !== selection.startLine ? `-L${selection.endLine}` : ""
      }\n\`\`\`\n${selection.text.slice(0, 4000)}\n\`\`\`\n${instruction}`
    );
    patchThread(filePath, { open: false });
  };

  return (
    <div className="ui-edagent">
      {thread.open ? (
        <div className="ui-edagent-panel">
          <div className="ui-edagent-head">
            <span>
              {t("editor.agent.title")} · {selection?.startLine ?? thread.appliedRange?.startLine ?? ""}
              {selection && selection.endLine !== selection.startLine ? `–${selection.endLine}` : ""}
            </span>
            <button
              type="button"
              className="ui-edagent-close"
              onClick={() => patchThread(filePath, { open: false })}
              aria-label={t("common.close")}
            >
              ✕
            </button>
          </div>
          <pre className="ui-edagent-sel">{selection ? selection.text.slice(0, 400) : ""}</pre>
          <textarea
            className="ui-edagent-input"
            value={thread.input}
            onChange={(e) => patchThread(filePath, { input: e.target.value })}
            placeholder={t("editor.agent.placeholder")}
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submitAgent();
              }
            }}
            autoFocus
          />
          {thread.busy ? (
            <div className="ui-edagent-running">
              <span className="ui-spinner" /> {t("editor.agent.running")}
            </div>
          ) : null}
          {thread.error ? <div className="ui-error">{thread.error}</div> : null}
          {/* S4：有替换代码时渲染行级 diff（±N 统计）而非裸文本 */}
          {thread.result && agentDiff ? (
            <div className="ui-edagent-result">
              <div className="ui-edagent-diffstat">
                <span className="add">+{agentDiff.added}</span>
                <span className="del">−{agentDiff.removed}</span>
              </div>
              <div className="ui-edagent-diff">
                {agentDiff.lines.map((l, i) => (
                  <div key={i} className={`dl ${l.kind}`}>
                    <span className="sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                    <span className="txt">{l.text}</span>
                  </div>
                ))}
              </div>
              <button type="button" className="btn" onClick={applyAgentCode}>
                {t("editor.agent.apply")}
              </button>
            </div>
          ) : thread.result ? (
            <div className="ui-edagent-result">
              <pre>{thread.result.content}</pre>
            </div>
          ) : null}
          {/* S3：数字体反问 Surface（A2UI v0.9 批次）；submit 读回 data model
              作 follow-up。 */}
          {thread.surface ? (
            <div className="ui-edagent-surface">
              <A2uiSurface
                messagesJson={thread.surface.json}
                surfaceId={thread.surface.id || undefined}
                onAction={handleSurfaceAction}
              />
            </div>
          ) : null}
          <div className="ui-edagent-actions">
            <span className="ui-edagent-hint">{t("editor.agent.hint")}</span>
            {onAskAgent ? (
              <button type="button" className="ui-edagent-tochat" onClick={submitToChat}>
                {t("editor.agent.toChat")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn"
              disabled={thread.busy || !thread.input.trim()}
              onClick={() => void submitAgent()}
            >
              {t("editor.agent.send")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="ui-edagent-fab"
          onClick={() => patchThread(filePath, { open: true })}
          title={t("editor.agent.ask")}
        >
          ◈ {t("editor.agent.ask")}
        </button>
      )}
    </div>
  );
}
