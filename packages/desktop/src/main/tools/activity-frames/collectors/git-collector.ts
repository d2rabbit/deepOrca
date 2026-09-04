/**
 * Git Collector — mines git history for development patterns.
 *
 * Captures commit frequency, file hotspots, branch patterns, and activity
 * timing. Uses `git` CLI (already available via bash tool). Cross-platform.
 */

import { execFileSync } from "node:child_process";

// ── Types ────────────────────────────────────────────────────────────────────

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
}

export interface GitFileHotspot {
  file: string;
  commits: number;
  lastChanged: string;
}

export interface GitActivity {
  hourlyCommits: Record<number, number>;
  dailyCommits: Record<string, number>;
}

export interface GitProfile {
  totalCommits: number;
  recentCommits: GitCommit[];
  fileHotspots: GitFileHotspot[];
  branches: string[];
  activity: GitActivity;
  topMessagePatterns: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function git(projectRoot: string, args: readonly string[]): string {
  try {
    // argv form (no shell) — hardening per security audit 2026-08-12 §2.1:
    // even though current call sites pass fixed git arguments, a shell string
    // helper invites injection the moment one caller interpolates a path.
    return execFileSync("git", args as string[], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

// ── Main collector ───────────────────────────────────────────────────────────

/**
 * Build a git behavioral profile.
 *
 * @param projectRoot — The project root path (must be a git repo).
 * @param days — Number of days to analyze (default: 30).
 */
export function collectGitProfile(projectRoot: string, days = 30): GitProfile {
  // Check if it's a git repo.
  const isRepo = git(projectRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (!isRepo) {
    return emptyProfile();
  }

  const since = `${days} days ago`;

  // Recent commits. Use ASCII unit separator (\x1f) as delimiter to avoid
  // issues with commit messages containing | characters.
  const SEP = "\x1f";
  const logOutput = git(projectRoot, [
    "log",
    `--since=${since}`,
    `--pretty=format:%h${SEP}%s${SEP}%an${SEP}%ai`,
    "--numstat",
    "--no-merges",
  ]);

  const commits: GitCommit[] = [];
  const fileCounts = new Map<string, { commits: number; lastChanged: string }>();
  const hourlyCommits: Record<number, number> = {};
  const dailyCommits: Record<string, number> = {};
  const messagePrefixes = new Map<string, number>();

  if (logOutput) {
    const lines = logOutput.split("\n");
    let currentCommit: GitCommit | null = null;

    for (const line of lines) {
      if (line.includes(SEP)) {
        // Commit header line (delimited by ASCII unit separator).
        const parts = line.split(SEP);
        const hash = parts[0]?.trim() ?? "";
        const message = parts.slice(1, -2).join(SEP).trim(); // message may contain SEP
        const author = parts[parts.length - 2]?.trim() ?? "";
        const date = parts[parts.length - 1]?.trim() ?? "";
        currentCommit = {
          hash,
          message,
          author,
          date,
          filesChanged: 0,
        };

        // Track hourly/daily activity.
        const d = new Date(date.trim());
        const hour = d.getHours();
        hourlyCommits[hour] = (hourlyCommits[hour] ?? 0) + 1;
        const dayKey = date.trim().slice(0, 10);
        dailyCommits[dayKey] = (dailyCommits[dayKey] ?? 0) + 1;

        // Track message prefix (conventional commits).
        const prefixMatch = message.trim().match(/^(\w+(\([^)]+\))?!?):/);
        if (prefixMatch) {
          const prefix = prefixMatch[1];
          messagePrefixes.set(prefix, (messagePrefixes.get(prefix) ?? 0) + 1);
        }

        commits.push(currentCommit);
      } else if (line.trim() && currentCommit) {
        // Numstat line: additions deletions file.
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const file = parts.slice(2).join(" ");
          currentCommit.filesChanged++;
          if (!fileCounts.has(file)) {
            fileCounts.set(file, { commits: 0, lastChanged: currentCommit.date });
          }
          fileCounts.get(file)!.commits++;
          if (currentCommit.date > fileCounts.get(file)!.lastChanged) {
            fileCounts.get(file)!.lastChanged = currentCommit.date;
          }
        }
      }
    }
  }

  // Branches.
  const branchOutput = git(projectRoot, ["branch", "--list"]);
  const branches = branchOutput
    .split("\n")
    .map((b) => b.replace(/^\*?\s+/, "").trim())
    .filter(Boolean);

  // File hotspots.
  const fileHotspots = Array.from(fileCounts.entries())
    .map(([file, v]) => ({ file, ...v }))
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 15);

  // Top message patterns.
  const topMessagePatterns = Array.from(messagePrefixes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([prefix, count]) => `${prefix} (${count}×)`);

  return {
    totalCommits: commits.length,
    recentCommits: commits.slice(0, 20),
    fileHotspots,
    branches,
    activity: { hourlyCommits, dailyCommits },
    topMessagePatterns,
  };
}

function emptyProfile(): GitProfile {
  return {
    totalCommits: 0,
    recentCommits: [],
    fileHotspots: [],
    branches: [],
    activity: { hourlyCommits: {}, dailyCommits: {} },
    topMessagePatterns: [],
  };
}
