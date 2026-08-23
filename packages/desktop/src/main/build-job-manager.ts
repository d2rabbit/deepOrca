/**
 * BuildJobManager (specs/index-knowledge-rework R2-1): the background build
 * process for workspace indexing. Jobs live HERE, in the main process — not
 * in the renderer's React state — so switching rows/tabs/views never drops a
 * running build, and returning to the row shows live progress again.
 *
 * One job per workspace root (idempotent): a second click while running
 * returns the in-flight job. Different roots build in parallel. Progress is
 * broadcast through the existing ActionProgress event (actionId
 * "index.build-all", message carries the stage; the job map is also polled
 * via knowledge.buildStatus for row rendering).
 */

import type { ActionRegistry } from "@deeporca/core";
import { IpcEvent } from "../shared/ipc.js";

export type BuildJobSnapshot = {
  root: string;
  mode: "init" | "update";
  stage: string;
  percent: number | null;
  error: string | null;
  startedAt: string;
  running: boolean;
};

type Emit = (channel: string, payload: unknown) => void;

type Job = {
  root: string;
  mode: "init" | "update";
  stage: string;
  percent: number | null;
  error: string | null;
  startedAt: string;
  running: boolean;
};

export class BuildJobManager {
  private jobs = new Map<string, Job>();

  constructor(
    private readonly getRegistry: () => ActionRegistry | null,
    private readonly emit: Emit
  ) {}

  /** Start (or return the in-flight) build for a root. Idempotent per root. */
  start(root: string): BuildJobSnapshot {
    const existing = this.jobs.get(root);
    if (existing && existing.running) {
      return this.snapshot(existing);
    }
    // mode: init when either index is absent, else update.
    const job: Job = {
      root,
      mode: "init",
      stage: "starting",
      percent: 5,
      error: null,
      startedAt: new Date().toISOString(),
      running: true,
    };
    this.jobs.set(root, job);
    void this.run(job);
    return this.snapshot(job);
  }

  /** All job snapshots for row rendering. */
  status(): BuildJobSnapshot[] {
    return [...this.jobs.values()].map((job) => this.snapshot(job));
  }

  private async run(job: Job): Promise<void> {
    try {
      const registry = this.getRegistry();
      if (!registry) {
        throw new Error("no project open");
      }
      const runHandle = registry.execute("index.build-all", { mode: job.mode, root: job.root });
      runHandle.onProgress((e: { message?: string; percent?: number }) => {
        job.stage = e.message ?? job.stage;
        if (typeof e.percent === "number") job.percent = e.percent;
        this.broadcast(job);
      });
      await runHandle.result;
      job.stage = "done";
      job.percent = 100;
      job.running = false;
      this.broadcast(job);
    } catch (err) {
      job.stage = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      job.running = false;
      this.broadcast(job);
    }
  }

  /** Progress hook wired to the bridge's action progress stream. */
  onProgress(root: string, message: string, percent?: number): void {
    const job = this.jobs.get(root);
    if (!job || !job.running) return;
    job.stage = message;
    if (typeof percent === "number") job.percent = percent;
    this.broadcast(job);
  }

  private broadcast(job: Job): void {
    this.emit(IpcEvent.ActionProgress, {
      actionId: "index.build-all",
      message: job.stage,
      percent: job.percent ?? undefined,
      data: { root: job.root },
    });
  }

  private snapshot(job: Job): BuildJobSnapshot {
    return { ...job };
  }
}
