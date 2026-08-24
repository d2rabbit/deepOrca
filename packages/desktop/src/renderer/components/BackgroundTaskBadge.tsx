import { useEffect, useMemo, useState, type JSX } from "react";
import { api } from "../api";
import { useI18n, type Translate } from "../i18n";
import { useBuildJobs } from "../hooks/useBuildJobs";
import { buildStageVerb, formatBuildDuration } from "./KnowledgeBuildProgress";
import type { ActionProgressEvent, KnowledgeBuildJobSnapshot } from "../../shared/ipc";

/**
 * BackgroundTaskBadge — the compact bottom-right presence for background work
 * (real-machine feedback: the auto-opening 460px build console plastered over
 * the chat view whenever a build ran; switching to a session should not be
 * interrupted by a large panel). The badge is a small circular progress ring
 * with the MODULE ICON in the center so task types are distinguishable at a
 * glance (◈ 索引与知识 / ⚖ 代码审查); clicking opens the detail view (build
 * console / review panel). The big console itself never auto-opens anymore.
 */

export type BadgeTaskKind = "knowledge" | "review";

const KIND_ICON: Record<BadgeTaskKind, string> = {
  knowledge: "◈",
  review: "⚖",
};

export type BadgeTask = {
  kind: BadgeTaskKind;
  /** 0-100 when known; null → indeterminate ring (LLM stages stream no %). */
  percent: number | null;
  /** One-line status for the tooltip. */
  label: string;
  startedAtMs: number;
};

/** ActionId prefixes that count as review-type background tasks. */
const REVIEW_ACTION_PREFIXES = ["review."];

/** Belt-and-braces staleness guard: drop tracked runs older than this. */
const STALE_MS = 30 * 60 * 1000;

type TrackedRun = { percent: number | null; message: string; at: number };

/**
 * Track renderer-initiated action runs by prefix: appear on the first progress
 * event, disappear on the terminal data.done event the action IPC now emits on
 * every settle path (success/failure/throw).
 */
function useActiveActionRuns(prefixes: string[]): Map<string, TrackedRun> {
  const [runs, setRuns] = useState<Map<string, TrackedRun>>(new Map());
  useEffect(() => {
    const off = api.onActionProgress((event: ActionProgressEvent) => {
      setRuns((prev) => {
        const next = new Map(prev);
        const data = event.data as { done?: boolean } | undefined;
        const matches = prefixes.some((p) => event.actionId.startsWith(p));
        if (data?.done) {
          if (next.delete(event.actionId)) return next;
          return prev;
        }
        if (!matches) return prev;
        next.set(event.actionId, {
          percent: typeof event.percent === "number" ? event.percent : null,
          message: event.message ?? "",
          at: Date.now(),
        });
        return next;
      });
    });
    // Staleness sweep — a lost terminal event must not pin the badge forever.
    const timer = setInterval(() => {
      setRuns((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map<string, TrackedRun>();
        for (const [id, run] of prev) {
          if (now - run.at < STALE_MS) next.set(id, run);
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 30_000);
    return () => {
      off();
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefixes is a module-literal constant
  }, []);
  return runs;
}

function knowledgeTask(jobs: KnowledgeBuildJobSnapshot[], t: Translate): BadgeTask | null {
  const running = jobs.filter((j) => j.running).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const job = running[0];
  if (!job) return null;
  const stage = job.stages.find((s) => s.status === "running");
  const verb = stage ? buildStageVerb(stage, job.mode, t) : t("index.building");
  const elapsed = formatBuildDuration(job.startedAt, undefined, Date.now());
  return {
    kind: "knowledge",
    percent: typeof job.percent === "number" ? job.percent : null,
    label: `${verb} · ${elapsed}${running.length > 1 ? ` · +${running.length - 1}` : ""}`,
    startedAtMs: new Date(job.startedAt).getTime(),
  };
}

function reviewTask(runs: Map<string, TrackedRun>, t: Translate): BadgeTask | null {
  let latest: { id: string; run: TrackedRun } | null = null;
  for (const [id, run] of runs) {
    if (!latest || run.at > latest.run.at) latest = { id, run };
  }
  if (!latest) return null;
  const detail = latest.run.message ? ` · ${latest.run.message.slice(0, 60)}` : "";
  return {
    kind: "review",
    percent: latest.run.percent,
    label: `${t("task.reviewRunning")}${detail}`,
    startedAtMs: latest.run.at,
  };
}

/** SVG ring geometry. */
const RING_SIZE = 44;
const RING_R = 19;
const RING_C = 2 * Math.PI * RING_R;

export function BackgroundTaskBadge({ onOpen }: { onOpen: (kind: BadgeTaskKind) => void }): JSX.Element | null {
  const { t } = useI18n();
  const buildJobs = useBuildJobs();
  const reviewRuns = useActiveActionRuns(REVIEW_ACTION_PREFIXES);

  const task = useMemo<BadgeTask | null>(() => {
    const k = knowledgeTask(buildJobs, t);
    const r = reviewTask(reviewRuns, t);
    if (k && r) return k.startedAtMs >= r.startedAtMs ? k : r;
    return k ?? r;
    // buildJobs refreshes on every poll/event; the elapsed label stays fresh.
  }, [buildJobs, reviewRuns, t]);

  if (!task) return null;
  const indeterminate = task.percent == null;
  const progress = Math.min(100, Math.max(0, task.percent ?? 0));

  return (
    <button
      type="button"
      className={`ui-task-badge kind-${task.kind}${indeterminate ? " indeterminate" : ""}`}
      onClick={() => onOpen(task.kind)}
      title={`${task.label} · ${t("task.badgeHint")}`}
      aria-label={`${task.label} · ${t("task.badgeHint")}`}
      role="status"
    >
      <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden>
        <circle
          className="ui-task-badge-track"
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_R}
          fill="none"
          strokeWidth="3"
        />
        {indeterminate ? (
          <circle
            className="ui-task-badge-arc ui-task-badge-sweep"
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_R}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${RING_C * 0.72} ${RING_C * 0.28}`}
          />
        ) : (
          <circle
            className="ui-task-badge-arc"
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_R}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={String(RING_C)}
            strokeDashoffset={String(RING_C * (1 - progress / 100))}
          />
        )}
      </svg>
      <span className="ui-task-badge-icon" aria-hidden>
        {KIND_ICON[task.kind]}
      </span>
    </button>
  );
}
