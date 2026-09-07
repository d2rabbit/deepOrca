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

// ── P1/P2: synthesis, review loop, rejection persistence, controlled write-back ──

function buildCtx2(
  projectRoot: string,
  complete?: (m: Array<{ role: "system" | "user"; content: string }>) => Promise<string | null>
) {
  return {
    projectRoot,
    signal: new AbortController().signal,
    emit: () => {},
    spawner: {} as never,
    ...(complete ? { completeViaLlm: complete } : {}),
  } as Parameters<typeof memoryAuditRun>[1];
}

function seedTwoFailureSessions(projectDir: string): void {
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "sessions-index.json"),
    JSON.stringify({
      version: 1,
      originalPath: "ws",
      entries: [
        { id: "s1", status: "completed", updateTime: "2026-09-04T12:00:00.000Z" },
        { id: "s2", status: "completed", updateTime: "2026-09-04T11:00:00.000Z" },
      ],
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(projectDir, "s1.jsonl"),
    toolMessage(
      "m1",
      "s1",
      { ok: false, name: "bash", error: "permission denied for git", errorType: "PERMISSION_DENIED" },
      { command: "git status" }
    ),
    "utf8"
  );
  fs.writeFileSync(
    path.join(projectDir, "s2.jsonl"),
    toolMessage(
      "m2",
      "s2",
      { ok: false, name: "bash", error: "permission denied for git", errorType: "PERMISSION_DENIED" },
      { command: "git log" }
    ),
    "utf8"
  );
}

const GOOD_JSON =
  '{"proposals":[' +
  '{"action":"add","target":"agents","ruleText":"Prefer scoped git commands; avoid bare git runs without a path.","evidenceIds":["ev-0","ev-1"],"rationale":"Two sessions hit PERMISSION_DENIED on git","estTokens":18},' +
  '{"action":"add","target":"agents","ruleText":"Bogous one","evidenceIds":["ev-99"],"rationale":"bad evidence","estTokens":1}' +
  "]}";

test("P1: synthesis parses the contract, drops bad-evidence proposals, dryRun stays read-only", async () => {
  const home = tempDir("deeporca-ma-p1-");
  const workspace = tempDir("deeporca-ma-p1ws-");
  setHomeDir(home);
  const projectDir = path.join(home, ".deeporca", "projects", getProjectCode(workspace));
  seedTwoFailureSessions(projectDir);

  const calls: number[] = [];
  const out = await memoryAuditRun(
    { synthesize: true },
    buildCtx2(workspace, async () => {
      calls.push(1);
      return GOOD_JSON;
    })
  );

  assert.equal(out.ok, true);
  assert.equal(out.synthesis?.ok, true);
  assert.equal(out.synthesis?.proposals.length, 1); // ev-99 dropped
  assert.equal(out.synthesis?.dropped, 1);
  const proposals = out.synthesis?.proposals ?? [];
  assert.equal(proposals.length, 1);
  assert.deepEqual(proposals[0]?.evidenceIds, ["ev-0", "ev-1"]);
  assert.ok(out.reviewInstructions?.includes("AskUserQuestion"));
  assert.equal(calls.length, 1);
  assert.equal(fs.existsSync(path.join(workspace, ".deeporca", "audits")), false); // dryRun read-only
});

test("P1: synthesis fail-opens (garbage output) — the snapshot still returns", async () => {
  const home = tempDir("deeporca-ma-p1b-");
  const workspace = tempDir("deeporca-ma-p1bws-");
  setHomeDir(home);
  seedTwoFailureSessions(path.join(home, ".deeporca", "projects", getProjectCode(workspace)));

  const out = await memoryAuditRun(
    { synthesize: true },
    buildCtx2(workspace, async () => "total garbage")
  );
  assert.equal(out.ok, true);
  assert.equal(out.synthesis?.ok, false);
  assert.equal(out.synthesis?.proposals.length, 0);
  assert.equal(out.reviewInstructions, undefined);
});

test("P1/P2 end-to-end: snapshot+report written, decisions recorded, rejected never resurfaces, accepts get write-backs", async () => {
  const home = tempDir("deeporca-ma-p2-");
  const workspace = tempDir("deeporca-ma-p2ws-");
  setHomeDir(home);
  seedTwoFailureSessions(path.join(home, ".deeporca", "projects", getProjectCode(workspace)));

  // 1) synthesize + write snapshot & HTML report
  const first = await memoryAuditRun(
    { synthesize: true, dryRun: false },
    buildCtx2(workspace, async () => GOOD_JSON)
  );
  assert.ok(first.snapshotPath && fs.existsSync(first.snapshotPath!));
  assert.ok(first.reportPath && fs.existsSync(first.reportPath!));
  const report = fs.readFileSync(first.reportPath!, "utf8");
  assert.ok(report.includes("记忆审计报告") && report.includes("Memory Audit Report"));
  const auditId = path
    .basename(first.snapshotPath!)
    .replace(/^memory-audit-/, "")
    .replace(/\.json$/, "");
  const keyA = first.synthesis!.proposals[0]!.key;

  // 2) record an accept → controlled write-back comes back for the native edit tool
  const second = await memoryAuditRun(
    { recordDecisions: { auditId, decisions: [{ proposalKey: keyA, verdict: "accept", note: "looks right" }] } },
    buildCtx2(workspace)
  );
  assert.equal(second.ok, true);
  assert.equal(second.pendingWriteBacks?.length, 1);
  const wb = second.pendingWriteBacks![0]!;
  assert.equal(wb.proposalKey, keyA);
  assert.equal(wb.targetFile, "AGENTS.md");
  assert.ok(wb.instruction.includes("native edit tool"));
  assert.ok(wb.instruction.includes("ev-"));

  // 3) persistence: the store records the accept; a fresh synthesis excludes it
  const storeFile = path.join(workspace, ".deeporca", "audits", "rejections.json");
  const store = JSON.parse(fs.readFileSync(storeFile, "utf8"));
  assert.equal(store[keyA]?.verdict, "accept");
  const third = await memoryAuditRun(
    { synthesize: true },
    buildCtx2(workspace, async () => GOOD_JSON)
  );
  assert.equal(third.synthesis?.proposals.length, 0); // the one valid proposal is now recorded
  assert.equal(third.synthesis?.dropped, 2); // one bad evidence + one recorded
});

test("P1: recordDecisions with an unknown auditId fails cleanly", async () => {
  const home = tempDir("deeporca-ma-p2b-");
  const workspace = tempDir("deeporca-ma-p2bws-");
  setHomeDir(home);
  const out = await memoryAuditRun(
    { recordDecisions: { auditId: "nope", decisions: [{ proposalKey: "x:y:z", verdict: "reject" }] } },
    buildCtx2(workspace)
  );
  assert.equal(out.ok, false);
  assert.match(out.error ?? "", /snapshot not found/);
});

test("P1: the prompt's literal JSON template echoes back into a valid synthesis", async () => {
  const home = tempDir("deeporca-ma-p1c-");
  const workspace = tempDir("deeporca-ma-p1cws-");
  setHomeDir(home);
  seedTwoFailureSessions(path.join(home, ".deeporca", "projects", getProjectCode(workspace)));

  const out = await memoryAuditRun(
    { synthesize: true },
    buildCtx2(workspace, async (m) => {
      // A model echoing the prompt's "Respond with JSON only:" template
      // verbatim must satisfy the validator (the template used to say
      // "proosals" while the validator reads "proposals" — a literal echo
      // could never validate).
      const prompt = m[1]?.content ?? "";
      return prompt.split("Respond with JSON only: ")[1] ?? "";
    })
  );
  assert.equal(out.synthesis?.ok, true, "the echoed template must pass validation");
  assert.equal(out.synthesis?.proposals.length, 1);
  assert.deepEqual(out.synthesis?.proposals[0]?.evidenceIds, ["ev-0"]);
});
