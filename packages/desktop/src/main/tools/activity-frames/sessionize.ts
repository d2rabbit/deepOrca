/**
 * Activity segmentation — port of activity_frames/sessionize.py.
 *
 * Partitions raw screen-change frames into continuous activity segments
 * using deterministic rules (DWELL_CAP, SESSION_GAP, MERGE_FLICKER).
 */

import type { RawFrame, Segment, Coverage, Gap, AppUsage } from "./types";
import { DWELL_CAP, SESSION_GAP, MERGE_FLICKER } from "./types";
import type { ActivityDb } from "./db";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Unicode format marks to strip from window titles. */
const FORMAT_CHARS = new Set([
  0x200e,
  0x200f,
  0x200b,
  0x2060,
  0xfeff, // LRM, RLM, ZWSP, WJ, BOM
]);

/** Strip invisible Unicode format marks from a string. */
export function cleanName(s: string): string {
  let out = "";
  for (const ch of s) {
    if (!FORMAT_CHARS.has(ch.codePointAt(0) ?? 0)) out += ch;
  }
  return out.trim();
}

/** Extract hostname from a URL, stripping leading "www.". */
export function domain(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    let h = u.hostname;
    if (h.startsWith("www.")) h = h.slice(4);
    return h || null;
  } catch {
    return null;
  }
}

// ── Segmentation ─────────────────────────────────────────────────────────────

interface SegmentizeOpts {
  dwellCap?: number;
  sessionGap?: number;
  mergeFlicker?: number;
}

/**
 * Segment a single device stream into raw segments.
 * Two passes: raw segmentation → flicker merge.
 */
function segmentStream(frames: RawFrame[], dwellCap: number, sessionGap: number, mergeFlicker: number): Segment[] {
  if (frames.length === 0) return [];

  // Pass 1: raw segmentation by (app, domain) key changes and session gaps.
  const raw: Segment[] = [];
  let cur: Segment | null = null;

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const next = frames[i + 1];
    const gap = next ? next.epoch - f.epoch : Infinity;
    const key = `${f.app}\0${domain(f.url) ?? ""}`;

    if (cur === null) {
      cur = {
        app: f.app,
        domain: domain(f.url),
        startEpoch: f.epoch,
        endEpoch: f.epoch,
        activeSeconds: 0,
        frames: [f],
        interruptions: [],
        breakReason: "start",
      };
    } else {
      const curKey = `${cur.app}\0${cur.domain ?? ""}`;
      if (gap > sessionGap) {
        cur.breakReason = "session_gap";
        raw.push(cur);
        cur = null;
        // Re-process this frame as a new segment start.
        i--;
        continue;
      } else if (key !== curKey) {
        cur.breakReason = "context_switch";
        raw.push(cur);
        cur = {
          app: f.app,
          domain: domain(f.url),
          startEpoch: f.epoch,
          endEpoch: f.epoch,
          activeSeconds: 0,
          frames: [f],
          interruptions: [],
          breakReason: "start",
        };
      } else {
        cur.frames.push(f);
        cur.endEpoch = f.epoch;
      }
    }

    // Add dwell time.
    if (gap <= sessionGap) {
      cur.activeSeconds += Math.min(gap, dwellCap);
    }
  }
  if (cur !== null) raw.push(cur);

  // Pass 2: flicker merge — collapse A→B→A when B is brief.
  if (mergeFlicker <= 0) return raw;

  const merged: Segment[] = [];
  let i = 0;
  while (i < raw.length) {
    const seg = raw[i];
    // Check if next segment is a flicker that should merge.
    while (i + 2 < raw.length) {
      const flicker = raw[i + 1];
      const after = raw[i + 2];
      const flickerWall = flicker.endEpoch - flicker.startEpoch;
      const flickerKey = `${flicker.app}\0${flicker.domain ?? ""}`;
      const segKey = `${seg.app}\0${seg.domain ?? ""}`;

      if (
        flickerWall <= mergeFlicker &&
        flickerKey === segKey &&
        flicker.startEpoch - seg.endEpoch <= sessionGap &&
        after.startEpoch - flicker.endEpoch <= sessionGap
      ) {
        // Merge: fold flicker into seg, absorb after.
        const intSeconds = Math.max(1.0, Math.round(flicker.activeSeconds * 10) / 10);
        seg.interruptions.push({
          app: flicker.app,
          domain: flicker.domain,
          seconds: intSeconds,
        });
        seg.frames.push(...after.frames);
        seg.activeSeconds += after.activeSeconds;
        seg.endEpoch = after.endEpoch;
        i += 2; // Skip flicker + after.
      } else {
        break;
      }
    }
    merged.push(seg);
    i++;
  }

  return merged;
}

/**
 * Partition frames by device, segment each stream, merge and sort.
 */
export function segments(db: ActivityDb, startUtc: string, endUtc: string, opts: SegmentizeOpts = {}): Segment[] {
  const dwellCap = opts.dwellCap ?? DWELL_CAP;
  const sessionGap = opts.sessionGap ?? SESSION_GAP;
  const mergeFlicker = opts.mergeFlicker ?? MERGE_FLICKER;

  const deviceCol = db.hasColumn("frames", "device_name") ? "device_name" : "''";
  const allFrames = db.loadFrames(startUtc, endUtc, deviceCol);

  // Assign domains.
  for (const f of allFrames) {
    f.domain = domain(f.url);
  }

  // Partition by device.
  const byDevice = new Map<string, RawFrame[]>();
  for (const f of allFrames) {
    const dev = f.device || "";
    if (!byDevice.has(dev)) byDevice.set(dev, []);
    byDevice.get(dev)!.push(f);
  }

  // Segment each device stream.
  const allSegs: Segment[] = [];
  for (const [, frames] of byDevice) {
    const segs = segmentStream(frames, dwellCap, sessionGap, mergeFlicker);
    allSegs.push(...segs);
  }

  // Sort by start epoch.
  allSegs.sort((a, b) => a.startEpoch - b.startEpoch);
  return allSegs;
}

// ── Coverage ─────────────────────────────────────────────────────────────────

/**
 * Compute coverage statistics for a time window.
 */
export function coverage(db: ActivityDb, startUtc: string, endUtc: string, sessionGap: number = SESSION_GAP): Coverage {
  const deviceCol = db.hasColumn("frames", "device_name") ? "device_name" : "''";
  const frames = db.loadFrames(startUtc, endUtc, deviceCol);

  if (frames.length === 0) {
    return {
      firstEpoch: 0,
      lastEpoch: 0,
      activeMinutes: 0,
      spanMinutes: 0,
      coveragePct: 0,
      frameCount: 0,
      distinctApps: 0,
      gaps: [],
      hourHistogram: {},
    };
  }

  const activeMinutesSet = new Set<number>();
  const hourHistogram: Record<number, number> = {};
  const apps = new Set<string>();
  const gaps: Gap[] = [];
  const first = frames[0];
  const last = frames[frames.length - 1];

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const next = frames[i + 1];
    const gap = next ? next.epoch - f.epoch : 0;

    // Track active minutes.
    if (gap <= sessionGap) {
      const minuteBucket = Math.floor(f.epoch / 60);
      activeMinutesSet.add(minuteBucket);
    }

    // Track gaps.
    if (gap > sessionGap) {
      const gapMin = Math.floor(gap / 60);
      if (gapMin >= 5) {
        gaps.push({
          startEpoch: f.epoch,
          endEpoch: next ? next.epoch : f.epoch,
          minutes: gapMin,
        });
      }
    }

    // Track apps.
    apps.add(f.app);

    // Hour histogram (local time).
    const d = new Date(f.epoch * 1000);
    const hour = d.getHours();
    hourHistogram[hour] = (hourHistogram[hour] ?? 0) + 1;
  }

  const activeMin = activeMinutesSet.size;
  const spanMin = Math.max(1, Math.round((last.epoch - first.epoch) / 60));
  const coveragePct = Math.min(100, Math.floor((activeMin / spanMin) * 100));

  return {
    firstEpoch: first.epoch,
    lastEpoch: last.epoch,
    activeMinutes: activeMin,
    spanMinutes: spanMin,
    coveragePct,
    frameCount: frames.length,
    distinctApps: apps.size,
    gaps,
    hourHistogram,
  };
}

// ── App Usage Ledger ─────────────────────────────────────────────────────────

/**
 * Per-app usage summary for a time window.
 */
export function appLedger(
  db: ActivityDb,
  startUtc: string,
  endUtc: string,
  dwellCap: number = DWELL_CAP,
  sessionGap: number = SESSION_GAP
): AppUsage[] {
  const segs = segments(db, startUtc, endUtc, { dwellCap, sessionGap });

  // Aggregate per app.
  const byApp = new Map<
    string,
    { minutes: number; sessions: number; longestMin: number; windows: Map<string, number> }
  >();

  for (const seg of segs) {
    const minutes = seg.activeSeconds / 60;
    if (minutes < 20 / 60) continue; // Drop apps with < 20 seconds.

    if (!byApp.has(seg.app)) {
      byApp.set(seg.app, { minutes: 0, sessions: 0, longestMin: 0, windows: new Map() });
    }
    const usage = byApp.get(seg.app)!;
    usage.minutes += minutes;
    usage.sessions += 1;
    usage.longestMin = Math.max(usage.longestMin, minutes);

    for (const f of seg.frames) {
      const w = cleanName(f.window);
      if (w) usage.windows.set(w, (usage.windows.get(w) ?? 0) + 1);
    }
  }

  const result: AppUsage[] = [];
  for (const [app, usage] of byApp) {
    const topWindows = Array.from(usage.windows.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([w]) => w);
    result.push({
      app,
      minutes: Math.round(usage.minutes * 10) / 10,
      sessions: usage.sessions,
      longestSessionMin: Math.round(usage.longestMin * 10) / 10,
      topWindows,
    });
  }

  result.sort((a, b) => b.minutes - a.minutes);
  return result;
}
