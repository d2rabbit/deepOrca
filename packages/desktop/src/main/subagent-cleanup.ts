/**
 * One-time cleanup of leaked subagent sessions (specs/index-knowledge-rework
 * R2-2.3). Before the `silent` zero-residue guarantee landed, arch-scan runs
 * through runSubagent created REAL sessions: full index entries + JSONL +
 * file-history, "Scan the codebase architecture…" summaries, visible in the
 * sidebar. This migration purges them from every project's sessions index.
 *
 * Match rule (conservative — only pipeline-shaped orphans are touched):
 *   - entry.isSilentSubagent is set, OR
 *   - summary starts with a known subagent prompt prefix AND the entry has no
 *     user turn (a session the user typed into keeps its history even when
 *     the summary matches — it is a real conversation).
 *
 * Idempotence: a marker file records the run; later boots no-op. Message
 * JSONL files of purged entries are deleted alongside the index entries.
 */

import { getUserConfigRoot } from "@deeporca/core";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Known subagent prompt prefixes that leaked as session summaries. */
const LEAKED_PREFIXES = ["Scan the codebase"];

const MARKER_NAME = "subagent-cleanup-v1";

type DiskEntry = {
  id: string;
  summary: string | null;
  createTime?: string;
  updateTime?: string;
  messagesPath?: string;
  isSilentSubagent?: boolean;
};

type DiskIndex = { version?: number; entries: DiskEntry[]; originalPath: string };

function projectsDir(): string {
  return path.join(getUserConfigRoot(), "projects");
}

function markerPath(): string {
  return path.join(getUserConfigRoot(), "desktop", MARKER_NAME);
}

/**
 * Does this JSONL contain any real user turn? The subagent prompt itself is
 * written as a USER-role message, so a user turn whose content matches a
 * known subagent prompt prefix does NOT count — only genuinely typed prompts
 * (e.g. "/init") keep the session alive.
 */
function hasUserTurn(jsonlPath: string | undefined): boolean {
  if (!jsonlPath || !existsSync(jsonlPath)) return false;
  try {
    const raw = readFileSync(jsonlPath, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as { role?: string; content?: unknown };
        if (msg.role === "user" && typeof msg.content === "string" && msg.content.trim().length > 0) {
          const content = msg.content.trim();
          const isSubagentPrompt = LEAKED_PREFIXES.some((prefix) => content.startsWith(prefix));
          if (!isSubagentPrompt) {
            return true;
          }
        }
      } catch {
        // skip malformed line
      }
    }
  } catch {
    return false;
  }
  return false;
}

/** Run the cleanup once. Safe to call on every boot (marker-gated). */
export function cleanupLeakedSubagentSessions(): void {
  try {
    if (existsSync(markerPath())) return;
  } catch {
    return;
  }
  let purged = 0;
  const dir = projectsDir();
  let projectDirs: string[] = [];
  try {
    projectDirs = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    projectDirs = [];
  }
  for (const code of projectDirs) {
    const indexPath = path.join(dir, code, "sessions-index.json");
    if (!existsSync(indexPath)) continue;
    let index: DiskIndex;
    try {
      index = JSON.parse(readFileSync(indexPath, "utf8")) as DiskIndex;
    } catch {
      continue;
    }
    if (!Array.isArray(index.entries)) continue;
    const keep: DiskEntry[] = [];
    for (const entry of index.entries) {
      const summary = entry.summary ?? "";
      const leaked =
        entry.isSilentSubagent === true ||
        (LEAKED_PREFIXES.some((prefix) => summary.startsWith(prefix)) &&
          !hasUserTurn(entry.messagesPath ?? path.join(dir, code, `${entry.id}.jsonl`)));
      if (!leaked) {
        keep.push(entry);
        continue;
      }
      purged += 1;
      // Delete the message file next to the index (both known layouts).
      const candidates = [
        entry.messagesPath,
        path.join(dir, code, `${entry.id}.jsonl`),
        path.join(dir, code, "sessions", `${entry.id}.jsonl`),
      ];
      for (const file of candidates) {
        if (file && existsSync(file)) {
          try {
            rmSync(file, { force: true });
          } catch {
            // best-effort
          }
        }
      }
    }
    if (keep.length !== index.entries.length) {
      index.entries = keep;
      try {
        writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
      } catch {
        // best-effort
      }
    }
  }
  try {
    mkdirSync(path.dirname(markerPath()), { recursive: true });
    writeFileSync(markerPath(), new Date().toISOString(), "utf8");
  } catch {
    // best-effort
  }
  if (purged > 0) {
    console.log(`[subagent-cleanup] purged ${purged} leaked subagent session(s)`);
  }
}
