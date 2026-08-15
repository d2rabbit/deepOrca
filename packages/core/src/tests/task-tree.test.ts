import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TaskTreeService } from "../tasks/task-tree-service";
import { SessionManager } from "../session";

const tempRoots: string[] = [];

/** Insert a minimal session entry into the index (test seam for binding paths). */
function injectSessionEntry(manager: SessionManager, sessionId: string, taskRef?: unknown): void {
  const index = (manager as any).loadSessionsIndex();
  index.entries.push({
    id: sessionId,
    summary: null,
    assistantReply: null,
    assistantThinking: null,
    assistantRefusal: null,
    toolCalls: null,
    status: "pending",
    failReason: null,
    usage: null,
    usagePerModel: null,
    activeTokens: 0,
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString(),
    processes: null,
    ...(taskRef ? { taskRef } : {}),
  });
  (manager as any).saveSessionsIndex(index);
  (manager as any).flushSessionsIndex();
}

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

// ── P1: merge / bindSession / plan materialization / branch resume ──────────

test("merge cherry-picks nodes onto the active branch and reports artifact conflicts", () => {
  const root = tempRoot();
  const svc = new TaskTreeService(root);
  const treeId = svc.createTree("Merge scenario", { why: "test" })!;
  // main gets an artifact
  const mainStep = svc.appendStep(treeId, { title: "Main work", artifactRefs: ["designs/a"] })!;
  // fork, add a conflicting + a fresh artifact
  const forkId = svc.fork(treeId, { name: "alt", why: "alt approach" })!;
  const altStep = svc.appendStep(treeId, { title: "Alt work", artifactRefs: ["designs/a", "designs/b"] })!;

  // back to main, merge the alt step
  assert.equal(svc.switchBranch(treeId!, "main"), true);
  const result = svc.merge(treeId!, "alt", [altStep!]);
  assert.ok(result, "merge succeeds");
  const mergeNode = svc.getNode(treeId!, result!.mergeNodeId)!;
  assert.equal(mergeNode.kind, "merge");
  assert.ok(mergeNode.artifactRefs.includes("designs/b"), "fresh artifact transferred");
  // conflicting artifact reported for human confirmation, not auto-resolved
  assert.deepEqual(
    result!.conflicts.map((c) => c.artifactRef),
    ["designs/a"]
  );

  // self-merge rejected; foreign-lineage picks rejected
  assert.equal(svc.merge(treeId!, "main", [mainStep!]), null);
  assert.equal(svc.merge(treeId!, "alt", ["deadbeefdead"]), null);
  void forkId;
});

test("bindSession stamps the branch head once and refuses silent rebinds", () => {
  const root = tempRoot();
  const svc = new TaskTreeService(root);
  const treeId = svc.createTree("Binding")!;
  assert.equal(svc.bindSession(treeId!, "main", "session-1"), true);
  assert.equal(svc.getNode(treeId!, svc.getTree(treeId!)!.index.branches["main"]!.headId)!.sessionRef, "session-1");
  // idempotent same-session rebind
  assert.equal(svc.bindSession(treeId!, "main", "session-1"), true);
  // a different session cannot silently take over the branch
  assert.equal(svc.bindSession(treeId!, "main", "session-2"), false);
  // but a NEW branch can be bound to that session
  svc.fork(treeId!, { name: "second", why: "second branch" });
  assert.equal(svc.bindSession(treeId!, "second", "session-2"), true);
});

test("plan materialization: UpdatePlan checklist lines become steps one-way, no duplicates", () => {
  const root = tempRoot();
  const manager = new SessionManager({
    projectRoot: root,
    createOpenAIClient: () => ({ client: null, model: "m", thinkingEnabled: false }),
    getResolvedSettings: () => ({ model: "m" }),
    renderMarkdown: (t: string) => t,
    onAssistantMessage: () => {},
  });
  const svc = (manager as any).getTaskTreeService() as TaskTreeService;
  const treeId = svc.createTree("Planned feature")!;
  // simulate the task.create binding path (entry must exist for the ref write)
  const tree = svc.getTree(treeId!)!;
  injectSessionEntry(manager, "fake-session");
  svc.bindSession(treeId!, tree.index.activeBranch, "fake-session");
  (manager as any).setSessionTaskRef("fake-session", {
    treeId: treeId!,
    branch: tree.index.activeBranch,
    nodeId: tree.index.branches[tree.index.activeBranch]!.headId,
  });

  // Fire the materialization hook exactly as appendToolMessages would.
  (manager as any).materializePlanToTaskTree("fake-session", {
    name: "UpdatePlan",
    arguments: JSON.stringify({
      plan: "## Steps\n- [ ] Design the schema\n- [x] Write migration\n- prose line (ignored)\n- [ ] Write migration",
    }),
  });

  const nodes = svc.getTree(treeId!)!.nodes;
  const titles = nodes.map((n) => n.title);
  assert.ok(titles.includes("Design the schema"));
  assert.ok(titles.includes("Write migration"));
  assert.equal(titles.filter((t) => t === "Write migration").length, 1, "duplicate checklist lines collapse");

  // Re-firing the same plan adds nothing (title match).
  (manager as any).materializePlanToTaskTree("fake-session", {
    name: "UpdatePlan",
    arguments: JSON.stringify({ plan: "- [ ] Design the schema\n- [ ] Write migration" }),
  });
  assert.equal(svc.getTree(treeId!)!.nodes.length, nodes.length, "idempotent materialization");

  // Non-UpdatePlan tools are ignored.
  (manager as any).materializePlanToTaskTree("fake-session", {
    name: "bash",
    arguments: JSON.stringify({ command: "- [ ] nope" }),
  });
  assert.equal(svc.getTree(treeId!)!.nodes.length, nodes.length);
});

test("branch-level resume: activating a bound session restores its branch", () => {
  const root = tempRoot();
  const manager = new SessionManager({
    projectRoot: root,
    createOpenAIClient: () => ({ client: null, model: "m", thinkingEnabled: false }),
    getResolvedSettings: () => ({ model: "m" }),
    renderMarkdown: (t: string) => t,
    onAssistantMessage: () => {},
  });
  const svc = (manager as any).getTaskTreeService() as TaskTreeService;
  const treeId = svc.createTree("Resume flow")!;
  svc.fork(treeId!, { name: "elsewhere", why: "someone else worked here" });
  assert.equal(svc.getTree(treeId!)!.index.activeBranch, "elsewhere");

  // Bind the (synthetic) session to main, then simulate activation.
  injectSessionEntry(manager, "resume-session", { treeId, branch: "main", nodeId: "x" });
  (manager as any).restoreTaskBranchForSession("resume-session");
  assert.equal(svc.getTree(treeId!)!.index.activeBranch, "main", "activation restored the bound branch");
});

test("behaviorContext boot injection: gated off by default, prepends block when enabled", async () => {
  const root = tempRoot();
  const home = tempRoot();
  process.env.HOME = home;
  let providerCalls = 0;
  const responses: unknown[] = [{ choices: [{ message: { content: "ok" } }] }];
  const client = { chat: { completions: { create: async () => responses.shift() } } };
  const manager = new SessionManager({
    projectRoot: root,
    createOpenAIClient: () => ({ client: client as any, model: "m", baseURL: "x", thinkingEnabled: false }),
    getResolvedSettings: () => ({ model: "m" }) as any,
    renderMarkdown: (t) => t,
    onAssistantMessage: () => {},
    buildBehaviorContext: () => {
      providerCalls += 1;
      return "uses vim; tests first; prefers small PRs";
    },
  });

  // Default (flag absent): no injection, provider not even called.
  const s1 = await manager.createSession({ text: "hello" });
  assert.equal(providerCalls, 0);
  assert.ok(!manager.listSessionMessages(s1!).some((m) => m.content?.includes("<behavior-context>")));

  // Flag on: hidden system message prepended with the provider block.
  (manager as any).getResolvedSettings = () => ({ model: "m", behaviorContext: true }) as any;
  const s2 = await manager.createSession({ text: "hello again" });
  assert.equal(providerCalls, 1);
  const ctx = manager.listSessionMessages(s2!).find((m) => m.content?.includes("<behavior-context>"));
  assert.ok(ctx, "context block injected");
  assert.match(ctx!.content!, /vim/);
  assert.equal(ctx!.visible, false, "hidden system message");
});
