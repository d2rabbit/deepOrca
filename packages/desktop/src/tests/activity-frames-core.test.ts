/**
 * Core unit tests for the activity-frames pipeline (spec Phase 5, finally
 * honored). All functions under test are deterministic and depend on the
 * ActivityDb only through {hasColumn, loadFrames, loadEvents} — a type-only
 * import, so a plain fake object satisfies the structural type without any
 * SQLite dependency (node:sqlite needs Node ≥24 or the experimental flag;
 * the fake-db seam keeps these tests runnable everywhere).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, domain, segments, coverage, appLedger } from "../main/tools/activity-frames/sessionize";
import { parseUrl } from "../main/tools/activity-frames/entities";
import { buildFrames } from "../main/tools/activity-frames/frames";
import type { RawFrame, RawEvent } from "../main/tools/activity-frames/types";
import type { ActivityDb } from "../main/tools/activity-frames/db";

const T0 = 1_700_000_000; // arbitrary epoch base (UTC)

function frame(overrides: Partial<RawFrame> & Pick<RawFrame, "id" | "epoch">): RawFrame {
  return { app: "Safari", window: "w", url: "", domain: null, device: "monitor_1", ...overrides };
}

/** Fake db: satisfies the structural surface the pipeline actually uses. */
function fakeDb(frames: RawFrame[], events: RawEvent[] = []): ActivityDb {
  return {
    hasColumn: (_table: string, column: string) => column === "device_name",
    loadFrames: (startUtc: string, endUtc: string) => {
      const s = Date.parse(startUtc) / 1000;
      const e = Date.parse(endUtc) / 1000;
      return frames.filter((f) => f.epoch >= s && f.epoch <= e).map((f) => ({ ...f }));
    },
    loadEvents: (startUtc: string, endUtc: string) => {
      const s = Date.parse(startUtc) / 1000;
      const e = Date.parse(endUtc) / 1000;
      return events.filter((ev) => ev.epoch >= s && ev.epoch <= e);
    },
  } as unknown as ActivityDb;
}

const win = (from: number, to: number): [string, string] => [
  new Date(from * 1000).toISOString(),
  new Date(to * 1000).toISOString(),
];

// ── sessionize helpers ───────────────────────────────────────────────────────

test("cleanName strips Unicode format marks and trims", () => {
  assert.equal(cleanName("\u200eLeft-to-right\u200b mark"), "Left-to-right mark");
  assert.equal(cleanName("  padded  "), "padded");
  assert.equal(cleanName("plain"), "plain");
});

test("domain strips www. and rejects invalid URLs", () => {
  assert.equal(domain("https://www.github.com/org/repo"), "github.com");
  assert.equal(domain("https://app.slack.com/client"), "app.slack.com");
  assert.equal(domain("not a url"), null);
  assert.equal(domain(""), null);
});

// ── segmentation ─────────────────────────────────────────────────────────────

test("segments break on context switch and on session gap", () => {
  const db = fakeDb([
    frame({ id: 1, epoch: T0, app: "Safari", url: "https://github.com/a/r" }),
    frame({ id: 2, epoch: T0 + 30, app: "Safari", url: "https://github.com/a/r/issues" }),
    // Context switch: same app, different domain.
    frame({ id: 3, epoch: T0 + 60, app: "Safari", url: "https://linear.app/team/x" }),
    // Session gap (> 300s) closes the segment.
    frame({ id: 4, epoch: T0 + 60 + 3600, app: "Safari", url: "https://linear.app/team/x" }),
  ]);
  const segs = segments(db, ...win(T0 - 10, T0 + 7200));
  assert.equal(segs.length, 3, `expected 3 segments, got ${segs.length}`);
  assert.equal(segs[0]!.breakReason, "context_switch", "github seg ended by the domain change");
  assert.equal(segs[1]!.breakReason, "session_gap", "linear seg ended by the 1h gap");
  assert.equal(segs[2]!.breakReason, "start", "trailing segment has no break yet");
  assert.equal(segs[0]!.domain, "github.com");
  assert.equal(segs[1]!.domain, "linear.app");
});

test("segments cap dwell time at DWELL_CAP per frame gap", () => {
  // Two frames 200s apart (same context, gap ≤ SESSION_GAP) — credit caps at 90s.
  const db = fakeDb([
    frame({ id: 1, epoch: T0, url: "https://github.com/a" }),
    frame({ id: 2, epoch: T0 + 200, url: "https://github.com/a" }),
  ]);
  const segs = segments(db, ...win(T0 - 10, T0 + 300));
  assert.equal(segs.length, 1);
  assert.equal(segs[0]!.activeSeconds, 90, "dwell credit capped at DWELL_CAP=90");
});

test("flicker merge folds A→B→A (B ≤ 20s) into one segment with an interruption", () => {
  const db = fakeDb([
    // A: github
    frame({ id: 1, epoch: T0, url: "https://github.com/a/r" }),
    frame({ id: 2, epoch: T0 + 10, url: "https://github.com/a/r" }),
    // B: brief flicker on slack (wall span 15s ≤ 20s)
    frame({ id: 3, epoch: T0 + 30, app: "Slack", url: "https://app.slack.com/client/w/ch" }),
    frame({ id: 4, epoch: T0 + 45, app: "Slack", url: "https://app.slack.com/client/w/ch" }),
    // A resumes within the session gap
    frame({ id: 5, epoch: T0 + 60, url: "https://github.com/a/r" }),
    frame({ id: 6, epoch: T0 + 70, url: "https://github.com/a/r" }),
  ]);
  const segs = segments(db, ...win(T0 - 10, T0 + 100));
  assert.equal(segs.length, 1, `github flicker merges, got ${segs.length}`);
  const seg = segs[0]!;
  assert.equal(seg.domain, "github.com");
  assert.equal(seg.endEpoch, T0 + 70, "after-frames absorbed");
  assert.equal(seg.interruptions.length, 1);
  assert.equal(seg.interruptions[0]!.app, "Slack");
});

test("segments partition by device", () => {
  const db = fakeDb([
    frame({ id: 1, epoch: T0, url: "https://github.com/a", device: "monitor_1" }),
    frame({ id: 2, epoch: T0 + 10, url: "https://github.com/a", device: "monitor_2" }),
  ]);
  const segs = segments(db, ...win(T0 - 10, T0 + 100));
  assert.equal(segs.length, 2, "each device streams independently");
});

// ── coverage ─────────────────────────────────────────────────────────────────

test("coverage counts active minutes, gaps ≥ 5min, and hour histogram", () => {
  const db = fakeDb([
    frame({ id: 1, epoch: T0 }),
    frame({ id: 2, epoch: T0 + 60 }),
    frame({ id: 3, epoch: T0 + 120 }),
    // 40-minute gap → recorded (≥5min)
    frame({ id: 4, epoch: T0 + 120 + 2400 }),
  ]);
  const cov = coverage(db, ...win(T0 - 10, T0 + 4000));
  assert.equal(cov.frameCount, 4);
  assert.ok(cov.activeMinutes >= 2 && cov.activeMinutes <= 4);
  assert.equal(cov.gaps.length, 1);
  assert.equal(cov.gaps[0]!.minutes, 40);
  assert.equal(cov.distinctApps, 1);
  const totalHist = Object.values(cov.hourHistogram).reduce((a, b) => a + b, 0);
  assert.equal(totalHist, 4);
});

test("coverage of an empty window returns zeroes", () => {
  const cov = coverage(fakeDb([]), ...win(T0, T0 + 100));
  assert.equal(cov.frameCount, 0);
  assert.equal(cov.coveragePct, 0);
  assert.deepEqual(cov.gaps, []);
});

// ── app ledger ───────────────────────────────────────────────────────────────

test("appLedger drops apps under 20s and ranks by minutes", () => {
  const frames: RawFrame[] = [];
  // App "Editor": 30 frames 10s apart = ~5 min active.
  for (let i = 0; i < 30; i++) {
    frames.push(frame({ id: 100 + i, epoch: T0 + i * 10, app: "Editor", window: "main.ts" }));
  }
  // App "Tiny": 2 frames 5s apart = 5s active → dropped.
  frames.push(frame({ id: 200, epoch: T0 + 1000, app: "Tiny", window: "x" }));
  frames.push(frame({ id: 201, epoch: T0 + 1005, app: "Tiny", window: "x" }));

  const ledger = appLedger(fakeDb(frames), ...win(T0 - 10, T0 + 1100));
  assert.equal(ledger.length, 1, "Tiny (<20s) dropped");
  assert.equal(ledger[0]!.app, "Editor");
  assert.deepEqual(ledger[0]!.topWindows, ["main.ts"]);
});

// ── entities: parseUrl ───────────────────────────────────────────────────────

test("parseUrl resolves representative sites", () => {
  const cases: Array<[string, string, string]> = [
    // [url, expected kind, expected entity (substring)]
    ["https://github.com/owner/repo/issues/42", "issue", "owner/repo#42"],
    ["https://github.com/owner/repo/pull/7", "pull_request", "owner/repo#7"],
    ["https://github.com/owner", "profile", "owner"],
    ["https://app.slack.com/client/WS/CH", "channel", "WS/CH"],
    ["https://linear.app/acme/issue/ENG-123", "issue", "ENG-123"],
    ["https://notion.so/workspace", "workspace", "Notion"],
    ["https://www.google.com/search?q=deep+orca", "search", "deep orca"],
  ];
  for (const [url, kind, entity] of cases) {
    const pr = parseUrl(url);
    assert.equal(pr.kind, kind, `${url} kind`);
    assert.ok(
      typeof entity === "string" ? pr.entity.includes(entity) || entity.includes(pr.entity) : true,
      `${url} entity: ${pr.entity}`
    );
    if (kind === "issue" && url.includes("github")) {
      assert.equal(pr.entity, entity, `${url} exact entity`);
    }
  }
});

test("parseUrl heuristic + fallback paths", () => {
  // login path heuristic
  const login = parseUrl("https://example.com/login");
  assert.equal(login.kind, "sign_in");
  // dashboard subdomain heuristic
  const dash = parseUrl("https://app.unknowntool.io/projects");
  assert.equal(dash.kind, "dashboard");
  // total fallback → page with first path slug
  const page = parseUrl("https://some.random.site/docs/getting-started");
  assert.equal(page.kind, "page");
  // garbage never throws
  assert.equal(parseUrl("::::").kind, "page");
  assert.equal(parseUrl("").kind, "page");
});

// ── frames compiler ──────────────────────────────────────────────────────────

test("buildFrames compiles segments into ActivityFrames with pages and input attribution", () => {
  const frames: RawFrame[] = [];
  // A 3-minute github browsing segment (frames 30s apart).
  for (let i = 0; i < 7; i++) {
    frames.push(
      frame({
        id: 10 + i,
        epoch: T0 + i * 30,
        url: i % 2 ? "https://github.com/a/r" : "https://github.com/a/r/issues/9",
      })
    );
  }
  // Input events inside the segment.
  const events: RawEvent[] = [
    { epoch: T0 + 10, eventType: "click", textContent: "" },
    { epoch: T0 + 20, eventType: "key", textContent: "" },
    { epoch: T0 + 50, eventType: "text", textContent: "hello" },
  ];
  const doc = buildFrames(fakeDb(frames, events), ...win(T0 - 10, T0 + 300), { minMinutes: 0 });

  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.frames.length, 1, "one segment → one frame");
  const f = doc.frames[0]!;
  assert.equal(f.app, "Safari");
  assert.equal(f.site, "github.com");
  assert.ok(f.durationMin > 0);
  // Pages aggregate both github URLs (issue page + repo).
  const kinds = f.pages.map((p) => `${p.kind}:${p.entity}`);
  assert.ok(
    kinds.some((k) => k.startsWith("issue:")),
    `issue page present: ${kinds}`
  );
  // Input attributed: 1 click, 1 keystroke, 1 text event.
  assert.equal(f.input!.clicks, 1);
  assert.equal(f.input!.keystrokes, 1);
  assert.equal((f.input as unknown as Record<string, unknown>)["text_events"], 1);
  // Evidence range covers first..last frame id.
  assert.equal(f.evidence.frame_ids, "10..16");
  assert.equal(doc.omittedBelowMin, 0);
});

test("buildFrames omits segments below minMinutes and counts them", () => {
  const db = fakeDb([
    frame({ id: 1, epoch: T0, url: "https://github.com/a" }),
    frame({ id: 2, epoch: T0 + 10, url: "https://github.com/a" }),
  ]);
  const doc = buildFrames(db, ...win(T0 - 10, T0 + 100), { minMinutes: 5 });
  assert.equal(doc.frames.length, 0);
  assert.equal(doc.omittedBelowMin, 1);
});
