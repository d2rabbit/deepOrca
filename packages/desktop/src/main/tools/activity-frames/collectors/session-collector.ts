/**
 * Session Collector — mines DeepOrca's own session history for behavioral patterns.
 *
 * This is the highest-value collector: it captures actual development work
 * (tool calls, file edits, searches, commands) from ~/.deeporca/projects/.
 * Zero external dependencies, fully cross-platform.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ToolUsage {
  name: string;
  count: number;
  lastUsed: string;
}

export interface FileHotspot {
  path: string;
  edits: number;
  reads: number;
  lastTouched: string;
}

export interface WorkflowStep {
  tool: string;
  target: string;
}

export interface WorkflowPattern {
  sequence: string[];
  count: number;
  label: string;
}

export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  messageCount: number;
  toolCalls: number;
  filesEdited: string[];
  commandsRun: string[];
  firstUserMessage: string;
}

export interface SessionProfile {
  totalSessions: number;
  recentSessions: SessionSummary[];
  topTools: ToolUsage[];
  fileHotspots: FileHotspot[];
  workflowPatterns: WorkflowPattern[];
  commonFirstActions: string[];
  avgSessionLength: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Candidate project storage codes for a root. Uses core's own getProjectCode
 * (which falls back to a hashed basename-<hash> code for paths >64 chars —
 * the legacy replace alone missed those, audit 2026-08-15 linkage L5) plus
 * the legacy form for pre-hash sessions.
 */
function projectCodeCandidates(projectRoot: string): string[] {
  const codes: string[] = [];
  try {
    const core = require("@deeporca/core") as { getProjectCode: (root: string) => string };
    codes.push(core.getProjectCode(projectRoot));
  } catch {
    // core unavailable — fall through to legacy computation only.
  }
  codes.push(projectRoot.replace(/[\\/]/g, "-").replace(/:/g, ""));
  return [...new Set(codes)];
}

/** Find the DeepOrca project storage dir for a given project root. */
function findProjectDir(projectRoot: string): string | null {
  for (const code of projectCodeCandidates(projectRoot)) {
    for (const root of [join(homedir(), ".deeporca", "projects"), join(homedir(), ".deepcode", "projects")]) {
      const dir = join(root, code);
      if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
    }
  }
  return null;
}

/** Read and parse a JSONL session file. */
function readSession(filePath: string): unknown[] {
  try {
    const content = readFileSync(filePath, "utf8");
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Parsed tool call from a session message. */
interface ParsedToolCall {
  name: string;
  arguments: string;
  output: string;
}

/**
 * Extract tool info from a tool message.
 * Tool messages store the tool name and arguments in `meta.function`,
 * NOT in `content` (which is the raw tool result text).
 */
function parseToolMessage(msg: Record<string, unknown>): ParsedToolCall | null {
  if (msg.role !== "tool") return null;
  const meta = msg.meta as { function?: { name?: string; arguments?: string } } | undefined;
  const fn = meta?.function;
  if (!fn || !fn.name) return null;
  return {
    name: fn.name,
    arguments: fn.arguments ?? "",
    output: String(msg.content ?? ""),
  };
}

/** Extract file paths from a tool call's arguments JSON string. */
function extractFilePaths(argsJson: string): string[] {
  if (!argsJson) return [];
  try {
    const args = JSON.parse(argsJson);
    const paths: string[] = [];
    // read/write/edit tools use "file_path".
    if (typeof args.file_path === "string") paths.push(args.file_path);
    // Some tools use "path".
    if (typeof args.path === "string") paths.push(args.path);
    return paths;
  } catch {
    // Arguments might not be valid JSON (e.g. template strings).
    // Fallback: regex extract.
    const match = argsJson.match(/"file_path"\s*:\s*"([^"]+)"/);
    return match ? [match[1]] : [];
  }
}

/** Extract bash command from a tool call's arguments JSON string. */
function extractBashCommand(argsJson: string): string | null {
  if (!argsJson) return null;
  try {
    const args = JSON.parse(argsJson);
    return typeof args.command === "string" ? args.command.slice(0, 80) : null;
  } catch {
    const match = argsJson.match(/"command"\s*:\s*"([^"]+)"/);
    return match ? match[1].slice(0, 80) : null;
  }
}

// ── Main collector ───────────────────────────────────────────────────────────

/**
 * Build a behavioral profile from DeepOrca session history.
 *
 * @param projectRoot — The project root path.
 * @param maxSessions — Max number of recent sessions to analyze (default 20).
 */
export function collectSessionProfile(projectRoot: string, maxSessions = 20): SessionProfile {
  const projectDir = findProjectDir(projectRoot);

  const empty: SessionProfile = {
    totalSessions: 0,
    recentSessions: [],
    topTools: [],
    fileHotspots: [],
    workflowPatterns: [],
    commonFirstActions: [],
    avgSessionLength: 0,
  };

  if (!projectDir) return empty;

  // List and sort session files by mtime (most recent first).
  const files = readdirSync(projectDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({
      name: f,
      path: join(projectDir, f),
      mtime: statSync(join(projectDir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, maxSessions);

  if (files.length === 0) return empty;

  // Aggregate across sessions.
  const toolCounts = new Map<string, { count: number; lastUsed: string }>();
  const fileStats = new Map<string, { edits: number; reads: number; lastTouched: string }>();
  const sessionSummaries: SessionSummary[] = [];
  const firstActions: string[] = [];
  const allWorkflows: string[][] = [];

  for (const file of files) {
    const messages = readSession(file.path);
    let toolCallCount = 0;
    const filesEdited = new Set<string>();
    const commandsRun: string[] = [];
    let firstUserMsg = "";
    const sessionWorkflow: string[] = [];

    for (const msg of messages as Array<Record<string, unknown>>) {
      const role = msg.role as string;
      const content = String(msg.content ?? "");
      const createTime = String(msg.createTime ?? "");

      if (role === "user" && !firstUserMsg && content) {
        firstUserMsg = content.slice(0, 100);
      }

      if (role === "tool") {
        const tc = parseToolMessage(msg);
        if (tc) {
          toolCallCount++;
          sessionWorkflow.push(tc.name);

          // Track tool usage.
          if (!toolCounts.has(tc.name)) {
            toolCounts.set(tc.name, { count: 0, lastUsed: createTime });
          }
          toolCounts.get(tc.name)!.count++;
          if (createTime > toolCounts.get(tc.name)!.lastUsed) {
            toolCounts.get(tc.name)!.lastUsed = createTime;
          }

          // Track file paths from read/write/edit tools.
          if (["read", "write", "edit"].includes(tc.name)) {
            const paths = extractFilePaths(tc.arguments);
            for (const p of paths) {
              if (!fileStats.has(p)) {
                fileStats.set(p, { edits: 0, reads: 0, lastTouched: createTime });
              }
              const fs = fileStats.get(p)!;
              if (tc.name === "read") fs.reads++;
              else fs.edits++;
              if (createTime > fs.lastTouched) fs.lastTouched = createTime;
              if (tc.name !== "read") filesEdited.add(p);
            }
          }

          // Track bash commands.
          if (tc.name === "bash" || tc.name === "Bash") {
            const cmd = extractBashCommand(tc.arguments);
            if (cmd) commandsRun.push(cmd);
          }
        }
      }
    }

    // First action in the session (first tool call).
    if (sessionWorkflow.length > 0) {
      firstActions.push(sessionWorkflow[0]);
    }

    // Store workflow sequences (limit to sessions with > 3 tool calls).
    if (sessionWorkflow.length > 3) {
      allWorkflows.push(sessionWorkflow);
    }

    sessionSummaries.push({
      sessionId: file.name.replace(".jsonl", ""),
      startedAt: new Date(file.mtime).toISOString(),
      messageCount: messages.length,
      toolCalls: toolCallCount,
      filesEdited: Array.from(filesEdited),
      commandsRun,
      firstUserMessage: firstUserMsg,
    });
  }

  // Top tools.
  const topTools = Array.from(toolCounts.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count);

  // File hotspots.
  const fileHotspots = Array.from(fileStats.entries())
    .map(([path, v]) => ({ path, ...v }))
    .sort((a, b) => b.edits + b.reads - a.edits - a.reads)
    .slice(0, 15);

  // Common first actions.
  const firstActionCounts = new Map<string, number>();
  for (const a of firstActions) {
    firstActionCounts.set(a, (firstActionCounts.get(a) ?? 0) + 1);
  }
  const commonFirstActions = Array.from(firstActionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([a]) => a);

  // Workflow patterns: mine bigrams and trigrams.
  const workflowPatterns = mineWorkflowPatterns(allWorkflows);

  // Average session length.
  const avgSessionLength =
    sessionSummaries.length > 0
      ? Math.round(sessionSummaries.reduce((s, x) => s + x.messageCount, 0) / sessionSummaries.length)
      : 0;

  return {
    totalSessions: files.length,
    recentSessions: sessionSummaries.slice(0, 10),
    topTools,
    fileHotspots,
    workflowPatterns,
    commonFirstActions,
    avgSessionLength,
  };
}

// ── Workflow pattern mining ──────────────────────────────────────────────────

/** Mine common tool-call sequences (bigrams and trigrams). */
function mineWorkflowPatterns(workflows: string[][]): WorkflowPattern[] {
  const sequenceCounts = new Map<string, { seq: string[]; count: number }>();

  for (const wf of workflows) {
    // Bigrams.
    for (let i = 0; i < wf.length - 1; i++) {
      const seq = [wf[i], wf[i + 1]];
      const key = seq.join(" → ");
      if (!sequenceCounts.has(key)) sequenceCounts.set(key, { seq, count: 0 });
      sequenceCounts.get(key)!.count++;
    }
    // Trigrams.
    for (let i = 0; i < wf.length - 2; i++) {
      const seq = [wf[i], wf[i + 1], wf[i + 2]];
      const key = seq.join(" → ");
      if (!sequenceCounts.has(key)) sequenceCounts.set(key, { seq, count: 0 });
      sequenceCounts.get(key)!.count++;
    }
  }

  return Array.from(sequenceCounts.values())
    .filter((x) => x.count >= 2) // Only patterns that repeat.
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((x) => ({
      sequence: x.seq,
      count: x.count,
      label: x.seq.join(" → "),
    }));
}
