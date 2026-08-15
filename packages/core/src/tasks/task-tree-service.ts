/**
 * TaskTreeService — the P0 core of the task trajectory (specs/task-tree).
 *
 * ModuleDesign:
 *   interface: createTree / appendStep / fork / switchBranch / abandon /
 *              getTree / getNode / listTrees / readReflog — nothing else.
 *   invariants:
 *     - Nodes are IMMUTABLE once written (id is content-addressed; edits are
 *       new nodes, never in-place mutation of nodes/<id>.json).
 *     - tree.json writes follow the sessions-index discipline: reads prefer
 *       the in-memory pending state, non-terminal writes are debounced,
 *       every branch-affecting call flushes synchronously (single writer).
 *     - reflog.jsonl is append-only — no concurrency surface.
 *     - Fail-open: any persistence error degrades to empty/in-memory state
 *       and never throws to the caller (a broken tree must not block chats).
 *   depth: deep — callers (actions + IPC) learn ~9 methods and get the whole
 *     git-like trajectory semantics (lineage, branches, journal, recovery).
 *   seam: this class is the only writer of .deeporca/task-trees/**; desktop
 *     bridges it over IPC, actions expose it to the LLM.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type {
  MemoryForkCandidate,
  TaskNode,
  TaskNodeKind,
  TaskReflogEntry,
  TaskTreeIndex,
  TaskTreeSummary,
} from "./types";

const INDEX_WRITE_DELAY_MS = 250;
const TREE_VERSION = 1;

function nowIso(): string {
  return new Date().toISOString();
}

/** Content-addressed short id: stable across restarts for identical lineage+payload. */
function nodeIdFor(parentId: string | null, payload: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${parentId ?? "root"}\0${payload}`)
    .digest("hex");
  return digest.slice(0, 12);
}

function sanitizeBranchName(name: string, fallback: string): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || fallback;
}

export class TaskTreeService {
  private readonly rootDir: string;
  /** treeId → in-memory index (the pending state reads must prefer). */
  private readonly pendingIndexes = new Map<string, TaskTreeIndex>();
  private readonly indexTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(projectRoot: string) {
    this.rootDir = path.join(projectRoot, ".deeporca", "task-trees");
    try {
      fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    } catch {
      // Fail-open: an unwritable project dir degrades to empty listings.
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  createTree(rootPrompt: string, opts?: { why?: string; branchName?: string }): string | null {
    const treeId = crypto.randomUUID();
    const dir = this.treeDir(treeId);
    const at = nowIso();
    const root: TaskNode = {
      id: nodeIdFor(null, `${rootPrompt}\0${at}`),
      treeId,
      parentId: null,
      kind: "root",
      title: rootPrompt.slice(0, 120) || "Untitled task",
      why: opts?.why?.trim() || "Initial task root.",
      prompt: rootPrompt,
      artifactRefs: [],
      memoryRefs: [],
      status: "running",
      createdAt: at,
      meta: { createdBy: "user" },
    };
    const branchName = sanitizeBranchName(opts?.branchName ?? "main", "main");
    const index: TaskTreeIndex = {
      version: TREE_VERSION,
      id: treeId,
      rootId: root.id,
      title: root.title,
      branches: { [branchName]: { name: branchName, headId: root.id, createdAt: at } },
      activeBranch: branchName,
      createdAt: at,
      updatedAt: at,
    };

    try {
      fs.mkdirSync(path.join(dir, "nodes"), { recursive: true, mode: 0o700 });
      this.writeNodeFile(dir, root);
      this.pendingIndexes.set(treeId, index);
      this.appendReflog(treeId, { at, op: "create", branch: branchName, nodeId: root.id, detail: root.title });
      this.saveIndex(treeId, { flush: true });
      return treeId;
    } catch {
      this.pendingIndexes.delete(treeId);
      return null;
    }
  }

  appendStep(
    treeId: string,
    input: { title: string; why?: string; prompt?: string; artifactRefs?: string[] }
  ): string | null {
    const index = this.loadIndex(treeId);
    if (!index) return null;
    const parent = this.readNodeFile(treeId, index.branches[index.activeBranch]?.headId ?? "");
    if (!parent) return null;

    const at = nowIso();
    const node: TaskNode = {
      id: nodeIdFor(parent.id, `${input.title}\0${at}`),
      treeId,
      parentId: parent.id,
      kind: "step",
      title: input.title.slice(0, 120) || "Untitled step",
      why: input.why?.trim() || `Step under "${parent.title}".`,
      ...(input.prompt ? { prompt: input.prompt } : {}),
      artifactRefs: input.artifactRefs ?? [],
      memoryRefs: [],
      status: "planned",
      createdAt: at,
      meta: { createdBy: "agent" },
    };

    try {
      this.writeNodeFile(this.treeDir(treeId), node);
      const next: TaskTreeIndex = {
        ...index,
        branches: {
          ...index.branches,
          [index.activeBranch]: { ...index.branches[index.activeBranch]!, headId: node.id },
        },
        updatedAt: at,
      };
      this.pendingIndexes.set(treeId, next);
      this.appendReflog(treeId, { at, op: "append", branch: index.activeBranch, nodeId: node.id, detail: node.title });
      this.saveIndex(treeId, { flush: true });
      return node.id;
    } catch {
      return null;
    }
  }

  fork(
    treeId: string,
    opts: { fromBranch?: string; name?: string; why: string; memorySnapshot?: string[] }
  ): string | null {
    const index = this.loadIndex(treeId);
    if (!index) return null;
    const sourceBranchName = opts.fromBranch ?? index.activeBranch;
    const sourceBranch = index.branches[sourceBranchName];
    if (!sourceBranch) return null;
    const parent = this.readNodeFile(treeId, sourceBranch.headId);
    if (!parent) return null;

    const at = nowIso();
    const branchName = sanitizeBranchName(opts.name ?? `fork-${Object.keys(index.branches).length + 1}`, "fork");
    if (index.branches[branchName]) return null; // no silent overwrite
    const kind: TaskNodeKind = opts.memorySnapshot && opts.memorySnapshot.length > 0 ? "memory-spawn" : "fork";
    const why = opts.why.trim();
    if (!why) return null; // a fork without a story is a UI lie — require it

    // Memory seeding (spec §3.2 step 5): the snapshot rides the branch as
    // context so any consumer of the lineage sees WHY-seeded memory.
    const seeded = [
      parent.contextSummary,
      ...(opts.memorySnapshot?.length ? [`Seeded memory: ${opts.memorySnapshot.join("; ")}`] : []),
    ]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join("\n");
    const node: TaskNode = {
      id: nodeIdFor(parent.id, `${kind}\0${branchName}\0${why}\0${at}`),
      treeId,
      parentId: parent.id,
      kind,
      title: `${branchName}: ${why}`.slice(0, 120),
      why,
      ...(seeded ? { contextSummary: seeded } : {}),
      artifactRefs: [...parent.artifactRefs],
      memoryRefs: opts.memorySnapshot ?? [],
      status: "planned",
      createdAt: at,
      meta: {
        createdBy: opts.memorySnapshot?.length ? "memory" : "user",
        ...(opts.memorySnapshot?.length
          ? { memorySeed: { unitIds: opts.memorySnapshot, similarity: 0, sourceTaskId: treeId } }
          : {}),
      },
    };

    try {
      this.writeNodeFile(this.treeDir(treeId), node);
      const next: TaskTreeIndex = {
        ...index,
        branches: { ...index.branches, [branchName]: { name: branchName, headId: node.id, createdAt: at } },
        activeBranch: branchName, // fork switches to the new branch (spec §3.1)
        updatedAt: at,
      };
      this.pendingIndexes.set(treeId, next);
      this.appendReflog(treeId, { at, op: "fork", branch: branchName, nodeId: node.id, detail: why });
      this.saveIndex(treeId, { flush: true });
      return node.id;
    } catch {
      return null;
    }
  }

  switchBranch(treeId: string, branch: string): boolean {
    const index = this.loadIndex(treeId);
    if (!index || !index.branches[branch] || index.branches[branch]!.abandoned) return false;
    const next: TaskTreeIndex = { ...index, activeBranch: branch, updatedAt: nowIso() };
    this.pendingIndexes.set(treeId, next);
    this.appendReflog(treeId, { at: next.updatedAt, op: "switch", branch });
    this.saveIndex(treeId, { flush: true });
    return true;
  }

  /**
   * Cherry-pick merge (spec §4): pick nodes from a SOURCE branch onto the
   * ACTIVE (target) branch. Merged content = the picked nodes' artifactRefs
   * (reference transfer, source-branch picks win) + a decision summary.
   * Conflicts are REPORTED, never auto-resolved: artifact refs that already
   * exist on the target lineage collide with the incoming ones — the human
   * confirmation list the spec requires. No text-level three-way merge.
   */
  merge(
    treeId: string,
    srcBranch: string,
    picks: string[],
    opts?: { why?: string }
  ): { mergeNodeId: string; conflicts: Array<{ artifactRef: string; targetTitle: string }> } | null {
    const index = this.loadIndex(treeId);
    if (!index) return null;
    const source = index.branches[srcBranch];
    if (!source || srcBranch === index.activeBranch) return null;
    const target = index.branches[index.activeBranch]!;
    if (target.abandoned) return null;

    // Validate picks: each must sit on the source branch's lineage.
    const picked = picks.map((id) => this.readNodeFile(treeId, id)).filter((n): n is TaskNode => n !== null);
    if (picked.length === 0) return null;
    const sourceLineage = this.lineageOf(treeId, source.headId);
    if (!picked.every((n) => sourceLineage.has(n.id))) return null;

    // Target-side existing refs (for conflict detection).
    const targetLineage = this.lineageOf(treeId, target.headId);
    const targetRefs = new Map<string, string>();
    for (const id of targetLineage) {
      const node = this.readNodeFile(treeId, id);
      for (const ref of node?.artifactRefs ?? []) {
        if (!targetRefs.has(ref)) targetRefs.set(ref, node?.title ?? id);
      }
    }

    const incomingRefs = [...new Set(picked.flatMap((n) => n.artifactRefs))];
    const conflicts = incomingRefs
      .filter((ref) => targetRefs.has(ref))
      .map((ref) => ({ artifactRef: ref, targetTitle: targetRefs.get(ref) ?? "" }));

    const at = nowIso();
    const parent = this.readNodeFile(treeId, target.headId);
    if (!parent) return null;
    const why =
      opts?.why?.trim() ||
      `Merged ${picked.length} pick(s) from "${srcBranch}": ${picked
        .map((n) => n.title)
        .join("; ")
        .slice(0, 200)}`;
    const node: TaskNode = {
      id: nodeIdFor(parent.id, `merge\0${srcBranch}\0${picks.join(",")}\0${at}`),
      treeId,
      parentId: parent.id,
      kind: "merge",
      title: `Merge from ${srcBranch}`.slice(0, 120),
      why,
      contextSummary: parent.contextSummary,
      // Reference transfer: union, incoming (picked) refs win on collision.
      artifactRefs: [...new Set([...incomingRefs, ...(parent.artifactRefs ?? [])])],
      memoryRefs: [],
      status: "done",
      createdAt: at,
      meta: {
        createdBy: "user",
        ...(conflicts.length > 0 ? { mergeConflicts: conflicts } : {}),
      },
    };

    try {
      this.writeNodeFile(this.treeDir(treeId), node);
      const next: TaskTreeIndex = {
        ...index,
        branches: { ...index.branches, [index.activeBranch]: { ...target, headId: node.id } },
        updatedAt: at,
      };
      this.pendingIndexes.set(treeId, next);
      this.appendReflog(treeId, {
        at,
        op: "append",
        branch: index.activeBranch,
        nodeId: node.id,
        detail: `merge ← ${srcBranch} (${picks.join(",")})`,
      });
      this.saveIndex(treeId, { flush: true });
      return { mergeNodeId: node.id, conflicts };
    } catch {
      return null;
    }
  }

  /**
   * Bind a session to a branch (P1): stamps the branch head's sessionRef so
   * the panel can show which session executed where. The session ENTRY side
   * (taskRef reverse pointer) is owned by SessionManager, not the service —
   * single-writer discipline.
   */
  bindSession(treeId: string, branch: string, sessionId: string): boolean {
    const index = this.loadIndex(treeId);
    if (!index) return false;
    const branchEntry = index.branches[branch];
    if (!branchEntry) return false;
    const head = this.readNodeFile(treeId, branchEntry.headId);
    if (!head) return false;
    // Nodes are immutable — a binding rewrite writes a NEW file for the same id
    // only when sessionRef actually changes (first binding wins).
    if (head.sessionRef === sessionId) return true;
    if (head.sessionRef && head.sessionRef !== sessionId) {
      return false; // already bound to a different session — no silent rebind
    }
    try {
      this.writeNodeFile(this.treeDir(treeId), { ...head, sessionRef: sessionId });
      return true;
    } catch {
      return false;
    }
  }

  /** All node ids from the root down to `headId` (inclusive) — a lineage set. */
  private lineageOf(treeId: string, headId: string): Set<string> {
    const lineage = new Set<string>();
    let cursor: TaskNode | null = this.readNodeFile(treeId, headId);
    let guard = 0;
    while (cursor && guard < 4096) {
      lineage.add(cursor.id);
      cursor = cursor.parentId ? this.readNodeFile(treeId, cursor.parentId) : null;
      guard += 1;
    }
    return lineage;
  }

  abandon(treeId: string, branch: string): boolean {
    const index = this.loadIndex(treeId);
    if (!index || !index.branches[branch] || branch === index.activeBranch) return false; // never abandon HEAD
    const at = nowIso();
    const next: TaskTreeIndex = {
      ...index,
      branches: { ...index.branches, [branch]: { ...index.branches[branch]!, abandoned: true } },
      updatedAt: at,
    };
    this.pendingIndexes.set(treeId, next);
    this.appendReflog(treeId, { at, op: "abandon", branch });
    this.saveIndex(treeId, { flush: true });
    return true;
  }

  getTree(treeId: string): { index: TaskTreeIndex; nodes: TaskNode[] } | null {
    const index = this.loadIndex(treeId);
    if (!index) return null;
    const nodes = this.loadAllNodes(treeId);
    return nodes.length === 0 ? null : { index, nodes };
  }

  getNode(treeId: string, nodeId: string): TaskNode | null {
    return this.readNodeFile(treeId, nodeId);
  }

  listTrees(): TaskTreeSummary[] {
    let ids: string[] = [];
    try {
      ids = fs
        .readdirSync(this.rootDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((name) => /^[0-9a-f-]{36}$/i.test(name));
    } catch {
      return [];
    }
    const summaries: TaskTreeSummary[] = [];
    for (const id of ids) {
      const index = this.loadIndex(id);
      if (!index) continue; // corrupt tree → skipped, not fatal (fail-open)
      const nodeCount = this.countNodes(id);
      summaries.push({
        id: index.id,
        title: index.title,
        activeBranch: index.activeBranch,
        branchCount: Object.keys(index.branches).length,
        nodeCount,
        updatedAt: index.updatedAt,
      });
    }
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return summaries;
  }

  readReflog(treeId: string, limit = 100): TaskReflogEntry[] {
    try {
      const raw = fs.readFileSync(path.join(this.treeDir(treeId), "reflog.jsonl"), "utf8");
      return raw
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as TaskReflogEntry)
        .slice(-limit);
    } catch {
      return [];
    }
  }

  /** Flush any pending debounced index writes (host teardown / tests). */
  flush(): void {
    for (const [treeId] of this.indexTimers) {
      this.saveIndexNow(treeId);
    }
  }

  /**
   * Memory-driven fork recall (spec §3.2 steps 2-3): scan persisted trees for
   * historical FORKS whose (task + why) resembles the query, and report what
   * happened to that branch. Divergence judgment stays with the consumer
   * (agent/user) — this only surfaces "same crossroads, different choice"
   * candidates with their outcomes. Token-Jaccard similarity; cheap, offline,
   * deterministic. Fail-open: any error → empty list.
   */
  recallAtDecision(query: string, opts?: { excludeTreeId?: string; topK?: number }): MemoryForkCandidate[] {
    const topK = opts?.topK ?? 3;
    const queryTokens = tokenizeTaskText(query);
    if (queryTokens.size === 0) return [];
    const candidates: MemoryForkCandidate[] = [];
    try {
      for (const summary of this.listTrees()) {
        if (summary.id === opts?.excludeTreeId) continue;
        const tree = this.getTree(summary.id);
        if (!tree) continue;
        const reflog = this.readReflog(summary.id, 500);
        const mergedBranches = new Set(
          reflog
            .filter((e) => e.op === "append" && (e.detail ?? "").startsWith("merge ←"))
            .map((e) => (e.detail ?? "").match(/^merge ← (\S+)/)?.[1] ?? "")
        );
        // Map each fork node to its branch BY LINEAGE (a fork stops being the
        // branch head once steps land on it — head equality would miss it).
        const branchLineage = new Map<string, Set<string>>();
        for (const branchName of Object.keys(tree.index.branches)) {
          const headId = tree.index.branches[branchName]?.headId;
          if (headId) branchLineage.set(branchName, this.lineageOf(summary.id, headId));
        }
        for (const node of tree.nodes) {
          if (node.kind !== "fork" && node.kind !== "memory-spawn") continue;
          const branch = [...branchLineage.entries()].find(([, lineage]) => lineage.has(node.id))?.[0];
          if (!branch) continue;
          const textTokens = tokenizeTaskText(`${tree.index.title} ${node.why}`);
          if (textTokens.size === 0) continue;
          const similarity = jaccardTokens(queryTokens, textTokens);
          if (similarity < 0.1) continue;
          const abandoned = tree.index.branches[branch]?.abandoned === true;
          candidates.push({
            treeId: summary.id,
            treeTitle: tree.index.title,
            branch,
            forkWhy: node.why,
            outcome: abandoned ? "abandoned" : mergedBranches.has(branch) ? "merged" : "open",
            similarity,
            sourceNodeId: node.id,
          });
        }
      }
    } catch {
      return []; // fail-open
    }
    candidates.sort((a, b) => b.similarity - a.similarity);
    return candidates.slice(0, topK);
  }

  // ── Persistence (single writer) ────────────────────────────────────────────

  private treeDir(treeId: string): string {
    return path.join(this.rootDir, treeId);
  }

  /** Reads prefer the pending in-memory index (sessions-index lesson). */
  private loadIndex(treeId: string): TaskTreeIndex | null {
    const pending = this.pendingIndexes.get(treeId);
    if (pending) return pending;
    try {
      const raw = fs.readFileSync(path.join(this.treeDir(treeId), "tree.json"), "utf8");
      const parsed = JSON.parse(raw) as TaskTreeIndex;
      if (parsed && typeof parsed.id === "string" && parsed.branches && parsed.rootId) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  private saveIndex(treeId: string, opts: { flush: boolean }): void {
    if (opts.flush) {
      this.saveIndexNow(treeId);
      return;
    }
    const existing = this.indexTimers.get(treeId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => this.saveIndexNow(treeId), INDEX_WRITE_DELAY_MS);
    timer.unref?.();
    this.indexTimers.set(treeId, timer);
  }

  private saveIndexNow(treeId: string): void {
    const timer = this.indexTimers.get(treeId);
    if (timer) clearTimeout(timer);
    this.indexTimers.delete(treeId);
    const index = this.pendingIndexes.get(treeId);
    if (!index) return;
    try {
      const dir = this.treeDir(treeId);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = path.join(dir, `tree.json.tmp-${crypto.randomUUID().slice(0, 8)}`);
      fs.writeFileSync(tmp, JSON.stringify(index, null, 2), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tmp, path.join(dir, "tree.json"));
    } catch {
      // Fail-open: keep the pending state; next flush retries.
    }
  }

  private nodePath(treeId: string, nodeId: string): string {
    return path.join(this.treeDir(treeId), "nodes", `${nodeId}.json`);
  }

  private writeNodeFile(dir: string, node: TaskNode): void {
    fs.writeFileSync(this.nodePath(node.treeId, node.id), JSON.stringify(node, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    void dir;
  }

  private readNodeFile(treeId: string, nodeId: string): TaskNode | null {
    if (!/^[0-9a-f]{12}$/.test(nodeId)) return null; // id containment (path join safety)
    try {
      return JSON.parse(fs.readFileSync(this.nodePath(treeId, nodeId), "utf8")) as TaskNode;
    } catch {
      return null;
    }
  }

  private loadAllNodes(treeId: string): TaskNode[] {
    try {
      const dir = path.join(this.treeDir(treeId), "nodes");
      return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as TaskNode;
          } catch {
            return null;
          }
        })
        .filter((n): n is TaskNode => n !== null && n.treeId === treeId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch {
      return [];
    }
  }

  private countNodes(treeId: string): number {
    try {
      return fs.readdirSync(path.join(this.treeDir(treeId), "nodes")).filter((n) => n.endsWith(".json")).length;
    } catch {
      return 0;
    }
  }

  private appendReflog(treeId: string, entry: TaskReflogEntry): void {
    try {
      fs.mkdirSync(this.treeDir(treeId), { recursive: true, mode: 0o700 });
      fs.appendFileSync(path.join(this.treeDir(treeId), "reflog.jsonl"), `${JSON.stringify(entry)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch {
      // Journal loss is non-fatal.
    }
  }
}

/** Tokenize for task-recall similarity: latin words + CJK bigrams, stopword-free (short texts). */
function tokenizeTaskText(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9_-]{1,}/g) ?? []) tokens.add(w);
  for (const seg of text.match(/[\u4e00-\u9fff]+/g) ?? []) {
    for (let i = 0; i < seg.length - 1; i++) tokens.add(seg.slice(i, i + 2));
  }
  return tokens;
}

function jaccardTokens(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
