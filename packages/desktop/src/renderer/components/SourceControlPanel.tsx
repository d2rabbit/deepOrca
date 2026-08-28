import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { AgentChangeFile, GitCommitFileEntry, GitLogEntry, GitStatus, GitStatusFile } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconPencil, IconButton, Input } from "../ui/index";
import type { DiffTarget } from "./DiffOverlay";

type Props = {
  /** Bumped by the parent whenever the project root changes, to force a reload. */
  refreshKey: number;
  /** Active session id, used to list agent file changes (null when none). */
  sessionId: string | null;
  /** Host platform ("darwin"/"win32"/"linux") — shortcut glyphs in tooltips. */
  platform: string;
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

/** Directory prefix (with trailing separator) for one-line file rows — gives
 *  same-name files in different folders enough context without a second line. */
function dirName(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(0, idx + 1) : "";
}

/**
 * Left-panel Git source control (item 6): an upper half showing current changes
 * (working tree + agent edits) and a lower half showing commit history. Every
 * row opens the universal DiffOverlay rather than an inline diff.
 */
export function SourceControlPanel({ refreshKey, sessionId, platform, onOpenDiff, onOpenEditor }: Props): JSX.Element {
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
  // Discard is irreversible (git checkout -- file): the row's ✕ needs a second
  // click to fire. The armed state resets after a few seconds, like the
  // session-delete confirm in the sidebar.
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const confirmDiscardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarmDiscardConfirm = useCallback(() => {
    if (confirmDiscardTimerRef.current) {
      clearTimeout(confirmDiscardTimerRef.current);
      confirmDiscardTimerRef.current = null;
    }
    setConfirmDiscard(null);
  }, []);

  useEffect(() => disarmDiscardConfirm, [disarmDiscardConfirm]);

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

  const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  const reload = useCallback(async () => {
    try {
      const [nextStatus, nextLog, nextAgent] = await Promise.all([
        api.gitStatus(),
        api.gitLog(),
        sessionId ? api.agentChangesList(sessionId) : Promise.resolve<AgentChangeFile[]>([]),
      ]);
      setStatus(nextStatus);
      setLog(nextLog);
      setAgentFiles(nextAgent);
    } catch (error) {
      // A failed reload must surface, not silently keep stale list state.
      setError(describeError(error));
    }
  }, [sessionId]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const runGitOp = useCallback(
    async (op: () => Promise<unknown>) => {
      try {
        await op();
      } catch (error) {
        setError(describeError(error));
        return;
      }
      await reload();
    },
    [reload]
  );

  const stage = useCallback((file: string) => runGitOp(() => api.gitStage(file)), [runGitOp]);
  const unstage = useCallback((file: string) => runGitOp(() => api.gitUnstage(file)), [runGitOp]);
  const stageAll = useCallback(() => runGitOp(() => api.gitStage(".")), [runGitOp]);
  const unstageAll = useCallback(() => runGitOp(() => api.gitUnstage(".")), [runGitOp]);

  const discard = useCallback(
    async (file: string) => {
      const result = await api.gitDiscard(file);
      if (!result.ok) {
        setError(result.error ?? t("app.requestFailed"));
        return;
      }
      await reload();
    },
    [reload, t]
  );

  const handleDiscardClick = useCallback(
    (file: string) => {
      if (confirmDiscard === file) {
        disarmDiscardConfirm();
        void discard(file);
        return;
      }
      if (confirmDiscardTimerRef.current) clearTimeout(confirmDiscardTimerRef.current);
      setConfirmDiscard(file);
      confirmDiscardTimerRef.current = setTimeout(disarmDiscardConfirm, 3000);
    },
    [confirmDiscard, disarmDiscardConfirm, discard]
  );

  const commit = useCallback(async () => {
    const msg = message.trim();
    if (!msg) {
      setError(t("scm.commitEmpty"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.gitCommit(msg);
      if (!result.ok) {
        setError(result.error ?? t("app.requestFailed"));
        return;
      }
      setMessage("");
      await reload();
    } catch (error) {
      setError(describeError(error));
    } finally {
      setBusy(false);
    }
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
        try {
          const files = await api.gitCommitFiles(hash);
          setCommitFiles((prev) => ({ ...prev, [hash]: files }));
        } catch (error) {
          // Collapse again instead of leaving a perpetual "Loading diff…".
          setError(describeError(error));
          setExpandedHash(null);
        }
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
      role="button"
      tabIndex={0}
      onClick={() => onOpenDiff({ kind: "git", file: file.path, staged: isStaged })}
      onKeyDown={(e) => {
        // Row action buttons stop mouse clicks; key events still bubble, so
        // only act when the row itself has focus.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDiff({ kind: "git", file: file.path, staged: isStaged });
        }
      }}
    >
      <span className={`ui-scm-status ${statusCls(isStaged ? file.index : file.work)}`}>
        {(isStaged ? file.index : file.work) || "?"}
      </span>
      <span className="ui-scm-pathwrap" title={file.path}>
        <span className="ui-scm-dir">{dirName(file.path)}</span>
        <span className="ui-scm-name">{baseName(file.path)}</span>
      </span>
      <span className="ui-scm-file-actions" onClick={(e) => e.stopPropagation()}>
        {onOpenEditor ? (
          <button
            className="ui-scm-act"
            onClick={() => onOpenEditor(file.path)}
            title={t("editor.openInEditor")}
            aria-label={t("editor.openInEditor")}
          >
            <IconPencil />
          </button>
        ) : null}
        {isStaged ? (
          <button
            className="ui-scm-act"
            onClick={() => void unstage(file.path)}
            title={t("scm.unstage")}
            aria-label={t("scm.unstage")}
          >
            −
          </button>
        ) : (
          <>
            <button
              className="ui-scm-act"
              onClick={() => void stage(file.path)}
              title={t("scm.stage")}
              aria-label={t("scm.stage")}
            >
              +
            </button>
            <button
              className={`ui-scm-act ui-scm-act--danger${confirmDiscard === file.path ? " armed" : ""}`}
              onClick={() => handleDiscardClick(file.path)}
              title={confirmDiscard === file.path ? t("scm.confirmDiscard") : t("scm.discard")}
              aria-label={confirmDiscard === file.path ? t("scm.confirmDiscard") : t("scm.discard")}
            >
              {confirmDiscard === file.path ? "!" : "✕"}
            </button>
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
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() => void commit()}
          title={platform === "darwin" ? "⌘↵" : "Ctrl+↵"}
        >
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
              <button
                className="ui-scm-group-action"
                onClick={() => void unstageAll()}
                title={t("scm.unstageAll")}
                aria-label={t("scm.unstageAll")}
              >
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
              <button
                className="ui-scm-group-action"
                onClick={() => void stageAll()}
                title={t("scm.stageAll")}
                aria-label={t("scm.stageAll")}
              >
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
                role="button"
                tabIndex={0}
                onClick={() => sessionId && onOpenDiff({ kind: "agent", sessionId, file: f.path })}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (sessionId) onOpenDiff({ kind: "agent", sessionId, file: f.path });
                  }
                }}
              >
                <span className="ui-scm-status">
                  <IconPencil />
                </span>
                <span className="ui-scm-pathwrap" title={f.path}>
                  <span className="ui-scm-dir">{dirName(f.path)}</span>
                  <span className="ui-scm-name">{baseName(f.path)}</span>
                </span>
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
                role="button"
                tabIndex={0}
                aria-expanded={expandedHash === entry.hash}
                title={`${entry.shortHash} · ${entry.author} · ${entry.date}`}
                onClick={() => void toggleCommit(entry.hash)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void toggleCommit(entry.hash);
                  }
                }}
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
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          onOpenDiff({ kind: "commit", hash: entry.hash, subject: entry.subject, file: f.path })
                        }
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onOpenDiff({ kind: "commit", hash: entry.hash, subject: entry.subject, file: f.path });
                          }
                        }}
                      >
                        <span className={`ui-scm-status ${statusCls(f.status)}`}>{f.status}</span>
                        <span className="ui-scm-pathwrap" title={f.path}>
                          <span className="ui-scm-dir">{dirName(f.path)}</span>
                          <span className="ui-scm-name">{baseName(f.path)}</span>
                        </span>
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
