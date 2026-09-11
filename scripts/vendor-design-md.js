// Vendor VoltAgent/awesome-design-md (https://github.com/VoltAgent/awesome-design-md)
// into the desktop app — the DESIGN.md collection (Google Stitch format, MIT).
//
// Git-based pin (same discipline as the other git vendors): a persistent clone
// lives in vendor-src/awesome-design-md (gitignored); the tracked main HEAD's
// `design-md/<name>/DESIGN.md` files are copied to
// packages/desktop/vendor/design-md/<name>/DESIGN.md only when HEAD changed
// (.vendored-head marker; --force to recopy). preview.html files are NOT
// vendored — core only reads the markdown. Docs-only collection (nothing
// executes), so tracking main + recording the exact hash in the marker is the
// pin. On network/git failure the existing vendored copy keeps working
// (best-effort doctrine shared by every vendor).
//
// Usage:
//   node scripts/vendor-design-md.js            # install/refresh (no-op when pinned)
//   node scripts/vendor-design-md.js --force    # force recopy
//
// Env overrides:
//   DESIGN_MD_REF  (default: origin/main; a commit/tag for one-off testing)

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

function main() {
  const requestedRef = process.env.DESIGN_MD_REF || "origin/main";
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

  // 只取 DESIGN.md（preview.html 不进包——core 只读 markdown，安装体积纪律）。
  const entries = runGit(["-C", cloneDir, "ls-tree", "-r", "--name-only", "HEAD", "design-md/"])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith("/DESIGN.md"));
  if (entries.length === 0) {
    throw new Error("no design-md/*/DESIGN.md entries found in upstream tree");
  }

  withAtomicSwap(targetDir, {
    build: (staging) => {
      for (const entry of entries) {
        const name = entry.slice("design-md/".length, -"/DESIGN.md".length);
        const dest = join(staging, name);
        mkdirSync(dest, { recursive: true });
        cpSync(join(cloneDir, entry), join(dest, "DESIGN.md"));
      }
      writeFileSync(join(staging, ".vendored-head"), head, "utf8");
    },
    log,
  });
  log(`vendored ${entries.length} design systems @ ${head.slice(0, 10)}`);
}

try {
  main();
} catch (error) {
  if (currentPinnedHead()) {
    log(`vendor refresh failed (${error.message}) — keeping existing vendored copy`);
  } else {
    throw error;
  }
}
