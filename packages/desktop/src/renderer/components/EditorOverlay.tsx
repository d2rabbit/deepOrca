import { useCallback, useEffect, useRef, useState, type ComponentType, type JSX } from "react";
import type { editor } from "monaco-editor";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton } from "../ui/index";

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
  // Use the locally bundled monaco-editor package instead of CDN.
  monacoLoader.config({ monaco: monacoEditor.default ?? monacoEditor });

  // Configure web workers for language features (TS IntelliSense, JSON, etc.).
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
};

/**
 * Monaco code editor. Loads a file via IPC, allows editing,
 * and saves back via IPC. Tracks dirty state and warns on unsaved changes.
 * Can render as a modal overlay or inline workspace panel.
 */
export function EditorOverlay({ filePath, onClose, appearance, inline }: Props): JSX.Element {
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
    const result = await api.editorReadFile(filePath);
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
    const result = await api.editorWriteFile(filePath, content);
    setSaving(false);
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

  const handleClose = useCallback(() => {
    if (dirty) {
      const ok = window.confirm(t("editor.dirty") + " — " + t("common.close") + "?");
      if (!ok) return;
    }
    onClose();
  }, [dirty, onClose, t]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") handleClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose, handleSave]);

  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const lang = languageForFile(filePath);

  const editorContent = (
    <>
      <div className="ui-editor-overlay-head">
        <span className="ui-editor-overlay-title" title={filePath}>
          {fileName}
          {dirty ? <span className="ui-editor-dirty-badge">{t("editor.dirty")}</span> : null}
        </span>
        <div className="ui-editor-overlay-actions">
          <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void handleSave()}>
            {saving ? t("editor.loading") : t("editor.save")}
          </Button>
          <IconButton onClick={handleClose} aria-label={t("common.close")} title={t("common.close")}>
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
    </>
  );

  if (inline) {
    return <div className="ui-editor-inline">{editorContent}</div>;
  }

  return (
    <div className="ui-editor-overlay" onClick={handleClose}>
      <div className="ui-editor-overlay-panel" onClick={(e) => e.stopPropagation()}>
        {editorContent}
      </div>
    </div>
  );
}
