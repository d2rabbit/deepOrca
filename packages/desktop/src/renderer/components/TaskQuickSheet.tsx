/**
 * TaskQuickSheet — the task hub's right-side floating QUICK view (user ask
 * 2026-09-02: 任务树里打开产物一律走右侧悬浮窗). Read-only condensed content
 * per artifact kind:
 *   - report  → one persisted review report (findings, no locate workbench)
 *   - build   → one settled index/knowledge build job (stage list)
 * The session-tree timeline embeds the existing lazy TaskRecordPanel directly
 * as this sheet's children (wired in App.tsx).
 *
 * Reuses the design preview sheet's shell classes (`ui-preview-panel*`) so
 * the right slot looks identical; single-right-slot arbitration lives in
 * App.tsx (opening either side closes the other).
 */

import { useCallback, useEffect, useState, type JSX, type ReactNode } from "react";
import type { ReviewReportMeta } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { IconFile, IconShield, IconSparkle, IconToolGeneric, IconWarn } from "../ui/index";
import { FindingBody, parseFinding, SEV_CLASS, type ReportFinding } from "../lib/report-view";
import { formatAbsolute } from "./task-hub-format";
import { TRACE_ICONS, type TaskHubQuickView } from "./TaskHubWorkspace";

/** Localized status line for a report's tri-state backend status — the raw
 *  `statusNote` is model-speak (English diagnostics for the agent) and must
 *  never leak into the UI (user report 2026-09-02). */
function LocalizedStatusLine({ status }: { status?: string }): JSX.Element | null {
  const { t } = useI18n();
  if (status === "degraded" || status === "unavailable") {
    return (
      <p className="ui-report-footer degraded">
        <IconWarn />
        {status === "degraded" ? t("review.statusDegraded") : t("review.statusUnavailable")}
      </p>
    );
  }
  return null;
}

export function TaskQuickSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ui-preview-panel ui-task-quick" role="dialog">
      <div className="ui-preview-panel-head">
        <div className="ui-preview-tabs">
          <button type="button" className="ui-preview-tab active">
            <IconSparkle /> {title}
          </button>
        </div>
        <button type="button" className="ui-preview-close" onClick={onClose} title={t("common.close")}>
          ✕
        </button>
      </div>
      <div className="ui-preview-panel-body">{children}</div>
    </div>
  );
}

/** One persisted review report, condensed: findings grouped by file — the
 *  history rail, risk map, and locate workbench stay in the main-area tab. */
export function ReportQuickContent({ root, reportId }: { root: string; reportId: string }): JSX.Element {
  const { t } = useI18n();
  const [meta, setMeta] = useState<ReviewReportMeta | null>(null);
  const [findings, setFindings] = useState<ReportFinding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await api.reviewReadReport(root, reportId);
      if (res.ok && res.meta) {
        setMeta(res.meta);
        setFindings((res.meta.findings ?? []).map((f) => parseFinding(f)));
        setError(null);
      } else {
        setError(res.error ?? t("app.requestFailed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [root, reportId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const byPath = new Map<string, ReportFinding[]>();
  for (const f of findings) {
    const list = byPath.get(f.path);
    if (list) list.push(f);
    else byPath.set(f.path, [f]);
  }

  return (
    <div className="ui-quick-report">
      {loading ? (
        <div className="ui-risk-board-state">
          <span className="ui-spinner" />
        </div>
      ) : error ? (
        <div className="ui-risk-board-state">{error}</div>
      ) : (
        <>
          <div className="ui-quick-report-head">
            <span className="ui-quick-report-title">{meta?.scopeLabel ?? ""}</span>
            <span className="ui-quick-report-time">{formatAbsolute(meta?.generatedAt)}</span>
          </div>
          {findings.length === 0 ? (
            <div className="ui-quick-report-empty">
              <span className="empty-glyph">
                <IconShield />
              </span>
              <span className="empty-title">{t("review.rpEmptyTitle")}</span>
              <span className="empty-hint">{t("review.rpEmptyHint", { n: meta?.filesReviewed ?? 0 })}</span>
            </div>
          ) : (
            [...byPath.entries()].map(([path, list]) => (
              <section key={path} className="ui-report-file">
                <h2>
                  <code>{path}</code> <span className="cnt">{list.length}</span>
                </h2>
                {list.map((f, i) => (
                  <div key={i} className="ui-report-finding">
                    <div className="head">
                      {f.severity ? (
                        <span className={`chip ${SEV_CLASS[f.severity] ?? ""}`}>{f.severity.toUpperCase()}</span>
                      ) : null}
                      <span className="loc">
                        {f.path}
                        {f.startLine > 0 ? `:${f.startLine}` : ""}
                        {f.endLine != null && f.endLine > f.startLine ? `-${f.endLine}` : ""}
                      </span>
                    </div>
                    <FindingBody content={f.content} />
                    {f.existingCode ? (
                      <div className="ui-report-codeblock kind-existing">
                        <div className="cb-head">
                          <span className="cb-kind">{t("review.rpExisting")}</span>
                          <span className="cb-file">{f.path}</span>
                        </div>
                        <pre className="code">
                          <code>{f.existingCode}</code>
                        </pre>
                      </div>
                    ) : null}
                    {f.suggestionCode ? (
                      <div className="ui-report-codeblock kind-suggestion">
                        <div className="cb-head">
                          <span className="cb-kind">{t("review.rpSuggestion")}</span>
                        </div>
                        <pre className="code">
                          <code>{f.suggestionCode}</code>
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ))}
              </section>
            ))
          )}
          <LocalizedStatusLine status={meta?.status} />
        </>
      )}
    </div>
  );
}

/** One settled build job: stage list with per-stage status (from the hub
 *  node's own meta — no extra fetch). */
export function BuildQuickContent({
  stages,
  error,
}: {
  stages: Array<{ id: string; status: string; error?: string }>;
  error?: string;
}): JSX.Element {
  return (
    <div className="ui-quick-report">
      {error ? <div className="ui-quick-report-error">{error}</div> : null}
      <div className="ui-quick-build-stages">
        {stages.length === 0 ? <div className="ui-quick-report-empty">—</div> : null}
        {stages.map((s) => (
          <div key={s.id} className={`ui-quick-build-stage ${s.status}`}>
            <span className={`rb-dot ${s.status === "done" ? "tier-lo" : "tier-hi"}`} aria-hidden />
            <span className="name">{s.id}</span>
            <span className="status">{s.status}</span>
            {s.error ? <span className="err">{s.error}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One trajectory step as a structured report (2026-09-06 user ask: the
 *  detail was a bare JSON dump — key/value params, local op time and the
 *  tool's result markdown turn it into a real report). Extracted from
 *  App.tsx at the file-length hard limit.
 *
 *  2026-09-08 user ask — 渲染强化 + 终态修正:
 *   - each tool family renders its own shape (bash 命令块 / read·write·edit
 *     文件卡 / search 查询 / fetch 链接 / question 问答卡 / plan 计划 /
 *     assistant 全文), generic JSON stays the fallback;
 *   - a landed trace is never "in progress": ok → 已完成, fail → 失败,
 *     no recorded result → 已中断 (the call was cut off mid-flight). */
type StepDetail = Extract<TaskHubQuickView, { kind: "step-detail" }>["step"];

type StepKind =
  | "bash"
  | "read"
  | "write"
  | "edit"
  | "search"
  | "fetch"
  | "question"
  | "plan"
  | "skill"
  | "assistant"
  | "generic";

function stepKindOf(step: StepDetail): StepKind {
  if (step.mcp) return "generic"; // MCP calls keep the generic JSON view
  const n = (step.tool || "").toLowerCase();
  if (n === "bash") return "bash";
  if (n === "read") return "read";
  if (n === "write") return "write";
  if (n === "edit") return "edit";
  if (n === "websearch" || n === "web_search") return "search";
  if (n === "webfetch" || n === "web_fetch") return "fetch";
  if (n === "askuserquestion") return "question";
  if (n === "updateplan") return "plan";
  if (n === "skill" || step.cls === "t-skill") return "skill";
  if (n === "assistant" || step.cls === "t-assistant") return "assistant";
  return "generic";
}

/** Loose arg parse — anything non-object stays null and the raw text shows. */
function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* non-JSON args stay raw */
  }
  return null;
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v, null, 2));

/** Only http(s) URLs become links (same rule as RichToolResult). */
function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

function OpSection({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="ui-depth-op-section">
      <div className="ui-depth-op-section-label">{label}</div>
      {children}
    </div>
  );
}

/** File-path chip shared by read/write/edit detail views. */
function OpFileChip({ path }: { path: string }): JSX.Element {
  return (
    <div className="ui-depth-op-file" title={path}>
      <IconFile />
      <code>{path}</code>
    </div>
  );
}

type QuestionArg = {
  question?: string;
  header?: string;
  multiSelect?: boolean;
  options?: Array<{ label?: string; description?: string }>;
};

export function StepDetailQuickContent({ step }: { step: StepDetail }): JSX.Element {
  const { t } = useI18n();
  const kind = stepKindOf(step);
  const raw = step.argFull ?? step.arg ?? "";
  const parsed = kind === "skill" || kind === "assistant" ? null : parseArgs(raw);
  // Terminal verdict only (user ask 2026-09-08): a landed trace has no
  // "in progress" — no recorded result means the call was interrupted.
  const status = step.fail ? "fail" : step.ok ? "ok" : "interrupted";
  // Local op time — hidden for unparseable timestamps (formatAbsolute would
  // render a bare "—").
  const at = step.at ? new Date(step.at) : null;
  const opTime = at && !Number.isNaN(at.getTime()) && step.at ? formatAbsolute(step.at) : "";

  // Per-kind consumed keys — everything NOT consumed falls through to the
  // generic key/value 参数 section, so no fact is dropped and none duplicates.
  const consumed = new Set<string>();
  let specialized: ReactNode = null;
  if (parsed) {
    switch (kind) {
      case "bash":
        consumed.add("command");
        consumed.add("description");
        specialized = (
          <OpSection label={t("taskhub.detail.command")}>
            <pre className="ui-depth-op-cmd">
              <span className="prompt">$ </span>
              {strOf(parsed.command)}
            </pre>
            {parsed.description ? <div className="ui-depth-op-cmd-note">{strOf(parsed.description)}</div> : null}
          </OpSection>
        );
        break;
      case "read":
        consumed.clear();
        consumed.add("file_path");
        specialized = (
          <OpSection label={t("taskhub.detail.file")}>
            <OpFileChip path={strOf(parsed.file_path) || raw} />
          </OpSection>
        );
        break;
      case "write":
        consumed.clear();
        consumed.add("file_path");
        consumed.add("content");
        specialized = (
          <>
            <OpSection label={t("taskhub.detail.file")}>
              <OpFileChip path={strOf(parsed.file_path) || raw} />
            </OpSection>
            {parsed.content != null ? (
              <OpSection label={t("taskhub.detail.content")}>
                <pre className="ui-depth-op-pre">{strOf(parsed.content)}</pre>
              </OpSection>
            ) : null}
          </>
        );
        break;
      case "edit": {
        consumed.clear();
        for (const k of ["file_path", "snippet_id", "old_string", "new_string", "replace_all"]) consumed.add(k);
        const oldS = strOf(parsed.old_string);
        const newS = strOf(parsed.new_string);
        specialized = (
          <>
            <OpSection label={t("taskhub.detail.file")}>
              <OpFileChip path={strOf(parsed.file_path) || raw} />
            </OpSection>
            {oldS || newS ? (
              <OpSection label={t("taskhub.detail.change")}>
                <div className="ui-depth-op-diff">
                  {oldS ? (
                    <div className="ui-depth-op-diff-row old">
                      <span className="tag">−</span>
                      <pre>{oldS}</pre>
                    </div>
                  ) : null}
                  {newS ? (
                    <div className="ui-depth-op-diff-row new">
                      <span className="tag">+</span>
                      <pre>{newS}</pre>
                    </div>
                  ) : null}
                </div>
              </OpSection>
            ) : null}
          </>
        );
        break;
      }
      case "search":
        consumed.clear();
        consumed.add("query");
        specialized = (
          <OpSection label={t("taskhub.detail.query")}>
            <div className="ui-depth-op-quote">“{strOf(parsed.query) || raw}”</div>
          </OpSection>
        );
        break;
      case "fetch": {
        consumed.clear();
        consumed.add("url");
        const url = strOf(parsed.url) || "";
        const href = safeHref(url);
        specialized = (
          <OpSection label={t("taskhub.detail.link")}>
            {href ? (
              <a className="ui-depth-op-link" href={href} target="_blank" rel="noopener noreferrer">
                {url}
              </a>
            ) : (
              <div className="ui-depth-op-quote">{url || raw}</div>
            )}
          </OpSection>
        );
        break;
      }
      case "question": {
        consumed.clear();
        consumed.add("questions");
        let questions: QuestionArg[] = [];
        if (Array.isArray(parsed.questions)) questions = parsed.questions as QuestionArg[];
        specialized = (
          <OpSection label={t("taskhub.detail.questions")}>
            {questions.length === 0 ? (
              <div className="ui-depth-op-quote">{raw}</div>
            ) : (
              questions.map((q, i) => (
                <div key={i} className="ui-depth-op-question">
                  <div className="q">
                    {q.header ? <span className="q-header">{q.header}</span> : null}
                    <span className="q-text">{q.question ?? ""}</span>
                  </div>
                  {Array.isArray(q.options) && q.options.length > 0 ? (
                    <div className="q-options">
                      {q.options.map((o, j) => (
                        <div key={j} className="q-option">
                          <span className="q-option-label">{o.label ?? ""}</span>
                          {o.description ? <span className="q-option-desc">{o.description}</span> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </OpSection>
        );
        break;
      }
      case "plan":
        consumed.clear();
        consumed.add("explanation");
        specialized = (
          <OpSection label={t("taskhub.detail.plan")}>
            <div className="ui-depth-op-text">{strOf(parsed.explanation) || raw}</div>
          </OpSection>
        );
        break;
      default:
        break;
    }
  }

  const kvRows = parsed
    ? Object.entries(parsed)
        .filter(([k]) => !consumed.has(k))
        .map(([k, v]) => ({ k, v: typeof v === "string" ? v : JSON.stringify(v) }))
    : [];

  return (
    <div className="ui-depth-op-report">
      <div className="ui-depth-op-head">
        <span className={`ui-depth-op-ic ${step.cls}`}>{TRACE_ICONS[step.cls] ?? <IconToolGeneric />}</span>
        <span className={`ui-depth-op-status ${status}`}>
          {status === "fail"
            ? `✗ ${t("msg.toolFail")}`
            : status === "ok"
              ? `✓ ${t("msg.taskDone")}`
              : `⊘ ${t("taskhub.status.interrupted")}`}
        </span>
        <span className="ui-depth-op-tool">{step.tool}</span>
        {step.mcp ? <span className="ui-depth-op-mcp">{step.mcp}</span> : null}
      </div>
      {status === "interrupted" ? (
        <div className="ui-depth-op-interrupted">
          <IconWarn />
          {t("taskhub.detail.interruptedNote")}
        </div>
      ) : null}
      <div className="ui-depth-op-meta">
        <div className="ui-depth-op-meta-item">
          <span className="ui-depth-op-meta-label">{t("taskrec.detailDuration")}</span>
          <span className="ui-depth-op-meta-value">{step.ms || "—"}</span>
        </div>
        {opTime ? (
          <div className="ui-depth-op-meta-item">
            <span className="ui-depth-op-meta-label">{t("taskrec.detailTime")}</span>
            <span className="ui-depth-op-meta-value">{opTime}</span>
          </div>
        ) : null}
        {step.mcp ? (
          <div className="ui-depth-op-meta-item">
            <span className="ui-depth-op-meta-label">MCP</span>
            <span className="ui-depth-op-meta-value">{step.mcp}</span>
          </div>
        ) : null}
      </div>
      {kind === "assistant" ? (
        <OpSection label={t("taskhub.detail.reply")}>
          <div className="ui-depth-op-text">{raw}</div>
        </OpSection>
      ) : kind === "skill" ? (
        <OpSection label={step.tool}>
          <div className="ui-depth-op-quote">{raw}</div>
        </OpSection>
      ) : (
        <>
          {specialized}
          {kvRows.length > 0 ? (
            <OpSection label={t("taskrec.detailArgs")}>
              {kvRows.map((row) => (
                <div key={row.k} className="ui-depth-op-kv">
                  <span className="k mono">{row.k}</span>
                  <span className="v mono">{row.v}</span>
                </div>
              ))}
            </OpSection>
          ) : !parsed && !specialized && raw ? (
            <OpSection label={t("taskrec.detailArgs")}>
              <pre className="ui-depth-op-pre">{raw}</pre>
            </OpSection>
          ) : null}
        </>
      )}
      {step.resultMd ? (
        <OpSection label={t("taskrec.detailResult")}>
          <pre className="ui-depth-op-pre">{step.resultMd}</pre>
        </OpSection>
      ) : null}
    </div>
  );
}
