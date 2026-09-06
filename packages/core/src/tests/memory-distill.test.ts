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
import { memoryDistillRun, pruneDistillSnapshots, readSessionDigest } from "../actions/memory-distill";
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
  complete?: (m: Array<{ role: "system" | "user"; content: string }>) => Promise<string | null>,
  seams?: {
    search?: (query: string, limit?: number) => Promise<string | null>;
    behavior?: () => string | null;
  }
) {
  return {
    projectRoot,
    signal: new AbortController().signal,
    emit: () => {},
    spawner: {} as never,
    ...(complete ? { completeViaLlm: complete } : {}),
    ...(seams?.search ? { searchKnownMemories: seams.search } : {}),
    ...(seams?.behavior ? { collectBehaviorContext: seams.behavior } : {}),
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

// ── P2 connectors (specs/sop-extraction §4) ─────────────────────────────────

test("distill P2: connector context lands bounded in the prompt; null/throwing seams degrade to empty", async () => {
  const home = tempDir("distill-p2-");
  const workspace = tempDir("distill-p2ws-");
  setHomeDir(home);
  seedProject(home, workspace);

  const calls: Array<{ q: string; limit?: number }> = [];
  const prompts: string[] = [];
  // Over-length on purpose: both slots must clip (600 / 1024 budgets).
  const known = "用户偏好TypeScript与React，测试用vitest，导出走Codable路径。".repeat(40);
  const behavior = "- edits under packages/core\n- runs npm test after edits\n".repeat(80);

  const out = await memoryDistillRun(
    { synthesize: true },
    buildCtx(
      workspace,
      async (m) => {
        prompts.push(m[1]!.content);
        return GOOD_SOP;
      },
      {
        search: async (q, limit) => {
          calls.push({ q, limit });
          return known;
        },
        behavior: () => behavior,
      }
    )
  );
  assert.equal(out.ok, true);
  assert.equal(out.synthesis?.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.limit, 5);
  assert.ok(calls[0]!.q.includes("动画时间线"), "query is built from digest intents");
  assert.ok(calls[0]!.q.length <= 200, "query clipped");

  // Budgets are pinned EXACTLY (over-length input → full budget, no
  // clip()-style 200-char short-circuit): the bounded slots land verbatim in
  // the prompt; the output only carries char counts (never the text itself).
  const expectedKnown = known.replace(/\s+/g, " ").trim().slice(0, 600);
  const expectedBehavior = behavior.replace(/\s+/g, " ").trim().slice(0, 1024);
  assert.equal(expectedKnown.length, 600, "fixture is over-length");
  assert.equal(expectedBehavior.length, 1024, "fixture is over-length");
  assert.equal(out.context?.relatedMemoriesChars, 600, "relatedMemories fills its budget");
  assert.equal(out.context?.behaviorProfileChars, 1024, "behaviorProfile fills its budget");

  const prompt = prompts[0]!;
  assert.match(prompt, /Known memories/);
  assert.ok(prompt.includes(expectedKnown), "known block embedded verbatim at full budget");
  assert.match(prompt, /do NOT re-distill the same fact/);
  assert.match(prompt, /Behavioral profile/);
  assert.ok(prompt.includes(expectedBehavior));
  assert.match(prompt, /A fact already present in Known memories must NOT become/);

  // Degraded truth table: null lookup + throwing collector → empty slots,
  // synthesis unaffected (same shape as a no-connector run).
  const degraded = await memoryDistillRun(
    { synthesize: true },
    buildCtx(workspace, async () => GOOD_SOP, {
      search: async () => null,
      behavior: () => {
        throw new Error("collector down");
      },
    })
  );
  assert.equal(degraded.ok, true);
  assert.equal(degraded.context, undefined);
  assert.equal(degraded.synthesis?.ok, true);
  assert.equal(degraded.synthesis?.proposals.length, 2);
});

test("distill P2 red line: a full synthesize run touches only read-only ctx keys", async () => {
  const home = tempDir("distill-rl-");
  const workspace = tempDir("distill-rlws-");
  setHomeDir(home);
  seedProject(home, workspace);

  const accessed = new Set<string>();
  const base = buildCtx(workspace, async () => GOOD_SOP, {
    search: async () => "known fact",
    behavior: () => "profile",
  });
  const proxied = new Proxy(base, {
    get(target, prop) {
      if (typeof prop === "string") accessed.add(prop);
      return Reflect.get(target, prop);
    },
  }) as Parameters<typeof memoryDistillRun>[1];

  const out = await memoryDistillRun({ synthesize: true }, proxied);
  assert.equal(out.ok, true);
  // There is no write channel to L0–L3 on the action context at all — pin it
  // behaviorally so an accidental seam addition cannot slip through unnoticed.
  const allowed = new Set(["projectRoot", "signal", "completeViaLlm", "searchKnownMemories", "collectBehaviorContext"]);
  for (const key of accessed) {
    assert.ok(allowed.has(key), `unexpected ctx access: ${key}`);
  }
});

test("distill P2.3: decisionStats aggregate the shared store (accept-rate tracking)", async () => {
  const home = tempDir("distill-st-");
  const workspace = tempDir("distill-stws-");
  setHomeDir(home);
  seedProject(home, workspace);

  const first = await memoryDistillRun(
    { synthesize: true, dryRun: false },
    buildCtx(workspace, async () => GOOD_SOP)
  );
  assert.deepEqual(first.decisionStats, { total: 0, accepted: 0, rejected: 0, skipped: 0, byAction: {} });

  const auditId = path
    .basename(
      fs.readdirSync(path.join(workspace, ".deeporca", "audits")).find((f) => f.startsWith("memory-distill-")) ?? ""
    )
    .replace(/^memory-distill-/, "")
    .replace(/\.json$/, "");
  const keySkill = first.synthesis!.proposals.find((p) => p.action === "skill-new")!.key;
  const keyRule = first.synthesis!.proposals.find((p) => p.action === "add-rule")!.key;

  const decided = await memoryDistillRun(
    {
      recordDecisions: {
        auditId,
        decisions: [
          { proposalKey: keySkill, verdict: "accept" },
          { proposalKey: keyRule, verdict: "reject" },
        ],
      },
    },
    buildCtx(workspace)
  );
  assert.equal(decided.ok, true);
  assert.equal(decided.decisionStats?.total, 2);
  assert.equal(decided.decisionStats?.accepted, 1);
  assert.equal(decided.decisionStats?.rejected, 1);
  assert.equal(decided.decisionStats?.byAction["skill-new"]?.accepted, 1);
  assert.equal(decided.decisionStats?.byAction["add-rule"]?.rejected, 1);

  // A fresh run surfaces the same aggregate — read-only tracking over the store.
  const again = await memoryDistillRun(
    { synthesize: true },
    buildCtx(workspace, async () => GOOD_SOP)
  );
  assert.equal(again.decisionStats?.total, 2);
  assert.equal(again.decisionStats?.byAction["skill-new"]?.accepted, 1);
});

test("distill: snapshot dir pruned to the newest 10 — memory-audit review-store discipline", () => {
  const dir = tempDir("distill-prune-");
  for (let i = 0; i < 12; i++) {
    fs.writeFileSync(
      path.join(dir, `memory-distill-2026-09-06T00-00-${String(i).padStart(2, "0")}Z.json`),
      "{}",
      "utf8"
    );
  }
  fs.writeFileSync(path.join(dir, "memory-audit-keepme.json"), "{}", "utf8"); // foreign prefix must survive

  pruneDistillSnapshots(dir);
  const remaining = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("memory-distill-"))
    .sort();
  assert.equal(remaining.length, 10, "keep-N = 10");
  assert.equal(remaining[0], "memory-distill-2026-09-06T00-00-02Z.json", "oldest two pruned");
  assert.ok(fs.existsSync(path.join(dir, "memory-audit-keepme.json")), "audit snapshots untouched");

  pruneDistillSnapshots(dir, 2);
  assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith("memory-distill-")).length, 2, "explicit keep honored");
});

test("distill hardening: query clipped at budget; unsafe skill names dropped; verdicts normalized; corrupt store tolerated", async () => {
  const home = tempDir("distill-hd-");
  const workspace = tempDir("distill-hdws-");
  setHomeDir(home);
  const projectDir = seedProject(home, workspace);
  // Two 400-char intents (each digested down to 160) so the joined L1 query
  // exceeds the 200 budget and the clip must engage.
  for (const [id, ch, stamp] of [
    ["s3", "长", "2026-09-04T13:00:00.000Z"],
    ["s4", "庚", "2026-09-04T12:30:00.000Z"],
  ] as const) {
    fs.writeFileSync(
      path.join(projectDir, `${id}.jsonl`),
      [msg("user", ch.repeat(400)), msg("assistant", "done")].join("\n") + "\n",
      "utf8"
    );
  }
  fs.writeFileSync(
    path.join(projectDir, "sessions-index.json"),
    JSON.stringify({
      version: 1,
      entries: [
        { id: "s1", status: "completed", updateTime: "2026-09-04T12:00:00.000Z" },
        { id: "s2", status: "completed", updateTime: "2026-09-04T11:00:00.000Z" },
        { id: "s3", status: "completed", updateTime: "2026-09-04T13:00:00.000Z" },
        { id: "s4", status: "completed", updateTime: "2026-09-04T12:30:00.000Z" },
      ],
    }),
    "utf8"
  );

  const calls: Array<{ q: string }> = [];
  const out = await memoryDistillRun(
    { sessions: 4, synthesize: true },
    buildCtx(workspace, async () => GOOD_SOP, {
      search: async (q) => {
        calls.push({ q });
        return "已知事实";
      },
    })
  );
  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.q.length, 200, "query clipped at exactly RELATED_QUERY_MAX");
  assert.ok(out.context?.relatedMemoriesChars, "known block present");

  // skillName with path separators must be dropped (it becomes a file path).
  const BAD_NAME =
    '{"sopProposals":[{"action":"skill-new","skillName":"a/../evil","body":"---\\nname: x\\n---\\nbody","rationale":"pathy","evidenceRefs":["s3#0"],"estTokens":1}]}';
  const bad = await memoryDistillRun(
    { sessionId: "s3", synthesize: true },
    buildCtx(workspace, async () => BAD_NAME)
  );
  assert.equal(bad.synthesis?.proposals.length, 0);
  assert.equal(bad.synthesis?.dropped, 1);

  // A hand-corrupted rejections store must not brick the stats (fail-open).
  const storeDir = path.join(workspace, ".deeporca", "audits");
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(
    path.join(storeDir, "rejections.json"),
    JSON.stringify({ "skill-new:agents:deadbeef": null, "add-rule:agents:cafe": { verdict: "accept", at: "t" } }),
    "utf8"
  );
  const stats = await memoryDistillRun({ sessionId: "s3" }, buildCtx(workspace));
  assert.equal(stats.ok, true);
  assert.equal(stats.decisionStats?.total, 1, "null entry skipped, valid one counted");
  assert.equal(stats.decisionStats?.accepted, 1);

  // recordDecisions normalizes unknown verdicts into the skip bucket.
  const snap = await memoryDistillRun(
    { synthesize: true, dryRun: false },
    buildCtx(workspace, async () => GOOD_SOP)
  );
  const auditId = path
    .basename(fs.readdirSync(storeDir).find((f) => f.startsWith("memory-distill-")) ?? "")
    .replace(/^memory-distill-/, "")
    .replace(/\.json$/, "");
  const keyRule = snap.synthesis!.proposals.find((p) => p.action === "add-rule")!.key;
  const normalized = await memoryDistillRun(
    { recordDecisions: { auditId, decisions: [{ proposalKey: keyRule, verdict: "accepted" }] } },
    buildCtx(workspace)
  );
  assert.equal(normalized.ok, true);
  assert.equal(normalized.decisionStats?.skipped, 1, "unknown verdict lands as skip");
  assert.equal(normalized.decisionStats?.accepted, 1, "pre-seeded accept survives");
  assert.equal(normalized.pendingWriteBacks, undefined, "skip never produces a write-back");
  const persisted = JSON.parse(fs.readFileSync(path.join(storeDir, "rejections.json"), "utf8")) as Record<
    string,
    { verdict: string }
  >;
  assert.equal(persisted[keyRule]?.verdict, "skip", "unknown verdict is normalized at write time");
});
