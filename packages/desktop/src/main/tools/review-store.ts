/**
 * Review report store — per-run, structured review history under
 * `<root>/.deeporca/reviews/`.
 *
 * One review run = one `<id>.html` (self-contained reading surface, opened in
 * the dedicated window) + one `<id>.json` (structured meta the review panel's
 * workspace rows list). Newest-first listing; a hard cap (REPORTS_KEEP)
 * prunes the oldest pairs so the generated-content directory stays bounded
 * (user rule 2026-08-31: everything under .deeporca/, nothing unbounded).
 *
 * Pure fs + validation — no Electron imports — so the pruning/listing logic
 * is unit-testable without an app shell.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** History cap: newest N runs survive a prune (user rule: 只保留十条). */
export const REPORTS_KEEP = 10;

export interface ReviewReportMeta {
  id: string;
  generatedAt: string;
  status: string;
  filesReviewed: number;
  comments: number;
  statusNote: string;
  /** Pre-localized scope label for the report header (e.g. 提交 HEAD 的变更). */
  scopeLabel?: string;
  /** Exclusion accounting — explains 0-finding runs. */
  excludedByPolicy?: number;
  unsupportedFiles?: number;
  /**
   * Full findings of the run — the native report view renders these directly.
   * Shape mirrors the delegation comments (content carries the
   * `[SEVERITY] ` prefix; severity field is optional).
   */
  findings?: Array<Record<string, unknown>>;
}

const reviewsDir = (root: string): string => path.join(root, ".deeporca", "reviews");

/** `review-<timestamp>` — the only id shape resolveReportFile accepts. */
function isSafeReportId(id: string): boolean {
  return /^review-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}$/.test(id);
}

/**
 * Persist one run: `<id>.html` + `<id>.json`, then prune past the cap.
 * Returns the report id. Best-effort pruner (a stuck deletion never fails
 * the save).
 */
export function saveReviewReport(root: string, html: string, meta: Omit<ReviewReportMeta, "id">): string | null {
  try {
    const dir = reviewsDir(root);
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date(meta.generatedAt);
    const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
    const id =
      `review-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
    fs.writeFileSync(path.join(dir, `${id}.html`), html, "utf-8");
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ ...meta, id }, null, 2), "utf-8");
    pruneReviewReports(root);
    return id;
  } catch (err) {
    console.warn("[review-store] save failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Newest-first report metas (malformed/unreadable entries skipped). */
export function listReviewReports(root: string): ReviewReportMeta[] {
  const dir = reviewsDir(root);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const metas: ReviewReportMeta[] = [];
  for (const f of entries) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as ReviewReportMeta;
      if (typeof meta?.id === "string" && typeof meta?.generatedAt === "string") {
        metas.push(meta);
      }
    } catch {
      // unreadable meta — skip
    }
  }
  return metas.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

/** Containment-checked path to one report's HTML; null for bad ids. */
export function resolveReportFile(root: string, id: string): string | null {
  if (!isSafeReportId(id)) return null;
  const dir = reviewsDir(root);
  const file = path.join(dir, `${id}.html`);
  if (path.dirname(file) !== dir) return null;
  return fs.existsSync(file) ? file : null;
}

/** Read one report's meta (with findings) — null for bad ids / unreadable. */
export function readReviewReport(root: string, id: string): ReviewReportMeta | null {
  if (!isSafeReportId(id)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(reviewsDir(root), `${id}.json`), "utf-8")) as ReviewReportMeta;
    return meta?.id === id ? meta : null;
  } catch {
    return null;
  }
}

/** Keep the newest REPORTS_KEEP pairs; delete the rest. Best-effort. */
export function pruneReviewReports(root: string): void {
  try {
    const dir = reviewsDir(root);
    const metas = listReviewReports(root);
    for (const meta of metas.slice(REPORTS_KEEP)) {
      for (const suffix of [".json", ".html"]) {
        try {
          fs.rmSync(path.join(dir, `${meta.id}${suffix}`), { force: true });
        } catch {
          // raced/unreadable — the next prune retries
        }
      }
    }
  } catch {
    // pruning is cosmetic — never fail a caller
  }
}
