/**
 * Review report store — per-run history under .deeporca/reviews/ with a hard
 * cap. Pins: save→list round-trip, newest-first ordering, id containment
 * (resolveReportFile rejects traversal-shaped ids), and the prune keeping
 * exactly the newest REPORTS_KEEP runs.
 */

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  REPORTS_KEEP,
  listReviewReports,
  pruneReviewReports,
  resolveReportFile,
  saveReviewReport,
} from "../main/tools/review-store";

function withRoot(fn: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-store-"));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const meta = (generatedAt: string) => ({
  generatedAt,
  status: "success",
  filesReviewed: 3,
  comments: 1,
  statusNote: "",
});

test("save persists id-named html+json and lists newest first", () => {
  withRoot((root) => {
    const idA = saveReviewReport(root, "<html>A</html>", meta("2026-08-31T10:00:00.000Z"))!;
    const idB = saveReviewReport(root, "<html>B</html>", meta("2026-08-31T11:00:00.000Z"))!;
    assert.notEqual(idA, null);
    assert.notEqual(idB, null);
    const list = listReviewReports(root);
    assert.deepEqual(
      list.map((m) => m.id),
      [idB, idA]
    );
    assert.equal(list[0].filesReviewed, 3);
    assert.equal(fs.readFileSync(resolveReportFile(root, idA)!, "utf-8"), "<html>A</html>");
  });
});

test("resolveReportFile rejects traversal and malformed ids", () => {
  withRoot((root) => {
    assert.equal(resolveReportFile(root, "../../etc/passwd"), null);
    assert.equal(resolveReportFile(root, "review-../evil"), null);
    assert.equal(resolveReportFile(root, "review-2026-08-31T10-00-00-000"), null, "absent file → null");
    assert.equal(resolveReportFile(root, "not-a-report"), null);
  });
});

test("prune keeps exactly the newest REPORTS_KEEP runs", () => {
  withRoot((root) => {
    const saved: string[] = [];
    for (let i = 0; i < REPORTS_KEEP + 5; i++) {
      const d = new Date(Date.UTC(2026, 7, 31, 8, 0, i * 1000));
      const id = saveReviewReport(root, `<html>${i}</html>`, meta(d.toISOString()));
      if (id) saved.push(id);
    }
    pruneReviewReports(root);
    const list = listReviewReports(root);
    assert.equal(list.length, REPORTS_KEEP);
    const oldest = saved[0];
    assert.equal(resolveReportFile(root, oldest), null, "oldest run pruned");
  });
});
