import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  AuditLog,
  buildAuditEvent,
  canonicalJson,
  parseAuditLine,
  readAuditEvents,
  serializeAuditEvent,
  verifyAuditChain,
  type AuditEvent,
} from "../sandbox/audit";
import { ToolExecutor } from "../tools/executor";

// P1 audit bus tests (specs/sandbox/design.md §4.3, task 10-11):
// append → serialize → verify roundtrip, tamper detection on any single
// record, fail-open writer behavior.

const tempDirs: string[] = [];

function createWorkspace(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-audit-")));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function buildChain(length: number, sessionId = "audit-session"): AuditEvent[] {
  const events: AuditEvent[] = [];
  let prevChecksum = "";
  for (let index = 0; index < length; index += 1) {
    const event = buildAuditEvent({
      monotonicNs: BigInt(1_000_000 + index),
      wallClock: `2026-08-16T00:00:0${index % 10}.000Z`,
      sessionId,
      prevChecksum,
      payload: {
        eventType: "path_gate",
        tool: "write",
        verdict: index % 2 === 0 ? "allow" : "deny",
        scope: index % 2 === 0 ? undefined : "write-out-cwd",
        filePath: `/tmp/target-${index}.txt`,
      },
    });
    events.push(event);
    prevChecksum = event.checksum;
  }
  return events;
}

test("append → serialize → parse → verify roundtrip", () => {
  const events = buildChain(5);
  assert.equal(events[0].prevChecksum, "", "genesis record links to empty checksum");
  const lines = events.map((event) => serializeAuditEvent(event));
  const parsed = lines.map((line) => parseAuditLine(line)) as AuditEvent[];
  assert.equal(parsed.length, 5);
  const verification = verifyAuditChain(parsed);
  assert.deepEqual(verification, { ok: true, verifiedCount: 5 });
});

test("tampering with ANY single record breaks the chain at that index", () => {
  const events = buildChain(5);
  for (let index = 0; index < events.length; index += 1) {
    // Mutate a payload field without fixing the checksum.
    const tampered: AuditEvent = {
      ...events[index],
      filePath: events[index].eventType === "path_gate" ? "/tmp/rewritten.txt" : events[index].filePath,
    };
    const chain = [...events.slice(0, index), tampered, ...events.slice(index + 1)];
    const verification = verifyAuditChain(chain);
    assert.equal(verification.ok, false, `tampered record ${index} must fail verification`);
    assert.equal(verification.firstBadIndex, index);
    // Records before the tampered one still verify.
    assert.equal(verification.verifiedCount, index);
  }
});

test("a broken prevChecksum link is detected even with valid checksums", () => {
  const events = buildChain(4);
  // Rebuild record 2 as if it chained from a different history: its own
  // checksum is valid, but the link to record 1 is severed.
  const orphan = buildAuditEvent({
    monotonicNs: BigInt(3_000_000),
    sessionId: "audit-session",
    prevChecksum: "0".repeat(64),
    payload: { eventType: "path_gate", tool: "write", verdict: "allow", filePath: "/tmp/x.txt" },
  });
  const verification = verifyAuditChain([events[0], events[1], orphan, events[3]]);
  assert.equal(verification.ok, false);
  assert.equal(verification.firstBadIndex, 2);
  assert.match(String(verification.reason), /prevChecksum/);
});

test("canonicalJson is key-order independent and undefined-free", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
});

test("AuditLog appends a chained file and resumes the chain across reopen", () => {
  const workspace = createWorkspace();
  const logPath = path.join(workspace, "nested", "audit", "session-1.jsonl");

  const first = AuditLog.open(logPath, "session-1");
  assert.notEqual(
    first.appendPathGate({ tool: "write", verdict: "deny", scope: "write-out-cwd", filePath: "/etc/x" }),
    null
  );
  assert.notEqual(first.appendProcessStart("bash -c 'echo hi'"), null);
  assert.notEqual(first.appendFileWrite("write", path.join(workspace, "a.txt")), null);
  assert.notEqual(
    first.appendSandboxBackend({ backend: "noop", outcome: "probe-failed", detail: "sandbox-exec missing" }),
    null
  );

  const events = readAuditEvents(logPath);
  assert.equal(events.length, 4);
  assert.deepEqual(verifyAuditChain(events), { ok: true, verifiedCount: 4 });
  assert.equal(events[0].eventType, "path_gate");
  assert.equal(events[3].eventType, "sandbox_backend");

  // Reopen: the writer must continue the existing chain, not restart it.
  const reopened = AuditLog.open(logPath, "session-1");
  assert.equal(reopened.chainTip, events[3].checksum);
  assert.notEqual(reopened.appendFileWrite("edit", path.join(workspace, "b.txt")), null);
  const allEvents = readAuditEvents(logPath);
  assert.equal(allEvents.length, 5);
  assert.deepEqual(verifyAuditChain(allEvents), { ok: true, verifiedCount: 5 });
});

test("AuditLog is fail-open: unwritable target never throws, failures are counted", () => {
  const workspace = createWorkspace();
  // The log target itself is a directory: every append fails with EISDIR.
  const blockedDir = path.join(workspace, "blocked");
  fs.mkdirSync(blockedDir);
  const log = AuditLog.open(blockedDir, "session-x");
  let threw = false;
  try {
    assert.equal(log.appendProcessStart("ls"), null);
    assert.equal(log.appendProcessStart("ls -la"), null);
  } catch {
    threw = true;
  }
  assert.equal(threw, false, "audit failure must never propagate to tool execution");
  assert.equal(log.droppedEvents, 2);
  assert.ok(log.lastFailure);
});

test("executor end-to-end: gate verdicts reach the audit hook (allow and deny)", async () => {
  const workspace = createWorkspace();
  const outside = createWorkspace();
  const executor = new ToolExecutor(workspace);
  const verdicts: Array<{ tool: string; ok: boolean | string }> = [];
  const toolCall = {
    id: "audit-exec-1",
    type: "function",
    function: {
      name: "write",
      arguments: JSON.stringify({ file_path: path.join(outside, "audited.txt"), content: "x" }),
    },
  };

  const denied = await executor.executeToolCalls(
    "audit-session",
    [toolCall],
    {
      onPathGateVerdict: (record) => verdicts.push({ tool: record.tool, ok: record.verdict.ok }),
    },
    {
      pathGrant: {
        writeRoots: [workspace],
        readRoots: [workspace],
        allowWriteOutsideRoots: false,
        allowReadOutsideRoots: false,
      },
    }
  );
  assert.equal(denied[0].result.ok, false);
  assert.deepEqual(verdicts, [{ tool: "write", ok: false }]);

  const approved = await executor.executeToolCalls(
    "audit-session",
    [{ ...toolCall, id: "audit-exec-2" }],
    {
      onPathGateVerdict: (record) => verdicts.push({ tool: record.tool, ok: record.verdict.ok }),
    },
    {
      pathGrant: {
        writeRoots: [workspace],
        readRoots: [workspace],
        allowWriteOutsideRoots: true,
        allowReadOutsideRoots: false,
      },
    }
  );
  assert.equal(approved[0].result.ok, true);
  assert.deepEqual(verdicts, [
    { tool: "write", ok: false },
    { tool: "write", ok: true },
  ]);
});
