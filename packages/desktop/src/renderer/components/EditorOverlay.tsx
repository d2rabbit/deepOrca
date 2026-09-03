import { useCallback, useEffect, useRef, useState, type ComponentType, type JSX } from "react";
import type { editor } from "monaco-editor";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, FileIcon, IconButton, Modal } from "../ui/index";

// Monaco is dynamically imported inside the component so its ~5MB of code
// only loads when the user actually opens the editor. Combined with
// React.lazy() in App.tsx and esbuild splitting, Monaco is fully deferred.
// The loader is configured once (on first mount) to use the local npm
// package instead of a CDN — eliminating the network dependency.

/**
 * Load this chunk's CSS. esbuild splits lazily-imported chunk CSS into a
 * sibling file but never injects it at runtime — Monaco's layout rules
 * (including the one that hides the IME textarea, which otherwise shows up
 * as a white UA-styled box) live in that file. build.mjs republishes each
 * chunk's CSS under a stable hash-free name so it can be linked here.
 */
function ensureEditorChunkCss(): void {
  const href = "./chunks/EditorOverlay.css";
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

let monacoInitialized = false;
async function ensureMonacoLoaded(): Promise<void> {
  if (monacoInitialized) return;
  monacoInitialized = true;
  ensureEditorChunkCss();
  const [{ loader: monacoLoader }, monacoEditor] = await Promise.all([
    import("@monaco-editor/react"),
    import("monaco-editor"),
  ]);
  const monaco = monacoEditor.default ?? monacoEditor;
  // Use the locally bundled monaco-editor package instead of CDN.
  monacoLoader.config({ monaco });

  // TS/JSX language service (user ask 2026-09-03 十三轮 B3c-2): without
  // compiler options the ts.worker treats tsx as plain ts and flags JSX —
  // configure the project the way this repo actually compiles + eager model
  // sync so diagnostics/completions cover every open file. The monaco type
  // stub marks languages.typescript deprecated (narrowed to {deprecated}),
  // so the runtime object goes through a structural cast.
  type TsLang = {
    typescriptDefaults: {
      setCompilerOptions(o: Record<string, unknown>): void;
      setEagerModelSync(v: boolean): void;
    };
    javascriptDefaults: { setCompilerOptions(o: Record<string, unknown>): void };
    ScriptTarget: Record<string, number>;
    ModuleKind: Record<string, number>;
    ModuleResolutionKind: Record<string, number>;
    JsxEmit: Record<string, number>;
  };
  const ts = (monaco.languages as unknown as { typescript: TsLang }).typescript;
  const tsDefaults = ts.typescriptDefaults;
  tsDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.React,
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: false,
    esModuleInterop: true,
    skipLibCheck: true,
  });
  tsDefaults.setEagerModelSync(true);
  ts.javascriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: false,
    esModuleInterop: true,
  });

  // Web Workers for language features (TS IntelliSense, JSON, etc.).
  // Workers are loaded from the bundled monaco-editor package via import.meta.url.
  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      switch (label) {
        case "json":
          return new Worker(new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url), {
            type: "module",
          });
        case "css":
        case "scss":
        case "less":
          return new Worker(new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url), {
            type: "module",
          });
        case "html":
        case "handlebars":
        case "razor":
          return new Worker(new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url), {
            type: "module",
          });
        case "typescript":
        case "javascript":
          return new Worker(new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url), {
            type: "module",
          });
        default:
          return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), {
            type: "module",
          });
      }
    },
  };
}

/** Map a file path to a Monaco language id. */
function languageForFile(file: string): string {
  const ext = (file.split(".").pop() ?? "").toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    mts: "typescript",
    cts: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    htm: "html",
    xml: "xml",
    svg: "xml",
    vue: "html",
    md: "markdown",
    markdown: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cc: "cpp",
    cpp: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    ini: "ini",
    sql: "sql",
    lua: "lua",
    r: "r",
    pl: "perl",
    mk: "makefile",
    dockerfile: "dockerfile",
    graphql: "graphql",
    gql: "graphql",
  };
  return map[ext] ?? "plaintext";
}

type Props = {
  /** Absolute path of the file to edit. */
  filePath: string;
  /** Called when the user closes the overlay. */
  onClose: () => void;
  /** Current appearance for Monaco theme. */
  appearance: "light" | "dark";
  /** When true, render inline (workspace mode) instead of modal overlay. */
  inline?: boolean;
  /** 选区 agent 交互（user ask 2026-09-03 十三轮 B3c-3 第一切片）：选中代码
   *  后浮出指令窗，发布的问题/指令带上文件:行号与选区代码注入主会话流式
   *  执行。专职 editor-agent 子代理见 specs/editor-agent/design.md。 */
  onAskAgent?: (prompt: string) => void;
};

/**
 * Monaco code editor. Loads a file via IPC, allows editing,
 * and saves back via IPC. Tracks dirty state and warns on unsaved changes.
 * Can render as a modal overlay or inline workspace panel.
 */
export function EditorOverlay({ filePath, onClose, appearance, inline, onAskAgent }: Props): JSX.Element {
  const { t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const originalContentRef = useRef<string>("");
  /**
   * Guards against the file-load race: open A, then quickly open B. Both reads
   * run concurrently; if A's response arrives last it would install A's content
   * while filePath is B, and pressing Save would write A's content to B. Each
   * load increments this counter and commits its result only when it is still
   * the latest. Also tracks which path the loaded content came from so Save
   * refuses to write stale content to a different path.
   */
  const loadReqIdRef = useRef(0);
  const loadedPathRef = useRef<string | null>(null);

  const loadFile = useCallback(async () => {
    const myReqId = ++loadReqIdRef.current;
    loadedPathRef.current = null;
    setLoading(true);
    setError(null);
    setBinary(false);
    setDirty(false);
    let result: Awaited<ReturnType<typeof api.editorReadFile>>;
    try {
      result = await api.editorReadFile(filePath);
    } catch (error) {
      // IPC rejection left loading=true forever — the spinner would never stop.
      if (myReqId !== loadReqIdRef.current) return;
      setLoading(false);
      setError(error instanceof Error ? error.message : String(error));
      return;
    }
    // A newer load for a different filePath started — discard this stale result.
    if (myReqId !== loadReqIdRef.current) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? t("editor.readError"));
      return;
    }
    if (result.binary) {
      setBinary(true);
      return;
    }
    const text = result.content ?? "";
    setContent(text);
    originalContentRef.current = text;
    loadedPathRef.current = filePath;
  }, [filePath, t]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  const handleSave = useCallback(async () => {
    if (content === null || saving) return;
    // Refuse to save if the loaded content belongs to a different path than
    // the one currently open (e.g. a file switch raced in). Writing here would
    // save the previous file's content to the current path.
    if (loadedPathRef.current !== filePath) {
      setError(t("editor.readError"));
      return;
    }
    setSaving(true);
    let result: Awaited<ReturnType<typeof api.editorWriteFile>>;
    try {
      result = await api.editorWriteFile(filePath, content);
    } catch (error) {
      // Rejection skipped setSaving(false) — the Save button stayed disabled.
      setError(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      setSaving(false);
    }
    if (!result.ok) {
      setError(result.error ?? t("editor.writeError"));
      return;
    }
    originalContentRef.current = content;
    // The saved content now matches disk for the current path.
    loadedPathRef.current = filePath;
    setDirty(false);
  }, [content, saving, filePath, t]);

  const [monacoReady, setMonacoReady] = useState(false);
  const MonacoEditorRef = useRef<ComponentType<Record<string, unknown>> | null>(null);

  // Dynamically load Monaco on mount — defers ~5MB of code until the editor
  // is actually opened.
  useEffect(() => {
    let cancelled = false;
    void ensureMonacoLoaded().then(async () => {
      if (cancelled) return;
      const mod = await import("@monaco-editor/react");
      if (cancelled) return;
      MonacoEditorRef.current = mod.default as ComponentType<Record<string, unknown>>;
      setMonacoReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = useCallback((value: string | undefined) => {
    const next = value ?? "";
    setContent(next);
    setDirty(next !== originalContentRef.current);
  }, []);

  // ── 选区数字体（B3c S2，specs/editor-agent）───────────────────────────────
  // 有非空选区时浮出「问数字体」；主路径走专职 editor-agent 后台实体
  // （sessionless 零残留），结果就地渲染：带替换代码块时「应用到选区」
  // 经 Monaco executeEdits 落回（⌘S 才写盘）；onAskAgent 保留为「到会话」
  // 旁路（注入主会话流式执行）。
  const [selection, setSelection] = useState<{ text: string; startLine: number; endLine: number } | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentInput, setAgentInput] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentResult, setAgentResult] = useState<{ content: string; code: string | null } | null>(null);
  const [agentSent, setAgentSent] = useState(false);
  const appliedRangeRef = useRef<{ startLine: number; endLine: number } | null>(null);
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const disposable = ed.onDidChangeCursorSelection(() => {
      const sel = ed.getSelection();
      const model = ed.getModel();
      if (!sel || !model || sel.isEmpty()) {
        setSelection(null);
        return;
      }
      setSelection({
        text: model.getValueInRange(sel),
        startLine: sel.startLineNumber,
        endLine: sel.endLineNumber,
      });
    });
    return () => disposable.dispose();
  }, [monacoReady]);

  /** 第一个 fenced 代码块 = 数字体给出的选区替换内容。 */
  const extractCode = useCallback((text: string): string | null => {
    const m = text.match(/```[a-zA-Z0-9]*\n([\s\S]*?)```/);
    return m ? (m[1] ?? "").replace(/\n$/, "") : null;
  }, []);

  const submitAgent = useCallback(async (): Promise<void> => {
    const instruction = agentInput.trim();
    if (!instruction || !selection || agentBusy) return;
    setAgentBusy(true);
    setAgentError(null);
    setAgentResult(null);
    // 记录提交时的范围：结果返回前用户若移动了光标/选区，应用仍落在
    // 当初请求的位置。
    appliedRangeRef.current = { startLine: selection.startLine, endLine: selection.endLine };
    try {
      const res = await api.editorAgentRun({
        filePath,
        startLine: selection.startLine,
        endLine: selection.endLine,
        selection: selection.text,
        instruction,
        lang: languageForFile(filePath),
      });
      if (!res.ok) {
        setAgentError(res.error);
        return;
      }
      setAgentResult({ content: res.content, code: extractCode(res.content) });
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : String(err));
    } finally {
      setAgentBusy(false);
    }
  }, [agentInput, selection, agentBusy, filePath, extractCode]);

  /** 把数字体返回的替换代码经 executeEdits 落回原选区（undo 可撤销，
   *  落回后走正常 onChange → dirty → ⌘S 保存）。 */
  const applyAgentCode = useCallback((): void => {
    const ed = editorRef.current;
    if (!ed || !agentResult?.code || !selection) return;
    const model = ed.getModel();
    if (!model) return;
    const start = appliedRangeRef.current?.startLine ?? selection.startLine;
    const end = appliedRangeRef.current?.endLine ?? selection.endLine;
    ed.executeEdits("editor-agent", [
      {
        range: {
          startLineNumber: start,
          startColumn: 1,
          endLineNumber: end,
          endColumn: model.getLineMaxColumn(end),
        },
        text: agentResult.code,
      },
    ]);
    ed.focus();
    setAgentOpen(false);
    setAgentResult(null);
  }, [agentResult, selection]);

  const [confirmClose, setConfirmClose] = useState(false);

  const requestClose = useCallback((): void => {
    // In-app confirm instead of window.confirm — the native dialog's
    // concatenated zh/en string read badly in every locale.
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }, [dirty, onClose]);

  const saveAndClose = useCallback(async (): Promise<void> => {
    if (content === null) {
      onClose();
      return;
    }
    if (loadedPathRef.current !== filePath) {
      setConfirmClose(false);
      return;
    }
    setSaving(true);
    try {
      const result = await api.editorWriteFile(filePath, content);
      if (result.ok) onClose();
      else {
        setConfirmClose(false);
        setError(result.error ?? t("editor.writeError"));
      }
    } catch (error) {
      setConfirmClose(false);
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [content, filePath, onClose, t]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        // The in-app confirm Modal owns Esc while it is open; and Monaco
        // owns Esc while focus is inside the editor (completion/hover
        // popups) — closing the file from under those was jarring.
        if (confirmClose) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest?.(".monaco-editor")) return;
        requestClose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmClose, handleSave, requestClose]);

  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const lang = languageForFile(filePath);

  const editorContent = (
    <>
      <div className="ui-editor-overlay-head">
        <span className="ui-editor-overlay-title" title={filePath}>
          <FileIcon name={fileName} />
          {fileName}
          {dirty ? <span className="ui-editor-dirty-badge">{t("editor.dirty")}</span> : null}
        </span>
        <div className="ui-editor-overlay-actions">
          <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void handleSave()}>
            {saving ? t("editor.saving") : t("editor.save")}
          </Button>
          <IconButton onClick={requestClose} aria-label={t("common.close")} title={t("common.close")}>
            ✕
          </IconButton>
        </div>
      </div>
      <div className="ui-editor-overlay-body">
        {loading ? (
          <div className="ui-editor-empty">
            <span className="ui-spinner" /> {t("editor.loading")}
          </div>
        ) : error ? (
          <div className="ui-editor-empty ui-editor-error">{error}</div>
        ) : binary ? (
          <div className="ui-editor-empty">{t("editor.binary")}</div>
        ) : content === null ? (
          <div className="ui-editor-empty">{t("editor.empty")}</div>
        ) : !monacoReady || !MonacoEditorRef.current ? (
          <div className="ui-editor-empty">
            <span className="ui-spinner" /> {t("editor.loading")}
          </div>
        ) : (
          (() => {
            const MonacoEditor = MonacoEditorRef.current;
            return (
              <MonacoEditor
                height="100%"
                language={lang}
                value={content}
                theme={appearance === "dark" ? "vs-dark" : "vs"}
                onChange={handleChange}
                onMount={(ed: editor.IStandaloneCodeEditor) => {
                  editorRef.current = ed;
                  ed.focus();
                }}
                options={{
                  minimap: { enabled: true },
                  fontSize: 13,
                  wordWrap: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  insertSpaces: true,
                  renderWhitespace: "selection",
                  bracketPairColorization: { enabled: true },
                  guides: { bracketPairs: true, indentation: true },
                }}
                loading={
                  <div className="ui-editor-empty">
                    <span className="ui-spinner" /> {t("editor.loading")}
                  </div>
                }
              />
            );
          })()
        )}
      </div>
      {/* 选区浮窗（B3c-3 第一切片）：选区存在 → 右下浮出按钮 → 迷你指令窗 */}
      {selection && !loading && !error && !binary ? (
        <div className="ui-edagent">
          {agentOpen ? (
            <div className="ui-edagent-panel">
              <div className="ui-edagent-head">
                <span>
                  {t("editor.agent.title")} · {selection.startLine}
                  {selection.endLine !== selection.startLine ? `–${selection.endLine}` : ""}
                </span>
                <button
                  type="button"
                  className="ui-edagent-close"
                  onClick={() => setAgentOpen(false)}
                  aria-label={t("common.close")}
                >
                  ✕
                </button>
              </div>
              <pre className="ui-edagent-sel">{selection.text.slice(0, 400)}</pre>
              <textarea
                className="ui-edagent-input"
                value={agentInput}
                onChange={(e) => setAgentInput(e.target.value)}
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
              {agentBusy ? (
                <div className="ui-edagent-running">
                  <span className="ui-spinner" /> {t("editor.agent.running")}
                </div>
              ) : null}
              {agentError ? <div className="ui-error">{agentError}</div> : null}
              {agentResult ? (
                <div className="ui-edagent-result">
                  <pre>{agentResult.content}</pre>
                  {agentResult.code ? (
                    <button type="button" className="btn" onClick={applyAgentCode}>
                      {t("editor.agent.apply")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="ui-edagent-actions">
                <span className="ui-edagent-hint">{t("editor.agent.hint")}</span>
                {onAskAgent ? (
                  <button
                    type="button"
                    className="ui-edagent-tochat"
                    onClick={() => {
                      const instruction = agentInput.trim();
                      if (!instruction || !selection) return;
                      onAskAgent(
                        `【编辑器选区指令】${filePath} L${selection.startLine}${
                          selection.endLine !== selection.startLine ? `-L${selection.endLine}` : ""
                        }\n\`\`\`\n${selection.text.slice(0, 4000)}\n\`\`\`\n${instruction}`
                      );
                      setAgentSent(true);
                      setAgentOpen(false);
                      window.setTimeout(() => setAgentSent(false), 2000);
                    }}
                  >
                    {t("editor.agent.toChat")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn"
                  disabled={agentBusy || !agentInput.trim()}
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
              onClick={() => setAgentOpen(true)}
              title={t("editor.agent.ask")}
            >
              ◈ {t("editor.agent.ask")}
            </button>
          )}
          {agentSent ? <div className="ui-edagent-sent">{t("editor.agent.sent")}</div> : null}
        </div>
      ) : null}
      {confirmClose ? (
        <Modal
          title={t("editor.closeDirtyTitle")}
          subtitle={t("editor.closeDirtyBody")}
          onClose={() => setConfirmClose(false)}
          actions={
            <>
              <Button onClick={() => setConfirmClose(false)}>{t("common.cancel")}</Button>
              <Button onClick={onClose}>{t("editor.discardAndClose")}</Button>
              <Button variant="primary" disabled={saving} onClick={() => void saveAndClose()}>
                {saving ? t("editor.saving") : t("editor.saveAndClose")}
              </Button>
            </>
          }
        />
      ) : null}
    </>
  );

  if (inline) {
    return <div className="ui-editor-inline">{editorContent}</div>;
  }

  return (
    <div className="ui-editor-overlay" onClick={requestClose}>
      <div className="ui-editor-overlay-panel" onClick={(e) => e.stopPropagation()}>
        {editorContent}
      </div>
    </div>
  );
}
