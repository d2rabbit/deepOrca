/**
 * specs/memory-audit P0 — deterministic evidence scan truth table.
 *
 * Fixture: a fake project storage (sessions-index + transcript JSONL + audit
 * hash-chain files) under a temp HOME. Pins:
 *   - failure events from transcripts (errorType classification), index
 *     (failed session) and audit chain (path_gate deny);
 *   - silent-subagent sessions excluded from the material;
 *   - corroboration: permission-denied bash/git across 2 sessions becomes a
 *     corroborated pattern + alwaysAllow candidate; single-session TIMEOUT
 *     stays uncorroborated;
 *   - chain integrity: one verified file, one broken file, denyEvents total;
 *   - dryRun is read-only (no writes under the workspace), dryRun:false
 *     writes the snapshot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { memoryAuditRun } from "../actions/memory-audit";
import { buildAuditEvent, serializeAuditEvent, type AuditEvent, type AuditEventPayload } from "../sandbox/audit";
import { getProjectCode } from "../common/app-dirs";
import { setHomeDir } from "./session-test-utils";

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function toolMessage(id: string, sessionId: string, result: unknown, fn?: unknown): string {
  return JSON.stringify({
    id,
    sessionId,
    role: "tool",
    content: JSON.stringify(result),
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-09-04T10:00:00.000Z",
    updateTime: "2026-09-04T10:00:00.000Z",
    meta: fn === undefined ? null : { function: fn },
  });
}

function buildDenyChain(sessionId: string, denyFilePath: string): string {
  const events: AuditEvent[] = [];
  let prev = "";
  const payloads: AuditEventPayload[] = [
    { eventType: "path_gate", tool: "bash", verdict: "deny", scope: "write-in-cwd", filePath: denyFilePath },
    { eventType: "path_gate", tool: "bash", verdict: "allow", scope: "read-in-cwd", filePath: "ok.txt" },
  ];
  for (const [index, payload] of payloads.entries()) {
    const event = buildAuditEvent({
      monotonicNs: BigInt(index + 1),
      wallClock: `2026-09-04T10:0${index}:00.000Z`,
      sessionId,
      prevChecksum: prev,
      payload,
    });
    prev = event.checksum;
    events.push(event);
  }
  return events.map(serializeAuditEvent).join("\n") + "\n";
}

function buildCtx(projectRoot: string) {
  return {
    projectRoot,
    signal: new AbortController().signal,
    emit: () => {},
    spawner: {} as never,
  } as Parameters<typeof memoryAuditRun>[1];
}

test("memory.audit P0: evidence scan, corroboration, chain integrity, dryRun read-only", async () => {
  const home = tempDir("deeporca-ma-home-");
  const workspace = tempDir("deeporca-ma-ws-");
  setHomeDir(home);
  const projectDir = path.join(home, ".deeporca", "projects", getProjectCode(workspace));
  fs.mkdirSync(path.join(projectDir, "audit"), { recursive: true });

  fs.writeFileSync(
    path.join(projectDir, "sessions-index.json"),
    JSON.stringify({
      version: 1,
      originalPath: workspace,
      entries: [
        { id: "s1", status: "completed", updateTime: "2026-09-04T12:00:00.000Z" },
        { id: "s2", status: "completed", updateTime: "2026-09-04T11:00:00.000Z" },
        { id: "s3", status: "completed", updateTime: "2026-09-04T10:30:00.000Z", isSilentSubagent: true },
        { id: "s4", status: "failed", failReason: "llm connection dropped", updateTime: "2026-09-04T10:00:00.000Z" },
      ],
    }),
    "utf8"
  );

  fs.writeFileSync(
    path.join(projectDir, "s1.jsonl"),
    [
      toolMessage(
        "m1",
        "s1",
        { ok: false, name: "bash", error: "permission denied for git", errorType: "PERMISSION_DENIED" },
        { command: "git status --short" }
      ),
      toolMessage("m2", "s1", { ok: true, name: "read", output: "fine" }),
    ].join("\n") + "\n"
  );
  fs.writeFileSync(
    path.join(projectDir, "s2.jsonl"),
    [
      toolMessage(
        "m3",
        "s2",
        { ok: false, name: "bash", error: "permission denied for git", errorType: "PERMISSION_DENIED" },
        { command: "git push origin main" }
      ),
      toolMessage("m4", "s2", { ok: false, name: "read", error: "timed out after 5000ms", errorType: "TIMEOUT" }),
    ].join("\n") + "\n"
  );

  // s2: a VERIFIED chain with one deny; s4: a tampered chain (broken) with a deny.
  fs.writeFileSync(path.join(projectDir, "audit", "s2.jsonl"), buildDenyChain("s2", "outside.txt"), "utf8");
  const tampered = buildDenyChain("s4", "outside2.txt").split("\n");
  tampered[0] = tampered[0]!.replace(/"filePath":"outside2.txt"/, '"filePath":"tampered.txt"');
  fs.writeFileSync(path.join(projectDir, "audit", "s4.jsonl"), tampered.join("\n"), "utf8");

  const output = await memoryAuditRun({}, buildCtx(workspace));

  assert.equal(output.ok, true);
  assert.equal(output.scannedSessions, 3); // s1, s2, s4
  assert.equal(output.excludedSilentSessions, 1);

  // index-level failure evidence surfaced
  const sessionFailed = output.events.find((e) => e.kind === "session-failed");
  assert.ok(sessionFailed && sessionFailed.message.includes("llm connection dropped"));

  // errorType classification
  assert.ok(
    output.events.some((e) => e.kind === "permission-denied" && e.tool === "bash" && e.commandPrefix === "git")
  );
  assert.ok(output.events.some((e) => e.kind === "timeout" && e.tool === "read"));

  // corroboration: bash permission-denied across s1+s2 → corroborated + candidate
  const bashPattern = output.patterns.find((p) => p.kind === "permission-denied" && p.tool === "bash");
  assert.ok(bashPattern, "bash permission-denied pattern exists");
  assert.equal(bashPattern?.distinctSessions, 2);
  assert.equal(bashPattern?.corroborated, true);
  const candidate = output.candidates.find((c) => c.tool === "bash" && c.commandPrefix === "git");
  assert.ok(candidate && candidate.distinctSessions === 2);
  // single-session TIMEOUT stays uncorroborated and never becomes a candidate
  const timeoutPattern = output.patterns.find((p) => p.kind === "timeout");
  assert.equal(timeoutPattern?.corroborated, false);
  assert.equal(
    output.candidates.some((c) => c.commandPrefix === "read"),
    false
  );

  // audit chain integrity: 2 files, 1 verified, 1 broken, 2 deny events
  assert.deepEqual(output.auditChain, { files: 2, verified: 1, broken: 1, denyEvents: 2 });
  const chainDeny = output.events.find((e) => e.kind === "path-gate-deny");
  assert.ok(chainDeny);

  // dryRun default: strictly read-only — nothing written under the workspace
  assert.equal(output.snapshotPath, undefined);
  assert.equal(fs.existsSync(path.join(workspace, ".deeporca", "audits")), false);
});

test("memory.audit P0: dryRun:false writes the snapshot into .deeporca/audits/", async () => {
  const home = tempDir("deeporca-ma-home2-");
  const workspace = tempDir("deeporca-ma-ws2-");
  setHomeDir(home);
  const projectDir = path.join(home, ".deeporca", "projects", getProjectCode(workspace));
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "sessions-index.json"),
    JSON.stringify({
      version: 1,
      originalPath: workspace,
      entries: [{ id: "s1", status: "completed", updateTime: "2026-09-04T12:00:00.000Z" }],
    }),
    "utf8"
  );

  const output = await memoryAuditRun({ dryRun: false }, buildCtx(workspace));
  assert.equal(output.ok, true);
  assert.ok(output.snapshotPath && fs.existsSync(output.snapshotPath!));
  const persisted = JSON.parse(fs.readFileSync(output.snapshotPath!, "utf8"));
  assert.equal(persisted.scannedSessions, 1);
});

test("memory.audit P0: missing index degrades to an empty scan, never throws", async () => {
  const home = tempDir("deeporca-ma-home3-");
  const workspace = tempDir("deeporca-ma-ws3-");
  setHomeDir(home);
  const output = await memoryAuditRun({}, buildCtx(workspace));
  assert.equal(output.ok, true);
  assert.equal(output.scannedSessions, 0);
  assert.equal(output.events.length, 0);
});
