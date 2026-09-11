// Vendor VoltAgent/awesome-design-md (https://github.com/VoltAgent/awesome-design-md)
// into the desktop app — the DESIGN.md collection (Google Stitch format, MIT).
//
// Pin discipline: upstream has NO tags and NO releases (checked 2026-09-11 via
// the GitHub API), so the pin is a commit SHA — the same "pin + review on bump"
// shape vendor-archify.js uses for its tag, only with no tag to use. The pinned
// commit's `design-md/<name>/DESIGN.md` files are copied to
// packages/desktop/vendor/design-md/<name>/DESIGN.md. preview.html files are NOT
// vendored — core only reads the markdown (install-size discipline).
//
// The pin earns its keep because this text is injected into an agent prompt as
// the authoritative design system (core actions/design.ts): an unpinned moving
// branch would change agent instructions with no review. Bumping is deliberate:
//   DESIGN_MD_REF=origin/main node scripts/vendor-design-md.js --force   # preview
//   … review the diff under packages/desktop/vendor/design-md …
//   then update PINNED_SHA below and re-run without the env override.
//
// Upstream symlinks are refused: a DESIGN.md committed as a symlink would be
// materialized as a symlink, and the reader follows symlinks — that is a
// local-file exfiltration path (env files, keys) into the design prompt and the
// catalog IPC. Only regular-file git modes are copied.
//
// A persistent clone lives in vendor-src/awesome-design-md (gitignored);
// files are re-copied only when the resolved commit differs from
// .vendored-head (--force to recopy). On network/git failure the existing
// vendored copy keeps working (best-effort doctrine shared by every vendor).
//
// Usage:
//   node scripts/vendor-design-md.js            # install/refresh (no-op when pinned)
//   node scripts/vendor-design-md.js --force    # force recopy
//
// Env overrides:
//   DESIGN_MD_REF  (default: the pinned SHA; any ref for a one-off preview)

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withAtomicSwap } from "./vendor-fs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const cloneDir = join(repoRoot, "vendor-src", "awesome-design-md");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "design-md");
const headFile = join(targetDir, ".vendored-head");
const force = process.argv.includes("--force");

const REPO_URL = "https://github.com/VoltAgent/awesome-design-md.git";
/** Reviewed upstream commit — bump deliberately (see header). Upstream has no tags. */
const PINNED_SHA = "8147538b4226ae41e2487a9179e3bcc1f68e8554";
/** `design-md/<name>/DESIGN.md` with exactly one segment — no nesting, no root-level file. */
const ENTRY_RE = /^design-md\/([^/]+)\/DESIGN\.md$/;
/** Modes we materialize: regular files only. 120000 = symlink, 160000 = gitlink. */
const REGULAR_FILE_MODES = new Set(["100644", "100755"]);

function log(message) {
  console.log(`[vendor-design-md] ${message}`);
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function currentPinnedHead() {
  try {
    return readFileSync(headFile, "utf8").trim();
  } catch {
    return null;
  }
}

/** `git ls-tree -r` → `{ mode, path }` for every entry that could hold a DESIGN.md. */
function listDesignMdEntries() {
  return runGit(["-C", cloneDir, "ls-tree", "-r", "HEAD", "design-md/"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [meta, entryPath] = line.split("\t");
      if (!meta || !entryPath) return null;
      const [mode] = meta.split(/\s+/);
      return { mode, path: entryPath };
    })
    .filter((entry) => entry !== null && entry.path.endsWith("/DESIGN.md"));
}

async function main() {
  const requestedRef = process.env.DESIGN_MD_REF || PINNED_SHA;
  mkdirSync(join(repoRoot, "vendor-src"), { recursive: true });

  if (!existsSync(join(cloneDir, ".git"))) {
    log(`cloning ${REPO_URL} (blobless)…`);
    runGit(["clone", "--filter=blob:none", REPO_URL, cloneDir]);
  }

  log(`fetching + checking out ${requestedRef}…`);
  runGit(["-C", cloneDir, "fetch", "--force", "origin"]);
  const head = runGit(["-C", cloneDir, "rev-parse", requestedRef]).trim();
  runGit(["-C", cloneDir, "checkout", "--force", head]);

  if (!force && currentPinnedHead() === head) {
    log(`already vendored @ ${head.slice(0, 10)} — up to date (use --force to recopy)`);
    return;
  }

  const systems = new Map();
  for (const entry of listDesignMdEntries()) {
    const match = ENTRY_RE.exec(entry.path);
    if (!match) {
      log(`skipping unexpected upstream layout: ${entry.path}`);
      continue;
    }
    if (!REGULAR_FILE_MODES.has(entry.mode)) {
      throw new Error(`refusing git mode ${entry.mode} at ${entry.path} — only regular files are vendored`);
    }
    systems.set(match[1], entry.path);
  }
  if (systems.size === 0) {
    throw new Error("no design-md/<name>/DESIGN.md entries found in upstream tree");
  }

  // 只取 DESIGN.md（preview.html 不进包——core 只读 markdown，安装体积纪律）。
  await withAtomicSwap(targetDir, {
    build: (staging) => {
      for (const [name, entryPath] of systems) {
        const dest = join(staging, name);
        mkdirSync(dest, { recursive: true });
        cpSync(join(cloneDir, entryPath), join(dest, "DESIGN.md"));
      }
      writeFileSync(join(staging, ".vendored-head"), head, "utf8");
    },
    log,
  });
  log(`vendored ${systems.size} design systems @ ${head.slice(0, 10)}`);
}

try {
  await main();
} catch (error) {
  if (currentPinnedHead()) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`vendor refresh failed (${reason}) — keeping existing vendored copy`);
  } else {
    throw error;
  }
}
