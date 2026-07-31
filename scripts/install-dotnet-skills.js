// Vendor .NET Skills (https://github.com/dotnet/skills) into bundled skills.
// dotnet/skills has 16 plugin directories, each with a skills/ subdir containing SKILL.md.
// We flatten: plugins/<plugin>/skills/<skill>/SKILL.md → bundled/dotnet-<plugin>-<skill>/SKILL.md
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const bundledDir = join(root, "packages", "core", "templates", "skills", "bundled");
const REPO_URL = "https://github.com/dotnet/skills.git";
const CLONE_DIR = join(tmpdir(), "orca-dotnet-skills");

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "pipe", ...opts });
}

function main() {
  console.log("\n📦 Installing dotnet/skills...\n");
  if (existsSync(CLONE_DIR)) rmSync(CLONE_DIR, { recursive: true, force: true });
  try {
    run(`git clone --depth 1 ${REPO_URL} "${CLONE_DIR}"`);
  } catch (e) {
    console.warn("  ⚠ Failed to clone dotnet/skills — skipping.");
    process.exit(0);
  }
  // Remove old dotnet-* skills
  for (const d of readdirSync(bundledDir)) {
    if (d.startsWith("dotnet-")) rmSync(join(bundledDir, d), { recursive: true, force: true });
  }
  // Find all SKILL.md recursively under plugins/
  const pluginsDir = join(CLONE_DIR, "plugins");
  if (!existsSync(pluginsDir)) {
    console.warn("  ⚠ No plugins/ dir — skipping.");
    process.exit(0);
  }
  let count = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (existsSync(join(full, "SKILL.md"))) {
          const name = entry.name;
          const dest = join(bundledDir, `dotnet-${name}`);
          cpSync(full, dest, { recursive: true });
          count++;
        } else {
          walk(full);
        }
      }
    }
  }
  walk(pluginsDir);
  rmSync(CLONE_DIR, { recursive: true, force: true });
  console.log(`  ✅ Installed ${count} .NET skills.`);
}
try {
  main();
} catch (e) {
  console.error("[install-dotnet-skills]", e.message);
  process.exit(0);
}
