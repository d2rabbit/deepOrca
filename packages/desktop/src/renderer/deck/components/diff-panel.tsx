// Diff focus card (E5.1): renders a unified diff for one file — hunk headers,
// added/removed lines with old/new line numbers. Parses the same unified-diff
// grammar as the classic DiffOverlay (kept deck-local per the isolation red
// line, without the highlight.js dependency — the design demo's diff view is
// plain colored rows). Binary and empty diffs surface honest notices.
import { useEffect, useMemo, useState, type JSX } from "react";
import { api } from "../../api";
import type { DiffPayload } from "../../../shared/ipc";
import { useI18n } from "../../i18n";

export type DeckDiffTarget = {
  file: string;
  staged: boolean;
};

type DiffRow = {
  text: string;
  kind: "added" | "removed" | "hunk" | "meta" | "context";
  oldNo?: number;
  newNo?: number;
};

function classifyDiff(diff: string): DiffRow[] {
  let oldLine = 0;
  let newLine = 0;
  return diff.split("\n").map((line): DiffRow => {
    const hunkMatch = line.match(/^@@ -(\d+)/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1] ?? "0", 10);
      const newMatch = line.match(/\+(\d+)/);
      newLine = parseInt(newMatch?.[1] ?? "0", 10);
      return { text: line, kind: "hunk" };
    }
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
      return { text: line, kind: "meta" };
    }
    if (line.startsWith("+")) return { text: line, kind: "added", newNo: newLine++ };
    if (line.startsWith("-")) return { text: line, kind: "removed", oldNo: oldLine++ };
    return { text: line, kind: "context", oldNo: oldLine++, newNo: newLine++ };
  });
}

export function DiffPanel(props: { target: DeckDiffTarget }): JSX.Element {
  const { t } = useI18n();
  const [payload, setPayload] = useState<DiffPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .gitDiff(props.target.file, props.target.staged)
      .then((p) => {
        if (!cancelled) {
          setPayload(p);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.target]);

  const rows = useMemo(() => (payload && !payload.binary ? classifyDiff(payload.diff) : []), [payload]);
  const added = rows.filter((r) => r.kind === "added").length;
  const removed = rows.filter((r) => r.kind === "removed").length;

  return (
    <div className="deck-diff">
      <div className="deck-diff-stats">
        <span className="add">+{added}</span>
        <span className="del">−{removed}</span>
        <span className="deck-row-meta">
          {props.target.staged ? t("deck.changes.staged") : t("deck.changes.unstaged")}
        </span>
      </div>
      {loading ? (
        <div className="deck-empty">{t("deck.loading")}</div>
      ) : !payload ? (
        <div className="deck-empty">{t("deck.editor.loadError")}</div>
      ) : payload.binary ? (
        <div className="deck-empty">{t("diff.binary")}</div>
      ) : !payload.diff.trim() ? (
        <div className="deck-empty">{t("diff.noDiff")}</div>
      ) : (
        <pre className="deck-diff-body">
          {rows.map((row, i) => (
            <div key={i} className={`deck-diff-line ${row.kind}`}>
              <span className="ln">{row.oldNo ?? ""}</span>
              <span className="ln">{row.newNo ?? ""}</span>
              <span className="tx">{row.text || " "}</span>
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}
