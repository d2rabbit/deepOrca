/**
 * useBuildJobs — shared renderer store over the main-process build job map
 * (specs/index-knowledge-rework R3-5).
 *
 * ONE poller for the whole app: any mounted consumer subscribes, the first
 * subscriber starts a 2s knowledgeBuildStatus poll, the last unsubscriber
 * stops it. Progress events (index.build-all) refresh instantly — the event
 * carries the full job snapshot — so the console and rows update without
 * waiting for the next poll tick. Because jobs live in the MAIN process,
 * switching tabs/rows/remounting always re-reads live state (the old
 * per-component polling duplicated timers and lost nothing, but also showed
 * nothing after remount until its own poll fired).
 */

import { useEffect, useState } from "react";
import { api } from "../api";
import type { ActionProgressEvent, KnowledgeBuildJobSnapshot } from "../../shared/ipc";

let cache: KnowledgeBuildJobSnapshot[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

async function refresh(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const jobs = await api.knowledgeBuildStatus();
    cache = jobs;
    notify();
  } catch {
    // status poll failure is non-fatal — keep the last snapshot
  } finally {
    inFlight = false;
  }
}

function ensurePolling(): () => void {
  listeners.add(notifyWrapper);
  if (!pollTimer) {
    pollTimer = setInterval(() => void refresh(), 2000);
    void refresh();
  }
  return () => {
    listeners.delete(notifyWrapper);
    if (listeners.size === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

// Stable identity for the listener set (notify itself is stable already, but
// keep an explicit wrapper so the unsubscribe logic stays obvious).
const notifyWrapper = notify;

// Instant refresh on progress events — the broadcast carries the full job
// snapshot in event.data.job. Registered once at module load (the api event
// subscription lives as long as the renderer).
let eventWired = false;
function wireEvents(): void {
  if (eventWired) return;
  eventWired = true;
  api.onActionProgress((event: ActionProgressEvent) => {
    if (event.actionId !== "index.build-all") return;
    const job = (event.data as { job?: KnowledgeBuildJobSnapshot } | undefined)?.job;
    if (job) {
      const idx = cache.findIndex((j) => j.root === job.root);
      if (idx >= 0) cache[idx] = job;
      else cache = [...cache, job];
      notify();
      return;
    }
    void refresh();
  });
}

export function useBuildJobs(): KnowledgeBuildJobSnapshot[] {
  const [jobs, setJobs] = useState<KnowledgeBuildJobSnapshot[]>(cache);
  useEffect(() => {
    wireEvents();
    const unsubscribe = ensurePolling();
    const update = (): void => setJobs([...cache]);
    listeners.add(update);
    // Catch up immediately on mount (the poll may be mid-cycle).
    void refresh();
    return () => {
      listeners.delete(update);
      unsubscribe();
    };
  }, []);
  return jobs;
}
