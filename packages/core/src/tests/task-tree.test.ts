import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TaskTreeService } from "../tasks/task-tree-service";

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-tree-test-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

test("create → append → fork produces two visible branches, fork requires why", () => {
  const root = tempRoot();
  const svc = new TaskTreeService(root);
  const treeId = svc.createTree("Build the onboarding flow", { why: "Q3 goal" });
  assert.ok(treeId);

  const step1 = svc.appendStep(treeId!, { title: "Draft screens", why: "wireframe first" });
  assert.ok(step1);

  const forkNode = svc.fork(treeId!, { name: "playful", why: "Try a more playful tone vs neutral" });
  assert.ok(forkNode);
  // fork switches to the new branch
  const tree = svc.getTree(treeId!);
  assert.equal(tree!.index.activeBranch, "playful");
  assert.equal(Object.keys(tree!.index.branches).length, 2);

  // Steps after the fork land on the new branch.
  const step2 = svc.appendStep(treeId!, { title: "Playful copy pass" });
  const after = svc.getTree(treeId!)!;
  const head = after.index.branches["playful"]!.headId;
  assert.equal(head, step2);

  // The fork node carries the human narrative.
  const fork = svc.getNode(treeId!, forkNode!);
  assert.equal(fork!.kind, "fork");
  assert.match(fork!.why, /playful tone/);
  assert.equal(fork!.title.includes("playful"), true);

  // A fork without a why is rejected — no story, no branch.
  assert.equal(svc.fork(treeId!, { name: "silent", why: "   " }), null);
});

test("switch + abandon: abandoned branches grey out, HEAD cannot be abandoned", () => {
  const root = tempRoot();
  const svc = new TaskTreeService(root);
  const treeId = svc.createTree("Refactor auth");
  svc.fork(treeId!, { name: "b", why: "token rotation approach" });
  // active is now "b"
  assert.equal(svc.abandon(treeId!, "b"), false, "active branch cannot be abandoned");
  assert.equal(svc.switchBranch(treeId!, "main"), true);
  assert.equal(svc.abandon(treeId!, "b"), true);
  const tree = svc.getTree(treeId!);
  assert.equal(tree!.index.branches["b"]!.abandoned, true);
  // abandoned branch cannot be switched back to
  assert.equal(svc.switchBranch(treeId!, "b"), false);
});

test("restart recovery: a fresh service instance reads the persisted tree", () => {
  const root = tempRoot();
  const first = new TaskTreeService(root);
  const treeId = first.createTree("Persistent task", { branchName: "main" });
  first.appendStep(treeId!, { title: "step one" });
  first.fork(treeId!, { name: "alt", why: "alternative plan" });
  first.flush();

  const second = new TaskTreeService(root);
  const tree = second.getTree(treeId!);
  assert.ok(tree, "tree survives restart");
  assert.equal(tree!.index.activeBranch, "alt");
  assert.equal(Object.keys(tree!.index.branches).length, 2);
  assert.equal(tree!.nodes.length, 3, "root + step + fork nodes all reloaded");
  // reflog replays in order
  const reflog = second.readReflog(treeId!);
  assert.deepEqual(
    reflog.map((e) => e.op),
    ["create", "append", "fork"]
  );
});

test("fail-open: corrupt/missing trees degrade instead of throwing", () => {
  const root = tempRoot();
  const svc = new TaskTreeService(root);
  assert.deepEqual(svc.listTrees(), [], "empty root lists nothing");
  assert.equal(svc.getTree("nonexistent"), null);
  assert.equal(svc.appendStep("nonexistent", { title: "x" }), null);

  // Corrupt tree.json → skipped from listing, no throw.
  const dir = path.join(root, ".deeporca", "task-trees", "0d76c4b8-1111-2222-3333-444455556666");
  fs.mkdirSync(path.join(dir, "nodes"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tree.json"), "{ not json");
  assert.equal(svc.listTrees().length, 0);
  assert.equal(svc.getTree("0d76c4b8-1111-2222-3333-444455556666"), null);
});

test("node ids are content-addressed and stable in shape", () => {
  const root = tempRoot();
  const svc = new TaskTreeService(root);
  const treeId = svc.createTree("Id checks");
  const tree = svc.getTree(treeId!);
  const rootNode = tree!.nodes[0]!;
  assert.match(rootNode.id, /^[0-9a-f]{12}$/, "short hash shape");
  // traversal IDs cannot path-traverse (node id containment)
  assert.equal(svc.getNode(treeId!, "../../etc/passwd".slice(0, 12)), null);
  assert.equal(svc.getNode(treeId!, "aaaaaaaaaaaa"), null);
});

test("branch names are sanitized (no path/metacharacters)", () => {
  const root = tempRoot();
  const svc = new TaskTreeService(root);
  const treeId = svc.createTree("Naming");
  const nodeId = svc.fork(treeId!, { name: "../evil name!", why: "x" });
  assert.ok(nodeId);
  const tree = svc.getTree(treeId!);
  const names = Object.keys(tree!.index.branches);
  assert.ok(
    names.every((n) => /^[A-Za-z0-9._-]+$/.test(n)),
    `sanitized: ${names.join(",")}`
  );
});
