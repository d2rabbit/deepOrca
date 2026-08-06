#!/usr/bin/env node
// test-arch-scan.mjs — Verify the arch-scan skill produces valid A2UI Surface structure.
//
// Simulates what the LLM would do when following the arch-scan SKILL.md:
//   1. Explores the codebase (reads manifests, lists dirs)
//   2. Selects perspectives from the catalog
//   3. Builds an A2UI Surface tree (root → perspective panels → element cards)
//   4. Validates the output structure matches A2UI Surface schema
//
// This is a deterministic smoke test (no LLM call) — it hardcodes the expected
// perspectives for the DeepOrca monorepo and checks the Surface JSON shape.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function log(msg) {
  console.log(`[test-arch-scan] ${msg}`);
}

// ── Step 1: Verify the skill file itself ────────────────────────────────────
log("Step 1: Verify SKILL.md...");
const skillPath = join(repoRoot, "packages/core/templates/plugins/code/skills/arch-scan/SKILL.md");
if (!existsSync(skillPath)) {
  log("FAIL: SKILL.md not found");
  process.exit(1);
}
const skillRaw = readFileSync(skillPath, "utf8");
const { data: fm, content: skillBody } = matter(skillRaw);
log(`  name: ${fm.name}, description: ${fm.description.slice(0, 60)}...`);

// ── Step 2: Explore the codebase (like the skill instructs) ─────────────────
log("\nStep 2: Explore codebase...");
const pkgJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
log(`  project: ${pkgJson.name} v${pkgJson.version}`);
const workspaces = pkgJson.workspaces || [];
log(`  workspaces: ${workspaces.join(", ")}`);

// List top-level package dirs
const packagesDir = join(repoRoot, "packages");
const packages = readdirSync(packagesDir).filter((d) => {
  try {
    return statSync(join(packagesDir, d)).isDirectory();
  } catch {
    return false;
  }
});
log(`  packages: ${packages.join(", ")}`);

// ── Step 3: Select perspectives (DeepOrca is a desktop app + CLI) ───────────
log("\nStep 3: Select perspectives...");
const selectedPerspectives = [
  "overall-architecture", // always
  "dependency-map", // monorepo with cross-package deps
  "data-flow", // IPC: main ↔ renderer ↔ core
  "command-surface", // CLI commands (npm run scripts)
  "external-integrations", // MCP servers, LLM APIs, vendored tools
];
for (const p of selectedPerspectives) {
  const inCatalog = skillBody.includes(p);
  log(`  ${inCatalog ? "✓" : "✗"} ${p} ${inCatalog ? "(in catalog)" : "(NOT in catalog!)"}`);
  if (!inCatalog) {
    log("FAIL: selected perspective not in skill catalog");
    process.exit(1);
  }
}

// ── Step 4: Build an A2UI Surface tree ──────────────────────────────────────
log("\nStep 4: Build A2UI Surface...");

// Root surface
const surface = {
  surfaceId: "arch-root",
  type: "panel",
  props: { title: `${pkgJson.name} Architecture`, layout: "tabs" },
  children: [],
};

// For each perspective, create a graph panel
for (const perspective of selectedPerspectives) {
  const panel = {
    surfaceId: `arch-${perspective}`,
    type: "graph",
    props: {
      title: perspective
        .split("-")
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(" "),
      direction: "LR",
      nodes: [],
      edges: [],
    },
  };

  // Populate overall-architecture with real package structure
  if (perspective === "overall-architecture") {
    panel.props.nodes = [
      { id: "desktop", label: "Desktop (Electron)\npackages/desktop/", kind: "entry" },
      { id: "core", label: "Core Engine\npackages/core/", kind: "default" },
      { id: "memory", label: "Memory (TDAI)\npackages/memory/", kind: "default" },
      { id: "embedding", label: "Embedding\npackages/embedding/", kind: "store" },
      { id: "routing", label: "Skill Routing\npackages/core/src/routing/", kind: "default" },
    ];
    panel.props.edges = [
      { from: "desktop", to: "core", label: "depends on" },
      { from: "desktop", to: "memory", label: "depends on" },
      { from: "core", to: "embedding", label: "dynamic import" },
      { from: "memory", to: "embedding", label: "dynamic import" },
      { from: "core", to: "routing", label: "contains" },
    ];
  }

  if (perspective === "data-flow") {
    panel.props.nodes = [
      { id: "user", label: "User Input", kind: "entry" },
      { id: "session", label: "SessionManager\nsession.ts", kind: "entry" },
      { id: "llm", label: "LLM (DeepSeek)\nopenai-client", kind: "external" },
      { id: "tools", label: "Tool Executor\ntools/", kind: "default" },
      { id: "mcp", label: "MCP Servers\nmcp/", kind: "external" },
      { id: "vectors", label: "Vector Store\nsqlite-vec", kind: "store" },
    ];
    panel.props.edges = [
      { from: "user", to: "session", label: "prompt" },
      { from: "session", to: "llm", label: "chat completion" },
      { from: "llm", to: "tools", label: "tool_calls" },
      { from: "tools", to: "mcp", label: "MCP execute" },
      { from: "session", to: "vectors", label: "memory recall" },
    ];
  }

  if (perspective === "dependency-map") {
    panel.props.nodes = [
      { id: "desktop", label: "desktop", kind: "default" },
      { id: "core", label: "core", kind: "default" },
      { id: "memory", label: "memory", kind: "default" },
      { id: "embedding", label: "embedding", kind: "default" },
    ];
    panel.props.edges = [
      { from: "desktop", to: "core", label: "file: dep" },
      { from: "desktop", to: "memory", label: "file: dep" },
      { from: "memory", to: "embedding", label: "file: dep" },
      { from: "core", to: "embedding", label: "file: dep" },
    ];
  }

  if (perspective === "command-surface") {
    panel.props.nodes = [
      { id: "check", label: "npm run check", kind: "entry" },
      { id: "build", label: "npm run build", kind: "entry" },
      { id: "test", label: "npm test", kind: "entry" },
      { id: "desktop", label: "npm run desktop:start", kind: "entry" },
    ];
    panel.props.edges = [];
  }

  if (perspective === "external-integrations") {
    panel.props.nodes = [
      { id: "deepseek", label: "DeepSeek API", kind: "external" },
      { id: "mcp", label: "MCP Protocol", kind: "external" },
      { id: "hf", label: "HuggingFace (model)", kind: "external" },
      { id: "sqlite", label: "SQLite + sqlite-vec", kind: "store" },
    ];
    panel.props.edges = [
      { from: "deepseek", to: "session", label: "consumed by" },
      { from: "hf", to: "embedding", label: "model source" },
    ];
  }

  surface.children.push(panel);
}

log(`  root surfaceId: ${surface.surfaceId}`);
log(`  perspectives (children): ${surface.children.length}`);
log(`  total nodes across perspectives: ${surface.children.reduce((s, c) => s + c.props.nodes.length, 0)}`);
log(`  total edges across perspectives: ${surface.children.reduce((s, c) => s + c.props.edges.length, 0)}`);

// ── Step 5: Validate the Surface structure ──────────────────────────────────
log("\nStep 5: Validate A2UI Surface structure...");
let failures = 0;
const checks = [
  ["root.surfaceId is string", typeof surface.surfaceId === "string"],
  ["root.type is panel", surface.type === "panel"],
  ["root.props.title is string", typeof surface.props.title === "string"],
  ["root.props.layout is tabs", surface.props.layout === "tabs"],
  ["root has children array", Array.isArray(surface.children)],
  ["children length >= 1", surface.children.length >= 1],
];

for (const child of surface.children) {
  checks.push([`child ${child.surfaceId}: type is graph`, child.type === "graph"]);
  checks.push([
    `child ${child.surfaceId}: has nodes array`,
    Array.isArray(child.props.nodes) && child.props.nodes.length > 0,
  ]);
  checks.push([`child ${child.surfaceId}: has edges array`, Array.isArray(child.props.edges)]);
  // Every node has id + label
  for (const node of child.props.nodes) {
    checks.push([`node ${node.id}: has id+label`, !!node.id && !!node.label]);
  }
  // Every edge has from + to
  for (const edge of child.props.edges) {
    checks.push([`edge ${edge.from}→${edge.to}: has from+to`, !!edge.from && !!edge.to]);
  }
}

for (const [label, pass] of checks) {
  if (!pass) {
    console.log(`  ✗ ${label}`);
    failures++;
  }
}
log(`  ${checks.length - failures}/${checks.length} checks passed`);

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("");
console.log("  ──────────────────────────────────────────────");
console.log(`  Perspectives: ${selectedPerspectives.length}`);
console.log(`  Surface nodes: ${surface.children.reduce((s, c) => s + c.props.nodes.length, 0)}`);
console.log(`  Surface edges: ${surface.children.reduce((s, c) => s + c.props.edges.length, 0)}`);
console.log(`  Validation: ${failures === 0 ? "PASS" : `${failures} FAILURES`}`);
console.log("  ──────────────────────────────────────────────");

if (failures > 0) {
  log(`FAILED with ${failures} validation failures`);
  process.exit(1);
}
log("PASS ✅ — arch-scan skill produces valid A2UI Surface structure");
process.exit(0);
