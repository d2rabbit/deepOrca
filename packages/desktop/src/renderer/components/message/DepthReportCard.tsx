/**
 * DepthReportCard — the dedicated renderer for the deep-lane decision report
 * (specs/depth-lane 渲染优化, user ask 2026-09-05): replaces the raw
 * `<proposed_plan>` markdown dump with a structured card — 结论先行 hero,
 * confidence bar, divergence/assumption/risk lists (irreversible risks
 * flagged on top), numbered next steps, and the 任务轨迹 integration: one
 * click seeds a task tree from the report ("落为任务轨迹" via
 * api.taskTreeCreate), so a deep decision flows straight into the
 * task-trajectory module instead of dying in the chat transcript.
 */
import { useState, type JSX } from "react";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { depthReportTaskPrompt, type DepthReport } from "../../lib/depth-report";
import { IconLaneDeep } from "../../ui/icons";

type TaskCreateResult = { treeId?: string; error?: string };

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="ui-depth-report-section">
      <div className="ui-depth-report-section-title">{title}</div>
      {children}
    </div>
  );
}

export function DepthReportCard({ report }: { report: DepthReport }): JSX.Element {
  const { t } = useI18n();
  const [taskState, setTaskState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [taskError, setTaskError] = useState<string>("");

  const handleToTaskTree = (): void => {
    if (taskState === "busy" || taskState === "done") return;
    setTaskState("busy");
    void api
      .taskTreeCreate(depthReportTaskPrompt(report).slice(0, 500), "deep-lane report", undefined)
      .then((result: TaskCreateResult) => {
        if (result?.treeId) {
          setTaskState("done");
        } else {
          setTaskState("error");
          setTaskError(result?.error ?? "failed");
        }
      })
      .catch((err: unknown) => {
        setTaskState("error");
        setTaskError(err instanceof Error ? err.message : String(err));
      });
  };

  return (
    <div className="ui-depth-report">
      <div className="ui-depth-report-head">
        <span className="ui-lane-badge ui-lane-badge--deep">
          <IconLaneDeep />
          {t("depth.report.title")}
        </span>
        <span className="ui-depth-report-confidence">
          {t("depth.report.confidence")}
          <span className="ui-depth-report-conf-track">
            <span className="ui-depth-report-conf-fill" style={{ width: `${report.confidencePct ?? 0}%` }} />
          </span>
          <span className="ui-depth-report-conf-value">{report.confidenceText || "—"}</span>
        </span>
      </div>

      {!report.converged ? <div className="ui-depth-report-unconverged">{t("depth.report.unconverged")}</div> : null}

      <div className="ui-depth-report-conclusion">{report.conclusion || "—"}</div>

      {report.irreversible.length > 0 ? (
        <div className="ui-depth-report-irreversible">
          <div className="ui-depth-report-section-title">⚠ {t("depth.report.irreversible")}</div>
          <ul>
            {report.irreversible.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Section title={t("depth.report.divergences")}>
        <ul>
          {report.divergences.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </Section>

      <Section title={t("depth.report.assumptions")}>
        <ul>
          {report.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </Section>

      {report.risks.length > 0 ? (
        <Section title={t("depth.report.risks")}>
          <ul>
            {report.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {report.nextSteps.length > 0 ? (
        <Section title={t("depth.report.nextSteps")}>
          <ol>
            {report.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </Section>
      ) : null}

      <div className="ui-depth-report-actions">
        <button
          type="button"
          className="ui-depth-report-task-btn"
          onClick={handleToTaskTree}
          disabled={taskState === "busy" || taskState === "done"}
        >
          {taskState === "done"
            ? t("depth.report.taskDone")
            : taskState === "busy"
              ? t("depth.report.taskBusy")
              : t("depth.report.toTaskTree")}
        </button>
        {taskState === "error" ? (
          <span className="ui-depth-report-task-error">
            {t("depth.report.taskError")}：{taskError}
          </span>
        ) : null}
      </div>
    </div>
  );
}
