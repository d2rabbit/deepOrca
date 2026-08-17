/**
 * Activity-Frames data model — TypeScript port of nossa-y/activity-frames.
 *
 * All types and constants used across the activity-frames pipeline:
 * db → sessionize → entities → frames → MCP output.
 */

// ── Determinism constants (SPEC.md contract) ────────────────────────────────

/** Max active-time credit for one frame (seconds). */
export const DWELL_CAP = 90.0;

/** Gap that closes a frame / candidate coverage gap (seconds). */
export const SESSION_GAP = 300.0;

/** A→B→A collapses when B's span ≤ this (seconds). */
export const MERGE_FLICKER = 20.0;

/** Activity document schema version. */
export const SCHEMA_VERSION = 1;

// ── Raw data (from SQLite) ──────────────────────────────────────────────────

/** One captured screen-change row from the `frames` table. */
export interface RawFrame {
  id: number;
  epoch: number;
  app: string;
  window: string;
  url: string;
  domain: string | null;
  device: string;
}

/** One input event from the `ui_events` table (optional). */
export interface RawEvent {
  epoch: number;
  eventType: string;
  textContent: string;
}

// ── Sessionize output ───────────────────────────────────────────────────────

/** A flicker (brief context switch) folded into a host segment. */
export interface Interruption {
  app: string;
  domain: string | null;
  seconds: number;
}

/** A continuous activity segment (same app + domain, no session gap). */
export interface Segment {
  app: string;
  domain: string | null;
  startEpoch: number;
  endEpoch: number;
  activeSeconds: number;
  frames: RawFrame[];
  interruptions: Interruption[];
  breakReason: string;
}

/** A coverage gap (user was away). */
export interface Gap {
  startEpoch: number;
  endEpoch: number;
  minutes: number;
}

/** Coverage statistics for a time window. */
export interface Coverage {
  firstEpoch: number;
  lastEpoch: number;
  activeMinutes: number;
  spanMinutes: number;
  coveragePct: number;
  frameCount: number;
  distinctApps: number;
  gaps: Gap[];
  hourHistogram: Record<number, number>;
}

/** Per-app usage summary. */
export interface AppUsage {
  app: string;
  minutes: number;
  sessions: number;
  longestSessionMin: number;
  topWindows: string[];
}

// ── Entity typing output ────────────────────────────────────────────────────

/** A parsed URL → entity reference. */
export interface PageRef {
  kind: string;
  domain: string;
  entity: string;
  extra: string;
}

// ── Frame compiler output ───────────────────────────────────────────────────

/** An aggregated page view within a frame. */
export interface PageView {
  kind: string;
  entity: string;
  count: number;
}

/** Input statistics for a frame. */
export interface InputStats {
  keystrokes: number;
  clicks: number;
  textEvents: number;
  copies: number;
  textSnippets: string[];
}

/** A compiled activity frame — the core output unit. */
export interface ActivityFrame {
  index: string;
  app: string;
  site: string | null;
  start: string;
  end: string;
  durationMin: number;
  wallMin?: number;
  windows: string[];
  pages: PageView[];
  input?: InputStats;
  interruptions: Interruption[];
  evidence: Record<string, string>;
}

/** The top-level activity document. */
export interface ActivityDocument {
  schemaVersion: number;
  generatedAt: string;
  window: Record<string, unknown>;
  coverage: Coverage;
  frames: ActivityFrame[];
  blindSpots: string[];
  omittedBelowMin: number;
  minMinutes: number;
}

/** A detected work pattern. */
export interface WorkPattern {
  kind: string;
  label: string;
  count: number;
}

/** Options for frame compilation. */
export interface FrameOptions {
  minMinutes?: number;
  includeText?: boolean;
  dwellCap?: number;
  sessionGap?: number;
  mergeFlicker?: number;
}

/** Default frame options. */
export const DEFAULT_FRAME_OPTIONS: Required<FrameOptions> = {
  minMinutes: 0.5,
  includeText: false,
  dwellCap: DWELL_CAP,
  sessionGap: SESSION_GAP,
  mergeFlicker: MERGE_FLICKER,
};

/** Blind spots — capture limitations documented in output. */
export const BLIND_SPOTS = [
  "Browser URLs may be absent in private/incognito windows.",
  "Frame timing is event-driven (screen change), not periodic polling.",
  "Click resolution depends on accessibility tree availability.",
  "Multi-monitor setups produce separate per-device streams.",
  "Audio-only activity (podcasts, calls without UI change) is invisible.",
  "Terminal/IDE text content is not captured (only window title + app).",
];
