/**
 * Multi-source aggregator — fuses all collector outputs into a unified
 * behavioral profile and generates context blocks for the agent.
 *
 * Sources:
 * 1. Session Collector (DeepOrca session history)
 * 2. Git Collector (commit/branch/file patterns)
 * 3. Shell Collector (command frequency/sequences)
 * 4. File Collector (recent edits, hotspots, languages)
 * 5. Screen Collector (activity-frames, optional, macOS)
 */

import { collectSessionProfile } from "./session-collector";
import type { SessionProfile } from "./session-collector";
import { collectGitProfile } from "./git-collector";
import type { GitProfile } from "./git-collector";
import { collectShellProfile } from "./shell-collector";
import type { ShellProfile } from "./shell-collector";
import { collectFileProfile } from "./file-collector";
import type { FileProfile } from "./file-collector";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BehavioralProfile {
  generatedAt: string;
  projectRoot: string;
  session: SessionProfile;
  git: GitProfile;
  shell: ShellProfile;
  file: FileProfile;
}

// ── Main collector ───────────────────────────────────────────────────────────

/**
 * Collect a full behavioral profile from all sources.
 */
export function collectProfile(projectRoot: string): BehavioralProfile {
  return {
    generatedAt: new Date().toISOString(),
    projectRoot,
    session: collectSessionProfile(projectRoot),
    git: collectGitProfile(projectRoot),
    shell: collectShellProfile(),
    file: collectFileProfile(projectRoot),
  };
}

// ── Context block formatters ─────────────────────────────────────────────────

/**
 * Generate a compact plaintext context block summarizing the behavioral profile.
 * This is what the agent sees when it calls get_context.
 */
export function formatContextBlock(profile: BehavioralProfile): string {
  const lines: string[] = [];
  const s = profile.session;
  const g = profile.git;
  const sh = profile.shell;
  const f = profile.file;

  // Session summary.
  if (s.totalSessions > 0) {
    lines.push(`Sessions: ${s.totalSessions} total, avg ${s.avgSessionLength} msgs/session.`);
    if (s.topTools.length > 0) {
      lines.push(
        `  Top tools: ${s.topTools
          .slice(0, 5)
          .map((t) => `${t.name}(${t.count}×)`)
          .join(", ")}`
      );
    }
    if (s.commonFirstActions.length > 0) {
      lines.push(`  First action: usually ${s.commonFirstActions[0]}`);
    }
    if (s.fileHotspots.length > 0) {
      lines.push(
        `  Most edited: ${s.fileHotspots
          .slice(0, 3)
          .map((h) => h.path.split("/").pop())
          .join(", ")}`
      );
    }
    if (s.workflowPatterns.length > 0) {
      lines.push(`  Workflow: ${s.workflowPatterns[0].label} (${s.workflowPatterns[0].count}×)`);
    }
  }

  // Git summary.
  if (g.totalCommits > 0) {
    lines.push(`Git: ${g.totalCommits} commits in last 30 days, ${g.branches.length} branches.`);
    if (g.fileHotspots.length > 0) {
      lines.push(
        `  Hot files: ${g.fileHotspots
          .slice(0, 3)
          .map((h) => h.file.split("/").pop())
          .join(", ")}`
      );
    }
    if (g.topMessagePatterns.length > 0) {
      lines.push(`  Commit style: ${g.topMessagePatterns.slice(0, 3).join(", ")}`);
    }
    // Peak hours.
    const peakHour = Object.entries(g.activity.hourlyCommits).sort((a, b) => b[1] - a[1])[0];
    if (peakHour) {
      lines.push(`  Peak hour: ${peakHour[0]}:00 (${peakHour[1]} commits)`);
    }
  }

  // Shell summary.
  if (sh.totalCommands > 0) {
    lines.push(
      `Shell: ${sh.totalCommands} commands, ${sh.distinctCommands} distinct. Top: ${sh.topCommands
        .slice(0, 5)
        .map((c) => `${c.command}(${c.count}×)`)
        .join(", ")}.`
    );
    if (sh.commandBigrams.length > 0) {
      lines.push(`  Common sequence: ${sh.commandBigrams[0].sequence} (${sh.commandBigrams[0].count}×)`);
    }
  }

  // File summary.
  if (f.totalFiles > 0) {
    const topLangs = Object.entries(f.languages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    lines.push(
      `Files: ${f.totalFiles} files, ${f.totalSizeMB}MB. Languages: ${topLangs.map(([l, c]) => `${l}(${c})`).join(", ")}.`
    );
    if (f.recentFiles.length > 0) {
      lines.push(
        `  Recent: ${f.recentFiles
          .slice(0, 3)
          .map((r) => r.path.split("/").pop())
          .join(", ")}`
      );
    }
  }

  return lines.length > 0 ? lines.join("\n") : "No behavioral data available yet.";
}

/**
 * Generate a detailed JSON profile for programmatic analysis.
 */
export function formatProfileJson(profile: BehavioralProfile): string {
  return JSON.stringify(profile, null, 2);
}

// ── SOP-oriented block (specs/sop-extraction P2.2 enhancement) ───────────────

/** Workflow-shaped slice of the collectors (what get_workflows exposes). */
export interface SopContextSources {
  session: SessionProfile;
  shell: ShellProfile;
  git: GitProfile;
}

export function collectSopContextSources(projectRoot: string): SopContextSources {
  return {
    session: collectSessionProfile(projectRoot),
    shell: collectShellProfile(),
    git: collectGitProfile(projectRoot),
  };
}

/**
 * SOP-oriented context block: the procedure-shaped view of the same collector
 * data — recurring tool-call sequences, command bigrams, session openings and
 * commit rhythm (vs formatContextBlock's "how this user works" persona view).
 * memory.distill's behaviorProfile slot prefers this when the host provides
 * it. Returns null when no workflow-shaped data exists (caller falls back to
 * the profile block).
 */
export function formatSopContextBlock(sources: SopContextSources): string | null {
  const lines: string[] = [];
  const s = sources.session;
  if (s.totalSessions > 0) {
    if (s.workflowPatterns.length > 0) {
      lines.push("Recurring tool sequences:");
      for (const w of s.workflowPatterns.slice(0, 5)) lines.push(`  ${w.label} (${w.count}×)`);
    }
    if (s.commonFirstActions.length > 0) {
      lines.push(`Sessions usually open with: ${s.commonFirstActions.slice(0, 3).join("; ")}`);
    }
    if (s.topTools.length > 0) {
      lines.push(
        `Tool cadence: ${s.topTools
          .slice(0, 6)
          .map((t) => `${t.name}(${t.count}×)`)
          .join(", ")}`
      );
    }
  }
  const sh = sources.shell;
  if (sh.totalCommands > 0 && sh.commandBigrams.length > 0) {
    lines.push("Command sequences:");
    for (const b of sh.commandBigrams.slice(0, 5)) lines.push(`  ${b.sequence} (${b.count}×)`);
  }
  const g = sources.git;
  if (g.totalCommits > 0) {
    const peaks = Object.entries(g.activity.hourlyCommits)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([h, c]) => `${h}:00 (${c})`)
      .join(", ");
    if (peaks) lines.push(`Commit rhythm: ${g.totalCommits} commits/30d, peaks ${peaks}`);
    if (g.topMessagePatterns.length > 0) {
      lines.push(`Commit style: ${g.topMessagePatterns.slice(0, 3).join(", ")}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}
