/**
 * subagent-cleanup tests — the boot sweeper that re-claims design-pipeline
 * sub-sessions whose isSilentSubagent flag was already washed off disk by the
 * pre-fix normalize whitelist (user ask 2026-09-09: spec-writer / revise
 * orphan conversations showed up in the sidebar as 已中断/processing).
 * Match rule: flag OR known pipeline prompt prefix + no real user turn.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { cleanupLeakedSubagentSessions } from "../main/subagent-cleanup";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let home: string;
let projectCode: string;

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-sweeper-home-")));
  process.env.HOME = home;
  if (process.platform === "win32") process.env.USERPROFILE = home;
  // getUserConfigRoot resolves <home>/.deepcode when present, else .deeporca —
  // keep .deepcode absent so the sweeper scans <home>/.deeporca/projects.
  projectCode = "abc123def456";
  fs.mkdirSync(path.join(home, ".deeporca", "projects", projectCode), { recursive: true });
});

afterEach(() => {
  process.env.HOME = originalHome;
  if (process.platform === "win32") process.env.USERPROFILE = originalUserProfile;
  fs.rmSync(home, { recursive: true, force: true });
});

type Entry = {
  id: string;
  summary: string | null;
  messagesPath?: string;
  isSilentSubagent?: boolean;
};

function writeIndex(entries: Entry[]): void {
  const indexPath = path.join(home, ".deeporca", "projects", projectCode, "sessions-index.json");
  fs.writeFileSync(indexPath, JSON.stringify({ version: 1, entries, originalPath: "/ws" }, null, 2), "utf8");
}

function readIndex(): Entry[] {
  const indexPath = path.join(home, ".deeporca", "projects", projectCode, "sessions-index.json");
  return (JSON.parse(fs.readFileSync(indexPath, "utf8")) as { entries: Entry[] }).entries;
}

/** A sub-session whose only user turn IS the pipeline prompt (the leak shape). */
function writeSubagentJsonl(id: string, promptPrefix: string): string {
  const jsonlPath = path.join(home, ".deeporca", "projects", projectCode, `${id}.jsonl`);
  fs.writeFileSync(
    jsonlPath,
    [
      JSON.stringify({ role: "user", content: `${promptPrefix} Target: x. Instruction: y.` }),
      JSON.stringify({ role: "assistant", content: "done" }),
    ].join("\n")
  );
  return jsonlPath;
}

test("purges flag-carrying entries and washed-flag pipeline orphans, keeps real conversations", () => {
  const flaggedId = "11111111-1111-4111-8111-111111111111";
  const washedId = "22222222-2222-4222-8222-222222222222";
  const realConvId = "33333333-3333-4333-8333-333333333333";
  const normalId = "44444444-4444-4444-8444-444444444444";

  const washedJsonl = writeSubagentJsonl(washedId, "Write the complete structured PRD for the requirement below");
  writeIndex([
    // 标记尚存(新构建写入) → 认领
    { id: flaggedId, summary: "Revise only the openui content below. Target: x", isSilentSubagent: true },
    // 标记已被旧构建洗掉,但摘要命中设计管线前缀且无真实用户轮次 → 认领
    { id: washedId, summary: "Write the complete structured PRD for the requirement below", messagesPath: washedJsonl },
    // 同前缀但用户真实输入过 → 保留(真实会话即使摘要相似也不动)
    {
      id: realConvId,
      summary: "Write the complete structured PRD for the requirement below",
      messagesPath: path.join(home, ".deeporca", "projects", projectCode, `${realConvId}.jsonl`),
    },
    // 普通会话 → 保留
    { id: normalId, summary: "/init" },
  ]);
  // 真实会话的用户轮次(不以任何管线前缀开头)
  fs.writeFileSync(
    path.join(home, ".deeporca", "projects", projectCode, `${realConvId}.jsonl`),
    JSON.stringify({ role: "user", content: "帮我看看这个需求" })
  );

  cleanupLeakedSubagentSessions();

  const survivors = readIndex().map((entry) => entry.id);
  assert.deepEqual(survivors.sort(), [normalId, realConvId].sort(), "only real conversations survive");
  assert.equal(fs.existsSync(washedJsonl), false, "purged entry's message file is removed");
});

test("idempotent: a clean index is rewritten untouched", () => {
  const normalId = "55555555-5555-4555-8555-555555555555";
  writeIndex([{ id: normalId, summary: "普通会话" }]);
  cleanupLeakedSubagentSessions();
  cleanupLeakedSubagentSessions();
  const survivors = readIndex().map((entry) => entry.id);
  assert.deepEqual(survivors, [normalId]);
});
