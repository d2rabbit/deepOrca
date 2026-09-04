import { useCallback, useEffect, useRef, useState, type ComponentType, type JSX } from "react";
import type { editor } from "monaco-editor";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { Button, FileIcon, IconButton } from "../../ui/index";
import type { EditorWorkspaceStore } from "../../hooks/use-editor-workspace";
import { ensureMonacoLoaded, languageForFile } from "./monaco-loader";
import { EditorTabBar } from "./EditorTabBar";
import { EditorAgentFloat, type Selection } from "./EditorAgentFloat";

type Props = {
  store: EditorWorkspaceStore;
  /** Current appearance for Monaco theme. */
  appearance: "light" | "dark";
  /** Guarded in App (dirty confirm) — the workspace only requests. */
  onRequestCloseFile: (file: string) => void;
  onContentChange: (file: string, content: string) => void;
  onSaved: (file: string, content: string) => void;
  /** 「到会话」旁路（选区指令注入主会话流式执行）。 */
  onAskAgent?: (prompt: string) => void;
};

/**
 * Editor workspace (B-line E3): the sheet behind the ONE top-bar editor chip.
 * Many files open as sub-tabs (EditorTabBar); ONE Monaco instance serves them
 * all — the `path` prop swaps models per file and the library keeps per-path
 * view state, so undo stacks, scroll and cursor survive sub-tab switches.
 * React-side state (drafts/dirty per file) lives in the workspace store hook.
 * The selection agent float (EditorAgentFloat) keeps per-file threads here.
 */
export function EditorWorkspace({
  store,
  appearance,
  onRequestCloseFile,
  onContentChange,
  onSaved,
  onAskAgent,
}: Props): JSX.Element {
  const { t } = useI18n();
  const { openFiles, activeFile, drafts, fileStates } = store;
  const [monacoReady, setMonacoReady] = useState(false);
  const MonacoEditorRef = useRef<ComponentType<Record<string, unknown>> | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  // Monaco dynamic load — defers ~5MB of code until the editor is opened.
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

  // Selection tracking for the agent float; reset on file switch so the float
  // never sees a selection belonging to the previous file's model.
  useEffect(() => {
    setSelection(null);
  }, [activeFile]);
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !monacoReady) return;
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

  const state = activeFile ? fileStates.get(activeFile) : undefined;
  const draft = activeFile ? drafts.get(activeFile) : undefined;
  const dirty = Boolean(activeFile && state?.loaded && draft !== state?.saved);
  const fileName = activeFile ? (activeFile.split(/[\\/]/).pop() ?? activeFile) : "";

  const handleSave = useCallback(async (): Promise<void> => {
    const file = activeFile;
    const content = file ? drafts.get(file) : undefined;
    if (!file || content === undefined || saving) return;
    setSaving(true);
    setSaveError(null);
    let result: Awaited<ReturnType<typeof api.editorWriteFile>>;
    try {
      result = await api.editorWriteFile(file, content);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      setSaving(false);
    }
    if (!result.ok) {
      setSaveError(result.error ?? t("editor.writeError"));
      return;
    }
    onSaved(file, content);
  }, [activeFile, drafts, saving, t, onSaved]);

  // ⌘S saves the active file; Esc asks App to close it (App owns the dirty
  // guard). Monaco owns Esc while focus is inside the editor — same rule as
  // the old overlay: never yank the file from under a completion popup.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
        return;
      }
      if (e.key === "Escape" && activeFile) {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.(".monaco-editor")) return;
        onRequestCloseFile(activeFile);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave, activeFile, onRequestCloseFile]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (activeFile) onContentChange(activeFile, value ?? "");
    },
    [activeFile, onContentChange]
  );

  return (
    <div className="ui-editor-workspace">
      <EditorTabBar
        files={openFiles}
        activeFile={activeFile}
        dirtyFiles={store.dirtyFilesSet}
        onSelect={store.setActiveFile}
        onCloseRequest={onRequestCloseFile}
      />
      <div className="ui-editor-overlay-head">
        <span className="ui-editor-overlay-title" title={activeFile ?? undefined}>
          {activeFile ? <FileIcon name={fileName} /> : null}
          {fileName}
          {dirty ? <span className="ui-editor-dirty-badge">{t("editor.dirty")}</span> : null}
        </span>
        <div className="ui-editor-overlay-actions">
          <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void handleSave()}>
            {saving ? t("editor.saving") : t("editor.save")}
          </Button>
          {activeFile ? (
            <IconButton
              onClick={() => onRequestCloseFile(activeFile)}
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              ✕
            </IconButton>
          ) : null}
        </div>
      </div>
      <div className="ui-editor-overlay-body">
        {!activeFile || !state ? (
          <div className="ui-editor-empty">{t("editor.empty")}</div>
        ) : state.loading ? (
          <div className="ui-editor-empty">
            <span className="ui-spinner" /> {t("editor.loading")}
          </div>
        ) : state.error ? (
          <div className="ui-editor-empty ui-editor-error">{state.error}</div>
        ) : state.binary ? (
          <div className="ui-editor-empty">{t("editor.binary")}</div>
        ) : draft === undefined ? (
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
                path={activeFile}
                language={languageForFile(activeFile)}
                value={draft}
                theme={appearance === "dark" ? "vs-dark" : "vs"}
                keepCurrentModel={true}
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
      {saveError ? <div className="ui-error ui-editor-save-error">{saveError}</div> : null}
      {activeFile && state?.loaded ? (
        <EditorAgentFloat filePath={activeFile} selection={selection} editorRef={editorRef} onAskAgent={onAskAgent} />
      ) : null}
    </div>
  );
}
