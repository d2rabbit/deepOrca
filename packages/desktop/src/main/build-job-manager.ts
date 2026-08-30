/**
 * BuildJobManager (specs/index-knowledge-rework R2-1): the background build
 * process for workspace indexing. Jobs live HERE, in the main process — not
 * in the renderer's React state — so switching rows/tabs/views never drops a
 * running build, and returning to the row shows live progress again.
 *
 * One job per workspace root (idempotent): a second click while running
 * returns the in-flight job. Different roots build in parallel.
 *
 * R3-5 observability: every progress line is folded into a per-stage state
 * machine (codegraph → wiki → arch) plus a console log ring buffer, and is
 * echoed to the main-process log. The wiki stage produces NO progress stream
 * of its own (openwiki --print buffers all output until exit), so the stage
 * view shows status + elapsed instead of a frozen percent — "stuck at 36%"
 * was a live 10-minute wiki run with nothing to look at.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ActionRegistry } from "@deeporca/core";
import { IpcEvent } from "../shared/ipc.js";
import type { KnowledgeBuildJobSnapshot, KnowledgeBuildStageState } from "../shared/ipc.js";

function existsCodegraph(root: string): boolean {
  return existsSync(join(root, ".codegraph", "codegraph.db"));
}

function existsWiki(root: string): boolean {
  // Canonical deepwiki/ store — the openwiki/ dir is a run-local stage.
  return existsSync(join(root, "deepwiki"));
}

/** Console ring buffer cap — enough history for a long build's console view. */
const MAX_LOG_LINES = 500;

/** Minimal shape of index.build-all's result needed for stage-failure surfacing. */
type IndexBuildResult = {
  stages?: Array<{ stage: string; ok: boolean; skipped?: boolean; error?: string }>;
};

type Emit = (channel: string, payload: unknown) => void;

type Job = KnowledgeBuildJobSnapshot;

function initialStages(): KnowledgeBuildStageState[] {
  // All three stages run on EVERY build (each refreshes in place when its
  // artifacts exist) — arch included: an update build that dropped the arch
  // row entirely read as "架构图没有执行" with no explanation (2026-08-27).
  return [
    // The action always starts with the symbol index — mark it running from
    // the first broadcast so the very first frame reads "正在生成/更新索引"
    // instead of the generic "构建中…" fallback (progress complaint).
    { id: "codegraph", labelKey: "codegraph", status: "running", startedAt: nowIso() },
    { id: "wiki", labelKey: "wiki", status: "pending" },
    { id: "arch-scan", labelKey: "arch", status: "pending" },
  ];
}

function nowIso(): string {
  return new Date().toISOString();
}

function logStamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export class BuildJobManager {
  private jobs = new Map<string, Job>();

  constructor(
    private readonly getRegistry: () => ActionRegistry | null,
    private readonly emit: Emit
  ) {}

  /**
   * Start (or return the in-flight) build for a root. Idempotent per root.
   * mode: explicit, or "auto" — resolved to update when both indexes exist
   * (knowledgeStatus probe), else init.
   */
  start(root: string, mode?: "init" | "update" | "auto"): KnowledgeBuildJobSnapshot {
    const existing = this.jobs.get(root);
    if (existing && existing.running) {
      return this.snapshot(existing);
    }
    const resolved = mode && mode !== "auto" ? mode : this.probeMode(root);
    const startedAt = nowIso();
    const job: Job = {
      root,
      mode: resolved,
      stage: "starting",
      percent: 5,
      error: null,
      startedAt,
      updatedAt: startedAt,
      running: true,
      stages: initialStages(),
      logs: [`${logStamp()} build ${resolved} started`],
    };
    this.jobs.set(root, job);
    console.log(`[build:${root}] ${resolved} started`);
    // Broadcast immediately — the first action progress line can arrive many
    // seconds in (codegraph warmup), and without this the row/knowledge tab
    // show no busy state at all during that window ("no progress" report).
    this.broadcast(job);
    void this.run(job);
    return this.snapshot(job);
  }

  /** All job snapshots for row rendering. */
  status(): KnowledgeBuildJobSnapshot[] {
    return [...this.jobs.values()].map((job) => this.snapshot(job));
  }

  private async run(job: Job): Promise<void> {
    try {
      const registry = this.getRegistry();
      if (!registry) {
        throw new Error("no project open");
      }
      const runHandle = registry.execute<{ mode?: string; root?: string }, IndexBuildResult>("index.build-all", {
        mode: job.mode,
        root: job.root,
      });
      runHandle.onProgress((e: { message?: string; percent?: number }) => {
        if (e.message) this.record(job, e.message, e.percent);
        else if (typeof e.percent === "number") this.record(job, `… ${e.percent}%`, e.percent);
      });
      const result = await runHandle.result;
      // Surface per-stage failures: index.build-all catches stage errors into
      // its stages[] report and RETURNS normally, so without this check a
      // failed wiki/arch stage showed up as a "done" build whose knowledge
      // status never moved off 未同步 — with no hint why anywhere in the UI.
      const report = result?.stages ?? [];
      for (const s of report) {
        const stage = job.stages.find((x) => x.id === s.stage);
        if (!stage) continue;
        if (s.skipped) {
          this.setStage(job, stage, "skipped", undefined, s.error);
        } else if (!s.ok) {
          this.setStage(job, stage, "failed", undefined, s.error);
        } else if (stage.status !== "failed" && stage.status !== "skipped") {
          this.setStage(job, stage, "done");
        }
      }
      const failed = report.filter((s) => !s.ok && !s.skipped);
      if (failed.length > 0) {
        job.stage = "failed";
        // FULL text — the per-stage error carries the decodable diagnostics
        // (prototypes listing, last validate path). UI render sites clip for
        // display via formatBuildError; truncating here amputated exactly the
        // evidence the message exists to carry (blue-team F1, 2026-08-30).
        job.error = failed.map((s) => `${s.stage}: ${s.error ?? "failed"}`).join("; ");
        job.running = false;
        this.pushLog(job, `build FAILED — ${job.error}`);
        console.log(`[build:${job.root}] FAILED — ${job.error}`);
        this.broadcast(job);
        this.emitSettled(job.root);
        return;
      }
      job.stage = "done";
      job.percent = 100;
      job.running = false;
      this.pushLog(job, "build complete");
      console.log(`[build:${job.root}] complete`);
      this.broadcast(job);
      // Post-build: tell the renderer to refresh the knowledge status for
      // this root — the build may have produced wiki pages / arch maps that
      // the left-rail row and knowledge tab need to re-read.
      this.emitSettled(job.root);
    } catch (err) {
      job.stage = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      job.running = false;
      // Any stage still "running" when the action threw never got a verdict.
      for (const stage of job.stages) {
        if (stage.status === "running") this.setStage(job, stage, "failed", undefined, job.error ?? undefined);
      }
      this.pushLog(job, `build FAILED — ${job.error}`);
      console.log(`[build:${job.root}] FAILED — ${job.error}`);
      this.broadcast(job);
      this.emitSettled(job.root);
    }
  }

  /**
   * Fold one progress line into the job: stage state machine + console log +
   * main-process log + broadcast. The action prefixes every line with
   * "[n/3]"; the stage that line n refers to is n-1 in our stage list (the
   * action always runs codegraph → wiki → arch-scan).
   */
  private record(job: Job, message: string, percent?: number): void {
    job.stage = message;
    if (typeof percent === "number") job.percent = percent;
    job.updatedAt = nowIso();
    const stageMatch = message.match(/^\[(\d)\/3\]\s*(.*)$/);
    if (stageMatch) {
      const idx = Number(stageMatch[1]) - 1;
      const rest = stageMatch[2] ?? "";
      const stage = job.stages[idx];
      if (stage) {
        // Earlier stages implicitly finished once a later one starts talking —
        // but a stage that already announced a TERMINAL verdict keeps it
        // (red-team B-2, 2026-08-30: "stage failed" then the next "[2/3]"
        // header promoted the failed stage to a green done).
        for (let i = 0; i < idx; i++) {
          const prev = job.stages[i];
          if (prev && prev.status === "running") this.setStage(job, prev, "done");
          if (prev && prev.status === "pending") this.setStage(job, prev, "skipped");
        }
        if (/done|complete/i.test(rest)) {
          this.setStage(job, stage, "done");
        } else if (/\bstage failed\b/i.test(rest)) {
          // Terminal failure verdict from the action itself — parseable so the
          // stage never flashes green and the detail carries the verdict.
          this.setStage(job, stage, "failed", rest);
        } else if (/\bstage skipped\b/i.test(rest)) {
          this.setStage(job, stage, "skipped", rest);
        } else if (stage.status !== "done") {
          this.setStage(job, stage, "running", rest);
        }
      }
    }
    this.pushLog(job, message);
    console.log(`[build:${job.root}] ${message}`);
    this.broadcast(job);
  }

  private setStage(
    job: Job,
    stage: KnowledgeBuildStageState,
    status: KnowledgeBuildStageState["status"],
    detail?: string,
    error?: string
  ): void {
    stage.status = status;
    if (detail !== undefined) stage.detail = detail;
    if (error !== undefined) stage.error = error;
    if (status === "running" && !stage.startedAt) stage.startedAt = nowIso();
    if (status === "done" || status === "failed" || status === "skipped") stage.endedAt = nowIso();
  }

  private pushLog(job: Job, line: string): void {
    job.logs.push(`${logStamp()} ${line}`);
    if (job.logs.length > MAX_LOG_LINES) job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
  }

  /** Build settled (success or failure): panels re-read statuses/artifacts. */
  private emitSettled(root: string): void {
    this.emit(IpcEvent.ActionProgress, {
      actionId: "knowledge.buildComplete",
      message: "build settled",
      percent: 100,
      data: { root },
    });
  }

  /** Progress hook wired to the bridge's action progress stream. */
  onProgress(root: string, message: string, percent?: number): void {
    const job = this.jobs.get(root);
    if (!job || !job.running) return;
    this.record(job, message, percent);
  }

  private broadcast(job: Job): void {
    this.emit(IpcEvent.ActionProgress, {
      actionId: "index.build-all",
      message: job.stage,
      percent: job.percent ?? undefined,
      // Full snapshot so subscribers update instantly without waiting for
      // their 2s poll (progress latency complaint).
      data: { root: job.root, job: this.snapshot(job) },
    });
  }

  private snapshot(job: Job): KnowledgeBuildJobSnapshot {
    // Deep-copy stages/logs: the renderer must never alias live job state.
    return {
      ...job,
      stages: job.stages.map((s) => ({ ...s })),
      logs: [...job.logs],
    };
  }

  /** auto → update when both symbol and wiki indexes exist, else init. */
  private probeMode(root: string): "init" | "update" {
    try {
      const cg = existsCodegraph(root);
      const wiki = existsWiki(root);
      return cg && wiki ? "update" : "init";
    } catch {
      return "init";
    }
  }
}
