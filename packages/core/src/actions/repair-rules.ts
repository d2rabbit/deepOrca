/**
 * memory.mine-repairs — repair-rule mining over the task-tree fork lineage
 * (specs/repair-rule-memory; EMG/KDD-2027 concept port, zero upstream code).
 *
 * P0 (deterministic, zero LLM): find fork pairs where the PARENT branch was
 * abandoned and the CHILD branch ran a bound session (the repair), diff their
 * tool-call trajectories (repair-diff.ts), keep pairs whose edit path carries
 * signal. P1 (optional, single structured completion): phrase ≤3 bilingual
 * repair rules — the LLM only words the deterministic diff. P2: the shared
 * AskUserQuestion review loop; accepted rules return controlled write-back
 * instructions targeting AGENTS.md's "## Repair rules" section.
 *
 * Disciplines inherited from memory-audit: no L0–L3 mutation; nothing lands
 * without an explicit user accept; reject/skip persist in the shared
 * decision store so settled proposals never resurface; snapshots keep-last-10.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ActionDefinition, ActionRun } from "./types";
import { getProjectCode, getProjectConfigRoot, getUserConfigRoot } from "../common/app-dirs";
import { applyAuxSchema, AUX_CONTENT_RETRY_BUDGET, type AuxSchema } from "../common/aux-llm-contract";
import { TaskTreeService } from "../tasks/task-tree-service";
import type { TaskNode } from "../tasks/types";
import {
  clip,
  getProjectConfigRootAuditRoot,
  isSafeSessionId,
  loadRejections,
  prunePrefixedSnapshots,
  saveRejections,
  sha8,
} from "./memory-audit";
import { diffSequences, editPathHasSignal, extractToolSequence, type ToolCallUnit } from "./repair-diff";

// ── Inputs / outputs ─────────────────────────────────────────────────────────

export interface MineRepairsInput {
  /** Mine at most this many fork pairs (default 5). */
  maxPairs?: number;
  /** true (default): return the snapshot without writing anything. */
  dryRun?: boolean;
  /** P1: phrase ≤3 bilingual repair rules from the mined edit paths. */
  synthesize?: boolean;
  /** P2 review loop: record per-rule verdicts; accepts return write-backs. */
  recordDecisions?: {
    snapshotId: string;
    decisions: ReadonlyArray<{ proposalKey: string; verdict: "accept" | "reject" | "skip"; note?: string }>;
  };
}

export interface RepairPair {
  readonly treeId: string;
  readonly treeTitle: string;
  readonly parentBranch: string;
  readonly childBranch: string;
  readonly forkWhy: string;
  readonly parentSession: string;
  readonly childSession: string;
  readonly editPath: {
    readonly spine: readonly ToolCallUnit[];
    readonly deletedClusters: readonly ToolCallUnit[][];
    readonly insertions: readonly ToolCallUnit[];
  };
}

/** P1: one bilingual repair rule proposal. */
export interface RepairRuleProposal {
  /** `repair:<sha8(zh|en)>` — stable identity in the shared decision store. */
  readonly key: string;
  readonly zh: string;
  readonly en: string;
  /** Index into the mined pairs array; unknown indexes are dropped. */
  readonly pairIndex: number;
}

export interface MineRepairsOutput {
  readonly ok: boolean;
  readonly treesScanned: number;
  readonly forksSeen: number;
  readonly pairs: readonly RepairPair[];
  /** Set when dryRun:false — the written snapshot path. */
  readonly snapshotPath?: string;
  /** Set when dryRun:false — the bilingual HTML report path. */
  readonly reportPath?: string;
  readonly synthesis?: { ok: boolean; rules: readonly RepairRuleProposal[]; error?: string };
  readonly reviewInstructions?: string;
  /** P2: write-backs for ACCEPTED rules (apply via the native edit tool). */
  readonly pendingWriteBacks?: ReadonlyArray<{ proposalKey: string; instruction: string }>;
  readonly error?: string;
}

const MAX_PAIRS_DEFAULT = 5;
const MAX_RULES = 3;
const SNAPSHOT_KEEP = 10;

// ── P0: deterministic pair mining ───────────────────────────────────────────

/** Parse a transcript JSONL defensively (bad lines contribute nothing). */
function readTranscriptMessages(projectDir: string, sessionId: string): unknown[] {
  const file = path.join(projectDir, `${sessionId}.jsonl`);
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      })
      .filter((m): m is Record<string, unknown> => Boolean(m));
  } catch {
    return [];
  }
}

/** Walk a branch head's lineage for the first node carrying a sessionRef. */
function sessionRefOfBranch(nodesById: Map<string, TaskNode>, headId: string | undefined): string | undefined {
  let id = headId;
  let hops = 0;
  while (id && hops < 200) {
    const node = nodesById.get(id);
    if (!node) return undefined;
    if (node.sessionRef && isSafeSessionId(node.sessionRef)) return node.sessionRef;
    id = node.parentId ?? undefined;
    hops += 1;
  }
  return undefined;
}

export function mineRepairPairs(
  projectRoot: string,
  maxPairs: number
): {
  treesScanned: number;
  forksSeen: number;
  pairs: RepairPair[];
} {
  const service = new TaskTreeService(projectRoot);
  const projectDir = path.join(getUserConfigRoot(), "projects", getProjectCode(projectRoot));
  const pairs: RepairPair[] = [];
  let forksSeen = 0;

  for (const summary of service.listTrees()) {
    if (pairs.length >= maxPairs) break;
    const tree = service.getTree(summary.id);
    if (!tree) continue;
    const nodesById = new Map(tree.nodes.map((node) => [node.id, node]));
    // branch → lineage node-id set (a fork node maps to its branch BY LINEAGE
    // — head equality would miss it once steps land on the branch).
    const branchLineage = new Map<string, Set<string>>();
    for (const [name, branch] of Object.entries(tree.index.branches)) {
      const lineage = new Set<string>();
      let id: string | undefined = branch.headId;
      let hops = 0;
      while (id && hops < 500) {
        lineage.add(id);
        id = nodesById.get(id)?.parentId ?? undefined;
        hops += 1;
      }
      branchLineage.set(name, lineage);
    }
    const branchOfNode = (nodeId: string): string | undefined =>
      [...branchLineage.entries()].find(([, lineage]) => lineage.has(nodeId))?.[0];

    for (const node of tree.nodes) {
      if (pairs.length >= maxPairs) break;
      if (node.kind !== "fork" && node.kind !== "memory-spawn") continue;
      forksSeen += 1;
      const childBranch = branchOfNode(node.id);
      const parentNode = node.parentId ? nodesById.get(node.parentId) : undefined;
      if (!childBranch || !parentNode) continue;
      const parentBranch = branchOfNode(parentNode.id);
      if (!parentBranch || parentBranch === childBranch) continue;
      const parentState = tree.index.branches[parentBranch];
      const childState = tree.index.branches[childBranch];
      if (!parentState || !childState) continue;
      // The mining contract: the parent path was abandoned, the child path ran.
      if (parentState.abandoned !== true || childState.abandoned === true) continue;
      const parentSession = sessionRefOfBranch(nodesById, parentState.headId);
      const childSession = sessionRefOfBranch(nodesById, childState.headId);
      if (!parentSession || !childSession || parentSession === childSession) continue;
      const parentSeq = extractToolSequence(readTranscriptMessages(projectDir, parentSession));
      const childSeq = extractToolSequence(readTranscriptMessages(projectDir, childSession));
      const diff = diffSequences(parentSeq, childSeq);
      if (!editPathHasSignal(diff)) continue;
      pairs.push({
        treeId: summary.id,
        treeTitle: summary.title,
        parentBranch,
        childBranch,
        forkWhy: clip(node.why),
        parentSession,
        childSession,
        editPath: { spine: diff.spine, deletedClusters: diff.deletedClusters, insertions: diff.insertions },
      });
    }
  }
  return { treesScanned: service.listTrees().length, forksSeen, pairs };
}

// ── P1: rule phrasing (single structured completion) ────────────────────────

const ruleSchema: AuxSchema<{ rules: Array<Record<string, unknown>> }> = {
  describe: '{"rules": [{"zh","en","pairIndex"}]}',
  validate: (parsed) => {
    if (!parsed || typeof parsed !== "object") return null;
    const rules = (parsed as { rules?: unknown }).rules;
    if (!Array.isArray(rules)) return null;
    return { rules: rules.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object") };
  },
};

function formatUnit(u: ToolCallUnit): string {
  return `${u.tool}(${u.argsDigest})`;
}

function buildSynthesisPrompt(input: {
  pairs: readonly RepairPair[];
  agentsHead: string;
  rejectedKeys: string[];
}): string {
  const pairText = input.pairs
    .map((p, i) => {
      const deleted = p.editPath.deletedClusters.map((c) => c.map(formatUnit).join(" → ")).join(" | ");
      const inserted = p.editPath.insertions.map(formatUnit).join(" | ");
      return (
        `P${i}: tree="${p.treeTitle}" forkWhy="${p.forkWhy}"\n` +
        `   failedActions(parent-only): ${deleted || "(none)"}\n` +
        `   repairActions(child-only): ${inserted || "(none)"}`
      );
    })
    .join("\n");
  const rejected =
    input.rejectedKeys.length > 0
      ? `\nAlready reviewed and settled by the user (DO NOT re-propose): ${input.rejectedKeys.join(", ")}`
      : "";
  return `You are wording repair rules for a coding agent's AGENTS.md, mined deterministically from fork history where an abandoned failed branch was repaired by a sibling branch.

Mined pairs (deterministic evidence — do not invent actions beyond it):
${pairText || "(none — return an empty rules array)"}
${rejected}
Current AGENTS.md (head):
${input.agentsHead || "(no AGENTS.md yet)"}

Rules:
- Each rule follows the shape: 在 <失败上下文> 下做 <修复动作>，不要 <失败动作> (EN: "When <context>, do <repair> instead of <failed action>").
- One or two sentences, directly actionable, grounded in ONE pair (pairIndex).
- Bilingual pair: zh and en must carry the same rule.
- At most ${MAX_RULES} rules, highest confidence first.

Respond with JSON only: {"rules": [{"zh":"…","en":"…","pairIndex":0}]}`;
}

async function synthesizeRules(opts: {
  projectRoot: string;
  pairs: readonly RepairPair[];
  complete: (messages: Array<{ role: "system" | "user"; content: string }>) => Promise<string | null>;
}): Promise<{ ok: boolean; rules: RepairRuleProposal[]; error?: string }> {
  const settled = loadRejections(opts.projectRoot);
  const settledKeys = Object.keys(settled).filter((key) => key.startsWith("repair:"));
  let agentsHead = "";
  try {
    agentsHead = fs.readFileSync(path.join(opts.projectRoot, "AGENTS.md"), "utf8").split("\n").slice(0, 60).join("\n");
  } catch {
    agentsHead = "";
  }
  const prompt = buildSynthesisPrompt({ pairs: opts.pairs, agentsHead, rejectedKeys: settledKeys });
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: "You word repair rules. Respond with JSON only." },
    { role: "user", content: prompt },
  ];
  for (let attempt = 0; attempt <= AUX_CONTENT_RETRY_BUDGET; attempt += 1) {
    let raw: string | null = null;
    try {
      raw = await opts.complete(messages);
    } catch {
      return { ok: false, rules: [], error: "completion transport failure" };
    }
    if (!raw) continue;
    let applied: { ok: true; value: { rules: Array<Record<string, unknown>> } } | { ok: false };
    try {
      applied = applyAuxSchema(raw, ruleSchema);
    } catch {
      applied = { ok: false };
    }
    if (!applied.ok) continue;
    const rules: RepairRuleProposal[] = [];
    for (const entry of applied.value.rules) {
      const zh = typeof entry.zh === "string" ? entry.zh.trim().slice(0, 400) : "";
      const en = typeof entry.en === "string" ? entry.en.trim().slice(0, 400) : "";
      const pairIndex = Number(entry.pairIndex);
      if (!zh || !en || !Number.isInteger(pairIndex) || pairIndex < 0 || pairIndex >= opts.pairs.length) continue;
      const key = `repair:${sha8(`${zh}|${en}`)}`;
      if (rules.length >= MAX_RULES || rules.some((r) => r.key === key) || settledKeys.includes(key)) continue;
      rules.push({ key, zh, en, pairIndex });
    }
    return { ok: true, rules };
  }
  return { ok: false, rules: [], error: "content budget exhausted (unparseable output)" };
}

function buildReviewInstructions(rules: readonly RepairRuleProposal[], pairs: readonly RepairPair[]): string {
  return [
    "审阅以下修复规则建议（每条附谱系证据）：",
    ...rules.map((r, i) => {
      const p = pairs[r.pairIndex];
      return `${i + 1}. ${r.zh} / ${r.en} — 依据: P${r.pairIndex}（tree "${p?.treeTitle ?? "?"}" fork why: ${p?.forkWhy ?? "?"}）`;
    }),
    "",
    "Use the AskUserQuestion tool to let the user accept/reject/skip EACH rule, then call memory.mine-repairs once with recordDecisions={snapshotId, decisions}.",
    "Accepted rules are applied ONLY afterwards, via the native edit tool (read AGENTS.md first for its snippet_id) — never bash redirection.",
  ].join("\n");
}

/** P2 write-back: append to AGENTS.md's "## Repair rules" section. */
function writeBackFor(rule: RepairRuleProposal, pair: RepairPair | undefined): string {
  const lineage = pair
    ? ` — 溯源 lineage: tree "${pair.treeTitle}" · fork why: ${pair.forkWhy} · treeId ${pair.treeId}`
    : "";
  return (
    `Append to AGENTS.md under the "## Repair rules" section (create the section at the end if absent):\n` +
    `- ${rule.zh}\n  - EN: ${rule.en}${lineage}\n` +
    `Apply via the native edit tool (read AGENTS.md first for its snippet_id; a snippet mismatch means the file changed — re-read).`
  );
}

// ── Snapshot + bilingual HTML report ────────────────────────────────────────

function writeSnapshot(projectRoot: string, output: Omit<MineRepairsOutput, "snapshotPath" | "reportPath">): string {
  const dir = getProjectConfigRootAuditRoot(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `repair-rules-${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  prunePrefixedSnapshots(dir, "repair-rules-", SNAPSHOT_KEEP);
  return file;
}

function buildHtmlReport(snapshot: Omit<MineRepairsOutput, "snapshotPath" | "reportPath">): string {
  const esc = (t: string): string =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const pairs = snapshot.pairs
    .map((p, i) => {
      const deleted = p.editPath.deletedClusters
        .map((c) => c.map((u) => esc(`${u.tool}(${u.argsDigest})`)).join(" → "))
        .join("<br>");
      const inserted = p.editPath.insertions.map((u) => esc(`${u.tool}(${u.argsDigest})`)).join(", ");
      return (
        `<section class="card"><h3>P${i} · ${esc(p.treeTitle)}</h3>` +
        `<p>fork why: ${esc(p.forkWhy)}</p>` +
        `<p class="ev">branches: ${esc(p.parentBranch)}（abandoned）→ ${esc(p.childBranch)} · sessions ${esc(p.parentSession)} → ${esc(p.childSession)}</p>` +
        `<p><b>失败动作 failed:</b><br>${deleted || "—"}</p>` +
        `<p><b>修复动作 repair:</b> ${inserted || "—"}</p></section>`
      );
    })
    .join("");
  const rules = (snapshot.synthesis?.rules ?? [])
    .map(
      (r) =>
        `<section class="card"><p>${esc(r.zh)}</p><p class="hint">${esc(r.en)}</p><p class="ev">依据 evidence: P${r.pairIndex}</p></section>`
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>memory.mine-repairs 报告 report</title><style>
body{font:14px/1.6 -apple-system,system-ui,sans-serif;margin:24px auto;max-width:860px;color:#222}
h1{font-size:20px}.card{border:1px solid #ddd;border-radius:8px;padding:10px 14px;margin:10px 0}
.card h3{font-size:13px;margin:0 0 6px;color:#666}.hint{color:#888}.ev{color:#09c;font-size:12px}
</style></head><body>
<h1>修复规则挖掘报告 · Repair-Rule Mining Report</h1>
<p>树 trees: <b>${snapshot.treesScanned}</b> · fork 节点 forks: <b>${snapshot.forksSeen}</b> · 有信号配对 signal pairs: <b>${snapshot.pairs.length}</b></p>
<h2>配对 Pairs（确定性 diff 证据）</h2>
${pairs || "<p>无合格配对 no qualifying pairs</p>"}
<h2>规则建议 Rule proposals${snapshot.synthesis?.ok === false ? "（合成失败 synthesis failed）" : ""}</h2>
${rules || "<p>无 no proposals</p>"}
</body></html>`;
}

// ── Action definition + run ─────────────────────────────────────────────────

export const mineRepairsDefinition: ActionDefinition<MineRepairsInput> = {
  id: "memory.mine-repairs",
  description:
    "Deterministic repair-rule mining over the task-tree fork lineage (specs/repair-rule-memory; EMG concept port): " +
    "find abandoned-parent → repaired-child fork pairs with bound sessions, diff their tool trajectories (LCS edit path, " +
    "zero LLM), and optionally phrase ≤3 bilingual repair rules for AGENTS.md. Review-gated write-back — nothing lands " +
    "without an explicit user accept.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      maxPairs: { type: "number", description: "Mine at most this many fork pairs (default 5)" },
      dryRun: { type: "boolean", description: "true (default) = return the snapshot without writing any file" },
      synthesize: {
        type: "boolean",
        description:
          "P1: also phrase ≤3 bilingual repair rules from the mined edit paths (user review in main session)",
      },
      recordDecisions: {
        type: "object",
        description: "P2 review loop: record per-rule verdicts; accepts return controlled write-backs for AGENTS.md",
        properties: {
          snapshotId: { type: "string", description: "stamp id of a previously written snapshot (file name stem)" },
          decisions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                proposalKey: { type: "string" },
                verdict: { type: "string", enum: ["accept", "reject", "skip"] },
                note: { type: "string" },
              },
              required: ["proposalKey", "verdict"],
            },
          },
        },
        required: ["snapshotId", "decisions"],
      },
    },
    additionalProperties: false,
  },
  sideEffects: ["read-in-cwd", "write-in-cwd"],
};

export const mineRepairsRun: ActionRun<MineRepairsInput, MineRepairsOutput> = async (input, ctx) => {
  // P2 review-loop leg.
  if (input?.recordDecisions) {
    return recordDecisions(ctx.projectRoot, input.recordDecisions);
  }
  const maxPairs =
    Number.isFinite(input?.maxPairs) && (input?.maxPairs as number) > 0
      ? (input?.maxPairs as number)
      : MAX_PAIRS_DEFAULT;
  const dryRun = input?.dryRun !== false;

  const { treesScanned, forksSeen, pairs } = mineRepairPairs(ctx.projectRoot, maxPairs);

  let synthesis: MineRepairsOutput["synthesis"];
  let reviewInstructions: string | undefined;
  if (input?.synthesize) {
    synthesis = ctx.completeViaLlm
      ? await synthesizeRules({ projectRoot: ctx.projectRoot, pairs, complete: (m) => ctx.completeViaLlm!(m) })
      : { ok: false, rules: [], error: "completeViaLlm seam not injected" };
    if (synthesis.rules.length > 0) {
      reviewInstructions = buildReviewInstructions(synthesis.rules, pairs);
    }
  }

  const snapshot: Omit<MineRepairsOutput, "snapshotPath" | "reportPath"> = {
    ok: true,
    treesScanned,
    forksSeen,
    pairs,
    ...(synthesis ? { synthesis } : {}),
    ...(reviewInstructions ? { reviewInstructions } : {}),
  };
  if (dryRun) return snapshot;
  try {
    const snapshotPath = writeSnapshot(ctx.projectRoot, snapshot);
    let reportPath: string | undefined;
    try {
      reportPath = snapshotPath.replace(/\.json$/, ".html");
      fs.writeFileSync(reportPath, buildHtmlReport(snapshot), "utf8");
    } catch {
      reportPath = undefined; // report is a convenience — never fail the run on it
    }
    return { ...snapshot, snapshotPath, ...(reportPath ? { reportPath } : {}) };
  } catch (err) {
    return {
      ...snapshot,
      ok: false,
      error: `snapshot write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

/** P2: persist verdicts in the shared decision store; accepts come back as write-backs. */
function recordDecisions(
  projectRoot: string,
  record: NonNullable<MineRepairsInput["recordDecisions"]>
): MineRepairsOutput {
  const base: Omit<MineRepairsOutput, "snapshotPath" | "reportPath"> = {
    ok: true,
    treesScanned: 0,
    forksSeen: 0,
    pairs: [],
  };
  if (!/^[A-Za-z0-9._-]+$/.test(record.snapshotId) || record.snapshotId.includes("..")) {
    return { ...base, ok: false, error: "invalid snapshotId" };
  }
  const snapshotFile = path.join(getProjectConfigRoot(projectRoot), "audits", `repair-rules-${record.snapshotId}.json`);
  let stored: MineRepairsOutput;
  try {
    stored = JSON.parse(fs.readFileSync(snapshotFile, "utf8")) as MineRepairsOutput;
  } catch {
    return { ...base, ok: false, error: `snapshot not found or unreadable: ${record.snapshotId}` };
  }
  const ruleByKey = new Map((stored.synthesis?.rules ?? []).map((r) => [r.key, r]));
  const storedPairs = stored.pairs ?? [];
  const store = loadRejections(projectRoot);
  const writeBacks: Array<{ proposalKey: string; instruction: string }> = [];
  const at = new Date().toISOString();
  for (const decision of record.decisions ?? []) {
    const rule = decision.proposalKey ? ruleByKey.get(decision.proposalKey) : undefined;
    if (!rule) continue; // unknown key — nothing to record
    store[rule.key] = { verdict: decision.verdict, note: decision.note, at };
    if (decision.verdict === "accept") {
      writeBacks.push({
        proposalKey: rule.key,
        instruction: writeBackFor(rule, storedPairs[rule.pairIndex]),
      });
    }
  }
  try {
    saveRejections(projectRoot, store);
  } catch (err) {
    return {
      ...base,
      ok: false,
      error: `decision store write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ...base, ...(writeBacks.length > 0 ? { pendingWriteBacks: writeBacks } : {}) };
}
