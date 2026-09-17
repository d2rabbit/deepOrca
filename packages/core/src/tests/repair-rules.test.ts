// Repair-rule mining integration (specs/repair-rule-memory P0/P2): a real
// TaskTreeService on a temp project + temp HOME session transcripts — the
// abandoned-parent → repaired-child fork pair must mine deterministically.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TaskTreeService } from "../tasks/task-tree-service";
import { getProjectCode, getUserConfigRoot } from "../common/app-dirs";
import { mineRepairPairs } from "../actions/repair-rules";
import { registerSessionTestCleanup, setHomeDir } from "./session-test-utils";

registerSessionTestCleanup();

let projectRoot: string;
let projectDir: string;

beforeEach(() => {
  setHomeDir(fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-repair-")));
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-repair-proj-"));
  projectDir = path.join(getUserConfigRoot(), "projects", getProjectCode(projectRoot));
  fs.mkdirSync(projectDir, { recursive: true });
});

function writeTranscript(sessionId: string, toolCalls: Array<{ name: string; arguments: string }>): void {
  const lines = [
    JSON.stringify({ role: "user", content: "go", createTime: "2026-09-17T00:00:00Z" }),
    ...toolCalls.map((call) =>
      JSON.stringify({
        role: "assistant",
        content: "",
        createTime: "2026-09-17T00:00:01Z",
        messageParams: { tool_calls: [{ id: `c-${Math.random()}`, type: "function", function: call }] },
      })
    ),
  ];
  fs.writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`, "utf8");
}

/** Parent retries a doomed grab ×3; child drops first, then grabs once. */
const PARENT_CALLS = [
  { name: "read", arguments: JSON.stringify({ path: "pkg.json" }) },
  { name: "bash", arguments: JSON.stringify({ command: "cat pkg.json" }) },
  { name: "grab", arguments: JSON.stringify({ path: "foo" }) },
  { name: "grab", arguments: JSON.stringify({ path: "foo" }) },
  { name: "grab", arguments: JSON.stringify({ path: "foo" }) },
  { name: "inspect", arguments: JSON.stringify({ path: "dir" }) },
  { name: "write", arguments: JSON.stringify({ path: "out.md" }) },
];
const CHILD_CALLS = [
  { name: "read", arguments: JSON.stringify({ path: "pkg.json" }) },
  { name: "bash", arguments: JSON.stringify({ command: "cat pkg.json" }) },
  { name: "drop", arguments: JSON.stringify({ path: "bar" }) },
  { name: "grab", arguments: JSON.stringify({ path: "foo" }) },
  { name: "inspect", arguments: JSON.stringify({ path: "dir" }) },
  { name: "write", arguments: JSON.stringify({ path: "out.md" }) },
];

/**
 * Build the abandoned→repaired fork scenario. Ordering matters: fork()
 * SWITCHES the active branch (so the parent becomes non-head and can be
 * abandoned — abandon() never touches the head branch).
 */
function buildPairFixture(
  svc: TaskTreeService,
  opts: { parentCalls: typeof PARENT_CALLS; childCalls: typeof CHILD_CALLS; abandonParent: boolean }
): string {
  const treeId = svc.createTree("ship the feature")!;
  assert.ok(svc.appendStep(treeId, { title: "try grabbing", prompt: "p" }));
  svc.bindSession(treeId, "main", "session-parent");
  writeTranscript("session-parent", opts.parentCalls);
  const forkNodeId = svc.fork(treeId, { name: "repair", why: "main kept retrying the grab; drop it first" });
  assert.ok(forkNodeId, "fork succeeds");
  if (opts.abandonParent) {
    assert.ok(svc.abandon(treeId, "main"), "abandon works once main is no longer the head branch");
  }
  svc.bindSession(treeId, "repair", "session-child");
  writeTranscript("session-child", opts.childCalls);
  return treeId;
}

test("mines the abandoned→repaired fork pair with the golden edit path", () => {
  const svc = new TaskTreeService(projectRoot);
  buildPairFixture(svc, { parentCalls: PARENT_CALLS, childCalls: CHILD_CALLS, abandonParent: true });

  const { pairs, treesScanned, forksSeen } = mineRepairPairs(projectRoot, 5);
  assert.equal(treesScanned, 1);
  assert.equal(forksSeen, 1);
  assert.equal(pairs.length, 1);
  const pair = pairs[0]!;
  assert.equal(pair.parentBranch, "main");
  assert.equal(pair.childBranch, "repair");
  assert.equal(pair.parentSession, "session-parent");
  assert.equal(pair.childSession, "session-child");
  assert.ok(pair.forkWhy.includes("drop it first"));
  // Golden edit path: 5-unit spine, ONE deleted cluster (the 2 extra grabs), drop insertion.
  assert.equal(pair.editPath.spine.length, 5);
  assert.equal(pair.editPath.deletedClusters.length, 1);
  assert.equal(pair.editPath.deletedClusters[0]!.length, 2);
  assert.deepEqual(pair.editPath.insertions, [{ tool: "drop", argsDigest: "bar" }]);
});

test("no signal pairs when the parent branch was NOT abandoned (honest empty)", () => {
  const svc = new TaskTreeService(projectRoot);
  buildPairFixture(svc, { parentCalls: PARENT_CALLS, childCalls: CHILD_CALLS, abandonParent: false });
  const { pairs } = mineRepairPairs(projectRoot, 5);
  assert.equal(pairs.length, 0, "open parent branch never mines — only abandoned→repaired does");
});

test("identical trajectories on both branches carry no rule signal", () => {
  const svc = new TaskTreeService(projectRoot);
  buildPairFixture(svc, { parentCalls: CHILD_CALLS, childCalls: CHILD_CALLS, abandonParent: true });
  const { pairs } = mineRepairPairs(projectRoot, 5);
  assert.equal(pairs.length, 0, "zero deletion clusters → no signal (graceful degradation)");
});
