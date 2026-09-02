/**
 * Whole-workspace token accounting (user ask 2026-09-01: 无论什么操作，只要
 * 涉及 LLM 的使用就记录) — aggregates the usage tallies of EVERY session in
 * the project's sessions-index, INCLUDING silent-subagent sessions (index
 * builds, arch LLM judging, prototype pipelines): those entries carry the
 * same usage/usagePerModel fields, they are merely hidden from the session
 * list. Reads the on-disk index directly — no bridge involvement, so the
 * numbers are workspace-scoped, not active-root-scoped.
 *
 * Out of scope (cannot be attributed here): the bundled OCR reviewer's own
 * API calls (external CLI with its own key) and local ONNX embeddings (zero
 * tokens by nature).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getProjectCode } from "@deeporca/core";

export interface TokenModelUsage {
  prompt: number;
  completion: number;
  total: number;
  cacheRead: number;
  reqs: number;
}

export interface WorkspaceTokenSummary {
  root: string;
  /** Session files counted (all sessions, silent subagents included). */
  sessions: number;
  silentSessions: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  requests: number;
  perModel: Record<string, TokenModelUsage>;
  /** Last activity seen in the index (max updateTime). */
  lastAt: string | null;
}

type IndexEntry = {
  usage?: Record<string, unknown> | null;
  usagePerModel?: Record<string, Record<string, unknown>> | null;
  updateTime?: string;
  isSilentSubagent?: boolean;
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function emptyModel(): TokenModelUsage {
  return { prompt: 0, completion: 0, total: 0, cacheRead: 0, reqs: 0 };
}

/** Project dir holding sessions-index.json — mirrors core's persistence layout. */
export function projectSessionsIndexPath(userConfigRoot: string, root: string): string {
  return path.join(userConfigRoot, "projects", getProjectCode(root), "sessions-index.json");
}

/** Zero summary — returned for an unregistered root (nothing read or enumerated). */
export function emptyTokenSummary(root: string): WorkspaceTokenSummary {
  return {
    root,
    sessions: 0,
    silentSessions: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    requests: 0,
    perModel: {},
    lastAt: null,
  };
}

export function buildTokenSummary(root: string, indexPath: string): WorkspaceTokenSummary {
  const out: WorkspaceTokenSummary = emptyTokenSummary(root);

  let entries: IndexEntry[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as { entries?: IndexEntry[] };
    entries = Array.isArray(raw.entries) ? raw.entries : [];
  } catch {
    return out; // no index yet — zero summary
  }

  for (const e of entries) {
    out.sessions++;
    if (e.isSilentSubagent) out.silentSessions++;
    if (e.updateTime && (!out.lastAt || e.updateTime > out.lastAt)) out.lastAt = e.updateTime;
    for (const usage of [e.usage]) {
      if (!usage) continue;
      out.promptTokens += num(usage.prompt_tokens);
      out.completionTokens += num(usage.completion_tokens);
      out.totalTokens += num(usage.total_tokens);
      out.cacheReadTokens += num(usage.prompt_cache_hit_tokens);
      out.requests += num(usage.total_reqs);
    }
    for (const [model, u] of Object.entries(e.usagePerModel ?? {})) {
      const m = (out.perModel[model] ??= emptyModel());
      m.prompt += num(u.prompt_tokens);
      m.completion += num(u.completion_tokens);
      m.total += num(u.total_tokens);
      m.cacheRead += num(u.prompt_cache_hit_tokens);
      m.reqs += num(u.total_reqs);
    }
  }
  return out;
}
