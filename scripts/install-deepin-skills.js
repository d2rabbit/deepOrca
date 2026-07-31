// Vendor Deepin Skills (https://github.com/linuxdeepin/deepin-skills) into bundled skills.
// 4 skills under skills/<name>/SKILL.md. License: LGPL-3.0-or-later. Default branch: master.
import { execSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const bundledDir = join(root, "packages", "core", "templates", "skills", "bundled");
const REPO_URL = "https://github.com/linuxdeepin/deepin-skills.git";
const REF = "master";
const CLONE_DIR = join(tmpdir(), "orca-deepin-skills");

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "pipe", ...opts });
}

function main() {
  console.log("\n📦 Installing linuxdeepin/deepin-skills...\n");
  if (existsSync(CLONE_DIR)) rmSync(CLONE_DIR, { recursive: true, force: true });
  try {
    run(`git clone --depth 1 --branch ${REF} ${REPO_URL} "${CLONE_DIR}"`);
  } catch {
    console.warn("  ⚠ Failed to clone — skipping.");
    process.exit(0);
  }
  for (const d of readdirSync(bundledDir)) {
    if (d.startsWith("deepin-") || d.startsWith("dde-") || d.startsWith("dtk-")) {
      rmSync(join(bundledDir, d), { recursive: true, force: true });
    }
  }
  const skillsDir = join(CLONE_DIR, "skills");
  if (!existsSync(skillsDir)) {
    console.warn("  ⚠ No skills/ dir — skipping.");
    process.exit(0);
  }
  let count = 0;
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillDir = join(skillsDir, entry.name);
    if (existsSync(join(skillDir, "SKILL.md"))) {
      const dest = join(bundledDir, `deepin-${entry.name}`);
      cpSync(skillDir, dest, { recursive: true });
      // Preserve LGPL license notice alongside the skill.
      const licenseSrc = join(CLONE_DIR, "LICENSE");
      if (existsSync(licenseSrc)) cpSync(licenseSrc, join(dest, "LICENSE.deepin"));
      count++;
    }
  }
  rmSync(CLONE_DIR, { recursive: true, force: true });
  console.log(`  ✅ Installed ${count} Deepin skills.`);
}
try {
  main();
} catch (e) {
  console.error("[install-deepin-skills]", e.message);
  process.exit(0);
}
