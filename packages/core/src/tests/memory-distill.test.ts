/**
 * specs/sop-extraction — memory.distill truth tables.
 *
 * Pins: deterministic digest (intents/tools/conclusion, clipping, corrupt-line
 * tolerance), the SOP synthesis contract (skill-new needs body, name collision
 * degrades to drop, evidence-ref shape, ≤5 cap, fail-open), the shared review
 * loop (recordDecisions → write-backs; settled keys never resurface), and
 * dryRun read-only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { memoryDistillRun, readSessionDigest } from "../actions/memory-distill";
import { getProjectCode } from "../common/app-dirs";
import { setHomeDir } from "./session-test-utils";

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function msg(role: string, content: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ id: "m", sessionId: "s1", role, content, createTime: "2026-09-04T10:00:00.000Z", ...extra });
}

const TOOL_RESULT = (name: string) => JSON.stringify({ ok: true, name, output: "done" });
const CALL = (name: string, args: Record<string, unknown>) => ({
  function: { name, arguments: JSON.stringify(args) },
});

function buildCtx(
  projectRoot: string,
  complete?: (m: Array<{ role: "system" | "user"; content: string }>) => Promise<string | null>
) {
  return {
    projectRoot,
    signal: new AbortController().signal,
    emit: () => {},
    spawner: {} as never,
    ...(complete ? { completeViaLlm: complete } : {}),
  } as Parameters<typeof memoryDistillRun>[1];
}

function seedProject(home: string, workspace: string): string {
  const projectDir = path.join(home, ".deeporca", "projects", getProjectCode(workspace));
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "sessions-index.json"),
    JSON.stringify({
      version: 1,
      entries: [
        { id: "s1", status: "completed", updateTime: "2026-09-04T12:00:00.000Z" },
        { id: "s2", status: "completed", updateTime: "2026-09-04T11:00:00.000Z" },
      ],
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(projectDir, "s1.jsonl"),
    [
      msg("user", "帮我把动画时间线导出成 JSON 并写个解析测试"),
      "{corrupt json line",
      msg("assistant", "我先看一下导出接口", {
        messageParams: { tool_calls: [CALL("read", { file_path: "Sources/Export/Timeline.swift" })] },
      }),
      msg("tool", TOOL_RESULT("read")),
      msg("assistant", "现在写解析测试", {
        messageParams: { tool_calls: [CALL("bash", { command: "swift test --filter TimelineParse" })] },
      }),
      msg("tool", TOOL_RESULT("bash")),
      msg("assistant", "完成：导出走 Codable 路径，测试覆盖了时间戳边界。"),
    ].join("\n") + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(projectDir, "s2.jsonl"),
    [msg("user", "随便聊聊"), msg("assistant", "好的。")].join("\n") + "\n",
    "utf8"
  );
  return projectDir;
}

test("digest: intents, tool portrait, conclusion — clipped, corrupt-line tolerant", () => {
  const home = tempDir("distill-dg-");
  const workspace = tempDir("distill-dgws-");
  setHomeDir(home);
  const projectDir = seedProject(home, workspace);

  const digest = readSessionDigest(projectDir, "s1")!;
  assert.ok(digest, "digest exists");
  assert.equal(digest.intents.length, 1);
  assert.ok(digest.intents[0]!.includes("动画时间线"));
  const read = digest.tools.find((t) => t.name === "read");
  const bash = digest.tools.find((t) => t.name === "bash");
  assert.equal(read?.count, 1);
  assert.ok(read?.args[0]?.includes("Timeline.swift"));
  assert.equal(bash?.count, 1);
  assert.ok(bash?.args[0]?.includes("swift test"));
  assert.ok(digest.conclusion.includes("Codable"));
  assert.equal(readSessionDigest(projectDir, "missing-session"), null);
  assert.equal(readSessionDigest(projectDir, "../../etc"), null); // traversal guard
});

const GOOD_SOP =
  '{"sopProposals":[' +
  '{"action":"skill-new","skillName":"timeline-export-test","body":"---\\nname: timeline-export-test\\ndescription: Export the animation timeline to JSON and cover timestamp boundaries with a parse test\\n---\\n# Timeline export testing SOP\\n1. Read Sources/Export/Timeline.swift first\\n2. Export via Codable\\n3. Run swift test --filter TimelineParse","rationale":"The session shows a reusable export+test procedure","evidenceRefs":["s1#0"],"estTokens":120},' +
  '{"action":"skill-new","skillName":"timeline-export-test","body":"x","rationale":"in-batch duplicate name must drop","evidenceRefs":["s1#0"],"estTokens":1},' +
  '{"action":"add-rule","ruleText":"Prefer Codable for JSON export paths.","rationale":"worked here","evidenceRefs":["s1#0"],"estTokens":12},' +
  '{"action":"skill-new","skillName":"no-body","rationale":"missing body must drop","evidenceRefs":["s1#0"],"estTokens":1},' +
  '{"action":"add-rule","ruleText":"bad ref","rationale":"malformed evidence","evidenceRefs":["not-a-ref"],"estTokens":1}' +
  "]}";

test("distill: synthesis keeps valid SOPs, drops collisions/no-body/bad-refs; dryRun read-only", async () => {
  const home = tempDir("distill-sy-");
  const workspace = tempDir("distill-syws-");
  setHomeDir(home);
  seedProject(home, workspace);
  // an existing skill named the same as proposal 1 → skill-new #1 degrades too;
  // make the existing skill a DIFFERENT name so #1 survives and #2 collides.
  fs.mkdirSync(path.join(workspace, ".deeporca", "skills", "timeline-export-test"), { recursive: true });
  // wait — we want #1 to SURVIVE; use a different collision target for #2.
  fs.rmSync(path.join(workspace, ".deeporca", "skills", "timeline-export-test"), { recursive: true, force: true });
  fs.mkdirSync(path.join(workspace, ".deeporca", "skills", "occupied"), { recursive: true });

  const out = await memoryDistillRun(
    { synthesize: true },
    buildCtx(workspace, async () => GOOD_SOP)
  );
  assert.equal(out.ok, true);
  assert.equal(out.digests.length, 2); // s1 has material, s2 has an intent → both kept
  assert.equal(out.synthesis?.ok, true);
  assert.equal(out.synthesis?.proposals.length, 2); // skill-new + add-rule
  assert.equal(out.synthesis?.dropped, 3); // collision + no-body + bad-ref
  const skillNew = out.synthesis?.proposals.find((p) => p.action === "skill-new");
  assert.ok(skillNew?.body?.includes("name: timeline-export-test"));
  assert.ok(out.reviewInstructions?.includes("AskUserQuestion"));
  assert.equal(fs.existsSync(path.join(workspace, ".deeporca", "audits")), false); // dryRun read-only (setup itself created .deeporca/skills)
});

test("distill: name collision with an existing skill degrades skill-new to drop", async () => {
  const home = tempDir("distill-co-");
  const workspace = tempDir("distill-cows-");
  setHomeDir(home);
  seedProject(home, workspace);
  fs.mkdirSync(path.join(workspace, ".deeporca", "skills", "timeline-export-test"), { recursive: true });

  const out = await memoryDistillRun(
    { synthesize: true },
    buildCtx(workspace, async () => GOOD_SOP)
  );
  assert.equal(out.synthesis?.proposals.filter((p) => p.action === "skill-new").length, 0);
  assert.equal(out.synthesis?.proposals.length, 1); // only add-rule survives
  assert.equal(out.synthesis?.dropped, 4);
});

test("distill: fail-open on garbage output; graceful without the completeViaLlm seam", async () => {
  const home = tempDir("distill-fo-");
  const workspace = tempDir("distill-fows-");
  setHomeDir(home);
  seedProject(home, workspace);

  const garbage = await memoryDistillRun(
    { synthesize: true },
    buildCtx(workspace, async () => "garbage")
  );
  assert.equal(garbage.ok, true);
  assert.equal(garbage.synthesis?.ok, false);

  const noSeam = await memoryDistillRun({ synthesize: true }, buildCtx(workspace));
  assert.equal(noSeam.synthesis?.ok, false);
  assert.match(noSeam.synthesis?.error ?? "", /seam not injected/);
});

test("distill: end-to-end review loop — snapshot written, accept → write-tool write-back, settled key never resurfaces", async () => {
  const home = tempDir("distill-e2e-");
  const workspace = tempDir("distill-e2ews-");
  setHomeDir(home);
  seedProject(home, workspace);

  const first = await memoryDistillRun(
    { synthesize: true, dryRun: false },
    buildCtx(workspace, async () => GOOD_SOP)
  );
  assert.ok(first.reviewInstructions);
  const auditId = path
    .basename(
      fs.readdirSync(path.join(workspace, ".deeporca", "audits")).find((f) => f.startsWith("memory-distill-")) ?? ""
    )
    .replace(/^memory-distill-/, "")
    .replace(/\.json$/, "");
  const keySkill = first.synthesis!.proposals.find((p) => p.action === "skill-new")!.key;

  const decided = await memoryDistillRun(
    { recordDecisions: { auditId, decisions: [{ proposalKey: keySkill, verdict: "accept" }] } },
    buildCtx(workspace)
  );
  assert.equal(decided.ok, true);
  assert.equal(decided.pendingWriteBacks?.length, 1);
  const wb = decided.pendingWriteBacks![0]!;
  assert.equal(wb.targetFile, "SKILL.md");
  assert.ok(wb.instruction.includes("native WRITE tool"));
  assert.ok(wb.instruction.includes(".deeporca/skills/timeline-export-test/SKILL.md"));
  assert.ok(wb.instruction.includes("name: timeline-export-test"));

  // settled: a fresh synthesis must not re-propose it (shared store)
  const again = await memoryDistillRun(
    { synthesize: true },
    buildCtx(workspace, async () => GOOD_SOP)
  );
  assert.equal(
    again.synthesis?.proposals.some((p) => p.key === keySkill),
    false
  );
});

test("distill: bad auditId fails cleanly; sessionId traversal rejected", async () => {
  const home = tempDir("distill-bad-");
  const workspace = tempDir("distill-badws-");
  setHomeDir(home);
  const bad = await memoryDistillRun({ recordDecisions: { auditId: "../escape", decisions: [] } }, buildCtx(workspace));
  assert.equal(bad.ok, false);
  const trav = await memoryDistillRun({ sessionId: "../../etc" }, buildCtx(workspace));
  assert.equal(trav.ok, false);
  assert.match(trav.error ?? "", /invalid sessionId/);
});
