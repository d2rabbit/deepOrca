// §6 experiment metrics (experiment-plan.md): review points #1/#2 decide the
// Deck layout's fate from data — core-path funnel (prompt → approval → diff)
// click counts and latency per layout, plus layout switch/boot bookkeeping
// (开启率 / 7 日留存 raw material). Collected at the shared api seam so BOTH
// layouts are captured without touching classic components (isolation red
// line §1). localStorage only — data never leaves the machine.
//
// Fail-open by construction: every recording path is best-effort; metrics can
// never break the app. Ring-capped so long sessions can't grow storage.

import type { DesktopApi } from "../../shared/ipc";

export type LayoutName = "classic" | "deck";
export type ApprovalOutcome = "none" | "granted" | "denied";

export type CorePathRunEvent = {
  layout: LayoutName;
  ts: number;
  /** Wall time from prompt to diff view. */
  ms: number;
  clicks: number;
  approval: ApprovalOutcome;
  /** True when the run reached the diff step; false = superseded/abandoned. */
  completed: boolean;
};

export type CorePathSummary = {
  boots: { classic: number; deck: number };
  switches: { toClassic: number; toDeck: number };
  runs: { classic: FunnelStats | null; deck: FunnelStats | null };
};

export type FunnelStats = {
  runs: number;
  completed: number;
  avgClicks: number;
  avgMs: number;
};

const STORAGE_KEY = "deeporca.experiment.metrics";
const MAX_BOOTS = 400;
const MAX_SWITCHES = 200;
const MAX_RUNS = 200;

type StoredMetrics = {
  boots: Array<{ layout: LayoutName; ts: number }>;
  switches: Array<{ from: LayoutName; to: LayoutName; ts: number }>;
  runs: CorePathRunEvent[];
};

type ActiveRun = {
  layout: LayoutName;
  promptTs: number;
  clicks: number;
  approval: ApprovalOutcome;
};

/** api calls that drive the funnel — the seam both layouts share. */
const WATCHED = new Set(["sendPrompt", "denyPermission", "gitDiff", "gitCommitDiff", "agentChangesDiff"]);

let store: StoredMetrics = { boots: [], switches: [], runs: [] };
let active: ActiveRun | null = null;
let clickHandler: (() => void) | null = null;
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredMetrics>;
      store = {
        boots: Array.isArray(parsed.boots) ? parsed.boots : [],
        switches: Array.isArray(parsed.switches) ? parsed.switches : [],
        runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      };
    }
  } catch {
    store = { boots: [], switches: [], runs: [] };
  }
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Best-effort persistence.
  }
}

/** Read the layout attribution directly (avoids a circular import on layout.ts). */
function currentLayout(): LayoutName {
  try {
    return localStorage.getItem("deeporca.layout") === "deck" ? "deck" : "classic";
  } catch {
    return "classic";
  }
}

function cap<T>(list: T[], max: number): T[] {
  return list.length > max ? list.slice(list.length - max) : list;
}

/** Boot bookkeeping — called once per page load by instrumentCorePath. */
export function recordBoot(): void {
  try {
    load();
    store.boots = cap([...store.boots, { layout: currentLayout(), ts: Date.now() }], MAX_BOOTS);
    save();
  } catch {
    // Never break the app for metrics.
  }
}

/** Layout switch bookkeeping — called by switchLayout BEFORE it persists. */
export function recordLayoutSwitch(from: LayoutName, to: LayoutName): void {
  try {
    load();
    store.switches = cap([...store.switches, { from, to, ts: Date.now() }], MAX_SWITCHES);
    save();
  } catch {
    // Never break the app for metrics.
  }
}

function installClickListener(): void {
  if (clickHandler || typeof document === "undefined") return;
  clickHandler = () => {
    if (active) active.clicks += 1;
  };
  document.addEventListener("click", clickHandler, true);
}

function removeClickListener(): void {
  if (clickHandler && typeof document !== "undefined") {
    document.removeEventListener("click", clickHandler, true);
  }
  clickHandler = null;
}

function finalizeRun(completed: boolean): void {
  if (!active) return;
  const run = active;
  active = null;
  removeClickListener();
  load();
  store.runs = cap(
    [
      ...store.runs,
      {
        layout: run.layout,
        ts: run.promptTs,
        ms: Date.now() - run.promptTs,
        clicks: run.clicks,
        approval: run.approval,
        completed,
      },
    ],
    MAX_RUNS
  );
  save();
}

/** The funnel state machine — driven by watched api calls. */
function onWatchedCall(name: string, args: unknown[]): void {
  if (name === "sendPrompt") {
    const payload = (args[0] ?? {}) as { permissions?: unknown[] };
    const isApproval = Array.isArray(payload.permissions) && payload.permissions.length > 0;
    if (isApproval) {
      if (active) active.approval = "granted";
      return;
    }
    // A fresh prompt supersedes any unfinished run (recorded as incomplete).
    finalizeRun(false);
    active = { layout: currentLayout(), promptTs: Date.now(), clicks: 0, approval: "none" };
    installClickListener();
    return;
  }
  if (name === "denyPermission") {
    if (active) active.approval = "denied";
    return;
  }
  // Diff views complete the core path.
  if (active) finalizeRun(true);
}

/** The active (open) funnel run, if any — exposed for tests and readouts. */
export function getActiveCorePathRun(): ActiveRun | null {
  return active;
}

/**
 * Wrap the preload api with transparent funnel instrumentation. The proxy
 * delegates every call untouched; watched calls additionally feed the state
 * machine. Returns the same type so every consumer keeps working unchanged.
 */
export function instrumentCorePath(api: DesktopApi): DesktopApi {
  recordBoot();
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || !WATCHED.has(String(prop))) return value;
      const fn = value as (...a: unknown[]) => unknown;
      return (...args: unknown[]) => {
        try {
          onWatchedCall(String(prop), args);
        } catch {
          // Instrumentation must never break the wrapped call.
        }
        return fn.apply(target, args);
      };
    },
  });
}

/** Aggregated snapshot for the settings readout / review points. */
export function readCorePathMetrics(): CorePathSummary {
  load();
  const boots = { classic: 0, deck: 0 };
  for (const boot of store.boots) boots[boot.layout] += 1;
  const switches = { toClassic: 0, toDeck: 0 };
  for (const sw of store.switches) {
    if (sw.to === "classic") switches.toClassic += 1;
    else switches.toDeck += 1;
  }
  const stats = (layout: LayoutName): FunnelStats | null => {
    const runs = store.runs.filter((r) => r.layout === layout);
    if (runs.length === 0) return null;
    const done = runs.filter((r) => r.completed);
    return {
      runs: runs.length,
      completed: done.length,
      avgClicks: done.length > 0 ? done.reduce((sum, r) => sum + r.clicks, 0) / done.length : 0,
      avgMs: done.length > 0 ? done.reduce((sum, r) => sum + r.ms, 0) / done.length : 0,
    };
  };
  return { boots, switches, runs: { classic: stats("classic"), deck: stats("deck") } };
}

/** Test seam: reset module-level state (store cache + open funnel). */
export function __resetCorePathMetricsForTest(): void {
  finalizeRun(false);
  store = { boots: [], switches: [], runs: [] };
  loaded = false;
}
