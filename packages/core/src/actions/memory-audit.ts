/**
 * memory.audit — deterministic evidence scan over the project's own session
 * history (specs/memory-audit P0; upstream research: backpass methodology,
 * re-implemented with own primitives — no external CLI, no upstream code).
 *
 * P0 is the OBSERVATION stage: scan sessions + audit hash-chain for failure
 * evidence, aggregate it into corroborated patterns, and return a snapshot —
 * strictly read-only unless `dryRun: false` (then the snapshot lands in
 * `<root>/.deeporca/audits/`, review-store style, keep-last-10). No LLM, no
 * write-back, no L0–L3 mutation: the data decides whether P1 (proposal
 * synthesis) is worth building at all.
 *
 * Evidence sources:
 *   - transcript JSONL (`<projectDir>/<sessionId>.jsonl`): tool messages with
 *     ok:false (errorType classified), via ToolExecutionResult content;
 *   - sessions-index entries: status "failed" + failReason, silent-subagent
 *     sessions EXCLUDED from the material;
 *   - audit hash-chain (`<projectDir>/audit/<sessionId>.jsonl`): path_gate
 *     deny verdicts — machine-verifiable via verifyAuditChain (a broken chain
 *     marks the file unverifiable but still surfaces its deny count, flagged).
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ActionDefinition, ActionRun } from "./types";
import { getProjectCode, getProjectConfigRoot, getUserConfigRoot } from "../common/app-dirs";
import { verifyAuditChain, type AuditEvent, type PathGateAuditEvent } from "../sandbox/audit";
import { applyAuxSchema, AUX_CONTENT_RETRY_BUDGET, type AuxSchema } from "../common/aux-llm-contract";

// ── Inputs / outputs ─────────────────────────────────────────────────────────

export interface MemoryAuditInput {
  /** Scan at most this many recent sessions (default 20). */
  maxSessions?: number;
  /** Independent sessions required to corroborate a pattern (default 2). */
  corroborationThreshold?: number;
  /** true (default): return the snapshot without writing anything. */
  dryRun?: boolean;
  /** P1: run stage-3 proposal synthesis (single structured completion on the
   *  primary model via ctx.completeViaLlm; contract-enforced, fail-open). */
  synthesize?: boolean;
  /** P1/P2 review loop: record the user's per-proposal verdicts. Reject/skip
   *  persist so the same suggestion never resurfaces; accepts return the
   *  controlled write-back instructions for the main agent to apply via the
   *  native edit tool. */
  recordDecisions?: {
    /** Stamp id of a previously written snapshot (its file name stem). */
    auditId: string;
    decisions: ReadonlyArray<{
      proposalKey: string;
      verdict: "accept" | "reject" | "skip";
      note?: string;
    }>;
  };
}

export type MemoryAuditEventKind =
  | "tool-failure"
  | "permission-denied"
  | "timeout"
  | "process-failed"
  | "session-failed"
  | "path-gate-deny";

export interface MemoryAuditEvent {
  readonly sessionId: string;
  readonly ts: string;
  readonly kind: MemoryAuditEventKind;
  readonly tool?: string;
  readonly errorType?: string;
  readonly message: string;
  readonly filePath?: string;
  /** First token of the tool's command (bash-style tools) — the alwaysAllow grain. */
  readonly commandPrefix?: string;
  readonly source: "transcript" | "index" | "audit-chain";
}

export interface MemoryAuditPattern {
  /** `${kind}|${tool ?? ""}` — the aggregation key. */
  readonly key: string;
  readonly kind: MemoryAuditEventKind;
  readonly tool?: string;
  readonly occurrences: number;
  readonly distinctSessions: number;
  /** Up to 3 sample messages (already clipped). */
  readonly samples: readonly string[];
  /** True when distinctSessions >= the corroboration threshold. */
  readonly corroborated: boolean;
}

/** Deterministic P0 candidate: a recurring permission-denied command prefix
 *  that an alwaysAllow entry MIGHT resolve — informational only in P0. */
export interface AlwaysAllowCandidate {
  readonly tool: string;
  readonly commandPrefix: string;
  readonly occurrences: number;
  readonly distinctSessions: number;
}

export interface MemoryAuditOutput {
  readonly ok: boolean;
  readonly projectDir: string;
  readonly scannedSessions: number;
  readonly excludedSilentSessions: number;
  readonly events: readonly MemoryAuditEvent[];
  /** Events omitted from the array above when it was capped (200). */
  readonly omittedEvents: number;
  readonly patterns: readonly MemoryAuditPattern[];
  readonly candidates: readonly AlwaysAllowCandidate[];
  readonly auditChain: {
    readonly files: number;
    readonly verified: number;
    readonly broken: number;
    readonly denyEvents: number;
  };
  /** Set when dryRun:false — the written snapshot path. */
  readonly snapshotPath?: string;
  /** Set when dryRun:false and synthesize — the bilingual HTML report path. */
  readonly reportPath?: string;
  /** P1 synthesis outcome (present when synthesize:true). */
  readonly synthesis?: MemoryAuditSynthesis;
  /** P1: instructions for the main agent to run the per-item review. */
  readonly reviewInstructions?: string;
  /** P2: returned by recordDecisions for accepted proposals — the agent MUST
   *  apply these via the native edit tool (read → snippet_id → edit); never
   *  bash redirection, never a background task. */
  readonly pendingWriteBacks?: ReadonlyArray<MemoryAuditWriteBack>;
  readonly error?: string;
}

/** P1: one memory-rule proposal (JSON contract enforced by applyAuxSchema). */
export interface MemoryAuditProposal {
  /** Stable identity: `${action}:${target}:${sha8(ruleText|diffHint|rationale)}`. */
  readonly key: string;
  readonly action: "add" | "update" | "delete";
  readonly target: "agents" | "skill";
  /** Target skill name (target === "skill" only). */
  readonly skillName?: string;
  /** New/updated rule text (add/update). */
  readonly ruleText?: string;
  /** Locate hint for update/delete (NOT a patch — the agent edits by hand). */
  readonly diffHint?: string;
  /** Event ids (ev-N) backing the proposal; unknown ids are dropped. */
  readonly evidenceIds: readonly string[];
  readonly rationale: string;
  /** Estimated always-loaded token cost of the rule. */
  readonly estTokens: number;
}

export interface MemoryAuditSynthesis {
  readonly ok: boolean;
  readonly proposals: readonly MemoryAuditProposal[];
  /** Proposals dropped for referencing unknown evidence or exceeding the cap. */
  readonly dropped: number;
  /** Absent when ok; reason otherwise (fail-open — the snapshot still returns). */
  readonly error?: string;
}

/** P2: controlled write-back instruction for one ACCEPTED proposal. */
export interface MemoryAuditWriteBack {
  readonly proposalKey: string;
  readonly action: "add" | "update" | "delete";
  readonly targetFile: "AGENTS.md" | "SKILL.md";
  readonly skillName?: string;
  readonly ruleText?: string;
  readonly diffHint?: string;
  readonly instruction: string;
}

const MAX_EVENTS = 200;
const MESSAGE_CLIP = 200;
const SNAPSHOT_KEEP = 10;

/** Index entries are semi-trusted storage — a corrupt/hand-edited id must
 *  never turn into a path traversal out of the project store. */
export function isSafeSessionId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && !id.includes("..");
}

export function clip(text: string): string {
  return text.length > MESSAGE_CLIP ? `${text.slice(0, MESSAGE_CLIP)}…` : text;
}

function classifyToolFailure(errorType: string | undefined): MemoryAuditEventKind {
  switch (errorType) {
    case "PERMISSION_DENIED":
      return "permission-denied";
    case "TIMEOUT":
      return "timeout";
    case "PROCESS_FAILED":
      return "process-failed";
    default:
      return "tool-failure";
  }
}

/** First token of a bash command, path-stripped — the alwaysAllow grain. */
function commandPrefix(fn: unknown): string | undefined {
  if (!fn || typeof fn !== "object") return undefined;
  const command = (fn as { command?: unknown }).command;
  if (typeof command !== "string" || !command.trim()) return undefined;
  const first = command.trim().split(/\s+/)[0] ?? "";
  if (!first) return undefined;
  const base = first.split(/[\\/]/).pop() ?? first;
  return base || undefined;
}

// ── Scanners (all read-only, all defensive) ─────────────────────────────────

type SessionIndexShape = {
  entries?: Array<{
    id: string;
    status?: string;
    failReason?: string | null;
    updateTime?: string;
    isSilentSubagent?: boolean;
  }>;
};

function scanTranscript(projectDir: string, sessionId: string): MemoryAuditEvent[] {
  const file = path.join(projectDir, `${sessionId}.jsonl`);
  if (!fs.existsSync(file)) return [];
  const events: MemoryAuditEvent[] = [];
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let message: {
        role?: string;
        content?: unknown;
        createTime?: string;
        meta?: { function?: unknown } | null;
      };
      try {
        message = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (message.role !== "tool" || typeof message.content !== "string") continue;
      let result: { ok?: unknown; name?: unknown; error?: unknown; errorType?: unknown };
      try {
        result = JSON.parse(message.content);
      } catch {
        continue;
      }
      if (result.ok !== false) continue;
      events.push({
        sessionId,
        ts: message.createTime ?? "",
        kind: classifyToolFailure(typeof result.errorType === "string" ? result.errorType : undefined),
        tool: typeof result.name === "string" ? result.name : undefined,
        errorType: typeof result.errorType === "string" ? result.errorType : undefined,
        message: clip(typeof result.error === "string" && result.error ? result.error : "tool call failed"),
        commandPrefix: commandPrefix(message.meta?.function),
        source: "transcript",
      });
    }
  } catch {
    // Unreadable transcript → contributes nothing (fail-open per file).
  }
  return events;
}

function scanAuditChain(projectDir: string, sessionId: string): { events: MemoryAuditEvent[]; verified: boolean } {
  const file = path.join(projectDir, "audit", `${sessionId}.jsonl`);
  if (!fs.existsSync(file)) return { events: [], verified: true };
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed: AuditEvent[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        parsed.push(JSON.parse(trimmed) as AuditEvent);
      } catch {
        // skip malformed line — chain verification will flag integrity
      }
    }
    const verified = verifyAuditChain(parsed).ok;
    const events = parsed
      .filter((e): e is PathGateAuditEvent => e.eventType === "path_gate" && e.verdict === "deny")
      .map((e) => ({
        sessionId,
        ts: e.wallClock,
        kind: "path-gate-deny" as const,
        tool: e.tool,
        message: clip(`path gate denied ${e.scope ?? "scope"}: ${e.filePath}`),
        filePath: e.filePath,
        source: "audit-chain" as const,
      }));
    return { events, verified };
  } catch {
    // Unreadable file → unverifiable, NOT verified (a broken read must not
    // count toward the verified total — review finding).
    return { events: [], verified: false };
  }
}

// ── Aggregation (deterministic) ─────────────────────────────────────────────

function aggregate(
  events: readonly MemoryAuditEvent[],
  threshold: number
): { patterns: MemoryAuditPattern[]; candidates: AlwaysAllowCandidate[] } {
  const groups = new Map<
    string,
    { kind: MemoryAuditEventKind; tool?: string; occurrences: number; sessions: Set<string>; samples: string[] }
  >();
  for (const event of events) {
    const key = `${event.kind}|${event.tool ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = { kind: event.kind, tool: event.tool, occurrences: 0, sessions: new Set(), samples: [] };
      groups.set(key, group);
    }
    group.occurrences += 1;
    group.sessions.add(event.sessionId);
    if (group.samples.length < 3) group.samples.push(event.message);
  }

  const patterns: MemoryAuditPattern[] = [...groups.entries()]
    .map(([key, group]) => ({
      key,
      kind: group.kind,
      tool: group.tool,
      occurrences: group.occurrences,
      distinctSessions: group.sessions.size,
      samples: group.samples,
      corroborated: group.sessions.size >= threshold,
    }))
    .sort((a, b) => b.occurrences - a.occurrences || a.key.localeCompare(b.key));

  // Deterministic candidates: corroborated permission-denied command prefixes
  // — the alwaysAllow grain. Single-session noise never becomes a candidate
  // (backpass's ≥2-independent-sessions rule), nor do prefix-less denials.
  const prefixGroups = new Map<string, { tool: string; occurrences: number; sessions: Set<string> }>();
  for (const event of events) {
    if (event.kind !== "permission-denied" || !event.tool || !event.commandPrefix) continue;
    const key = `${event.tool}|${event.commandPrefix}`;
    let group = prefixGroups.get(key);
    if (!group) {
      group = { tool: event.tool, occurrences: 0, sessions: new Set() };
      prefixGroups.set(key, group);
    }
    group.occurrences += 1;
    group.sessions.add(event.sessionId);
  }
  const candidates: AlwaysAllowCandidate[] = [...prefixGroups.entries()]
    .filter(([, group]) => group.sessions.size >= threshold)
    .map(([key, group]) => ({
      tool: group.tool,
      commandPrefix: key.split("|")[1] ?? "",
      occurrences: group.occurrences,
      distinctSessions: group.sessions.size,
    }))
    .sort((a, b) => b.occurrences - a.occurrences);

  return { patterns, candidates };
}

// ── Snapshot write (dryRun=false only) ──────────────────────────────────────

/** Audits store dir (legacy `.deepcode` root honored) — shared with memory.distill. */
export function getProjectConfigRootAuditRoot(projectRoot: string): string {
  return path.join(getProjectConfigRoot(projectRoot), "audits");
}

function writeSnapshot(projectRoot: string, output: Omit<MemoryAuditOutput, "snapshotPath">): string {
  // getProjectConfigRoot honors a legacy `.deepcode` root when present — the
  // same dual-root discipline as the reviews store.
  const dir = getProjectConfigRootAuditRoot(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `memory-audit-${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  prunePrefixedSnapshots(dir, "memory-audit-", SNAPSHOT_KEEP);
  return file;
}

/**
 * Review-store discipline shared by memory.audit and memory.distill
 * (specs/sop-extraction §4.4): keep only the newest N `<prefix>*.json`
 * snapshots in the audits dir. Best-effort — never throws.
 */
export function prunePrefixedSnapshots(dir: string, prefix: string, keep: number): void {
  let existing: string[] = [];
  try {
    existing = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
      .sort();
  } catch {
    return;
  }
  for (const stale of existing.slice(0, Math.max(0, existing.length - keep))) {
    try {
      fs.rmSync(path.join(dir, stale));
    } catch {
      // best-effort prune
    }
  }
}

// ── P1/P2: proposal synthesis, review loop, controlled write-back ────────────

/** Max proposals per run (backpass's 5-edit budget; overflow shrinks, never grows). */
const MAX_PROPOSALS = 5;

export function sha8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8);
}

export function proposalKeyOf(p: {
  action: string;
  target: string;
  ruleText?: string;
  diffHint?: string;
  rationale?: string;
}): string {
  return `${p.action}:${p.target}:${sha8(p.ruleText ?? p.diffHint ?? p.rationale ?? "")}`;
}

export type RejectionStore = Record<string, { verdict: "accept" | "reject" | "skip"; note?: string; at: string }>;

function rejectionsPath(projectRoot: string): string {
  return path.join(getProjectConfigRoot(projectRoot), "audits", "rejections.json");
}

export function loadRejections(projectRoot: string): RejectionStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(rejectionsPath(projectRoot), "utf8")) as RejectionStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveRejections(projectRoot: string, store: RejectionStore): void {
  const file = rejectionsPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
}

/**
 * P2.3 (specs/sop-extraction): aggregate the shared decision store so the
 * distill action output can surface the production accept rate (memory.audit
 * can adopt the same field later — this is substrate only). Same store,
 * content-hashed keys — the action prefix of each key (the part before the
 * first ":") names the proposal's action, so distill's
 * "skill-new"/"add-rule"/… and audit's "add"/"update"/"delete" bucket apart.
 */
export interface DecisionStats {
  readonly total: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly skipped: number;
  readonly byAction: Readonly<Record<string, { accepted: number; rejected: number; skipped: number }>>;
}

export function summarizeDecisions(projectRoot: string): DecisionStats {
  return summarizeStore(loadRejections(projectRoot));
}

/**
 * Store-level aggregate — callers that already hold the in-memory store
 * (e.g. recordDecisions right after saveRejections) skip the disk re-read.
 * Entry-shape tolerant: a hand-edited/corrupt store entry is skipped, not
 * dereferenced — one bad record must never brick the action (fail-open).
 */
export function summarizeStore(store: RejectionStore): DecisionStats {
  const byAction: Record<string, { accepted: number; rejected: number; skipped: number }> = {};
  let accepted = 0;
  let rejected = 0;
  let skipped = 0;
  for (const [key, entry] of Object.entries(store)) {
    if (!entry || typeof entry !== "object") continue;
    const action = key.split(":")[0] || "unknown";
    const bucket = (byAction[action] ??= { accepted: 0, rejected: 0, skipped: 0 });
    if (entry.verdict === "accept") {
      accepted += 1;
      bucket.accepted += 1;
    } else if (entry.verdict === "reject") {
      rejected += 1;
      bucket.rejected += 1;
    } else {
      skipped += 1;
      bucket.skipped += 1;
    }
  }
  return { total: accepted + rejected + skipped, accepted, rejected, skipped, byAction };
}

const proposalSchema: AuxSchema<{ proposals: Array<Record<string, unknown>> }> = {
  describe: '{"proosals": [{"action","target","ruleText","diffHint","evidenceIds","rationale","estTokens"}]}',
  validate: (parsed) => {
    if (!parsed || typeof parsed !== "object") return null;
    const proposals = (parsed as { proposals?: unknown }).proposals;
    if (!Array.isArray(proposals)) return null;
    return { proposals: proposals.filter((p): p is Record<string, unknown> => !!p && typeof p === "object") };
  },
};

/**
 * Stage-3 synthesis prompt. Input redaction discipline (documented, P1.3):
 * corroborated patterns + clipped samples + event ids + the AGENTS.md head
 * (first 60 lines) + the SKILL NAME LISTING only — never raw transcripts,
 * never skill bodies, never audit-chain checksums.
 */
function buildSynthesisPrompt(input: {
  patterns: readonly MemoryAuditPattern[];
  eventCount: number;
  agentsHead: string;
  skillNames: string[];
  rejectedKeys: string[];
}): string {
  const corroborated = input.patterns.filter((p) => p.corroborated);
  const patternText = corroborated
    .map(
      (p, i) =>
        `P${i}: kind=${p.kind} tool=${p.tool ?? "-"} occurrences=${p.occurrences} sessions=${p.distinctSessions}\n` +
        `   samples: ${p.samples.map((x) => `"${x}"`).join(" | ")}`
    )
    .join("\n");
  const rejected =
    input.rejectedKeys.length > 0
      ? `\nAlready reviewed and rejected by the user (DO NOT re-propose): ${input.rejectedKeys.join(", ")}`
      : "";
  return `You are proposing memory-rule edits for a coding agent (AGENTS.md / SKILL.md) based on CORROBORATED failure evidence from its own session history.

Evidence events are referenced as ev-N (N = index into the scanned event list, 0..${input.eventCount - 1}).
Corroborated patterns:
${patternText || "(none — return an empty proposals array)"}
${rejected}
Current AGENTS.md (head):
${input.agentsHead || "(no AGENTS.md yet)"}
Existing skills (names only): ${input.skillNames.join(", ") || "(none)"}

Rules:
- Only propose rules the evidence genuinely supports; every proposal MUST cite evidenceIds.
- add/update target AGENTS.md ("agents") or one existing skill ("skill" + skillName).
- delete requires harm evidence across sessions — prefer update over delete.
- Keep each ruleText one or two sentences, directly actionable; no narration.
- At most ${MAX_PROPOSALS} proposals, highest confidence first.

Respond with JSON only: {"proosals": [{"action":"add|update|delete","target":"agents|skill","skillName":"...","ruleText":"...","diffHint":"...","evidenceIds":["ev-0"],"rationale":"...","estTokens":12}]}`;
}

/** Redacted, bounded context reads for the synthesis prompt (P1.3). */
function readAgentsHead(projectRoot: string): string {
  try {
    return fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8").split("\n").slice(0, 60).join("\n");
  } catch {
    return "";
  }
}

function listSkillNames(projectRoot: string): string[] {
  const dir = path.join(getProjectConfigRoot(projectRoot), "skills");
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .slice(0, 50);
  } catch {
    return [];
  }
}

async function synthesizeProposals(opts: {
  projectRoot: string;
  patterns: readonly MemoryAuditPattern[];
  eventCount: number;
  complete: (messages: Array<{ role: "system" | "user"; content: string }>) => Promise<string | null>;
}): Promise<MemoryAuditSynthesis> {
  const rejections = loadRejections(opts.projectRoot);
  // ANY recorded decision (accept OR reject OR skip) settles a proposal —
  // re-proposing settled items is review noise; the user re-runs from scratch
  // by clearing the store.
  const rejectedKeys = Object.keys(rejections);
  const prompt = buildSynthesisPrompt({
    patterns: opts.patterns,
    eventCount: opts.eventCount,
    agentsHead: readAgentsHead(opts.projectRoot),
    skillNames: listSkillNames(opts.projectRoot),
    rejectedKeys,
  });
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: "You synthesize memory-rule proposals. Respond with JSON only." },
    { role: "user", content: prompt },
  ];

  for (let attempt = 0; attempt <= AUX_CONTENT_RETRY_BUDGET; attempt++) {
    let raw: string | null = null;
    try {
      raw = await opts.complete(messages);
    } catch {
      return { ok: false, proposals: [], dropped: 0, error: "completion transport failure" };
    }
    if (!raw) continue; // content-level empty — retry within budget
    let applied: { ok: true; value: { proposals: Array<Record<string, unknown>> } } | { ok: false };
    try {
      applied = applyAuxSchema(raw, proposalSchema);
    } catch {
      applied = { ok: false };
    }
    if (!applied.ok) continue;

    const proposals: MemoryAuditProposal[] = [];
    let dropped = 0;
    for (const raw of applied.value.proposals) {
      const action = raw.action === "update" || raw.action === "delete" ? raw.action : "add";
      const target = raw.target === "skill" ? "skill" : "agents";
      const ruleText = typeof raw.ruleText === "string" ? raw.ruleText.slice(0, 400) : undefined;
      const diffHint = typeof raw.diffHint === "string" ? raw.diffHint.slice(0, 200) : undefined;
      const rationale = typeof raw.rationale === "string" ? raw.rationale.slice(0, 300) : "";
      const evidenceIds = Array.isArray(raw.evidenceIds)
        ? raw.evidenceIds.filter(
            (id): id is string => typeof id === "string" && /^ev-\d+$/.test(id) && Number(id.slice(3)) < opts.eventCount
          )
        : [];
      const candidate = { action, target, ruleText, diffHint, rationale };
      const key = proposalKeyOf(candidate);
      if (proposals.length >= MAX_PROPOSALS || !rationale || evidenceIds.length === 0 || rejectedKeys.includes(key)) {
        dropped += 1;
        continue;
      }
      proposals.push({
        key,
        action,
        target,
        skillName: target === "skill" && typeof raw.skillName === "string" ? raw.skillName.slice(0, 80) : undefined,
        ruleText,
        diffHint,
        evidenceIds,
        rationale,
        estTokens: Number.isFinite(Number(raw.estTokens)) ? Math.max(0, Math.round(Number(raw.estTokens))) : 0,
      });
    }
    return { ok: true, proposals, dropped };
  }
  return { ok: false, proposals: [], dropped: 0, error: "content budget exhausted (unparseable output)" };
}

function buildReviewInstructions(synthesis: MemoryAuditSynthesis): string {
  return [
    "审阅以下记忆规则建议（每条附证据）：",
    ...synthesis.proposals.map(
      (p, i) =>
        `${i + 1}. [${p.action}/${p.target}${p.skillName ? `:${p.skillName}` : ""}] ${p.ruleText ?? p.diffHint ?? ""} — 依据: ${p.evidenceIds.join(", ")}（${p.rationale}）`
    ),
    "",
    "Use the AskUserQuestion tool to let the user accept/reject/skip EACH proposal, then call memory.audit once with recordDecisions={auditId, decisions}.",
    "Accepted proposals are applied ONLY afterwards, via the native edit tool (read the target file first for its snippet_id) — never bash redirection.",
  ].join("\n");
}

/** P2: controlled write-back instruction for one accepted proposal. */
function writeBackFor(p: MemoryAuditProposal): MemoryAuditWriteBack {
  const targetFile = p.target === "skill" ? "SKILL.md" : "AGENTS.md";
  const locate =
    p.target === "skill" ? `.deeporca/skills/${p.skillName ?? "<skill>"}/SKILL.md` : "AGENTS.md (repo root)";
  const instruction =
    p.action === "add"
      ? `Append the rule below to ${locate} in its matching section (create the section if absent): "${p.ruleText ?? ""}"`
      : p.action === "update"
        ? `In ${locate}, update the rule hinted at by "${p.diffHint ?? ""}" to: "${p.ruleText ?? ""}"`
        : `In ${locate}, delete the rule hinted at by "${p.diffHint ?? ""}" ONLY if the harm evidence justifies removal (≥2 sessions); otherwise skip and say why.`;
  return {
    proposalKey: p.key,
    action: p.action,
    targetFile,
    skillName: p.skillName,
    ruleText: p.ruleText,
    diffHint: p.diffHint,
    instruction: `${instruction} — apply via the native edit tool (read first for snippet_id; a snippet mismatch means the file changed, re-read). Evidence: ${p.evidenceIds.join(", ")}.`,
  };
}

/** Bilingual self-contained HTML report (P1.5 — zero renderer/i18n surface). */
function buildHtmlReport(snapshot: Omit<MemoryAuditOutput, "snapshotPath" | "reportPath">): string {
  const esc = (t: string): string =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const patterns = snapshot.patterns
    .map(
      (p) =>
        `<tr><td>${esc(p.key)}</td><td>${p.occurrences}</td><td>${p.distinctSessions}</td><td>${p.corroborated ? "✅" : "—"}</td></tr>`
    )
    .join("");
  const proposals = (snapshot.synthesis?.proposals ?? [])
    .map(
      (p) =>
        `<section class="card"><h3>${esc(p.key)}</h3><p><b>${esc(p.action)} / ${esc(p.target)}${p.skillName ? `:${esc(p.skillName)}` : ""}</b></p>` +
        (p.ruleText ? `<p>${esc(p.ruleText)}</p>` : "") +
        (p.diffHint ? `<p class="hint">${esc(p.diffHint)}</p>` : "") +
        `<p class="ev">证据 evidence: ${p.evidenceIds.map(esc).join(", ")} · ~${p.estTokens} tokens</p>` +
        `<p>${esc(p.rationale)}</p></section>`
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>memory.audit 报告 report</title><style>
body{font:14px/1.6 -apple-system,system-ui,sans-serif;margin:24px auto;max-width:860px;color:#222}
h1{font-size:20px}table{border-collapse:collapse;width:100%;margin:12px 0}
td,th{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:13px}
.card{border:1px solid #ddd;border-radius:8px;padding:10px 14px;margin:10px 0}
.card h3{font-size:13px;margin:0 0 6px;color:#666}
.hint{color:#888}.ev{color:#09c;font-size:12px}
</style></head><body>
<h1>记忆审计报告 · Memory Audit Report</h1>
<p>扫描会话 sessions scanned: <b>${snapshot.scannedSessions}</b>（排除 silent 子代理 ${snapshot.excludedSilentSessions}）·
失败事件 failure events: <b>${snapshot.events.length + snapshot.omittedEvents}</b> ·
审计链 audit chain: ${snapshot.auditChain.verified} verified / ${snapshot.auditChain.broken} broken / ${snapshot.auditChain.denyEvents} denies</p>
<h2>模式 Patterns（佐证 corroborated 标记）</h2>
<table><tr><th>key</th><th>次数 occ.</th><th>会话 sessions</th><th>佐证</th></tr>${patterns}</table>
<h2>建议 Proposals${snapshot.synthesis?.ok === false ? "（合成失败 synthesis failed）" : ""}</h2>
${proposals || "<p>无 no proposals</p>"}
</body></html>`;
}

// ── Action definition + run ─────────────────────────────────────────────────

export const memoryAuditDefinition: ActionDefinition<MemoryAuditInput> = {
  id: "memory.audit",
  description:
    "Deterministic, read-only evidence scan over this project's own session history (specs/memory-audit P0): " +
    "failure events from transcripts + sessions-index + the audit hash-chain (path_gate denies), aggregated into " +
    "corroborated patterns (≥2 independent sessions by default). No LLM, no write-back, L0–L3 memory untouched — " +
    "the snapshot data gates whether proposal synthesis (P1) gets built.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      maxSessions: { type: "number", description: "Scan at most this many recent sessions (default 20)" },
      corroborationThreshold: {
        type: "number",
        description: "Independent sessions required to corroborate a pattern (default 2)",
      },
      dryRun: { type: "boolean", description: "true (default) = return the snapshot without writing any file" },
      synthesize: {
        type: "boolean",
        description:
          "P1: also synthesize memory-rule proposals (add/update/delete for AGENTS.md/SKILL.md) from corroborated patterns, with per-proposal evidence; user review happens in the main session",
      },
      recordDecisions: {
        type: "object",
        description:
          "P1/P2 review loop: record per-proposal verdicts. reject/skip persist (never resurface); accepts return controlled write-back instructions to apply via the native edit tool",
        properties: {
          auditId: { type: "string", description: "stamp id of a previously written snapshot (file name stem)" },
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
        required: ["auditId", "decisions"],
      },
    },
    additionalProperties: false,
  },
  sideEffects: ["read-in-cwd", "write-in-cwd"],
};

export const memoryAuditRun: ActionRun<MemoryAuditInput, MemoryAuditOutput> = async (input, ctx) => {
  // P1/P2 review-loop leg: record verdicts against a stored snapshot.
  if (input?.recordDecisions) {
    return recordDecisions(ctx.projectRoot, input.recordDecisions);
  }
  const maxSessions =
    Number.isFinite(input?.maxSessions) && (input?.maxSessions as number) > 0 ? (input?.maxSessions as number) : 20;
  const threshold =
    Number.isFinite(input?.corroborationThreshold) && (input?.corroborationThreshold as number) > 0
      ? (input?.corroborationThreshold as number)
      : 2;
  const dryRun = input?.dryRun !== false;

  const projectDir = path.join(getUserConfigRoot(), "projects", getProjectCode(ctx.projectRoot));

  // Sessions index — on-disk shape (pendingIndex debounce is a writer concern;
  // a read-only scan takes the file as-is, one snapshot behind at worst).
  let entries: NonNullable<SessionIndexShape["entries"]> = [];
  const indexPath = path.join(projectDir, "sessions-index.json");
  if (fs.existsSync(indexPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8")) as SessionIndexShape;
      if (Array.isArray(parsed.entries)) entries = parsed.entries;
    } catch {
      return {
        ok: false,
        projectDir,
        scannedSessions: 0,
        excludedSilentSessions: 0,
        events: [],
        omittedEvents: 0,
        patterns: [],
        candidates: [],
        auditChain: { files: 0, verified: 0, broken: 0, denyEvents: 0 },
        error: "sessions-index.json is unreadable (corrupt JSON)",
      };
    }
  }

  const silent = entries.filter((e) => e.isSilentSubagent);
  const material = entries
    .filter((e) => !e.isSilentSubagent && isSafeSessionId(e.id))

    .sort((a, b) => String(b.updateTime ?? "").localeCompare(String(a.updateTime ?? "")))
    .slice(0, maxSessions);

  const events: MemoryAuditEvent[] = [];
  const chain = { files: 0, verified: 0, broken: 0, denyEvents: 0 };

  for (const entry of material) {
    // index-level failure evidence (the session itself died)
    if (entry.status === "failed" && entry.failReason) {
      events.push({
        sessionId: entry.id,
        ts: entry.updateTime ?? "",
        kind: "session-failed",
        message: clip(entry.failReason),
        source: "index",
      });
    }
    events.push(...scanTranscript(projectDir, entry.id));
    const audit = scanAuditChain(projectDir, entry.id);
    events.push(...audit.events);
    if (audit.events.length > 0 || fs.existsSync(path.join(projectDir, "audit", `${entry.id}.jsonl`))) {
      chain.files += 1;
      if (audit.verified) chain.verified += 1;
      else chain.broken += 1;
      chain.denyEvents += audit.events.length;
    }
  }

  const { patterns, candidates } = aggregate(events, threshold);
  const omittedEvents = Math.max(0, events.length - MAX_EVENTS);
  const keptEvents = events.slice(0, MAX_EVENTS);
  // Evidence ids are POSITIONAL (ev-N = keptEvents[N]) — stable within one
  // snapshot and expandable by the reviewer without re-running the scan.
  let synthesis: MemoryAuditSynthesis | undefined;
  let reviewInstructions: string | undefined;
  if (input?.synthesize) {
    synthesis = ctx.completeViaLlm
      ? await synthesizeProposals({
          projectRoot: ctx.projectRoot,
          patterns,
          eventCount: keptEvents.length,
          complete: (messages) => ctx.completeViaLlm!(messages),
        })
      : { ok: false, proposals: [], dropped: 0, error: "completeViaLlm seam not injected" };
    if (synthesis.proposals.length > 0) {
      reviewInstructions = buildReviewInstructions(synthesis);
    }
  }
  const snapshot: Omit<MemoryAuditOutput, "snapshotPath" | "reportPath"> = {
    ok: true,
    projectDir,
    scannedSessions: material.length,
    excludedSilentSessions: silent.length,
    events: keptEvents,
    omittedEvents,
    patterns,
    candidates,
    auditChain: chain,
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

/** P1/P2: persist verdicts; accepted proposals come back as write-backs. */
function recordDecisions(
  projectRoot: string,
  record: NonNullable<MemoryAuditInput["recordDecisions"]>
): MemoryAuditOutput {
  const base: Omit<MemoryAuditOutput, "snapshotPath" | "reportPath"> = {
    ok: true,
    projectDir: path.join(getUserConfigRoot(), "projects", getProjectCode(projectRoot)),
    scannedSessions: 0,
    excludedSilentSessions: 0,
    events: [],
    omittedEvents: 0,
    patterns: [],
    candidates: [],
    auditChain: { files: 0, verified: 0, broken: 0, denyEvents: 0 },
  };
  if (!/^[A-Za-z0-9._-]+$/.test(record.auditId) || record.auditId.includes("..")) {
    return { ...base, ok: false, error: "invalid auditId" };
  }
  // Re-read the stored snapshot to resolve accepted proposals (never trust
  // the caller to re-supply proposal content).
  const snapshotFile = path.join(getProjectConfigRoot(projectRoot), "audits", `memory-audit-${record.auditId}.json`);
  let stored: MemoryAuditOutput;
  try {
    stored = JSON.parse(fs.readFileSync(snapshotFile, "utf8")) as MemoryAuditOutput;
  } catch {
    return { ...base, ok: false, error: `snapshot not found or unreadable: ${record.auditId}` };
  }
  const byKey = new Map((stored.synthesis?.proposals ?? []).map((p) => [p.key, p]));
  const store = loadRejections(projectRoot);
  const writeBacks: MemoryAuditWriteBack[] = [];
  const at = new Date().toISOString();
  for (const decision of record.decisions ?? []) {
    const proposal = decision.proposalKey ? byKey.get(decision.proposalKey) : undefined;
    if (!proposal) continue; // unknown key — nothing to record
    if (decision.verdict === "accept") {
      // Accepts are recorded too (so they don't resurface), and produce the
      // controlled write-back for the main agent to apply via edit.
      store[proposal.key] = { verdict: "accept", note: decision.note, at };
      writeBacks.push(writeBackFor(proposal));
    } else {
      store[proposal.key] = { verdict: decision.verdict, note: decision.note, at };
    }
  }
  try {
    saveRejections(projectRoot, store);
  } catch (err) {
    return {
      ...base,
      ok: false,
      error: `rejection store write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ...base, ...(writeBacks.length > 0 ? { pendingWriteBacks: writeBacks } : {}) };
}
