// Unit tests for the per-request local usage ledger (P1 of the
// token-statistics rework): append-only JSONL beside sessions-index.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { appendUsageRecord, readUsageLedger, usageLedgerPath, type UsageRecord } from "../common/usage-ledger";

const record = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  ts: "2026-09-02T00:00:00.000Z",
  model: "deepseek-chat",
  prompt: 100,
  completion: 5,
  source: "chat",
  sessionId: "s1",
  estimated: true,
  apiUsage: null,
  ...overrides,
});

function tmpLedger(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-ledger-")), "usage-ledger.jsonl");
}

test("ledger roundtrips append-only records", () => {
  const ledger = tmpLedger();
  appendUsageRecord(ledger, record());
  appendUsageRecord(ledger, record({ source: "background", sessionId: undefined, prompt: 7 }));

  const read = readUsageLedger(ledger);
  assert.equal(read.length, 2);
  assert.equal(read[0]?.source, "chat");
  assert.equal(read[0]?.prompt, 100);
  assert.equal(read[1]?.source, "background");
  assert.equal(read[1]?.sessionId, undefined);
});

test("missing file and torn tail line are tolerated", () => {
  const missing = path.join(os.tmpdir(), "deeporca-ledger-missing", "usage-ledger.jsonl");
  assert.deepEqual(readUsageLedger(missing), []);

  const ledger = tmpLedger();
  appendUsageRecord(ledger, record());
  fs.appendFileSync(ledger, '{"ts":"torn', "utf8"); // process died mid-append
  const read = readUsageLedger(ledger);
  assert.equal(read.length, 1, "torn tail skipped, complete record survives");
});

test("usageLedgerPath lands in the project dir beside sessions-index", () => {
  const ledger = usageLedgerPath("/home/x/.deeporca", "/work/repo");
  assert.match(ledger, /projects[/\\][^/\\]+[/\\]usage-ledger\.jsonl$/);
  assert.ok(!ledger.includes("sessions-index"), "independent of the sessions index");
});
