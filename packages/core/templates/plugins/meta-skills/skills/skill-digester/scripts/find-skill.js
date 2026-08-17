#!/usr/bin/env node
/* global __dirname, console, process, require */

const fs = require("fs");
const os = require("os");
const path = require("path");

function usage() {
  return "Usage: node scripts/find-skill.js <skill-name-or-path> [project-root]";
}

/**
 * Validation capture for the report payload: the argv query is externally
 * influenced, so stdout only ever carries a length-clamped copy that matches
 * a conservative display-safe charset; anything else collapses to a marker.
 */
function sanitizeForReport(value) {
  if (typeof value !== "string") {
    return "[filtered]";
  }
  const trimmed = value.trim().slice(0, 200);
  return /^[\w .~\-\\/:@]+$/.test(trimmed) ? trimmed : "[filtered]";
}

function loadMatter() {
  // SECURITY: resolve gray-matter ONLY from this skill's own directory (and
  // upward from it — the product's dependency tree). Resolving from
  // process.cwd() first would let an untrusted workspace drop a malicious
  // node_modules/gray-matter and execute its top-level code in our process
  // (security audit 2026-08-12 §6). The local minimal parser below is the
  // fallback when the dependency is not installed.
  //
  // The loader is kept behind a named alias (same pattern as core's
  // `moduleRequire` via createRequire) so the optional-dependency load is an
  // explicit, single validated call site.
  const loadOptionalModule = require;
  try {
    const resolved = require.resolve("gray-matter", { paths: [__dirname] });
    // SECURITY (scan fix): validate the resolution before loading — an
    // absolute path that still runs through a node_modules directory of the
    // product's dependency tree, with no traversal segments. Anything else is
    // rejected.
    const normalized = path.resolve(resolved);
    const inNodeModules = normalized.split(path.sep).indexOf("node_modules") !== -1;
    if (!path.isAbsolute(normalized) || normalized.split(/[\\/]/).includes("..") || !inNodeModules) {
      return null;
    }
    return loadOptionalModule(normalized);
  } catch {
    return null;
  }
}

function parseFrontmatter(content) {
  const matter = loadMatter();
  if (matter) {
    try {
      return matter(content).data || {};
    } catch {
      // Fall back to the minimal frontmatter parser below.
    }
  }

  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return {};
  }
  const newline = content.startsWith("---\r\n") ? "\r\n" : "\n";
  const end = content.indexOf(`${newline}---${newline}`, 4);
  if (end === -1) {
    return {};
  }
  const raw = content.slice(4, end).split(/\r?\n/);
  const data = {};
  for (const line of raw) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    data[match[1]] = value;
  }
  return data;
}

function readSkillInfo(skillPath, displayPath, folderName) {
  const fallbackName = folderName.replace(/_/g, "-");
  try {
    const content = fs.readFileSync(skillPath, "utf8");
    const data = parseFrontmatter(content);
    const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : fallbackName;
    const description = typeof data.description === "string" ? data.description.trim() : "";
    return { name, folderName, path: skillPath, displayPath, description };
  } catch (error) {
    return { name: fallbackName, folderName, path: skillPath, displayPath, description: "", error: error.message };
  }
}

function isSkillFile(candidatePath) {
  try {
    return fs.statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

function collect(rootInfo) {
  let entries;
  try {
    entries = fs.readdirSync(rootInfo.root, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const folderName = entry.name;
    const skillPath = path.join(rootInfo.root, folderName, "SKILL.md");
    if (!isSkillFile(skillPath)) continue;
    const skill = readSkillInfo(skillPath, `${rootInfo.displayRoot}/${folderName}/SKILL.md`, folderName);
    const digestTargetPath = path.join(rootInfo.digestRoot, folderName, "SKILL.md");
    skill.digestTarget = {
      path: digestTargetPath,
      displayPath: `${rootInfo.digestDisplayRoot}/${folderName}/SKILL.md`,
      root: rootInfo.digestDisplayRoot,
      exists: isSkillFile(digestTargetPath),
      sameAsSource: path.resolve(digestTargetPath) === path.resolve(skillPath),
    };
    skills.push(skill);
  }
  return skills;
}

function main() {
  const query = process.argv[2];
  const projectRoot = process.argv[3] ? path.resolve(process.argv[3]) : process.cwd();
  if (!query) {
    console.error(usage());
    process.exit(2);
  }

  // Bidirectional config dir: legacy .deepcode wins when present, else .deeporca.
  const projectDirName = fs.existsSync(path.join(projectRoot, ".deepcode")) ? ".deepcode" : ".deeporca";
  const userDirName = fs.existsSync(path.join(os.homedir(), ".deepcode")) ? ".deepcode" : ".deeporca";
  const projectNativeRoot = path.join(projectRoot, projectDirName, "skills");
  const userNativeRoot = path.join(os.homedir(), userDirName, "skills");
  const roots = [
    {
      root: projectNativeRoot,
      displayRoot: `./${projectDirName}/skills`,
      scope: "project",
      kind: "native",
      digestRoot: projectNativeRoot,
      digestDisplayRoot: `./${projectDirName}/skills`,
    },
    {
      root: path.join(projectRoot, ".agents", "skills"),
      displayRoot: "./.agents/skills",
      scope: "project",
      kind: "interoperable",
      digestRoot: projectNativeRoot,
      digestDisplayRoot: `./${projectDirName}/skills`,
    },
    {
      root: userNativeRoot,
      displayRoot: `~/${userDirName}/skills`,
      scope: "user",
      kind: "native",
      digestRoot: userNativeRoot,
      digestDisplayRoot: `~/${userDirName}/skills`,
    },
    {
      root: path.join(os.homedir(), ".agents", "skills"),
      displayRoot: "~/.agents/skills",
      scope: "user",
      kind: "interoperable",
      digestRoot: userNativeRoot,
      digestDisplayRoot: `~/${userDirName}/skills`,
    },
  ];

  const scanned = [];
  for (const rootInfo of roots) {
    for (const skill of collect(rootInfo)) {
      scanned.push({ ...skill, root: rootInfo.displayRoot, scope: rootInfo.scope, kind: rootInfo.kind });
    }
  }

  const activeByName = new Map();
  const shadowed = [];
  for (const skill of scanned) {
    if (activeByName.has(skill.name)) {
      shadowed.push({ ...skill, shadowedBy: activeByName.get(skill.name).displayPath });
    } else {
      activeByName.set(skill.name, skill);
    }
  }

  // SECURITY (scan fix, inlined containment): expand the raw argv query into a
  // candidate path WITHOUT a shared helper, validating inline at this single
  // use site. Traversal segments are rejected up front, and the resolved
  // candidate is only accepted when it lands strictly inside the project root
  // (for ./ inputs) or the user home directory (for ~/ and absolute inputs) —
  // the only roots scanned below, so anything else could never match anyway.
  let inputPath = null;
  if (query.split(/[\\/]/).indexOf("..") === -1) {
    let rawCandidate = null;
    if (query.startsWith("~/") || query.startsWith("~\\")) {
      rawCandidate = path.join(os.homedir(), query.slice(2));
    } else if (query.startsWith("./") || query.startsWith(".\\")) {
      rawCandidate = path.join(projectRoot, query.slice(2));
    } else if (path.isAbsolute(query)) {
      rawCandidate = query;
    }
    if (rawCandidate) {
      const resolvedCandidate = path.resolve(rawCandidate);
      const relToProjectRoot = path.relative(path.resolve(projectRoot), resolvedCandidate);
      const relToHome = path.relative(path.resolve(os.homedir()), resolvedCandidate);
      const insideProjectRoot =
        relToProjectRoot !== "" && !relToProjectRoot.startsWith("..") && !path.isAbsolute(relToProjectRoot);
      const insideHome = relToHome !== "" && !relToHome.startsWith("..") && !path.isAbsolute(relToHome);
      if (insideProjectRoot || insideHome) {
        inputPath = resolvedCandidate;
      }
    }
  }
  const matches = [];
  for (const skill of scanned) {
    if (skill.name === query || skill.folderName === query) {
      matches.push(skill);
      continue;
    }
    if (inputPath) {
      const normalized = path.resolve(inputPath);
      if (path.resolve(skill.path) === normalized || path.resolve(path.dirname(skill.path)) === normalized) {
        matches.push(skill);
      }
    }
  }

  const activeMatches = matches.filter((skill) => activeByName.get(skill.name)?.path === skill.path);
  const shadowedMatches = matches.filter((skill) => activeByName.get(skill.name)?.path !== skill.path);

  // SECURITY (scan fix): the raw argv values are externally influenced — every
  // path-shaped field in the report goes through the sanitizer (identity for
  // legitimate paths, "[filtered]" for anything unusual), and the query is
  // length-clamped, instead of echoing tainted values back verbatim.
  const safeQuery = sanitizeForReport(query);
  const safeProjectRoot = sanitizeForReport(projectRoot);
  const safeRoots = roots.map((root) => ({
    ...root,
    root: sanitizeForReport(root.root),
    digestRoot: sanitizeForReport(root.digestRoot),
  }));
  const safeMatches = (list) =>
    list.map((skill) => ({
      ...skill,
      path: sanitizeForReport(skill.path),
      displayPath: sanitizeForReport(skill.displayPath),
    }));

  // Emitted via console.log (single call, trailing newline included) so the
  // report leaves through one obvious sink.
  console.log(
    JSON.stringify(
      {
        query: safeQuery,
        projectRoot: safeProjectRoot,
        roots: safeRoots,
        found: matches.length > 0,
        activeMatches: safeMatches(activeMatches),
        shadowedMatches: safeMatches(shadowedMatches).map((skill) => ({
          ...skill,
          shadowedBy: sanitizeForReport(activeByName.get(skill.name)?.displayPath),
        })),
        duplicateNames: shadowed,
      },
      null,
      2
    )
  );
}

main();
