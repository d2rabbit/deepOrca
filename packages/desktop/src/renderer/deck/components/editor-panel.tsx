// Editor overlay (E3): file tree on the left, plain-text editor on the right.
// Reads/writes go through the same editor IPC as the classic layer
// (editorReadFile / editorWriteFile); ⌘S or the save button writes back.
// Binary files are refused honestly instead of corrupting them.
import { useCallback, useEffect, useState, type JSX } from "react";
import { api } from "../../api";
import type { EditorFileEntry } from "../../../shared/ipc";
import { useI18n } from "../../i18n";
import { FileNode } from "./workspace-panels";

type EditorState =
  | { status: "empty" }
  | { status: "loading"; path: string }
  | { status: "error"; path: string; message: string }
  | { status: "binary"; path: string }
  | { status: "ready"; path: string; draft: string; saved: string };

export function EditorPanel(props: { initialPath?: string | null }): JSX.Element {
  const { t } = useI18n();
  const [root, setRoot] = useState<EditorFileEntry[] | null>(null);
  const [state, setState] = useState<EditorState>({ status: "empty" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .editorListFiles(".")
      .then((result) => setRoot(Array.isArray(result.entries) ? result.entries : []))
      .catch(() => setRoot([]));
  }, []);

  const open = useCallback(
    (path: string) => {
      setState({ status: "loading", path });
      void api
        .editorReadFile(path)
        .then((result) => {
          if (!result.ok || result.content === undefined) {
            setState({ status: "error", path, message: result.error ?? t("deck.editor.loadError") });
          } else if (result.binary) {
            setState({ status: "binary", path });
          } else {
            setState({ status: "ready", path, draft: result.content, saved: result.content });
          }
        })
        .catch(() => setState({ status: "error", path, message: t("deck.editor.loadError") }));
    },
    [t]
  );

  // Deep link from the files drawer: load the requested file once.
  useEffect(() => {
    if (props.initialPath && state.status === "empty") open(props.initialPath);
  }, [props.initialPath, state.status, open]);

  const save = useCallback(() => {
    if (state.status !== "ready" || state.draft === state.saved || saving) return;
    setSaving(true);
    void api
      .editorWriteFile(state.path, state.draft)
      .then((result) => {
        if (result.ok) setState((prev) => (prev.status === "ready" ? { ...prev, saved: prev.draft } : prev));
      })
      .finally(() => setSaving(false));
  }, [state, saving]);

  const dirty = state.status === "ready" && state.draft !== state.saved;

  return (
    <div className="deck-editor">
      <div className="deck-editor-tree">
        {root === null ? (
          <div className="deck-empty">{t("deck.loading")}</div>
        ) : (
          root.map((entry) => <FileNode key={entry.path} entry={entry} depth={0} onOpen={open} />)
        )}
      </div>
      <div className="deck-editor-main">
        <div className="deck-editor-bar">
          <span className="deck-editor-path">{state.status === "empty" ? t("deck.editor.pick") : state.path}</span>
          {state.status === "ready" ? (
            <>
              <span className={`deck-editor-state${dirty ? " dirty" : ""}`}>
                {dirty ? t("deck.editor.dirty") : t("deck.editor.saved")}
              </span>
              <button
                type="button"
                className="deck-op primary"
                disabled={!dirty || saving}
                onClick={save}
                data-test-id="deck-editor-save"
              >
                {t("deck.editor.save")}
              </button>
            </>
          ) : null}
        </div>
        {state.status === "ready" ? (
          <textarea
            className="deck-editor-text"
            spellCheck={false}
            value={state.draft}
            onChange={(e) => setState({ ...state, draft: e.target.value })}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                save();
              }
            }}
          />
        ) : (
          <div className="deck-editor-note">
            {state.status === "loading"
              ? t("deck.loading")
              : state.status === "binary"
                ? t("deck.editor.binary")
                : state.status === "error"
                  ? state.message
                  : t("deck.editor.pick")}
          </div>
        )}
      </div>
    </div>
  );
}
