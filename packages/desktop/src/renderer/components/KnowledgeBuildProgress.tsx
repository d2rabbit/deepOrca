import { useEffect, useState, type JSX } from "react";
import { useI18n, type Translate } from "../i18n";
import { formatBuildError } from "../lib/build-error";
import type { KnowledgeBuildJobSnapshot, KnowledgeBuildStageState } from "../../shared/ipc";

/**
 * KnowledgeBuildProgress — the stage checklist for a running knowledge build
 * (real-machine feedback: the old one-line banner rendered "label · mm:ss",
 * which read as a bare timer). The panel makes the pipeline itself visible —
 * 生成/更新索引 → 构建 Wiki（读取符号索引加速）→ 架构图 — with per-stage
 * state, per-stage elapsed, the running stage's latest live line, and (full
 * variant) a short console tail. The wiki stage genuinely consumes the
 * stage-1 symbol index (WikiCliController wires it in), so the hint is
 * descriptive of real behavior, not decoration.
 *
 * Where it renders (real-machine feedback #2): "compact" lives UNDER the
 * workspace's row in the left rail — progress belongs next to the thing being
 * built, not inside the knowledge tab; "full" keeps the console tail for
 * wider surfaces.
 *
 * Props-driven (no api import) so the DOM test harness can render it cold.
 */

const STATUS_MARK: Record<KnowledgeBuildStageState["status"], string> = {
  pending: "·",
  running: "●",
  done: "✓",
  failed: "✗",
  skipped: "—",
};

/** Console tail shown under the checklist — liveness without the full console. */
const TAIL_LINES = 5;

/** Compact duration: "12s" / "3m24s" (same shape as the build console). */
export function formatBuildDuration(fromIso: string | undefined, toIso: string | undefined, nowMs: number): string {
  if (!fromIso) return "";
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : nowMs;
  const secs = Math.max(0, Math.round((to - from) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** Running-stage verb, mode-aware for stage 1: 生成索引 vs 更新索引. */
export function buildStageVerb(
  stage: Pick<KnowledgeBuildStageState, "labelKey">,
  mode: string | undefined,
  t: Translate
): string {
  if (stage.labelKey === "codegraph") {
    return mode === "update" ? t("index.buildStageIndexUpdate") : t("index.buildStageIndexInit");
  }
  // Explicit per-stage verbs: a catch-all else here once made the translate
  // stage print the ARCH verb ("双语翻译 · 正在生成架构图" — 2026-08-27).
  if (stage.labelKey === "wiki") return t("index.buildStageWiki");
  return t("index.buildStageArch");
}

/** Checklist noun: 索引 / Wiki / 架构图. */
export function buildStageName(stage: Pick<KnowledgeBuildStageState, "labelKey">, t: Translate): string {
  return stage.labelKey === "codegraph"
    ? t("index.stageIndexName")
    : stage.labelKey === "wiki"
      ? t("index.stageWikiName")
      : t("index.stageArchName");
}

export function KnowledgeBuildProgress({
  job,
  variant = "full",
}: {
  job: KnowledgeBuildJobSnapshot;
  /** compact = under-row rail placement (no console tail, tighter). */
  variant?: "full" | "compact";
}): JSX.Element {
  const { t } = useI18n();
  // 1s tick while running so per-stage elapsed counters advance even when the
  // stage itself emits nothing (the wiki LLM stage streams no progress).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!job.running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job.running]);

  const modeLabel = job.mode === "update" ? t("index.buildModeUpdate") : t("index.buildModeInit");
  const headText = job.running
    ? `${t("index.building")} · ${modeLabel} · ${t("index.buildElapsed", {
        time: formatBuildDuration(job.startedAt, undefined, now),
      })}`
    : job.error
      ? `${t("index.stageFailed")} — ${formatBuildError(job.error, t, 160)}`
      : `${t("index.stageDone")} · ${modeLabel} · ${formatBuildDuration(job.startedAt, job.updatedAt, now)}`;
  const tail = job.logs.slice(-TAIL_LINES);

  return (
    <div className={`ui-knowledge-build${variant === "compact" ? " compact" : ""}`} role="status">
      <div className="ui-knowledge-build-head">
        {job.running ? (
          <span className="ui-spinner" aria-hidden />
        ) : (
          <span className="ui-knowledge-build-mark">{job.error ? "✗" : "✓"}</span>
        )}
        <span className="ui-knowledge-build-title">{headText}</span>
      </div>
      <ol className="ui-knowledge-build-stages">
        {job.stages.map((stage) => {
          const name = buildStageName(stage, t);
          let detail = "";
          if (stage.status === "running") {
            const elapsed = formatBuildDuration(stage.startedAt, undefined, now);
            const hint = stage.labelKey === "wiki" ? ` · ${t("index.stageWikiHint")}` : "";
            detail = `${buildStageVerb(stage, job.mode, t)}${elapsed ? ` · ${elapsed}` : ""}${hint}`;
          } else if (stage.status === "done") {
            const dur = formatBuildDuration(stage.startedAt, stage.endedAt, now);
            detail = `${t("index.stageDone")}${dur ? ` · ${dur}` : ""}`;
          } else if (stage.status === "failed") {
            detail = `${t("index.stageFailed")}${stage.error ? ` — ${formatBuildError(stage.error, t, 400)}` : ""}`;
          } else if (stage.status === "skipped") {
            detail = t("index.stageSkipped");
          } else {
            detail = t("index.stagePending");
          }
          return (
            <li key={stage.id} className={`ui-knowledge-build-stage st-${stage.status}`}>
              <span className="ui-knowledge-build-mark" aria-hidden>
                {STATUS_MARK[stage.status]}
              </span>
              <span className="ui-knowledge-build-stage-name">{name}</span>
              <span className="ui-knowledge-build-stage-detail">{detail}</span>
              {/* Running stage's freshest progress line (page counts, heartbeats)
                  as a wrap row — the rail panel has no console tail. */}
              {stage.status === "running" && stage.detail ? (
                <span className="ui-knowledge-build-stage-live">{stage.detail}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {variant === "full" && tail.length > 0 ? (
        <div className="ui-knowledge-build-console">
          <div className="ui-knowledge-build-console-title">{t("index.buildConsole")}</div>
          {tail.map((line, i) => (
            <div key={i} className="ui-knowledge-build-console-line">
              {line.length > 160 ? `${line.slice(0, 160)}…` : line}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
