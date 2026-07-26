/**
 * scripts/install-flutter-skills.js
 *
 * 构建时从 flutter/agent-plugins 源仓库拉取最新的 Agent Skills，
 * 内置到 packages/core/templates/skills/bundled/ 中随引擎发布。
 *
 * 每次构建重新拉取，确保始终为最新版本。不依赖远程插件中心。
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const bundledDir = join(root, "packages", "core", "templates", "skills", "bundled");

const REPO_URL = "https://github.com/flutter/agent-plugins.git";
const CLONE_DIR = join(tmpdir(), "orca-flutter-agent-plugins");

// Skills to exclude (too generic or not useful for Orca context)
const EXCLUDE_SKILLS = new Set([]);

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "pipe", ...opts });
}

function main() {
  console.log("\n📦 Installing flutter/agent-plugins skills...\n");

  // 1. Clean previous clone
  if (existsSync(CLONE_DIR)) {
    rmSync(CLONE_DIR, { recursive: true, force: true });
  }

  // 2. Shallow clone
  try {
    run(`git clone --depth 1 --single-branch ${REPO_URL} "${CLONE_DIR}"`);
  } catch (err) {
    console.warn("⚠️  Failed to clone flutter/agent-plugins — skipping (network issue?)");
    console.warn(`   ${err.message?.split("\n")[0] ?? err}`);
    return;
  }

  // 3. Locate skills directory
  const skillsSrc = join(CLONE_DIR, "skills");
  if (!existsSync(skillsSrc)) {
    console.warn("⚠️  flutter/agent-plugins: skills/ directory not found — skipping");
    rmSync(CLONE_DIR, { recursive: true, force: true });
    return;
  }

  // 4. Ensure bundled dir exists
  mkdirSync(bundledDir, { recursive: true });

  // 5. Remove previously installed flutter/dart skills (from agent-plugins repo)
  const existing = readdirSync(bundledDir, { withFileTypes: true });
  for (const entry of existing) {
    if (entry.isDirectory() && (entry.name.startsWith("flutter-") || entry.name.startsWith("dart-"))) {
      rmSync(join(bundledDir, entry.name), { recursive: true, force: true });
    }
  }
  // Also remove previous mcp config
  const prevMcp = join(bundledDir, "flutter-mcp-config.json");
  if (existsSync(prevMcp)) rmSync(prevMcp);

  // 6. Copy each skill
  const skills = readdirSync(skillsSrc, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && !EXCLUDE_SKILLS.has(e.name)
  );

  let count = 0;
  for (const skill of skills) {
    const src = join(skillsSrc, skill.name);
    const dest = join(bundledDir, skill.name);
    cpSync(src, dest, { recursive: true, dereference: true });
    count++;
  }

  console.log(`✅  Installed ${count} flutter/agent-plugins skills → bundled/`);

  // 7. Also copy .mcp.json if present (for Dart/Flutter MCP config reference)
  const mcpJson = join(CLONE_DIR, ".mcp.json");
  if (existsSync(mcpJson)) {
    const mcpDest = join(bundledDir, "flutter-mcp-config.json");
    cpSync(mcpJson, mcpDest);
    console.log("✅  Copied .mcp.json → flutter-mcp-config.json");
  }

  // 8. Cleanup
  rmSync(CLONE_DIR, { recursive: true, force: true });
  console.log("");
}

main();
