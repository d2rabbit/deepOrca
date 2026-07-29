/**
 * scripts/install-rn-skills.js
 *
 * 构建时拉取 React Native / Expo 生态的 Agent Skills，合并内置到
 * packages/core/templates/skills/bundled/ 中随引擎发布。
 *
 * 数据源（两个仓库）：
 *   - https://github.com/expo/skills.git        → expo-* 前缀
 *   - https://github.com/callstack/agent-skills.git → react-native-* 前缀
 *
 * 每次构建重新拉取，确保始终为最新版本。不依赖远程插件中心。
 *
 * 最佳努力：如果某个仓库 clone 失败（网络问题等），仅打印警告并继续处理
 * 其它仓库；任何情况下都不阻断构建流程（exit 0）。
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const bundledDir = join(root, "packages", "core", "templates", "skills", "bundled");

const SOURCES = [
  {
    name: "expo/skills",
    repoUrl: "https://github.com/expo/skills.git",
    cloneDir: join(tmpdir(), "orca-expo-skills"),
    prefix: "expo-",
    exclude: new Set([]),
  },
  {
    name: "callstack/agent-skills",
    repoUrl: "https://github.com/callstack/agent-skills.git",
    cloneDir: join(tmpdir(), "orca-callstack-agent-skills"),
    prefix: "react-native-",
    exclude: new Set([]),
  },
];

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "pipe", ...opts });
}

/**
 * 在源目录中查找包含 SKILL.md 的技能目录。
 * 依次尝试 skills/、SKILLS/、skill/、docs/skills/ 以及仓库根目录。
 */
function findSkillDirs(cloneRoot) {
  const candidates = ["skills", "SKILLS", "skill", "docs/skills", "docs/skill"];
  for (const c of candidates) {
    const dir = join(cloneRoot, c);
    if (existsSync(dir)) {
      const found = listSkillDirsIn(dir);
      if (found.length > 0) {
        console.log(`   found skills directory: ${c}/`);
        return found;
      }
    }
  }

  const rootLevel = listSkillDirsIn(cloneRoot);
  if (rootLevel.length > 0) {
    console.log("   found skills at repository root");
    return rootLevel;
  }

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

/**
 * 处理单个仓库：clone、定位 skills、按前缀拷贝到 bundledDir。
 * 返回成功安装的技能数量。
 */
function processSource(src) {
  console.log(`\n📦 Installing ${src.name} skills...`);

  // 1. Clean previous clone
  if (existsSync(src.cloneDir)) {
    rmSync(src.cloneDir, { recursive: true, force: true });
  }

  // 2. Shallow clone
  try {
    run(`git clone --depth 1 --single-branch ${src.repoUrl} "${src.cloneDir}"`);
  } catch (err) {
    console.warn(`⚠️  Failed to clone ${src.name} — skipping (network issue?)`);
    console.warn(`   ${err.message?.split("\n")[0] ?? err}`);
    return 0;
  }

  // 3. Locate skill directories (each containing SKILL.md)
  const skills = findSkillDirs(src.cloneDir);
  if (skills.length === 0) {
    console.warn(`⚠️  ${src.name}: no skill directories (with SKILL.md) found — skipping`);
    rmSync(src.cloneDir, { recursive: true, force: true });
    return 0;
  }

  // 4. Copy each skill with prefix
  let count = 0;
  for (const skill of skills) {
    if (src.exclude.has(skill.name)) continue;

    const prefixedName = skill.name.startsWith(src.prefix) ? skill.name : `${src.prefix}${skill.name}`;
    const dest = join(bundledDir, prefixedName);
    cpSync(skill.path, dest, { recursive: true, dereference: true });
    console.log(`   + ${prefixedName}`);
    count++;
  }

  console.log(`✅  Installed ${count} ${src.name} skills → bundled/`);

  // 5. Cleanup this clone
  rmSync(src.cloneDir, { recursive: true, force: true });
  return count;
}

function main() {
  console.log("\n📦 Installing React Native / Expo skills...\n");

  // Ensure bundled dir exists
  mkdirSync(bundledDir, { recursive: true });

  // Remove previously installed rn-related skills from these repos
  const prefixes = SOURCES.map((s) => s.prefix);
  const existing = readdirSync(bundledDir, { withFileTypes: true });
  for (const entry of existing) {
    if (!entry.isDirectory()) continue;
    if (prefixes.some((p) => entry.name.startsWith(p))) {
      rmSync(join(bundledDir, entry.name), { recursive: true, force: true });
    }
  }

  let total = 0;
  for (const src of SOURCES) {
    try {
      total += processSource(src);
    } catch (err) {
      console.warn(`⚠️  ${src.name}: unexpected error — skipping`);
      console.warn(`   ${err?.message?.split("\n")[0] ?? err}`);
      // best-effort cleanup
      if (existsSync(src.cloneDir)) {
        rmSync(src.cloneDir, { recursive: true, force: true });
      }
    }
  }

  console.log(`\n✅  Total RN/Expo skills installed: ${total}\n`);
}

try {
  main();
} catch (err) {
  console.warn("⚠️  install-rn-skills: unexpected error — skipping");
  console.warn(`   ${err?.message?.split("\n")[0] ?? err}`);
  process.exit(0);
}
