import { useCallback, useEffect, useRef, useState, type JSX, type RefObject } from "react";
import type { editor } from "monaco-editor";
import { useI18n } from "../../i18n";

type DiagRow = {
  severity: number;
  message: string;
  line: number;
  column: number;
};

type Props = {
  filePath: string | null;
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>;
};

/**
 * 编辑器诊断抽屉（B-line E4，user ask 2026-09-04）：底部可折叠条，列出当前
 * 文件的 Monaco markers（ts.worker 已产：类型/语法级）。点击行跳转到对应
 * 行列。C 线（lsp-diagnostics）P1 会把桥的 get_diagnostics 回灌进同一抽屉。
 * Monaco 命名空间经动态 import 获取（与 monaco-loader 同模式）。
 */
export function EditorDiagnosticsDrawer({ filePath, editorRef }: Props): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DiagRow[]>([]);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let off: (() => void) | null = null;
    void (async () => {
      try {
        const mod = await import("monaco-editor");
        const monaco = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
        if (cancelled) return;
        const refresh = (): void => {
          const ed = editorRef.current;
          if (!ed) return;
          const model = ed.getModel();
          if (!model) {
            setRows([]);
            return;
          }
          const markers = monaco.editor.getModelMarkers({ resource: model.uri }) as Array<{
            severity: number;
            message: string;
            startLineNumber: number;
            startColumn: number;
          }>;
          setRows(
            markers
              .filter((m) => m.severity >= 2 && m.message) // error/warn/info，去 hint
              .sort((a, b) => b.severity - a.severity || a.startLineNumber - b.startLineNumber)
              .map((m) => ({
                severity: m.severity,
                message: m.message,
                line: m.startLineNumber,
                column: m.startColumn,
              }))
          );
        };
        refreshRef.current = refresh;
        const d = monaco.editor.onDidChangeMarkers(() => refresh());
        off = () => d.dispose();
        refresh();
      } catch {
        // Monaco 未就绪/加载失败：抽屉保持空态，不阻塞编辑器。
      }
    })();
    return () => {
      cancelled = true;
      off?.();
      refreshRef.current = () => {};
    };
  }, [editorRef, filePath]);

  const errors = rows.filter((r) => r.severity >= 8).length;
  const warnings = rows.filter((r) => r.severity === 4).length;

  const jumpTo = useCallback(
    (row: DiagRow): void => {
      const ed = editorRef.current;
      if (!ed) return;
      ed.revealLineInCenter(row.line);
      ed.setPosition({ lineNumber: row.line, column: row.column });
      ed.focus();
    },
    [editorRef]
  );

  return (
    <div className="ui-diag">
      <button
        type="button"
        className={`ui-diag-chip${open ? " open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={t("editor.diagnostics.title")}
      >
        <span aria-hidden>⚡</span>
        {t("editor.diagnostics.title")}
        {errors > 0 ? <span className="ui-diag-count err">{errors}</span> : null}
        {warnings > 0 ? <span className="ui-diag-count warn">{warnings}</span> : null}
        <span className="chev" aria-hidden>
          {open ? "▾" : "▴"}
        </span>
      </button>
      {open ? (
        <div className="ui-diag-drawer" role="list">
          {rows.length === 0 ? (
            <div className="ui-diag-empty">{t("editor.diagnostics.empty")}</div>
          ) : (
            rows.map((row, i) => (
              <button key={i} type="button" className="ui-diag-row" role="listitem" onClick={() => jumpTo(row)}>
                <span className={`sev s${row.severity}`} aria-hidden />
                <span className="msg">{row.message}</span>
                <span className="pos">
                  L{row.line}:{row.column}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
