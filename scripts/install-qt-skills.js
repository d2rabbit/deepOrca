// Vendor Qt Group Agent Skills (https://github.com/TheQtCompanyRnD/agent-skills) into bundled skills.
// 12 skills under skills/<name>/SKILL.md. License: BSD-3-Clause.
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const bundledDir = join(root, "packages", "core", "templates", "skills", "bundled");
const REPO_URL = "https://github.com/TheQtCompanyRnD/agent-skills.git";
const CLONE_DIR = join(tmpdir(), "orca-qt-skills");

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "pipe", ...opts });
}

function main() {
  console.log("\n📦 Installing Qt Group agent-skills...\n");
  if (existsSync(CLONE_DIR)) rmSync(CLONE_DIR, { recursive: true, force: true });
  try {
    run(`git clone --depth 1 ${REPO_URL} "${CLONE_DIR}"`);
  } catch {
    console.warn("  ⚠ Failed to clone — skipping.");
    process.exit(0);
  }
  mkdirSync(bundledDir, { recursive: true });
  for (const d of readdirSync(bundledDir)) {
    if (d.startsWith("qt-")) rmSync(join(bundledDir, d), { recursive: true, force: true });
  }
  const skillsDir = join(CLONE_DIR, "skills");
  if (!existsSync(skillsDir)) {
    console.warn("  ⚠ No skills/ dir — skipping.");
    process.exit(0);
  }
  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (existsSync(join(full, "SKILL.md"))) {
          cpSync(full, join(bundledDir, `qt-${entry.name}`), { recursive: true, dereference: true });
          count++;
        } else {
          walk(full);
        }
      }
    }
  }
  walk(skillsDir);
  rmSync(CLONE_DIR, { recursive: true, force: true });
  console.log(`  ✅ Installed ${count} Qt skills.`);
}
try {
  main();
} catch (e) {
  console.error("[install-qt-skills]", e.message);
  process.exit(0);
}
