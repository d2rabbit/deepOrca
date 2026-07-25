import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { ReviewComment, ReviewOptions, ReviewProgressEvent } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton } from "../ui/index";

/**
 * Left-panel code review (item 8): runs the `ocr` CLI (Alibaba Open Code Review)
 * against the current workspace and displays structured review comments.
 */
export function CodeReviewPanel(): JSX.Element {
  const { t } = useI18n();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [summary, setSummary] = useState<string>("");
  const [mode, setMode] = useState<ReviewOptions["mode"]>("workspace");
  const [fromRef, setFromRef] = useState("main");
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const rawOutputRef = useRef("");

  // Check ocr availability on mount.
  useEffect(() => {
    void api.reviewCheckAvailable().then((res) => {
      setAvailable(res.available);
      setVersion(res.version ?? "");
    });
  }, []);

  // Subscribe to streaming review progress events.
  useEffect(() => {
    const off = api.onReviewProgress((event: ReviewProgressEvent) => {
      if (event.done) {
        setBusy(false);
        // Try to parse JSON output from accumulated stdout.
        parseReviewOutput(rawOutputRef.current);
        return;
      }
      if (event.stream === "stdout") {
        rawOutputRef.current += event.chunk;
      }
      setLogLines((prev) => {
        const text = event.chunk.replace(/\n$/, "");
        if (!text) return prev;
        const lines = text.split("\n");
        const next = [...prev, ...lines];
        return next.length > 300 ? next.slice(next.length - 300) : next;
      });
    });
    return off;
  }, []);

  // Auto-scroll log to bottom on new lines.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  const parseReviewOutput = useCallback((raw: string) => {
    // Attempt to extract JSON from the output (ocr --format json).
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try {
        const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
          comments?: ReviewComment[];
          summary?: string;
        };
        if (Array.isArray(parsed.comments)) {
          setComments(parsed.comments);
          setSummary(parsed.summary ?? "");
          return;
        }
      } catch {
        // Not valid JSON — fall through to raw display.
      }
    }
    // Try JSON array format.
    const arrStart = raw.indexOf("[");
    const arrEnd = raw.lastIndexOf("]");
    if (arrStart >= 0 && arrEnd > arrStart) {
      try {
        const parsed = JSON.parse(raw.slice(arrStart, arrEnd + 1)) as ReviewComment[];
        if (Array.isArray(parsed)) {
          setComments(parsed);
          setSummary(`${parsed.length} comments`);
          return;
        }
      } catch {
        // Not valid JSON array.
      }
    }
    setComments([]);
    setSummary("");
  }, []);

  const runReview = useCallback(async () => {
    setBusy(true);
    setComments([]);
    setSummary("");
    rawOutputRef.current = "";
    const label = mode === "branch" ? `ocr review --from ${fromRef} --format json` : "ocr review --format json";
    setLogLines([`$ ${label}`]);
    const options: ReviewOptions = { mode };
    if (mode === "branch") {
      options.from = fromRef;
    }
    await api.reviewRun(options);
  }, [mode, fromRef]);

  const severityColor = (sev: string): string => {
    switch (sev) {
      case "critical":
        return "var(--ui-danger, #ef4444)";
      case "warning":
        return "var(--ui-warning, #f59e0b)";
      default:
        return "var(--ui-text-tertiary, #888)";
    }
  };

  if (available === null) {
    return (
      <div className="ui-side-panel">
        <div className="ui-side-panel-head">
          <span>{t("review.title")}</span>
        </div>
        <div className="ui-side-panel-body">
          <div className="ui-side-panel-empty">{t("review.checking")}</div>
        </div>
      </div>
    );
  }

  if (!available) {
    return (
      <div className="ui-side-panel">
        <div className="ui-side-panel-head">
          <span>{t("review.title")}</span>
        </div>
        <div className="ui-side-panel-body">
          <div className="ui-review-unavailable">
            <p>{t("review.notInstalled")}</p>
            <code>npm install -g @alibaba-group/open-code-review</code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("review.title")}</span>
        {version ? <span className="ui-review-version">{version}</span> : null}
      </div>
      <div className="ui-side-panel-body">
        {/* Controls */}
        <div className="ui-review-controls">
          <select
            className="ui-select ui-review-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as ReviewOptions["mode"])}
            disabled={busy}
          >
            <option value="workspace">{t("review.modeWorkspace")}</option>
            <option value="branch">{t("review.modeBranch")}</option>
          </select>
          {mode === "branch" ? (
            <input
              className="ui-input ui-review-ref"
              value={fromRef}
              onChange={(e) => setFromRef(e.target.value)}
              placeholder="main"
              disabled={busy}
            />
          ) : null}
          <Button size="sm" onClick={() => void runReview()} disabled={busy}>
            {busy ? t("review.running") : t("review.run")}
          </Button>
        </div>

        {/* Summary */}
        {summary ? <div className="ui-review-summary">{summary}</div> : null}

        {/* Parsed comments */}
        {comments.length > 0 ? (
          <div className="ui-review-comments">
            {comments.map((c, i) => (
              <div key={i} className="ui-review-comment">
                <div className="ui-review-comment-head">
                  <span className="ui-review-severity" style={{ color: severityColor(c.severity) }}>
                    {c.severity}
                  </span>
                  <span className="ui-review-file">
                    {c.file}:{c.line}
                  </span>
                </div>
                <div className="ui-review-message">{c.message}</div>
                {c.suggestion ? <div className="ui-review-suggestion">{c.suggestion}</div> : null}
              </div>
            ))}
          </div>
        ) : null}

        {/* Raw log output */}
        {logLines.length > 0 ? (
          <div className="ui-index-log">
            <div className="ui-index-log-head">
              <span>ocr</span>
              <IconButton
                onClick={() => {
                  setLogLines([]);
                  setComments([]);
                  setSummary("");
                }}
                title="✕"
                aria-label="close"
              >
                ✕
              </IconButton>
            </div>
            <pre className="ui-index-log-body">
              {logLines.join("\n")}
              <div ref={logEndRef} />
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
