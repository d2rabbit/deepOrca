import { useEffect, useMemo, useState, type JSX } from "react";
import hljs from "highlight.js/lib/common";
import type { DiffPayload } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { IconPencil } from "../ui/index";

/** A universal diff target: git working tree, agent change, or a whole commit. */
export type DiffTarget =
  | { kind: "git"; file: string; staged: boolean }
  | { kind: "agent"; sessionId: string; file: string }
  | { kind: "commit"; hash: string; subject?: string; file?: string };

type DiffRow = {
  text: string;
  kind: "added" | "removed" | "hunk" | "meta" | "context";
  oldNo?: number;
  newNo?: number;
  /** highlight.js language for this row (tracked per file section). */
  lang?: string;
};

/** Map a file path to a registered highlight.js language (or undefined). */
function languageForFile(file: string): string | undefined {
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
    html: "xml",
    htm: "xml",
    xml: "xml",
    svg: "xml",
    vue: "xml",
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
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    ini: "ini",
    sql: "sql",
    lua: "lua",
    r: "r",
    pl: "perl",
    mk: "makefile",
  };
  const lang = map[ext];
  return lang && hljs.getLanguage(lang) ? lang : undefined;
}

function classifyDiff(diff: string, fallbackFile: string): DiffRow[] {
  let oldLine = 0;
  let newLine = 0;
  let lang = languageForFile(fallbackFile);
  return diff.split("\n").map((line): DiffRow => {
    // Parse hunk headers to track line numbers
    const hunkMatch = line.match(/^@@ -(\d+)/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1] ?? "0", 10);
      const newMatch = line.match(/\+(\d+)/);
      newLine = parseInt(newMatch?.[1] ?? "0", 10);
      return { text: line, kind: "hunk" };
    }
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
      // Multi-file diffs (whole commits): retarget the language per file section.
      const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
      if (fileMatch?.[1]) {
        lang = languageForFile(fileMatch[1]);
      }
      return { text: line, kind: "meta" };
    }
    if (line.startsWith("+")) {
      return { text: line, kind: "added", newNo: newLine++, lang };
    }
    if (line.startsWith("-")) {
      return { text: line, kind: "removed", oldNo: oldLine++, lang };
    }
    // Context line
    return { text: line, kind: "context", oldNo: oldLine++, newNo: newLine++, lang };
  });
}

/** Syntax-highlighted code cell for one diff row (falls back to plain text). */
function DiffText({ row }: { row: DiffRow }): JSX.Element {
  // Unified diff prefixes the code with "+", "-" or a space — keep the marker
  // as-is and highlight only the code that follows it.
  const hasPrefix = row.kind === "added" || row.kind === "removed" || row.text.startsWith(" ");
  const prefix = hasPrefix ? row.text.charAt(0) : "";
  const code = hasPrefix ? row.text.slice(1) : row.text;
  if (row.lang && code.trim()) {
    try {
      const html = hljs.highlight(code, { language: row.lang, ignoreIllegals: true }).value;
      return (
        <span className="ui-diff-text">
          {prefix}
          <span dangerouslySetInnerHTML={{ __html: html }} />
        </span>
      );
    } catch {
      // Fall through to the plain rendering below.
    }
  }
  return <span className="ui-diff-text">{row.text || " "}</span>;
}

async function loadDiff(target: DiffTarget): Promise<DiffPayload> {
  if (target.kind === "git") return api.gitDiff(target.file, target.staged);
  if (target.kind === "agent") return api.agentChangesDiff(target.sessionId, target.file);
  return api.gitCommitDiff(target.hash, target.file);
}

/**
 * A large secondary overlay used everywhere a diff is viewed — source control
 * files, agent file changes, and whole commits all render through this panel.
 */
export function DiffOverlay({
  target,
  onClose,
  onOpenEditor,
}: {
  target: DiffTarget;
  onClose: () => void;
  onOpenEditor?: (filePath: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [payload, setPayload] = useState<DiffPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const p = await loadDiff(target);
        if (!cancelled) {
          setPayload(p);
        }
      } catch (err) {
        // A rejected load left loading=true forever — the overlay spun eternally.
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title =
    target.kind === "commit"
      ? target.file
        ? `${target.file} @ ${target.subject ?? target.hash.slice(0, 7)}`
        : (target.subject ?? target.hash)
      : (payload?.file ?? "");
  const rows = useMemo(() => (payload && !payload.binary ? classifyDiff(payload.diff, payload.file) : []), [payload]);
  const addedCount = rows.filter((r) => r.kind === "added").length;
  const removedCount = rows.filter((r) => r.kind === "removed").length;

  return (
    <div className="ui-diff-overlay" onClick={onClose}>
      <div className="ui-diff-overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ui-diff-overlay-head">
          <span className="ui-diff-overlay-title" title={title}>
            {title || t("diff.title")}
          </span>
          {rows.length > 0 ? (
            <span className="ui-diff-stats">
              <span className="ui-diff-stat-add">+{addedCount}</span>
              <span className="ui-diff-stat-del">-{removedCount}</span>
            </span>
          ) : null}
          {onOpenEditor && payload?.file ? (
            <button
              className="ui-diff-overlay-action"
              onClick={() => onOpenEditor(payload.file)}
              title={t("editor.openInEditor")}
            >
              <IconPencil /> {t("editor.openInEditor")}
            </button>
          ) : null}
          <button
            className="ui-diff-overlay-close"
            onClick={onClose}
            aria-label={t("common.close")}
            title={t("common.close")}
          >
            ✕
          </button>
        </div>
        <div className="ui-diff-overlay-body">
          {loading ? (
            <div className="ui-diff-empty ui-diff-loading">
              <span className="ui-spinner" /> {t("diff.loading") || "Loading…"}
            </div>
          ) : error ? (
            <div className="ui-diff-empty">{error}</div>
          ) : !payload ? (
            <div className="ui-diff-empty">{t("diff.selectFile")}</div>
          ) : payload.binary ? (
            <div className="ui-diff-empty">{t("diff.binary")}</div>
          ) : !payload.diff.trim() ? (
            <div className="ui-diff-empty">{t("diff.noDiff")}</div>
          ) : (
            <pre className="ui-diff-body">
              {rows.map((row, i) => (
                <div key={i} className={`ui-diff-line ${row.kind}`}>
                  <span className="ui-diff-ln">{row.oldNo ?? ""}</span>
                  <span className="ui-diff-ln">{row.newNo ?? ""}</span>
                  <DiffText row={row} />
                </div>
              ))}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
