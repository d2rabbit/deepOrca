/**
 * Shell Collector — mines shell command history for patterns.
 *
 * Reads ~/.zsh_history, ~/.bash_history, or PowerShell history.
 * Cross-platform, zero external dependencies.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ShellCommand {
  command: string;
  count: number;
}

export interface ShellProfile {
  totalCommands: number;
  topCommands: ShellCommand[];
  commandBigrams: { sequence: string; count: number }[];
  distinctCommands: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Find the shell history file for the current platform. */
function findHistoryFile(): string | null {
  const candidates = [
    join(homedir(), ".zsh_history"),
    join(homedir(), ".bash_history"),
    // Windows PowerShell (not .bash/.zsh, but try for completeness).
    join(
      homedir(),
      "AppData",
      "Roaming",
      "Microsoft",
      "Windows",
      "PowerShell",
      "PSReadLine",
      "ConsoleHost_history.txt"
    ),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Parse zsh history format (extended history has timestamps). */
function parseHistoryLine(line: string): string {
  // Extended zsh history: ": 1234567890:0;command"
  // Use `s` flag so `.` matches newlines (multiline commands).
  const extMatch = line.match(/^:\s*\d+:\d+;(.*)$/s);
  if (extMatch) return extMatch[1].trim();
  return line.trim();
}

/** Extract the command "verb" (first word/token) for grouping. */
function commandVerb(cmd: string): string {
  // Strip env vars, sudo, etc. Get the actual command.
  let c = cmd.trim();
  // Remove ALL leading env assignments like "FOO=bar BAZ=qux ".
  c = c.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, "");
  // Remove leading "sudo ".
  c = c.replace(/^sudo\s+/, "");
  // Take first token.
  const firstToken = c.split(/\s+/)[0] ?? c;
  return firstToken;
}

// ── Main collector ───────────────────────────────────────────────────────────

/**
 * Build a shell command profile.
 *
 * @param maxCommands — Max commands to read from history (default: 2000).
 */
export function collectShellProfile(maxCommands = 2000): ShellProfile {
  const historyFile = findHistoryFile();

  const empty: ShellProfile = {
    totalCommands: 0,
    topCommands: [],
    commandBigrams: [],
    distinctCommands: 0,
  };

  if (!historyFile) return empty;

  let content: string;
  try {
    content = readFileSync(historyFile, "utf8");
  } catch {
    return empty;
  }

  // Parse commands (take the last N).
  const allLines = content.split("\n").filter(Boolean);
  const lines = allLines.slice(-maxCommands);
  const commands = lines.map(parseHistoryLine).filter((c) => c.length > 0 && c.length < 200);

  if (commands.length === 0) return empty;

  // Count command frequency by verb.
  const verbCounts = new Map<string, number>();
  for (const cmd of commands) {
    const verb = commandVerb(cmd);
    verbCounts.set(verb, (verbCounts.get(verb) ?? 0) + 1);
  }

  const topCommands = Array.from(verbCounts.entries())
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Mine bigrams (command → next command).
  const bigramCounts = new Map<string, number>();
  for (let i = 0; i < commands.length - 1; i++) {
    const v1 = commandVerb(commands[i]);
    const v2 = commandVerb(commands[i + 1]);
    if (v1 !== v2) {
      const key = `${v1} → ${v2}`;
      bigramCounts.set(key, (bigramCounts.get(key) ?? 0) + 1);
    }
  }

  const commandBigrams = Array.from(bigramCounts.entries())
    .filter(([, count]) => count >= 2)
    .map(([sequence, count]) => ({ sequence, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalCommands: commands.length,
    topCommands,
    commandBigrams,
    distinctCommands: verbCounts.size,
  };
}
