/**
 * Git preflight & bootstrap for the knowledge build (2026-08-28).
 *
 * The vendored wiki generator consumes commit history as its core input —
 * its update pass diffs `gitHead..HEAD`, and its init pass "reads the wiki
 * state and Git history". In a repo with an unborn HEAD (zero commits) the
 * agent gets no anchor and, in practice, writes only the bare skeleton while
 * reporting success (real-machine 2026-08-28: 37-byte index.md, exit 0 in
 * 14s). The build panel therefore preflights BEFORE building and lets the
 * user decide; bootstrap runs only on explicit confirmation.
 *
 * Dependency-free module (node:child_process only) so it stays unit-testable
 * without Electron.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { KnowledgeGitBootstrapResult, KnowledgeGitPreflight } from "../shared/ipc";

const execFileAsync = promisify(execFile);

/** One git invocation; stdout trimmed. Throws on non-zero exit. */
async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

/** execFile's Error.message is just "Command failed: git …" — the diagnostic
 *  ("nothing to commit", identity guidance) lives in stderr/stdout. */
function execFailureDetail(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { stderr?: string | Buffer; stdout?: string | Buffer; message?: string };
    const parts = [e.stderr, e.stdout, e.message]
      .filter((s): s is string | Buffer => Boolean(s))
      .map((s) => (Buffer.isBuffer(s) ? s.toString("utf8") : s).trim())
      .filter(Boolean);
    if (parts.length > 0) return parts.join("\n");
  }
  return err instanceof Error ? err.message : String(err);
}

/** One git probe; false on ANY failure (not a repo, unborn HEAD, git absent). */
async function gitOk(root: string, args: string[]): Promise<boolean> {
  try {
    await git(root, args);
    return true;
  } catch {
    return false;
  }
}

export async function gitPreflight(root: string): Promise<KnowledgeGitPreflight> {
  const isRepo = await gitOk(root, ["rev-parse", "--is-inside-work-tree"]);
  return { isRepo, hasCommits: isRepo ? await gitOk(root, ["rev-parse", "--verify", "HEAD"]) : false };
}

/**
 * Make the root buildable: `git init` (only when absent) + stage everything +
 * first commit. The commit identity falls back to `-c user.name/email` scoped
 * to THIS invocation — the user's global git config is never touched.
 */
export async function gitBootstrap(root: string): Promise<KnowledgeGitBootstrapResult> {
  try {
    const pre = await gitPreflight(root);
    if (pre.isRepo && pre.hasCommits) {
      // Server-side re-check (review round 6): the dialog gates this flow on
      // no-repo/no-commits, but a privileged renderer (or a race) can call
      // bootstrap on a committed repo — committing staged state mid-history
      // as "Initial commit" is never what the user confirmed.
      return { ok: false, error: "repository already has commits — bootstrap is only for the first commit" };
    }
    if (pre.isRepo && !pre.hasCommits) {
      // Inside a PARENT repo's worktree (sub-directory workspace): git add -A
      // + commit would snapshot the PARENT's pending changes under our
      // message (review round 6) — refuse unless root IS the worktree top.
      // Normalize both sides (macOS /var ↔ /private/var): git reports the
      // physical toplevel with symlinks resolved; an exact string compare
      // would false-refuse symlinked workspace roots (review round 7).
      const fsSync = await import("node:fs");
      const real = (p: string): string => {
        try {
          return fsSync.realpathSync(p);
        } catch {
          return p;
        }
      };
      const toplevel = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
      if (toplevel && real(toplevel) !== real(root)) {
        return {
          ok: false,
          error: `workspace is a sub-directory of ${toplevel} — refusing to commit the parent repository; run the build from the repository root`,
        };
      }
    }
    if (!pre.isRepo) {
      await git(root, ["init"]);
    }
    // Secrets hygiene on EVERY no-commit path (review round 7): retry after a
    // partial first attempt (init done, commit failed) used to skip seeding
    // and commit .env*/settings.json on the second try. Also APPEND missing
    // entries when a .gitignore already exists.
    {
      const fs = await import("node:fs");
      const giPath = (await import("node:path")).join(root, ".gitignore");
      const required = [
        ".env",
        ".env.*",
        ".deeporca/settings.json",
        "node_modules/",
        ".codegraph/",
        "openwiki/",
        "deepwiki/",
      ];
      let existing = "";
      try {
        existing = fs.readFileSync(giPath, "utf-8");
      } catch {
        // none yet
      }
      const have = new Set(existing.split("\n").map((l) => l.trim()));
      const missing = required.filter((r) => !have.has(r));
      const hasContent = fs.existsSync(root) && fs.readdirSync(root).some((f) => f !== ".gitignore" && f !== ".git");
      if (missing.length > 0 && hasContent) {
        const header =
          existing.trim().length === 0
            ? "# Seeded by DeepOrca before the first knowledge-build commit\n"
            : "\n# DeepOrca additions\n";
        fs.writeFileSync(giPath, existing + header + missing.join("\n") + "\n", "utf-8");
      }
    }
    await git(root, ["add", "-A"]);
    const message = "Initial commit (DeepOrca knowledge build)";
    try {
      await git(root, ["commit", "-m", message]);
    } catch (err) {
      const detail = execFailureDetail(err);
      if (/nothing to commit|no changes added|nothing added to commit/i.test(detail)) {
        return { ok: false, error: "nothing to commit — the workspace has no files to put under version control" };
      }
      // Most common remaining cause: no user.name/user.email configured
      // anywhere. Retry with an invocation-scoped identity (never writes
      // config): the commit is the user's explicitly confirmed action.
      await git(root, ["-c", "user.name=DeepOrca", "-c", "user.email=deeporca@local", "commit", "-m", message]);
    }
    const commit = await git(root, ["rev-parse", "--short", "HEAD"]);
    return { ok: true, commit };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
