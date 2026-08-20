// Workspace-centric deck panels: files (lazy tree), changes (git stage /
// unstage / discard / commit), processes (live stdout tail). Functional
// layer (E2) — real data and primary actions, minimal visuals.
import { useEffect, useRef, useState, type JSX } from "react";
import { api } from "../../api";
import type { EditorFileEntry, GitStatus } from "../../../shared/ipc";
import { useI18n } from "../../i18n";
import type { DeckEngine } from "../hooks/use-deck-engine";

// ── 文件：工作区文件树（按层懒加载） ───────────────────────────────────────
function FileNode(props: { entry: EditorFileEntry; depth: number }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<EditorFileEntry[] | null>(null);
  const isDir = props.entry.type === "directory";

  const toggle = () => {
    if (!isDir) return;
    if (!expanded && children === null) {
      void api
        .editorListFiles(props.entry.path)
        .then((result) => setChildren(result.entries ?? []))
        .catch(() => setChildren([]));
    }
    setExpanded((v) => !v);
  };

  return (
    <div>
      <button type="button" className="deck-row" style={{ paddingLeft: 10 + props.depth * 16 }} onClick={toggle}>
        <span>{isDir ? (expanded ? "▾" : "▸") : "·"}</span>
        <span className="deck-row-main">{props.entry.name}</span>
        {!isDir ? <span className="deck-row-meta">{props.entry.size}B</span> : null}
      </button>
      {expanded && children
        ? children.map((child) => <FileNode key={child.path} entry={child} depth={props.depth + 1} />)
        : null}
    </div>
  );
}

export function FilesPanel(): JSX.Element {
  const { t } = useI18n();
  const [root, setRoot] = useState<EditorFileEntry[] | null>(null);

  useEffect(() => {
    void api
      .editorListFiles(".")
      .then((result) => setRoot(result.entries ?? []))
      .catch(() => setRoot([]));
  }, []);

  if (!root) return <div className="deck-empty">{t("deck.loading")}</div>;
  if (root.length === 0) return <div className="deck-empty">{t("deck.files.empty")}</div>;

  return (
    <div className="deck-panel">
      {root.map((entry) => (
        <FileNode key={entry.path} entry={entry} depth={0} />
      ))}
    </div>
  );
}

// ── 变更：暂存区/更改分区 + 逐文件操作 + 提交 ──────────────────────────────
export function ChangesPanel(): JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void api
      .gitStatus()
      .then(setStatus)
      .catch(() => {});
  };
  useEffect(refresh, []);

  if (!status) return <div className="deck-empty">{t("deck.loading")}</div>;
  if (!status.isRepo) return <div className="deck-empty">{t("deck.changes.noRepo")}</div>;

  const staged = status.files.filter((f) => f.staged);
  const unstaged = status.files.filter((f) => !f.staged);

  const op = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    void fn().then((result) => {
      setError(result.ok ? null : (result.error ?? null));
      refresh();
    });
  };

  const commit = () => {
    const text = message.trim();
    if (!text || staged.length === 0) return;
    setMessage("");
    op(() => api.gitCommit(text));
  };

  return (
    <div className="deck-panel">
      <div className="deck-panel-group-title">
        {status.branch} · {t("deck.changes.staged")} ({staged.length})
      </div>
      {staged.map((file) => (
        <div key={`s-${file.path}`} className="deck-row static">
          <span className="deck-row-main">{file.path}</span>
          <span className="deck-row-ops">
            <button type="button" className="deck-op" onClick={() => op(() => api.gitUnstage(file.path))}>
              {t("deck.changes.unstage")}
            </button>
          </span>
        </div>
      ))}
      <div className="deck-panel-group-title">
        {t("deck.changes.unstaged")} ({unstaged.length})
      </div>
      {unstaged.map((file) => (
        <div key={`u-${file.path}`} className="deck-row static">
          <span className="deck-row-main">{file.path}</span>
          <span className="deck-row-ops">
            <button type="button" className="deck-op" onClick={() => op(() => api.gitStage(file.path))}>
              {t("deck.changes.stage")}
            </button>
            <button type="button" className="deck-op danger" onClick={() => op(() => api.gitDiscard(file.path))}>
              {t("deck.changes.discard")}
            </button>
          </span>
        </div>
      ))}
      {staged.length === 0 && unstaged.length === 0 ? (
        <div className="deck-empty">{t("deck.changes.clean")}</div>
      ) : null}
      {error ? <div className="deck-error">{error}</div> : null}
      <div className="deck-commit">
        <input
          value={message}
          placeholder={t("deck.changes.commitPlaceholder")}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
        <button
          type="button"
          className="deck-op primary"
          disabled={!message.trim() || staged.length === 0}
          onClick={commit}
        >
          {t("deck.changes.commit")}
        </button>
      </div>
    </div>
  );
}

// ── 进程：当前会话的后台进程 + 实时 stdout 尾部 ────────────────────────────
export function ProcessesPanel(props: { engine: DeckEngine }): JSX.Element {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const [output, setOutput] = useState<Record<string, string>>({});
  const tailRef = useRef<HTMLPreElement>(null);

  const processes = props.engine.entry?.processes ?? [];

  useEffect(() => {
    const off = api.onProcessStdout((event) => {
      const key = String(event.pid);
      setOutput((prev) => {
        const merged = (prev[key] ?? "") + event.chunk;
        // Cap per-process buffer at 64KB.
        return { ...prev, [key]: merged.length > 65536 ? merged.slice(-65536) : merged };
      });
    });
    return off;
  }, []);

  useEffect(() => {
    const el = tailRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output, selected]);

  if (!props.engine.activeId) return <div className="deck-empty">{t("deck.noSession")}</div>;
  if (processes.length === 0) return <div className="deck-empty">{t("deck.processes.empty")}</div>;

  const current = selected ?? processes[0]?.pid ?? null;

  return (
    <div className="deck-panel">
      <div className="deck-proc-list">
        {processes.map((proc) => (
          <button
            key={proc.pid}
            type="button"
            className={`deck-row${current === proc.pid ? " active" : ""}`}
            onClick={() => setSelected(proc.pid)}
          >
            <span className="deck-row-main">{proc.command}</span>
            <span className="deck-row-meta">{proc.startTime.slice(11, 19)}</span>
          </button>
        ))}
      </div>
      {current ? (
        <pre ref={tailRef} className="deck-proc-output">
          {output[current] ?? t("deck.processes.noOutput")}
        </pre>
      ) : null}
    </div>
  );
}
