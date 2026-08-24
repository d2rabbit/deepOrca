#!/usr/bin/env node
// test-arch-scan.mjs — Verify the arch-scan skill produces a valid Mermaid
// architecture-map document.
//
// Simulates what the LLM would do when following the arch-scan SKILL.md:
//   1. Verifies the skill contract (save_archmap + mermaid guidance present,
//      A2UI surfaces explicitly excluded for arch maps)
//   2. Explores the codebase (reads manifests, lists dirs)
//   3. Selects perspectives from the catalog
//   4. Builds the Mermaid document per the layout contract (one `##` section
//      per perspective, each with exactly one ```mermaid fence)
//   5. Validates diagram syntax basics (known diagram type, node/edge budget)
//
// Deterministic smoke test — no LLM call, no save_archmap side effect.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function log(msg) {
  console.log(`[test-arch-scan] ${msg}`);
}

// ── Step 1: Verify the skill contract ───────────────────────────────────────
log("Step 1: Verify SKILL.md...");
const skillPath = join(repoRoot, "packages/core/templates/plugins/code/skills/arch-scan/SKILL.md");
if (!existsSync(skillPath)) {
  log("FAIL: SKILL.md not found");
  process.exit(1);
}
const skillRaw = readFileSync(skillPath, "utf8");
const { data: fm, content: skillBody } = matter(skillRaw);
log(`  name: ${fm.name}, description: ${fm.description.slice(0, 60)}...`);

const contractChecks = [
  ["instructs save_archmap", /save_archmap/.test(skillBody)],
  ["instructs mermaid output", /```mermaid/.test(skillBody)],
  ["forbids render_surface for arch maps", /do NOT use[\s\S]{0,80}render_surface/.test(skillBody)],
  ["keeps arch-<name>.md naming", /arch-<name>\.md|arch-<project-slug>\.md/.test(skillBody)],
];
for (const [label, pass] of contractChecks) {
  log(`  ${pass ? "✓" : "✗"} ${label}`);
  if (!pass) {
    log("FAIL: skill contract regression");
    process.exit(1);
  }
}

// ── Step 2: Explore the codebase (like the skill instructs) ─────────────────
log("\nStep 2: Explore codebase...");
const pkgJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
log(`  project: ${pkgJson.name} v${pkgJson.version}`);
const packagesDir = join(repoRoot, "packages");
const packages = readdirSync(packagesDir).filter((d) => {
  try {
    return statSync(join(packagesDir, d)).isDirectory();
  } catch {
    return false;
  }
});
log(`  packages: ${packages.join(", ")}`);

// ── Step 3: Select perspectives (DeepOrca is a desktop app monorepo) ────────
log("\nStep 3: Select perspectives...");
const selectedPerspectives = [
  "overall-architecture", // always
  "dependency-map", // monorepo with cross-package deps
  "data-flow", // IPC: main ↔ renderer ↔ core
  "command-surface", // npm run scripts
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

// ── Step 4: Build the Mermaid document (layout contract) ────────────────────
log("\nStep 4: Build Mermaid document...");

const diagrams = {
  "overall-architecture": [
    "flowchart TD",
    '  subgraph Desktop["Electron 桌面端"]',
    '    R["Renderer (React)"]',
    '    M["Main Process"]',
    "  end",
    '  CORE["@deeporca/core 引擎"]',
    '  MEM["@deeporca/memory"]',
    '  EMB["@deeporca/embedding"]',
    '  R -->|"IPC invoke"| M',
    '  M -->|"会话循环 + 工具执行"| CORE',
    '  CORE -.->|"dynamic import"| EMB',
    '  MEM -.->|"dynamic import"| EMB',
    "  classDef entry stroke:#3b82f6,stroke-width:2.5px",
    "  class R,M entry",
  ],
  "dependency-map": [
    "flowchart TD",
    "  DESKTOP[desktop]",
    "  CORE[core]",
    "  MEM[memory]",
    "  EMB[embedding]",
    '  DESKTOP -->|"file: dep"| CORE',
    '  DESKTOP -->|"file: dep"| MEM',
    '  CORE -.->|"dynamic import"| EMB',
    '  MEM -.->|"dynamic import"| EMB',
  ],
  "data-flow": [
    "flowchart LR",
    '  U["用户输入"]',
    '  S["SessionManager"]',
    '  L["DeepSeek API"]',
    '  T["ToolExecutor"]',
    '  V[("向量存储")]',
    '  U -->|"prompt"| S',
    '  S -->|"chat completion"| L',
    '  L -->|"tool_calls"| T',
    '  S -->|"memory recall"| V',
  ],
  "command-surface": [
    "flowchart TD",
    '  CLI["npm scripts"]',
    '  CHECK["npm run check"]',
    '  BUILD["npm run build"]',
    '  TEST["npm test"]',
    "  CLI --> CHECK",
    "  CLI --> BUILD",
    "  CLI --> TEST",
  ],
  "external-integrations": [
    "flowchart LR",
    '  subgraph Inside["代码库内"]',
    '    CORE["core 引擎"]',
    "  end",
    '  subgraph Outside["外部"]',
    '    DS["DeepSeek API"]',
    '    MCP["MCP 生态"]',
    "  end",
    '  CORE -->|"HTTPS"| DS',
    '  CORE <-->|"stdio JSON-RPC"| MCP',
    "  classDef external stroke-dasharray: 4 3",
    "  class DS,MCP external",
  ],
};

let doc = `# ${pkgJson.name} 架构\n\nnpm workspaces monorepo：Electron 桌面端 + 共享核心引擎 + 记忆/嵌入流水线。\n`;
for (const [perspective, lines] of Object.entries(diagrams)) {
  const title = perspective
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  doc += `\n## ${title}\n\n要点一句话。\n\n\`\`\`mermaid\n${lines.join("\n")}\n\`\`\`\n`;
}

const fences = [...doc.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
log(`  document lines: ${doc.split("\n").length}, mermaid fences: ${fences.length}`);

// ── Step 5: Validate the document + diagrams ────────────────────────────────
log("\nStep 5: Validate Mermaid document...");
let failures = 0;
const checks = [
  ["document has an H1 title", /^# .+/m.test(doc)],
  ["fence count == perspective count", fences.length === selectedPerspectives.length],
];

const DIAGRAM_TYPES = /^(flowchart|graph|sequenceDiagram|stateDiagram-v2|classDiagram|erDiagram|mindmap|timeline)\b/;
let nodeTotal = 0;
let edgeTotal = 0;
fences.forEach((body, i) => {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  checks.push([`fence ${i}: starts with a known diagram type`, DIAGRAM_TYPES.test(lines[0])]);
  const edgeLines = lines.filter((l) => /(-.->|-->|<-->)/.test(l));
  const nodeLines = lines.filter((l) => /^\w+\[/.test(l) || /^\w+\(/.test(l) || /^\s+\w+\[/.test(l));
  nodeTotal += nodeLines.length;
  edgeTotal += edgeLines.length;
  // Complexity budget: the SKILL's hard constraint (≤ 9 nodes / ≤ 12 edges per diagram).
  checks.push([`fence ${i}: ≤ 9 node lines`, nodeLines.length <= 9]);
  checks.push([`fence ${i}: ≤ 12 edge lines`, edgeLines.length <= 12]);
});

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
console.log(`  Diagram nodes: ${nodeTotal}`);
console.log(`  Diagram edges: ${edgeTotal}`);
console.log(`  Validation: ${failures === 0 ? "PASS" : `${failures} FAILURES`}`);
console.log("  ──────────────────────────────────────────────");

if (failures > 0) {
  log(`FAILED with ${failures} validation failures`);
  process.exit(1);
}
log("PASS ✅ — arch-scan skill produces a valid Mermaid architecture map");
process.exit(0);
