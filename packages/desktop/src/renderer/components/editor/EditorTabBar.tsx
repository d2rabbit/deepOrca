import type { JSX } from "react";
import { useI18n } from "../../i18n";

type Props = {
  /** Open files in workspace order. */
  files: string[];
  activeFile: string | null;
  /** Files whose draft differs from the on-disk baseline. */
  dirtyFiles: ReadonlySet<string>;
  onSelect: (file: string) => void;
  /** Always routed through the parent — the dirty-close guard lives there. */
  onCloseRequest: (file: string) => void;
};

/**
 * Sub-tab strip INSIDE the editor workspace (B-line E2): one tab per open
 * file, VSCode-style. The top bar keeps a single editor chip (App E1) — file
 * tabs never reach the top-level tab model. Pure display: closing always asks
 * the parent, which owns the per-file dirty guard.
 */
export function EditorTabBar({ files, activeFile, dirtyFiles, onSelect, onCloseRequest }: Props): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ui-edtabs" role="tablist" aria-label={t("rail.editor")}>
      {files.map((file) => {
        const name = file.split(/[\\/]/).pop() ?? file;
        const active = file === activeFile;
        const dirty = dirtyFiles.has(file);
        return (
          <div
            key={file}
            className={`ui-edtab${active ? " active" : ""}`}
            role="tab"
            aria-selected={active}
            title={file}
          >
            <button type="button" className="ui-edtab-main" onClick={() => onSelect(file)}>
              <span className="ui-edtab-name">{name}</span>
              {dirty ? (
                <span className="ui-edtab-dirty" title={t("editor.dirty")} aria-label={t("editor.dirty")} />
              ) : null}
            </button>
            <button
              type="button"
              className="ui-edtab-close"
              onClick={() => onCloseRequest(file)}
              aria-label={t("tasktree.closeTab")}
              title={t("tasktree.closeTab")}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
