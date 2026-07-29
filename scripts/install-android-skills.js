/**
 * scripts/install-android-skills.js
 *
 * 构建时从 android/skills 源仓库拉取最新的 Agent Skills，
 * 内置到 packages/core/templates/skills/bundled/ 中随引擎发布。
 *
 * 每次构建重新拉取，确保始终为最新版本。不依赖远程插件中心。
 *
 * 最佳努力：如果 clone 失败（网络问题等），仅打印警告并以 exit 0 退出，
 * 不阻断构建流程。
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const bundledDir = join(root, "packages", "core", "templates", "skills", "bundled");

const REPO_URL = "https://github.com/android/skills.git";
const CLONE_DIR = join(tmpdir(), "orca-android-skills");

const NAME_PREFIX = "android-";

// Skills to exclude (too generic or not useful for Orca context)
const EXCLUDE_SKILLS = new Set([]);

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "pipe", ...opts });
}

/**
 * 在源目录中递归查找包含 SKILL.md 的技能目录。
 * 兼容仓库根目录直接存放技能，或放在 skills/、SKILLS/ 等子目录中的情况。
 */
function findSkillDirs(cloneRoot) {
  // 1. 尝试常见的 skills 子目录
  const candidates = ["skills", "SKILLS", "skill", "docs/skills"];
  for (const c of candidates) {
    const dir = join(cloneRoot, c);
    if (existsSync(dir)) {
      const found = listSkillDirsIn(dir);
      if (found.length > 0) return found;
    }
  }

  // 2. 仓库根目录直接存放技能目录
  const rootLevel = listSkillDirsIn(cloneRoot);
  if (rootLevel.length > 0) return rootLevel;

  return [];
}

function listSkillDirsIn(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillMd = join(dir, entry.name, "SKILL.md");
    if (existsSync(skillMd)) {
      out.push({ name: entry.name, path: join(dir, entry.name) });
    }
  }
  return out;
}

function main() {
  console.log("\n📦 Installing android/skills skills...\n");

  // 1. Clean previous clone
  if (existsSync(CLONE_DIR)) {
    rmSync(CLONE_DIR, { recursive: true, force: true });
  }

  // 2. Shallow clone
  try {
    run(`git clone --depth 1 --single-branch ${REPO_URL} "${CLONE_DIR}"`);
  } catch (err) {
    console.warn("⚠️  Failed to clone android/skills — skipping (network issue?)");
    console.warn(`   ${err.message?.split("\n")[0] ?? err}`);
    process.exit(0);
  }

  // 3. Locate skill directories (each containing SKILL.md)
  const skills = findSkillDirs(CLONE_DIR);
  if (skills.length === 0) {
    console.warn("⚠️  android/skills: no skill directories (with SKILL.md) found — skipping");
    rmSync(CLONE_DIR, { recursive: true, force: true });
    process.exit(0);
  }

  // 4. Ensure bundled dir exists
  mkdirSync(bundledDir, { recursive: true });

  // 5. Remove previously installed android- skills from this repo
  const existing = readdirSync(bundledDir, { withFileTypes: true });
  for (const entry of existing) {
    if (entry.isDirectory() && entry.name.startsWith(NAME_PREFIX)) {
      rmSync(join(bundledDir, entry.name), { recursive: true, force: true });
    }
  }

  // 6. Copy each skill with prefix
  let count = 0;
  for (const skill of skills) {
    if (EXCLUDE_SKILLS.has(skill.name)) continue;

    const prefixedName = skill.name.startsWith(NAME_PREFIX) ? skill.name : `${NAME_PREFIX}${skill.name}`;
    const dest = join(bundledDir, prefixedName);
    cpSync(skill.path, dest, { recursive: true, dereference: true });
    console.log(`   + ${prefixedName}`);
    count++;
  }

  console.log(`✅  Installed ${count} android/skills → bundled/`);

  // 7. Cleanup
  rmSync(CLONE_DIR, { recursive: true, force: true });
  console.log("");
}

try {
  main();
} catch (err) {
  console.warn("⚠️  install-android-skills: unexpected error — skipping");
  console.warn(`   ${err?.message?.split("\n")[0] ?? err}`);
  process.exit(0);
}
