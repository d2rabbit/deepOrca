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

import * as fs from "node:fs";
import * as path from "node:path";
import type { ActionDefinition, ActionRun } from "./types";
import { getProjectCode, getProjectConfigRoot, getUserConfigRoot } from "../common/app-dirs";
import { verifyAuditChain, type AuditEvent, type PathGateAuditEvent } from "../sandbox/audit";

// ── Inputs / outputs ─────────────────────────────────────────────────────────

export interface MemoryAuditInput {
  /** Scan at most this many recent sessions (default 20). */
  maxSessions?: number;
  /** Independent sessions required to corroborate a pattern (default 2). */
  corroborationThreshold?: number;
  /** true (default): return the snapshot without writing anything. */
  dryRun?: boolean;
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
  readonly error?: string;
}

const MAX_EVENTS = 200;
const MESSAGE_CLIP = 200;
const SNAPSHOT_KEEP = 10;

/** Index entries are semi-trusted storage — a corrupt/hand-edited id must
 *  never turn into a path traversal out of the project store. */
function isSafeSessionId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && !id.includes("..");
}

function clip(text: string): string {
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

function writeSnapshot(projectRoot: string, output: Omit<MemoryAuditOutput, "snapshotPath">): string {
  // getProjectConfigRoot honors a legacy `.deepcode` root when present — the
  // same dual-root discipline as the reviews store.
  const dir = path.join(getProjectConfigRoot(projectRoot), "audits");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `memory-audit-${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  // review-store discipline: keep the newest SNAPSHOT_KEEP files.
  const existing = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith("memory-audit-") && name.endsWith(".json"))
    .sort();
  for (const stale of existing.slice(0, Math.max(0, existing.length - SNAPSHOT_KEEP))) {
    try {
      fs.rmSync(path.join(dir, stale));
    } catch {
      // best-effort prune
    }
  }
  return file;
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
    },
    additionalProperties: false,
  },
  sideEffects: ["read-in-cwd", "write-in-cwd"],
};

export const memoryAuditRun: ActionRun<MemoryAuditInput, MemoryAuditOutput> = async (input, ctx) => {
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
  const snapshot: Omit<MemoryAuditOutput, "snapshotPath"> = {
    ok: true,
    projectDir,
    scannedSessions: material.length,
    excludedSilentSessions: silent.length,
    events: events.slice(0, MAX_EVENTS),
    omittedEvents,
    patterns,
    candidates,
    auditChain: chain,
  };

  if (dryRun) return snapshot;
  try {
    const snapshotPath = writeSnapshot(ctx.projectRoot, snapshot);
    return { ...snapshot, snapshotPath };
  } catch (err) {
    return {
      ...snapshot,
      ok: false,
      error: `snapshot write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
