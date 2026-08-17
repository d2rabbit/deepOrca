/**
 * Frame compiler — port of activity_frames/frames.py.
 *
 * Takes segmented activity data and compiles it into ActivityFrame[]
 * with input event attribution, page view aggregation, and conditional
 * field omission.
 */

import type { Segment, ActivityFrame, ActivityDocument, PageView, InputStats, RawEvent } from "./types";
import { SCHEMA_VERSION, BLIND_SPOTS, DEFAULT_FRAME_OPTIONS } from "./types";
import type { ActivityDb } from "./db";
import type { FrameOptions } from "./types";
import { segments, coverage } from "./sessionize";
import { cleanName } from "./sessionize";
import { parseUrl } from "./entities";
import { fmtLocalHms, utcNowString, localDayWindowUtc, hoursAgoWindowUtc, localDayString } from "./time";

// ── Binary search helpers (port of Python bisect) ──────────────────────────

/** Rightmost insertion point: index of last element <= target. Returns -1 if none. */
function bisectRight(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Leftmost insertion point: index of first element >= target. */
function bisectLeft(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ── Page view aggregation ────────────────────────────────────────────────────

/**
 * Aggregate URL views within a segment into PageView[].
 */
function pagesForSegment(seg: Segment): PageView[] {
  const views: PageView[] = [];
  const index = new Map<string, number>(); // (kind, entity) → views index

  for (const f of seg.frames) {
    if (!f.url) continue;
    const pr = parseUrl(f.url);
    const key = `${pr.kind}\0${pr.entity}`;
    const existing = index.get(key);
    if (existing !== undefined) {
      views[existing].count++;
    } else {
      index.set(key, views.length);
      views.push({ kind: pr.kind, entity: pr.entity, count: 1 });
    }
  }

  return views;
}

// ── Top windows ──────────────────────────────────────────────────────────────

/**
 * Get top N window titles by frequency in a segment.
 */
function topWindows(seg: Segment, limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const f of seg.frames) {
    const w = cleanName(f.window);
    if (w) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w);
}

// ── Input event attribution ──────────────────────────────────────────────────

/**
 * Attribute input events to segments using nearest-frame binary search.
 * Each event is assigned to exactly one segment to avoid double-counting.
 */
function attributeEvents(segs: Segment[], events: RawEvent[]): Map<Segment, InputStats> {
  const stats = new Map<Segment, InputStats>();

  if (events.length === 0 || segs.length === 0) return stats;

  // Group segments by device, build start epochs per device.
  const devSegs = new Map<string, Segment[]>();
  for (const seg of segs) {
    const dev = seg.frames[0]?.device ?? "";
    if (!devSegs.has(dev)) devSegs.set(dev, []);
    devSegs.get(dev)!.push(seg);
  }

  const devStarts = new Map<string, number[]>();
  for (const [dev, segArr] of devSegs) {
    segArr.sort((a, b) => a.startEpoch - b.startEpoch);
    devStarts.set(
      dev,
      segArr.map((s) => s.startEpoch)
    );
  }

  // Build sorted frame epochs for nearest-device resolution.
  const allFrameEpochs: { epoch: number; device: string }[] = [];
  for (const seg of segs) {
    for (const f of seg.frames) {
      allFrameEpochs.push({ epoch: f.epoch, device: f.device });
    }
  }
  allFrameEpochs.sort((a, b) => a.epoch - b.epoch);
  const sfEpochs = allFrameEpochs.map((f) => f.epoch);

  for (const event of events) {
    let bestSeg: Segment | null = null;

    for (const [dev, starts] of devStarts) {
      const segArr = devSegs.get(dev)!;
      const idx = bisectRight(starts, event.epoch);
      if (idx >= 0 && idx < segArr.length) {
        const seg = segArr[idx];
        if (event.epoch >= seg.startEpoch && event.epoch <= seg.endEpoch) {
          // Candidate found. If multiple devices match, pick nearest frame.
          if (bestSeg === null) {
            bestSeg = seg;
          } else {
            const nearest = bisectLeft(sfEpochs, event.epoch);
            const clamped = Math.min(nearest, sfEpochs.length - 1);
            const left = clamped > 0 ? sfEpochs[clamped - 1] : Infinity;
            const right = sfEpochs[clamped];
            const leftDev = clamped > 0 ? allFrameEpochs[clamped - 1].device : "";
            const rightDev = allFrameEpochs[clamped].device;
            const leftDist = event.epoch - left;
            const rightDist = right - event.epoch;
            const closerDev = leftDist <= rightDist ? leftDev : rightDev;
            const closerSegArr = devSegs.get(closerDev);
            if (closerSegArr) {
              const ci = bisectRight(devStarts.get(closerDev)!, event.epoch);
              if (ci >= 0 && ci < closerSegArr.length) bestSeg = closerSegArr[ci];
            }
          }
        }
      }
    }

    if (bestSeg !== null) {
      if (!stats.has(bestSeg)) {
        stats.set(bestSeg, { keystrokes: 0, clicks: 0, textEvents: 0, copies: 0, textSnippets: [] });
      }
      const s = stats.get(bestSeg)!;
      switch (event.eventType) {
        case "key":
          s.keystrokes++;
          break;
        case "click":
          s.clicks++;
          break;
        case "clipboard":
          s.copies++;
          break;
        case "text":
          s.textEvents++;
          if (event.textContent && s.textSnippets.length < 5) {
            s.textSnippets.push(event.textContent.slice(0, 100));
          }
          break;
      }
    }
  }

  return stats;
}

// ── Main compiler ────────────────────────────────────────────────────────────

/**
 * Compile raw frames in a time window into an ActivityDocument.
 */
export function buildFrames(
  db: ActivityDb,
  startUtc: string,
  endUtc: string,
  opts: FrameOptions = {}
): ActivityDocument {
  const o = { ...DEFAULT_FRAME_OPTIONS, ...opts };

  const segs = segments(db, startUtc, endUtc, {
    dwellCap: o.dwellCap,
    sessionGap: o.sessionGap,
    mergeFlicker: o.mergeFlicker,
  });
  const cov = coverage(db, startUtc, endUtc, o.sessionGap);

  // Load and attribute input events.
  const events = db.loadEvents(startUtc, endUtc);
  const inputStats = attributeEvents(segs, events);

  // Build ActivityFrames.
  const frames: ActivityFrame[] = [];
  let omitted = 0;
  let idx = 0;

  for (const seg of segs) {
    const durationMin = Math.round((seg.activeSeconds / 60) * 10) / 10;

    if (durationMin < o.minMinutes) {
      omitted++;
      continue;
    }

    const wallMin = Math.round(((seg.endEpoch - seg.startEpoch) / 60) * 10) / 10;
    const input = inputStats.get(seg);

    const frame: ActivityFrame = {
      index: `f-${String(idx).padStart(4, "0")}`,
      app: seg.app,
      site: seg.domain,
      start: fmtLocalHms(seg.startEpoch),
      end: fmtLocalHms(seg.endEpoch),
      durationMin,
      windows: topWindows(seg),
      pages: pagesForSegment(seg),
      interruptions: seg.interruptions,
      evidence: {
        frame_ids: seg.frames.length > 0 ? `${seg.frames[0].id}..${seg.frames[seg.frames.length - 1].id}` : "",
      },
    };

    // Only include wallMin if significantly different from durationMin.
    if (Math.abs(wallMin - durationMin) > 1) {
      frame.wallMin = wallMin;
    }

    // Only include input block if there are events.
    if (input && (input.keystrokes > 0 || input.clicks > 0 || input.copies > 0 || input.textEvents > 0)) {
      const inputObj: Record<string, unknown> = {
        keystrokes: input.keystrokes,
        clicks: input.clicks,
      };
      if (input.copies > 0) inputObj.copies = input.copies;
      if (input.textEvents > 0) inputObj.text_events = input.textEvents;
      if (o.includeText && input.textSnippets.length > 0) {
        inputObj.text = input.textSnippets;
      }
      frame.input = inputObj as unknown as InputStats;
    }

    frames.push(frame);
    idx++;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: utcNowString() + "Z",
    window: { start: startUtc, end: endUtc },
    coverage: cov,
    frames,
    blindSpots: BLIND_SPOTS,
    omittedBelowMin: omitted,
    minMinutes: o.minMinutes,
  };
}

/**
 * Build frames for a specific local day.
 */
export function buildDay(db: ActivityDb, day?: string, opts: FrameOptions = {}): ActivityDocument {
  const dayStr = day ?? localDayString();
  const [start, end] = localDayWindowUtc(dayStr);
  const doc = buildFrames(db, start, end, opts);
  doc.window = { day: dayStr };
  return doc;
}

/**
 * Build frames for the last N hours.
 */
export function buildRecent(db: ActivityDb, hours: number = 2, opts: FrameOptions = {}): ActivityDocument {
  const [start, end] = hoursAgoWindowUtc(hours);
  const doc = buildFrames(db, start, end, opts);
  doc.window = { hours };
  return doc;
}
