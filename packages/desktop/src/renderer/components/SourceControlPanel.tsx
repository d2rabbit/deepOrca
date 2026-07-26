import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { AgentChangeFile, GitCommitFileEntry, GitLogEntry, GitStatus, GitStatusFile } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton, Input } from "../ui/index";
import type { DiffTarget } from "./DiffOverlay";

type Props = {
  /** Bumped by the parent whenever the project root changes, to force a reload. */
  refreshKey: number;
  /** Active session id, used to list agent file changes (null when none). */
  sessionId: string | null;
  /** Open the universal diff overlay for any target (git file / commit / agent). */
  onOpenDiff: (target: DiffTarget) => void;
  /** Open a file in the code editor overlay. */
  onOpenEditor?: (filePath: string) => void;
};

/** Map git status letter to a CSS modifier for color coding. */
function statusCls(letter: string): string {
  const l = letter.toUpperCase();
  if (l === "M") return "modified";
  if (l === "A" || l === "?") return "added";
  if (l === "D") return "deleted";
  if (l === "R" || l === "C") return "renamed";
  return "";
}

const EMPTY_STATUS: GitStatus = { isRepo: false, branch: "", files: [] };

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Left-panel Git source control (item 6): an upper half showing current changes
 * (working tree + agent edits) and a lower half showing commit history. Every
 * row opens the universal DiffOverlay rather than an inline diff.
 */
export function SourceControlPanel({ refreshKey, sessionId, onOpenDiff, onOpenEditor }: Props): JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitStatus>(EMPTY_STATUS);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [agentFiles, setAgentFiles] = useState<AgentChangeFile[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useState(55);
  // History second level: the expanded commit and its per-commit file lists.
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<Record<string, GitCommitFileEntry[]>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const handleSplitResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const y = ev.clientY - rect.top;
      const ratio = Math.max(20, Math.min(80, (y / rect.height) * 100));
      setSplitRatio(ratio);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const reload = useCallback(async () => {
    const [nextStatus, nextLog, nextAgent] = await Promise.all([
      api.gitStatus(),
      api.gitLog(),
      sessionId ? api.agentChangesList(sessionId) : Promise.resolve<AgentChangeFile[]>([]),
    ]);
    setStatus(nextStatus);
    setLog(nextLog);
    setAgentFiles(nextAgent);
  }, [sessionId]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const stage = useCallback(
    async (file: string) => {
      await api.gitStage(file);
      await reload();
    },
    [reload]
  );

  const unstage = useCallback(
    async (file: string) => {
      await api.gitUnstage(file);
      await reload();
    },
    [reload]
  );

  const stageAll = useCallback(async () => {
    await api.gitStage(".");
    await reload();
  }, [reload]);

  const unstageAll = useCallback(async () => {
    await api.gitUnstage(".");
    await reload();
  }, [reload]);

  const discard = useCallback(
    async (file: string) => {
      await api.gitDiscard(file);
      await reload();
    },
    [reload]
  );

  const commit = useCallback(async () => {
    const msg = message.trim();
    if (!msg) {
      setError(t("scm.commitEmpty"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await api.gitCommit(msg);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t("app.requestFailed"));
      return;
    }
    setMessage("");
    await reload();
  }, [message, reload, t]);

  // First click on a history row expands its file list (second level);
  // clicking again collapses it. Only the file rows open the diff overlay.
  const toggleCommit = useCallback(
    async (hash: string) => {
      if (expandedHash === hash) {
        setExpandedHash(null);
        return;
      }
      setExpandedHash(hash);
      if (!commitFiles[hash]) {
        const files = await api.gitCommitFiles(hash);
        setCommitFiles((prev) => ({ ...prev, [hash]: files }));
      }
    },
    [expandedHash, commitFiles]
  );

  if (!status.isRepo) {
    return (
      <div className="ui-side-panel">
        <div className="ui-side-panel-head">
          <span>{t("scm.title")}</span>
        </div>
        <div className="ui-side-panel-body">
          <div className="ui-side-panel-empty">{t("scm.noRepo")}</div>
        </div>
      </div>
    );
  }

  const staged = status.files.filter((f) => f.staged);
  const unstaged = status.files.filter((f) => !f.staged);

  const renderFile = (file: GitStatusFile, isStaged: boolean): JSX.Element => (
    <div
      key={`${isStaged ? "s" : "u"}:${file.path}`}
      className="ui-scm-file"
      onClick={() => onOpenDiff({ kind: "git", file: file.path, staged: isStaged })}
    >
      <span className={`ui-scm-status ${statusCls(isStaged ? file.index : file.work)}`}>
        {(isStaged ? file.index : file.work) || "?"}
      </span>
      <span className="ui-scm-name" title={file.path}>
        {baseName(file.path)}
      </span>
      <span className="ui-scm-path">{file.path}</span>
      <span className="ui-scm-file-actions" onClick={(e) => e.stopPropagation()}>
        {onOpenEditor ? (
          <Button size="sm" variant="subtle" onClick={() => onOpenEditor(file.path)} title={t("editor.openInEditor")}>
            ✎
          </Button>
        ) : null}
        {isStaged ? (
          <Button size="sm" variant="subtle" onClick={() => void unstage(file.path)}>
            {t("scm.unstage")}
          </Button>
        ) : (
          <>
            <Button size="sm" variant="subtle" onClick={() => void stage(file.path)}>
              {t("scm.stage")}
            </Button>
            <Button
              size="sm"
              variant="subtle"
              className="ui-scm-discard"
              onClick={() => void discard(file.path)}
              title={t("scm.discard")}
            >
              ✕
            </Button>
          </>
        )}
      </span>
    </div>
  );

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("scm.title")}</span>
        <IconButton onClick={() => void reload()} title={t("scm.refresh")} aria-label={t("scm.refresh")}>
          ⟳
        </IconButton>
      </div>

      <div className="ui-scm-branch">
        <span className="ui-scm-branch-icon">⑂</span>
        {status.branch || "—"}
      </div>

      <div className="ui-scm-commit">
        <Input
          type="text"
          placeholder={t("scm.commitPlaceholder")}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void commit();
          }}
        />
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void commit()} title="⌘↵">
          {t("scm.commit")}
        </Button>
      </div>
      {error ? <div className="ui-scm-error">{error}</div> : null}

      {/* Upper half: current changes (working tree + agent edits). */}
      <div className="ui-scm-split-top" ref={containerRef} style={{ flex: `0 0 ${splitRatio}%` }}>
        {status.files.length === 0 && agentFiles.length === 0 ? (
          <div className="ui-side-panel-empty">{t("scm.noChanges")}</div>
        ) : null}
        {staged.length > 0 ? (
          <>
            <div className="ui-scm-group-head">
              <span>
                {t("scm.stagedChanges")}
                <span className="ui-scm-count">{staged.length}</span>
              </span>
              <button className="ui-scm-group-action" onClick={() => void unstageAll()} title={t("scm.unstageAll")}>
                −
              </button>
            </div>
            {staged.map((f) => renderFile(f, true))}
          </>
        ) : null}
        {unstaged.length > 0 ? (
          <>
            <div className="ui-scm-group-head">
              <span>
                {t("scm.changes")}
                <span className="ui-scm-count">{unstaged.length}</span>
              </span>
              <button className="ui-scm-group-action" onClick={() => void stageAll()} title={t("scm.stageAll")}>
                +
              </button>
            </div>
            {unstaged.map((f) => renderFile(f, false))}
          </>
        ) : null}
        {agentFiles.length > 0 ? (
          <>
            <div className="ui-scm-group-head">{t("diff.agentTab")}</div>
            {agentFiles.map((f) => (
              <div
                key={`a:${f.path}`}
                className="ui-scm-file"
                onClick={() => sessionId && onOpenDiff({ kind: "agent", sessionId, file: f.path })}
              >
                <span className="ui-scm-status">✎</span>
                <span className="ui-scm-name" title={f.path}>
                  {baseName(f.path)}
                </span>
                <span className="ui-scm-path">{f.path}</span>
              </div>
            ))}
          </>
        ) : null}
      </div>

      {/* Draggable split divider */}
      <div className="ui-scm-split-handle" onMouseDown={handleSplitResize} />

      {/* Lower half: commit history. */}
      <div className="ui-scm-split-bottom" style={{ flex: `1 1 ${100 - splitRatio}%` }}>
        <div className="ui-scm-group-head">{t("scm.history")}</div>
        {log.length === 0 ? (
          <div className="ui-side-panel-empty">{t("scm.noHistory")}</div>
        ) : (
          log.map((entry) => (
            <div key={entry.hash} className="ui-scm-commit-block">
              <div
                className={`ui-scm-commit-row${expandedHash === entry.hash ? " expanded" : ""}`}
                title={`${entry.shortHash} · ${entry.author} · ${entry.date}`}
                onClick={() => void toggleCommit(entry.hash)}
              >
                <span className="ui-scm-commit-caret">{expandedHash === entry.hash ? "▾" : "▸"}</span>
                <span className="ui-scm-commit-hash">{entry.shortHash}</span>
                <span className="ui-scm-commit-subject">{entry.subject}</span>
                <span className="ui-scm-commit-meta">{entry.date}</span>
              </div>
              {expandedHash === entry.hash ? (
                <div className="ui-scm-commit-files">
                  {!commitFiles[entry.hash] ? (
                    <div className="ui-side-panel-empty">{t("diff.loading")}</div>
                  ) : commitFiles[entry.hash].length === 0 ? (
                    <div className="ui-side-panel-empty">{t("scm.noChanges")}</div>
                  ) : (
                    commitFiles[entry.hash].map((f) => (
                      <div
                        key={`${entry.hash}:${f.path}`}
                        className="ui-scm-file ui-scm-commit-file"
                        onClick={() =>
                          onOpenDiff({ kind: "commit", hash: entry.hash, subject: entry.subject, file: f.path })
                        }
                      >
                        <span className={`ui-scm-status ${statusCls(f.status)}`}>{f.status}</span>
                        <span className="ui-scm-name" title={f.path}>
                          {baseName(f.path)}
                        </span>
                        <span className="ui-scm-path">{f.path}</span>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
