/**
 * memory.distill — the SOP-extraction generalization of the memory-audit
 * pipeline (specs/sop-extraction; upstream: specs/archive/memory-audit P3 +
 * the memory-remediation §五 2 "session→SOP 自萃取" blank area).
 *
 * Same substrate, opposite signal: memory.audit learns from what BROKE
 * (failure events); distill learns from what WORKED — the user points it at
 * recent sessions, a deterministic digest (intent sequence / tool portrait /
 * conclusion) goes to ONE contract-enforced synthesis call, and reusable SOP
 * proposals come back: a NEW skill (full SKILL.md draft), an AGENTS.md rule,
 * or an appendix to an existing skill. Review loop, decision persistence
 * (shared rejections store — content-hashed keys can't collide) and
 * controlled write-back (native write for new files, edit for rules) are all
 * inherited unchanged.
 *
 * Red lines (inherited): sessions read-only; digests bounded + redacted
 * (never full transcripts into the prompt); fail-open everywhere; nothing
 * ever written to L0–L3; P0–P1 zero new IPC / i18n.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ActionDefinition, ActionRun } from "./types";
import { getProjectCode, getProjectConfigRoot, getUserConfigRoot } from "../common/app-dirs";
import { applyAuxSchema, AUX_CONTENT_RETRY_BUDGET, type AuxSchema } from "../common/aux-llm-contract";
import {
  clip,
  getProjectConfigRootAuditRoot,
  isSafeSessionId,
  loadRejections,
  proposalKeyOf,
  saveRejections,
  type MemoryAuditWriteBack,
} from "./memory-audit";

// ── Inputs / outputs ─────────────────────────────────────────────────────────

export interface MemoryDistillInput {
  /** Distill the N most recent non-silent sessions (default 3). */
  sessions?: number;
  /** …or one specific session by id. */
  sessionId?: string;
  /** true (default): return without writing anything. */
  dryRun?: boolean;
  /** Run stage-2 SOP synthesis (single contract-enforced completion). */
  synthesize?: boolean;
  /** Review loop — same shape and shared store as memory.audit. */
  recordDecisions?: {
    auditId: string;
    decisions: ReadonlyArray<{ proposalKey: string; verdict: "accept" | "reject" | "skip"; note?: string }>;
  };
}

export type DistillAction = "add-rule" | "update-rule" | "skill-new" | "skill-append";

export interface DistillProposal {
  readonly key: string;
  readonly action: DistillAction;
  readonly skillName?: string;
  /** Rule text (add-rule / update-rule / skill-append). */
  readonly ruleText?: string;
  /** Full SKILL.md draft incl. frontmatter (skill-new only). */
  readonly body?: string;
  readonly rationale: string;
  /** Human-readable pointers back into the sessions ("s1#msg7"). */
  readonly evidenceRefs: readonly string[];
  readonly estTokens: number;
}

export interface MemoryDistillOutput {
  readonly ok: boolean;
  readonly projectDir: string;
  readonly digests: readonly SessionDigest[];
  readonly synthesis?: {
    ok: boolean;
    proposals: readonly DistillProposal[];
    dropped: number;
    error?: string;
  };
  readonly reviewInstructions?: string;
  readonly pendingWriteBacks?: readonly MemoryAuditWriteBack[];
  readonly error?: string;
}

export type SessionDigest = {
  sessionId: string;
  /** User intent sequence (≤8 messages, each clipped to 160 chars). */
  readonly intents: readonly string[];
  /** Tool portrait: name → count (+ up to 3 key args like commands/paths). */
  readonly tools: ReadonlyArray<{ name: string; count: number; args: readonly string[] }>;
  /** Final assistant conclusion (clipped to 400 chars). */
  readonly conclusion: string;
  readonly userMessageCount: number;
};

// ── Stage 1: deterministic session digest ───────────────────────────────────

type RawMessage = {
  role?: string;
  content?: unknown;
  createTime?: string;
  messageParams?: {
    tool_calls?: Array<{ function?: { name?: string; arguments?: string | Record<string, unknown> } }>;
  } | null;
  meta?: { function?: Record<string, unknown> } | null;
};

function readTranscript(projectDir: string, sessionId: string): RawMessage[] {
  const file = path.join(projectDir, `${sessionId}.jsonl`);
  if (!fs.existsSync(file)) return [];
  const out: RawMessage[] = [];
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as RawMessage);
      } catch {
        // corrupt line — skip (fail-open per line)
      }
    }
  } catch {
    return [];
  }
  return out;
}

/** Key args worth surfacing in the tool portrait (commands and file paths). */
function keyArg(fn: Record<string, unknown> | undefined): string | null {
  if (!fn) return null;
  const command = fn.command;
  if (typeof command === "string" && command.trim())
    return command.trim().split(/\s+/).slice(0, 3).join(" ").slice(0, 60);
  const filePath = fn.file_path ?? fn.path;
  if (typeof filePath === "string" && filePath.trim()) return filePath.trim().slice(0, 80);
  return null;
}

export function readSessionDigest(projectDir: string, sessionId: string): SessionDigest | null {
  if (!isSafeSessionId(sessionId)) return null;
  const messages = readTranscript(projectDir, sessionId);
  if (messages.length === 0) return null;

  const intents: string[] = [];
  const toolCounts = new Map<string, { count: number; args: string[] }>();
  let conclusion = "";
  let userMessageCount = 0;

  for (const message of messages) {
    if (message.role === "user") {
      const text = typeof message.content === "string" ? message.content.trim() : "";
      if (text) {
        userMessageCount += 1;
        if (intents.length < 8) intents.push(clip(text).slice(0, 160));
      }
      continue;
    }
    if (message.role === "tool") {
      // The tool RESULT carries the name; meta.function on the paired
      // assistant call carries the args — portrait merges both passes.
      let name = "";
      if (typeof message.content === "string") {
        try {
          name = String((JSON.parse(message.content) as { name?: unknown }).name ?? "");
        } catch {
          name = "";
        }
      }
      if (!name) continue;
      const entry = toolCounts.get(name) ?? { count: 0, args: [] };
      entry.count += 1;
      toolCounts.set(name, entry);
      continue;
    }
    if (message.role === "assistant") {
      const calls = message.messageParams?.tool_calls ?? [];
      for (const call of calls) {
        const name = call.function?.name;
        if (!name) continue;
        const entry = toolCounts.get(name) ?? { count: 0, args: [] };
        const arg = keyArg(
          typeof call.function?.arguments === "string"
            ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
            : (call.function?.arguments as Record<string, unknown> | undefined)
        );
        if (arg && entry.args.length < 3 && !entry.args.includes(arg)) entry.args.push(arg);
        toolCounts.set(name, entry);
      }
      if (typeof message.content === "string" && message.content.trim()) conclusion = message.content.trim();
      continue;
    }
  }

  return {
    sessionId,
    intents,
    tools: [...toolCounts.entries()]
      .map(([name, { count, args }]) => ({ name, count, args }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    conclusion: clip(conclusion).slice(0, 400),
    userMessageCount,
  };
}

// ── Stage 2: SOP synthesis (contract-enforced, fail-open) ────────────────────

const sopSchema: AuxSchema<{ sopProposals: Array<Record<string, unknown>> }> = {
  describe: '{"sopProposals": [{"action","skillName","ruleText","body","rationale","evidenceRefs","estTokens"}]}',
  validate: (parsed) => {
    if (!parsed || typeof parsed !== "object") return null;
    const sopProposals = (parsed as { sopProposals?: unknown }).sopProposals;
    if (!Array.isArray(sopProposals)) return null;
    return { sopProposals: sopProposals.filter((p): p is Record<string, unknown> => !!p && typeof p === "object") };
  },
};

const MAX_SOP = 5;
const DISTILL_ACTIONS: readonly DistillAction[] = ["add-rule", "update-rule", "skill-new", "skill-append"];

function buildDistillPrompt(
  digests: readonly SessionDigest[],
  existingSkills: string[],
  rejectedKeys: string[]
): string {
  const digestText = digests
    .map(
      (d) =>
        `session ${d.sessionId.slice(0, 8)}:\n` +
        `  intents: ${d.intents.map((i) => `"${i}"`).join(" → ") || "(none)"}\n` +
        `  tools: ${d.tools.map((t) => `${t.name}×${t.count}${t.args.length ? `(${t.args.join("; ")})` : ""}`).join(", ") || "(none)"}\n` +
        `  conclusion: ${d.conclusion ? `"${d.conclusion.slice(0, 200)}"` : "(none)"}`
    )
    .join("\n");
  const rejected =
    rejectedKeys.length > 0 ? `\nAlready reviewed by the user (DO NOT re-propose): ${rejectedKeys.join(", ")}` : "";
  return `You distill REUSABLE SOPs from what these coding-agent sessions actually did (the procedure worked —固化它, not the failure).

Session digests (evidenceRefs point back as "<session8>#<intentIndex>", e.g. "${digests[0]?.sessionId.slice(0, 8) ?? "s"}#0"):
${digestText}
Existing skills (do NOT create a skill with one of these names — use action "skill-append" for them): ${existingSkills.join(", ") || "(none)"}
${rejected}
Rules:
- Propose only procedures with real reuse value across future sessions; every proposal cites evidenceRefs.
- "skill-new" (a NEW skill): body = full SKILL.md draft — frontmatter (name/description) + concise procedure steps. Name must NOT collide with existing skills.
- "skill-append": ruleText = a compact appendix bullet for the named existing skill.
- "add-rule"/"update-rule": ruleText = 1-2 sentence AGENTS.md rule.
- At most ${MAX_SOP} proposals, highest confidence first. No narration.

Respond with JSON only: {"sopProposals": [{"action":"add-rule|update-rule|skill-new|skill-append","skillName":"...","ruleText":"...","body":"...","rationale":"...","evidenceRefs":["<sid>#0"],"estTokens":40}]}`;
}

async function synthesizeSop(opts: {
  projectRoot: string;
  digests: readonly SessionDigest[];
  complete: (messages: Array<{ role: "system" | "user"; content: string }>) => Promise<string | null>;
}): Promise<NonNullable<MemoryDistillOutput["synthesis"]>> {
  const store = loadRejections(opts.projectRoot);
  const rejectedKeys = Object.keys(store);
  const existingSkills = listSkillNames(opts.projectRoot);
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: "You distill reusable SOPs from session digests. Respond with JSON only." },
    { role: "user", content: buildDistillPrompt(opts.digests, existingSkills, rejectedKeys) },
  ];

  for (let attempt = 0; attempt <= AUX_CONTENT_RETRY_BUDGET; attempt++) {
    let raw: string | null = null;
    try {
      raw = await opts.complete(messages);
    } catch {
      return { ok: false, proposals: [], dropped: 0, error: "completion transport failure" };
    }
    if (!raw) continue;
    let applied: { ok: true; value: { sopProposals: Array<Record<string, unknown>> } } | { ok: false };
    try {
      applied = applyAuxSchema(raw, sopSchema);
    } catch {
      applied = { ok: false };
    }
    if (!applied.ok) continue;

    const proposals: DistillProposal[] = [];
    const claimedSkillNames = new Set<string>(); // in-batch dedupe: one skill-new per name
    let dropped = 0;
    for (const raw of applied.value.sopProposals) {
      const action = DISTILL_ACTIONS.includes(raw.action as DistillAction) ? (raw.action as DistillAction) : null;
      const skillName = typeof raw.skillName === "string" ? raw.skillName.slice(0, 60) : undefined;
      const ruleText = typeof raw.ruleText === "string" ? raw.ruleText.slice(0, 400) : undefined;
      const body = typeof raw.body === "string" ? raw.body.slice(0, 4000) : undefined;
      const rationale = typeof raw.rationale === "string" ? raw.rationale.slice(0, 300) : "";
      const evidenceRefs = Array.isArray(raw.evidenceRefs)
        ? raw.evidenceRefs
            .filter((r): r is string => typeof r === "string" && /^#?[A-Za-z0-9-]+#\d+$/.test(r))
            .slice(0, 5)
        : [];
      const candidate = { action: action ?? "add-rule", target: "agents", ruleText, diffHint: undefined, rationale };
      const key = proposalKeyOf({ ...candidate, ruleText: ruleText ?? body ?? rationale });
      const nameTaken =
        (action === "skill-new" || action === "skill-append") &&
        skillName &&
        (existingSkills.includes(skillName) ? action === "skill-new" : false);
      const nameClaimed = action === "skill-new" && skillName && claimedSkillNames.has(skillName);
      if (
        proposals.length >= MAX_SOP ||
        !action ||
        !rationale ||
        evidenceRefs.length === 0 ||
        rejectedKeys.includes(key) ||
        nameTaken ||
        nameClaimed ||
        (action === "skill-new" && !body) ||
        ((action === "add-rule" || action === "update-rule" || action === "skill-append") && !ruleText) ||
        ((action === "skill-new" || action === "skill-append") && !skillName)
      ) {
        dropped += 1;
        continue;
      }
      if (action === "skill-new" && skillName) claimedSkillNames.add(skillName);
      proposals.push({
        key,
        action,
        skillName,
        ruleText,
        body,
        rationale,
        evidenceRefs,
        estTokens: Number.isFinite(Number(raw.estTokens)) ? Math.max(0, Math.round(Number(raw.estTokens))) : 0,
      });
    }
    return { ok: true, proposals, dropped };
  }
  return { ok: false, proposals: [], dropped: 0, error: "content budget exhausted (unparseable output)" };
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

// ── Review + write-back ──────────────────────────────────────────────────────

function buildReviewInstructions(synthesis: NonNullable<MemoryDistillOutput["synthesis"]>): string {
  return [
    "审阅以下 SOP 萃取建议（每条附会话证据）：",
    ...synthesis.proposals.map(
      (p, i) =>
        `${i + 1}. [${p.action}${p.skillName ? `:${p.skillName}` : ""}] ${p.ruleText ?? `${(p.body ?? "").split("\n").find((l) => l.includes("description:")) ?? "(skill draft)"}…`} — 证据: ${p.evidenceRefs.join(", ")}（${p.rationale}）`
    ),
    "",
    "Use the AskUserQuestion tool to let the user accept/reject/skip EACH proposal, then call memory.distill once with recordDecisions={auditId, decisions}.",
    "Accepted items are applied ONLY afterwards via native tools: skill-new via the write tool (new file), rules via the edit tool (read first for snippet_id).",
  ].join("\n");
}

function writeBackFor(p: DistillProposal): MemoryAuditWriteBack {
  if (p.action === "skill-new") {
    return {
      proposalKey: p.key,
      action: "add",
      targetFile: "SKILL.md",
      skillName: p.skillName,
      ruleText: p.body,
      instruction:
        `Create the new skill file .deeporca/skills/${p.skillName ?? "<name>"}/SKILL.md via the native WRITE tool with EXACTLY this content (frontmatter + body, permissions apply):\n` +
        `${p.body ?? ""}\nEvidence: ${p.evidenceRefs.join(", ")}.`,
    };
  }
  const target =
    p.action === "skill-append"
      ? `.deeporca/skills/${p.skillName ?? "<skill>"}/SKILL.md (append section)`
      : "AGENTS.md (repo root)";
  const instruction =
    p.action === "add-rule"
      ? `Append the rule to ${target}: "${p.ruleText ?? ""}"`
      : p.action === "update-rule"
        ? `In ${target}, update the rule to: "${p.ruleText ?? ""}"`
        : `Append to ${target} the bullet: "${p.ruleText ?? ""}"`;
  return {
    proposalKey: p.key,
    action: p.action === "add-rule" || p.action === "skill-append" ? "add" : "update",
    targetFile: p.action === "skill-append" ? "SKILL.md" : "AGENTS.md",
    skillName: p.skillName,
    ruleText: p.ruleText,
    instruction: `${instruction} — apply via the native edit tool (read first for snippet_id). Evidence: ${p.evidenceRefs.join(", ")}.`,
  };
}

// ── Action definition + run ─────────────────────────────────────────────────

export const memoryDistillDefinition: ActionDefinition<MemoryDistillInput> = {
  id: "memory.distill",
  description:
    "Distill reusable SOPs from what recent sessions actually did (specs/sop-extraction — the success-driven twin of " +
    "memory.audit): deterministic session digests (intent sequence / tool portrait / conclusion) → ONE contract-enforced " +
    "synthesis → proposals (new SKILL.md draft / AGENTS.md rule / skill appendix) → per-item user review → controlled " +
    "write-back via native write/edit. Sessions read-only; decisions persist (never re-propose settled items).",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      sessions: { type: "number", description: "Distill the N most recent non-silent sessions (default 3)" },
      sessionId: { type: "string", description: "Distill one specific session by id" },
      dryRun: { type: "boolean", description: "true (default) = return without writing any file" },
      synthesize: { type: "boolean", description: "Also run the SOP synthesis stage" },
      recordDecisions: {
        type: "object",
        description: "Review loop: record per-proposal verdicts (shared store with memory.audit)",
        properties: {
          auditId: { type: "string" },
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

export const memoryDistillRun: ActionRun<MemoryDistillInput, MemoryDistillOutput> = async (input, ctx) => {
  if (input?.recordDecisions) {
    return recordDistillDecisions(ctx.projectRoot, input.recordDecisions);
  }
  const projectDir = path.join(getUserConfigRoot(), "projects", getProjectCode(ctx.projectRoot));
  const dryRun = input?.dryRun !== false;

  // Session selection: explicit id, or the N most recent non-silent entries.
  const ids: string[] = [];
  if (input?.sessionId) {
    if (!isSafeSessionId(input.sessionId)) {
      return baseError(projectDir, "invalid sessionId");
    }
    ids.push(input.sessionId);
  } else {
    const n = Number.isFinite(input?.sessions) && (input?.sessions as number) > 0 ? (input?.sessions as number) : 3;
    const indexPath = path.join(projectDir, "sessions-index.json");
    if (fs.existsSync(indexPath)) {
      try {
        const entries = (
          JSON.parse(fs.readFileSync(indexPath, "utf8")) as {
            entries?: Array<{ id: string; isSilentSubagent?: boolean; updateTime?: string }>;
          }
        ).entries;
        if (Array.isArray(entries)) {
          ids.push(
            ...entries
              .filter((e) => !e.isSilentSubagent && isSafeSessionId(e.id))
              .sort((a, b) => String(b.updateTime ?? "").localeCompare(String(a.updateTime ?? "")))
              .slice(0, n)
              .map((e) => e.id)
          );
        }
      } catch {
        return baseError(projectDir, "sessions-index.json is unreadable");
      }
    }
  }

  const digests = ids
    .map((id) => readSessionDigest(projectDir, id))
    .filter((d): d is SessionDigest => d !== null && d.intents.length + d.tools.length > 0);

  let synthesis: NonNullable<MemoryDistillOutput["synthesis"]> | undefined;
  let reviewInstructions: string | undefined;
  if (input?.synthesize) {
    synthesis = ctx.completeViaLlm
      ? await synthesizeSop({
          projectRoot: ctx.projectRoot,
          digests,
          complete: (messages) => ctx.completeViaLlm!(messages),
        })
      : { ok: false, proposals: [], dropped: 0, error: "completeViaLlm seam not injected" };
    if (synthesis.proposals.length > 0) reviewInstructions = buildReviewInstructions(synthesis);
  }

  const output: MemoryDistillOutput = {
    ok: true,
    projectDir,
    digests,
    ...(synthesis ? { synthesis } : {}),
    ...(reviewInstructions ? { reviewInstructions } : {}),
  };
  if (dryRun || !synthesis || synthesis.proposals.length === 0) return output;
  // Persist the distill snapshot so recordDecisions can resolve accepted keys.
  try {
    const dir = path.join(getProjectConfigRootAuditRoot(ctx.projectRoot));
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `memory-distill-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(output, null, 2), "utf8");
  } catch {
    // Snapshot is the review-loop anchor; without it recordDecisions can't run
    // — surface but keep the digest output usable.
    return { ...output, ok: false, error: "distill snapshot write failed" };
  }
  return output;
};

function baseError(projectDir: string, error: string): MemoryDistillOutput {
  return { ok: false, projectDir, digests: [], error };
}

/** Shared review-loop leg: same store, same semantics as memory.audit. */
function recordDistillDecisions(
  projectRoot: string,
  record: NonNullable<MemoryDistillInput["recordDecisions"]>
): MemoryDistillOutput {
  const projectDir = path.join(getUserConfigRoot(), "projects", getProjectCode(projectRoot));
  if (!/^[A-Za-z0-9._-]+$/.test(record.auditId) || record.auditId.includes("..")) {
    return baseError(projectDir, "invalid auditId");
  }
  const snapshotFile = path.join(getProjectConfigRootAuditRoot(projectRoot), `memory-distill-${record.auditId}.json`);
  let stored: MemoryDistillOutput;
  try {
    stored = JSON.parse(fs.readFileSync(snapshotFile, "utf8")) as MemoryDistillOutput;
  } catch {
    return baseError(projectDir, `snapshot not found or unreadable: ${record.auditId}`);
  }
  const byKey = new Map((stored.synthesis?.proposals ?? []).map((p) => [p.key, p]));
  const store = loadRejections(projectRoot);
  const writeBacks: MemoryAuditWriteBack[] = [];
  const at = new Date().toISOString();
  for (const decision of record.decisions ?? []) {
    const proposal = decision.proposalKey ? byKey.get(decision.proposalKey) : undefined;
    if (!proposal) continue;
    store[proposal.key] = { verdict: decision.verdict, note: decision.note, at };
    if (decision.verdict === "accept") writeBacks.push(writeBackFor(proposal));
  }
  try {
    saveRejections(projectRoot, store);
  } catch (err) {
    return baseError(projectDir, `rejection store write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { ok: true, projectDir, digests: [], ...(writeBacks.length > 0 ? { pendingWriteBacks: writeBacks } : {}) };
}
