import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton } from "../ui/index";

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

  const loadFile = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBinary(false);
    setDirty(false);
    const result = await api.editorReadFile(filePath);
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
  }, [filePath, t]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  const handleSave = useCallback(async () => {
    if (content === null || saving) return;
    setSaving(true);
    const result = await api.editorWriteFile(filePath, content);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("editor.writeError"));
      return;
    }
    originalContentRef.current = content;
    setDirty(false);
  }, [content, saving, filePath, t]);

  const handleEditorMount: OnMount = (ed) => {
    editorRef.current = ed;
    ed.focus();
  };

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
        ) : (
          <Editor
            height="100%"
            language={lang}
            value={content}
            theme={appearance === "dark" ? "vs-dark" : "vs"}
            onChange={handleChange}
            onMount={handleEditorMount}
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
