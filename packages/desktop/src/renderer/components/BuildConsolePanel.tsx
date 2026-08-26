/**
 * BuildConsolePanel (specs/index-knowledge-rework R3-5) — the build's live
 * console rendered as a TEMPORARY A2UI surface, floating over the bottom-right
 * corner of the window.
 *
 * Floating (not docked) on purpose: the build must stay observable from ANY
 * tab — the user asked "switch away and come back and I can't see progress";
 * a floating console means they don't even have to come back. The surface is
 * renderer-local (surfaceId "build-console", component-message batches
 * replayed by the real A2uiSurface renderer): it never enters the
 * main-process a2ui server map, so it is never persisted and never collides
 * with arch-prefixed or design surfaces. It auto-opens when a build starts
 * and keeps its final per-stage verdict until dismissed.
 */

import { useEffect, useMemo, useState, type JSX } from "react";
import { A2uiSurface } from "../a2ui/A2uiSurface";
import { useBuildJobs } from "../hooks/useBuildJobs";
import { useI18n, type Translate } from "../i18n";
import { formatBuildError } from "../lib/build-error";
import { BASIC_CATALOG_ID } from "../../shared/a2ui-legacy";
import type { KnowledgeBuildJobSnapshot, KnowledgeBuildStageState } from "../../shared/ipc";

const SURFACE_ID = "build-console";

/** Console tail length — the A2UI tree stays small enough to re-render at 1Hz. */
const CONSOLE_LINES = 14;

function formatElapsed(fromIso: string | undefined, toIso: string | undefined, nowMs: number): string {
  if (!fromIso) return "";
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : nowMs;
  const secs = Math.max(0, Math.round((to - from) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

const STAGE_LABEL_KEYS: Record<
  KnowledgeBuildStageState["labelKey"],
  "build.stage.codegraph" | "build.stage.wiki" | "build.stage.arch" | "build.stage.wikiTranslate"
> = {
  codegraph: "build.stage.codegraph",
  wiki: "build.stage.wiki",
  arch: "build.stage.arch",
  "wiki-translate": "build.stage.wikiTranslate",
};

const STATUS_MARK: Record<KnowledgeBuildStageState["status"], string> = {
  pending: "·",
  running: "●",
  done: "✓",
  failed: "✗",
  skipped: "—",
};

function rootLabel(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? root;
}

/** Build the official v0.9 message batch for a job snapshot (component
 *  adjacency list: flat components with forward `children` references; one
 *  component carries id "root"). Status marks are Text glyphs — the official
 *  Icon enum only accepts Material-Symbols names. */
function buildMessages(job: KnowledgeBuildJobSnapshot, nowMs: number, t: Translate): string {
  const overall = job.running
    ? t("build.overallRunning", { time: formatElapsed(job.startedAt, undefined, nowMs) })
    : job.error
      ? t("build.overallFailed", { time: formatElapsed(job.startedAt, job.updatedAt, nowMs) })
      : t("build.overallDone", { time: formatElapsed(job.startedAt, job.updatedAt, nowMs) });

  const components: Array<{ id: string; component: string; children?: string[] } & Record<string, unknown>> = [];
  const add = (id: string, component: string, props: Record<string, unknown> = {}, children?: string[]): void => {
    components.push({ id, component, ...props, ...(children ? { children } : {}) });
  };

  add("root", "Column", {}, [
    "title",
    "subtitle",
    "sep1",
    ...job.stages.flatMap((st) => [`stage-${st.id}`, `mark-${st.id}`, `label-${st.id}`]),
    "sep2",
    "console",
  ]);
  add("title", "Text", { text: t("build.title", { root: rootLabel(job.root) }), variant: "h3" });
  add("subtitle", "Text", {
    text: `${job.mode === "init" ? t("build.mode.init") : t("build.mode.incremental")} · ${overall}`,
    variant: "body",
  });
  add("sep1", "Divider");

  // Stage checklist: mark (Text glyph) + label row per stage.
  for (const stage of job.stages) {
    const sid = stage.id;
    add(`stage-${sid}`, "Row", {}, [`mark-${sid}`, `label-${sid}`]);
    add(`mark-${sid}`, "Text", { text: STATUS_MARK[stage.status], variant: "h4" });
    const elapsed = formatElapsed(stage.startedAt, stage.endedAt, nowMs);
    const detailText =
      `${t(STAGE_LABEL_KEYS[stage.labelKey])}${elapsed ? ` · ${elapsed}` : ""}` +
      (stage.labelKey === "wiki" && stage.status === "running" ? ` · ${t("build.wikiHint")}` : "") +
      (stage.status === "failed" && stage.error ? ` — ${formatBuildError(stage.error, t, 80)}` : "");
    add(`label-${sid}`, "Text", {
      text: detailText,
      variant: stage.status === "running" ? "h5" : "body",
    });
  }

  add("sep2", "Divider");

  // Console tail inside a card (single child per official Card).
  const tail = job.logs.slice(-CONSOLE_LINES);
  const consoleChildren = ["console-title", ...(tail.length > 0 ? tail.map((_, i) => `log-${i}`) : ["console-empty"])];
  add("console", "Card", {}, ["console-inner"]);
  add("console-inner", "Column", {}, consoleChildren);
  add("console-title", "Text", { text: t("build.consoleTitle"), variant: "caption" });
  if (tail.length === 0) {
    add("console-empty", "Text", { text: t("build.consoleEmpty"), variant: "caption" });
  } else {
    tail.forEach((line, i) => {
      add(`log-${i}`, "Text", {
        text: line.length > 160 ? `${line.slice(0, 160)}…` : line,
        variant: "caption",
      });
    });
  }

  return JSON.stringify([
    { version: "v0.9", createSurface: { surfaceId: SURFACE_ID, catalogId: BASIC_CATALOG_ID } },
    { version: "v0.9", updateComponents: { surfaceId: SURFACE_ID, components } },
  ]);
}

export function BuildConsolePanel({ onClose }: { onClose: () => void }): JSX.Element | null {
  const { t } = useI18n();
  const jobs = useBuildJobs();

  // Prefer a running job; else the most recently updated job (final verdict
  // stays visible after completion).
  const job = useMemo(() => {
    const running = jobs.filter((j) => j.running).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    if (running.length > 0) return running[0];
    const settled = [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return settled[0] ?? null;
  }, [jobs]);

  // 1s tick while a job runs so elapsed counters advance.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!job?.running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job?.running]);

  const messagesJson = useMemo(() => (job ? buildMessages(job, now, t) : null), [job, now, t]);

  if (!job || !messagesJson) return null;
  return (
    <div className="ui-build-console">
      <div className="ui-build-console-head">
        <span className="ui-build-console-title">
          {STATUS_MARK[job.running ? "running" : job.error ? "failed" : "done"]}{" "}
          {t("build.title", { root: rootLabel(job.root) })}
        </span>
        <button type="button" className="ui-build-console-close" onClick={onClose} title={t("build.closeHint")}>
          ✕
        </button>
      </div>
      <div className="ui-build-console-body">
        <A2uiSurface messagesJson={messagesJson} surfaceId={SURFACE_ID} />
      </div>
    </div>
  );
}
