import { useCallback, useEffect, useState, type JSX } from "react";
import type { EditorFileEntry } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { FileIcon, IconButton, IconFile, IconFolder } from "../ui/index";

type Props = {
  /** Called when the user picks a file to open in the editor. */
  onOpenFile: (filePath: string) => void;
};

/** Simple file-tree browser for the editor side panel. */
export function EditorPanel({ onOpenFile }: Props): JSX.Element {
  const { t } = useI18n();
  const [entries, setEntries] = useState<EditorFileEntry[]>([]);
  const [currentDir, setCurrentDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const loadDir = useCallback(
    async (dir: string) => {
      setLoading(true);
      setError(null);
      const result = await api.editorListFiles(dir);
      setLoading(false);
      if (!result.ok) {
        setError(result.error ?? t("editor.readError"));
        return;
      }
      setEntries(result.entries ?? []);
      setCurrentDir(dir);
    },
    [t]
  );

  useEffect(() => {
    void loadDir("");
  }, [loadDir]);

  const navigateUp = useCallback(() => {
    if (!currentDir) return;
    const parent = currentDir.split(/[\\/]/).slice(0, -1).join("/");
    void loadDir(parent);
  }, [currentDir, loadDir]);

  const handleEntryClick = useCallback(
    (entry: EditorFileEntry) => {
      if (entry.type === "directory") {
        void loadDir(entry.path);
      } else {
        setSelectedFile(entry.path);
        onOpenFile(entry.path);
      }
    },
    [loadDir, onOpenFile]
  );

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("editor.fileTree")}</span>
        <IconButton onClick={() => void loadDir(currentDir)} title={t("scm.refresh")} aria-label={t("scm.refresh")}>
          ⟳
        </IconButton>
      </div>
      <div className="ui-side-panel-body">
        {currentDir ? (
          <div className="ui-editor-breadcrumb">
            <button className="ui-editor-breadcrumb-btn" onClick={navigateUp}>
              ← ..
            </button>
            <span className="ui-editor-breadcrumb-path">{currentDir}</span>
          </div>
        ) : null}
        {loading ? (
          <div className="ui-side-panel-empty">
            <span className="ui-spinner" /> {t("editor.loading")}
          </div>
        ) : error ? (
          <div className="ui-side-panel-empty ui-editor-error">{error}</div>
        ) : entries.length === 0 ? (
          <div className="ui-side-panel-empty">{t("editor.noFiles")}</div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.path}
              className={`ui-editor-file-entry${entry.type === "directory" ? " is-dir" : ""}${selectedFile === entry.path ? " is-selected" : ""}`}
              onClick={() => handleEntryClick(entry)}
            >
              <span className={`ui-editor-file-icon${entry.type === "directory" ? " is-dir" : ""}`}>
                {entry.type === "directory" ? <IconFolder /> : <FileIcon name={entry.name} fallback={<IconFile />} />}
              </span>
              <span className="ui-editor-file-name" title={entry.path}>
                {entry.name}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
