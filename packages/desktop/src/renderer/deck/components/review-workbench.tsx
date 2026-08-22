// Code-review full-body workbench (E8): runs the REAL action path —
// actionRun("review.check-available") / actionRun("review.full") with the
// unified onActionProgress stream (the legacy review:run IPC channel has no
// main-process handler; the overlay used to die on it). Findings render
// structured (path:startLine + suggestion), each convertible into an engine
// intervention; runs accumulate into a session-local history (honest scope:
// this app session only).
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { api } from "../../api";
import type { ActionRunResult, CrgIndexEntry } from "../../../shared/ipc";
import { useI18n } from "../../i18n";
import type { DeckEngine } from "../hooks/use-deck-engine";

/** review.full output (core actions/review.ts) — parsed defensively. */
type ReviewFinding = {
  path: string;
  startLine: number;
  content: string;
  suggestionCode?: string;
};

type ReviewFullOutput = {
  review?: {
    status?: string;
    summary?: unknown;
    comments?: ReviewFinding[];
  };
  risk?: { changedNodes?: unknown[]; graphBuilt?: boolean; reason?: string };
  statusNote?: string;
};

type ReviewRun = {
  id: number;
  at: string;
  ok: boolean;
  error?: string;
  output?: ReviewFullOutput;
};

/**
 * Runs cache shared by the overlay thumbnail and the full-body tab (E12) —
 * both mount their own ReviewWorkbench instance, so component-local state
 * would silently drop the run history on expand. Module scope = this app
 * session, which is exactly the honest lifetime of a review run.
 */
const runsCache: { runs: ReviewRun[]; viewing: number | null; seq: number } = {
  runs: [],
  viewing: null,
  seq: 0,
};

function findingsOf(run: ReviewRun | null): ReviewFinding[] {
  const comments = run?.output?.review?.comments;
  return Array.isArray(comments) ? comments : [];
}

function summaryOf(run: ReviewRun | null): string | null {
  const summary = run?.output?.review?.summary;
  if (summary == null) return null;
  if (typeof summary === "string") return summary;
  try {
    return JSON.stringify(summary);
  } catch {
    return null;
  }
}

export function ReviewWorkbench(props: { engine: DeckEngine; full?: boolean }): JSX.Element {
  const { t } = useI18n();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [workspace, setWorkspace] = useState<CrgIndexEntry | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [runs, setRunsState] = useState<ReviewRun[]>(runsCache.runs);
  const [viewing, setViewingState] = useState<number | null>(runsCache.viewing);
  const seqRef = useRef(runsCache.seq);

  // Writes flow through the module cache so a second instance (overlay ↔ tab)
  // mounts with the same history.
  const setRuns = (next: ReviewRun[]) => {
    runsCache.runs = next;
    setRunsState(next);
  };
  const setViewing = (id: number | null) => {
    runsCache.viewing = id;
    setViewingState(id);
  };

  useEffect(() => {
    void api
      .actionRun("review.check-available")
      .then((res) => {
        const out = res.ok ? (res.output as { available?: boolean }) : null;
        setAvailable(out?.available === true);
      })
      .catch(() => setAvailable(false));
    void api
      .crgList()
      .then((list) => setWorkspace(list[0] ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!running) {
      setProgress(null);
      return;
    }
    return api.onActionProgress((evt) => {
      if (evt.actionId === "review.full") {
        setProgress(evt.percent != null ? `${evt.percent}% — ${evt.message}` : evt.message);
      }
    });
  }, [running]);

  const run = useCallback(() => {
    if (running) return;
    setRunning(true);
    const record = (entry: ReviewRun) => {
      runsCache.seq = seqRef.current;
      setRuns([entry, ...runsCache.runs].slice(0, 20));
      setViewing(entry.id);
    };
    void api
      .actionRun("review.full")
      .then((res: ActionRunResult) => {
        record(
          res.ok
            ? { id: seqRef.current++, at: new Date().toISOString(), ok: true, output: res.output as ReviewFullOutput }
            : { id: seqRef.current++, at: new Date().toISOString(), ok: false, error: `${res.code}: ${res.error}` }
        );
      })
      .catch((err: unknown) => {
        record({
          id: seqRef.current++,
          at: new Date().toISOString(),
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => setRunning(false));
  }, [running]);

  const intervene = (finding: ReviewFinding) => {
    if (props.engine.busy) return;
    const text = `审查意见 ${finding.path}:${finding.startLine} — ${finding.content}${
      finding.suggestionCode ? `\n建议：${finding.suggestionCode}` : ""
    }`;
    void props.engine.send(text);
  };

  if (available === null) return <div className="deck-empty">{t("deck.loading")}</div>;
  if (!available) return <div className="deck-empty">{t("deck.review.unavailable")}</div>;

  const current = runs.find((r) => r.id === viewing) ?? runs[0] ?? null;
  const findings = findingsOf(current);
  const summary = summaryOf(current);
  const risk = current?.output?.risk;

  return (
    <div className={`deck-review${props.full ? " full" : ""}`}>
      <div className="deck-review-head">
        {workspace ? (
          <span className="deck-row-meta">
            {workspace.label} · {workspace.hasGraph ? t("deck.review.graphReady") : t("deck.review.graphUnbuilt")}
          </span>
        ) : null}
        <span className="deck-tree-head-ops">
          <button type="button" className="deck-op primary" disabled={running} onClick={run}>
            {running ? t("deck.review.running") : t("deck.review.runFull")}
          </button>
        </span>
      </div>
      {progress ? <div className="deck-srcprog">{progress}</div> : null}

      <div className="deck-review-body">
        {props.full && runs.length > 0 ? (
          <aside className="deck-review-runs">
            <div className="deck-panel-group-title">{t("deck.review.history")}</div>
            {runs.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`deck-row linked${current?.id === r.id ? " active" : ""}`}
                onClick={() => setViewing(r.id)}
              >
                <span className={`deck-wo-tag ${r.ok ? (findingsOf(r).length > 0 ? "a" : "g") : "r"}`}>
                  {r.ok ? (findingsOf(r).length > 0 ? "◐" : "✓") : "✕"}
                </span>
                <span className="deck-row-main">{r.at.slice(5, 16).replace("T", " ")}</span>
                <span className="deck-row-meta">
                  {r.ok ? t("deck.review.findings", { count: String(findingsOf(r).length) }) : "✕"}
                </span>
              </button>
            ))}
          </aside>
        ) : null}

        <section className="deck-review-result">
          {!current ? (
            <div className="deck-empty">{t("deck.review.noRuns")}</div>
          ) : !current.ok ? (
            <div className="deck-tree-error">{t("deck.review.failed", { error: current.error ?? "?" })}</div>
          ) : (
            <>
              {current.output?.statusNote ? <div className="deck-row-meta">{current.output.statusNote}</div> : null}
              {risk?.graphBuilt && Array.isArray(risk.changedNodes) ? (
                <div className="deck-row-meta">
                  {t("deck.review.risk", { count: String(risk.changedNodes.length) })}
                </div>
              ) : null}
              {summary ? <p className="deck-review-summary">{summary}</p> : null}
              {findings.length === 0 ? (
                <div className="deck-empty">{t("deck.review.noFindings")}</div>
              ) : (
                <>
                  <div className="deck-panel-group-title">
                    {t("deck.review.findings", { count: String(findings.length) })}
                  </div>
                  {findings.map((f, i) => (
                    <div key={`${f.path}:${f.startLine}:${i}`} className="deck-review-item">
                      <span className={`deck-wo-tag ${f.suggestionCode ? "a" : "b"}`}>
                        {f.suggestionCode ? t("deck.review.advisory") : t("deck.review.finding")}
                      </span>
                      <span className="deck-review-item-main">
                        <b>{f.content}</b>
                        <span className="deck-row-meta">
                          {f.path}:{f.startLine}
                        </span>
                        {f.suggestionCode ? (
                          <details>
                            <summary className="deck-sub-back">{t("deck.review.suggestion")}</summary>
                            <pre className="deck-srcpage">{f.suggestionCode}</pre>
                          </details>
                        ) : null}
                      </span>
                      <span className="deck-row-ops">
                        <button
                          type="button"
                          className="deck-op"
                          disabled={props.engine.busy}
                          title={props.engine.busy ? t("deck.review.interveneBusy") : undefined}
                          onClick={() => intervene(f)}
                        >
                          {t("deck.review.intervene")}
                        </button>
                      </span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
