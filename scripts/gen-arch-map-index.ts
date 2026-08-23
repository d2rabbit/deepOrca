/**
 * Generate the workspace architecture map DETERMINISTICALLY from the
 * CodeGraph index (R3-8): packages → key symbols → cross-package
 * relationship edges, composed as an official A2UI v0.9 surface
 * (`arch-root`) — the same artifact format the arch-scan LLM channel
 * produces, grounded in real index data instead of an LLM pass (the LLM
 * path stays available via scripts/gen-arch-map.ts when credits allow).
 *
 * Usage: npx tsx scripts/gen-arch-map-index.ts [projectRoot]
 * Output: <root>/.deeporca/prototypes/arch-root.json (+ arch-xrefs.json)
 */

import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

const BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";
const REL_KINDS = new Set(["calls", "references", "instantiates", "implements"]);

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const dbPath = path.join(root, ".codegraph", "codegraph.db");
if (!fs.existsSync(dbPath)) {
  console.error(`[gen-arch-index] no CodeGraph index at ${dbPath} — run a build first`);
  process.exit(1);
}
const db = new DatabaseSync(dbPath, { readOnly: true });

type NodeRow = { id: string; name: string; kind: string; file_path: string; start_line?: number };
const nodes = db
  .prepare("SELECT id, name, kind, file_path FROM nodes WHERE kind NOT IN ('import','unknown','file')")
  .all() as NodeRow[];
const byId = new Map(nodes.map((n) => [n.id, n]));

/** Map a file path to its package/module group (top-level source dir). */
function moduleOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const m = normalized.match(/^(packages\/[^/]+\/src)\//);
  if (m) return m[1].replace("/src", "");
  if (normalized.startsWith("scripts/")) return "scripts";
  if (normalized.startsWith("packages/")) return "packages(root)";
  return normalized.split("/")[0] === "" ? "(root)" : normalized.split("/")[0];
}

// ── Aggregate: per-module symbol census + hub symbols ───────────────────────
type ModuleStat = {
  module: string;
  symbols: number;
  kinds: Record<string, number>;
  hubs: Array<{ name: string; kind: string; inDeg: number }>;
};
const modules = new Map<string, ModuleStat>();
const inDeg = new Map<string, number>();
const edges = db.prepare("SELECT source, target, kind FROM edges").all() as Array<{
  source: string;
  target: string;
  kind: string;
}>;
for (const e of edges) {
  if (REL_KINDS.has(e.kind)) inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
}
for (const n of nodes) {
  const mod = moduleOf(n.file_path);
  const stat = modules.get(mod) ?? { module: mod, symbols: 0, kinds: {}, hubs: [] };
  stat.symbols += 1;
  stat.kinds[n.kind] = (stat.kinds[n.kind] ?? 0) + 1;
  const deg = inDeg.get(n.id);
  if (deg && deg >= 5) stat.hubs.push({ name: n.name, kind: n.kind, inDeg: deg });
  modules.set(mod, stat);
}
for (const stat of modules.values()) {
  stat.hubs.sort((a, b) => b.inDeg - a.inDeg);
  stat.hubs = stat.hubs.slice(0, 5);
}

// ── Cross-module relationship aggregation ──────────────────────────────────
const xrefs = new Map<string, number>(); // "A→B" → count
for (const e of edges) {
  if (!REL_KINDS.has(e.kind)) continue;
  const from = byId.get(e.source);
  const to = byId.get(e.target);
  if (!from || !to) continue;
  const a = moduleOf(from.file_path);
  const b = moduleOf(to.file_path);
  if (a === b) continue;
  const key = `${a}→${b}`;
  xrefs.set(key, (xrefs.get(key) ?? 0) + 1);
}
const topXrefs = [...xrefs.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10);
const sortedModules = [...modules.values()].sort((a, b) => b.symbols - a.symbols).slice(0, 10);

// ── Compose the official v0.9 surface ──────────────────────────────────────
type Comp = { id: string; component: string; children?: string[]; child?: string } & Record<string, unknown>;
const comps: Comp[] = [];
const kidsOf = new Map<string, string[]>();
const add = (c: Comp): void => {
  comps.push(c);
  if (c.children && c.children.length > 0) kidsOf.set(c.id, c.children);
};

const rootName = path.basename(root);
const totalSymbols = nodes.length;
const relEdges = edges.filter((e) => REL_KINDS.has(e.kind)).length;

add({ id: "root", component: "Card", child: "root-inner" });
add({
  id: "root-inner",
  component: "Column",
  children: ["arch-title", "arch-overview", "arch-divider", "arch-tabs"],
});
add({ id: "arch-title", component: "Text", text: `${rootName} — 架构图（索引驱动）`, variant: "h1" });
add({
  id: "arch-overview",
  component: "Text",
  text: `${modules.size} 个模块 · ${totalSymbols} 个符号 · ${relEdges} 条关系边 · 数据来源 CodeGraph 索引（确定性生成，非 LLM）`,
  variant: "caption",
});
add({ id: "arch-divider", component: "Divider" });

// Perspective 1: module structure
const pkgChildren = ["pkg-content"];
// ONE Tabs container holding both perspectives (official v0.9 shape:
// tabs: [{title, child}] array — never sibling/per-tab Tabs components).
add({
  id: "arch-tabs",
  component: "Tabs",
  tabs: [
    { title: "模块结构", child: "pkg-content" },
    { title: "跨模块关系", child: "xref-content" },
  ],
});
const modCards = sortedModules.map((m, i) => `mod-${i}`);
add({ id: "pkg-content", component: "Column", children: modCards });
sortedModules.forEach((m, i) => {
  const cid = `mod-${i}`;
  add({ id: cid, component: "Card", child: `${cid}-inner` });
  const kinds = Object.entries(m.kinds)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, c]) => `${k}×${c}`)
    .join(" · ");
  const hubText = m.hubs.length > 0 ? m.hubs.map((h) => `${h.name}(${h.inDeg})`).join("、") : "—";
  add({
    id: `${cid}-inner`,
    component: "Column",
    children: [`${cid}-name`, `${cid}-meta`, `${cid}-hubs`],
  });
  add({ id: `${cid}-name`, component: "Text", text: `▸ ${m.module}`, variant: "h4" });
  add({ id: `${cid}-meta`, component: "Text", text: `${m.symbols} 符号 · ${kinds}`, variant: "caption" });
  add({ id: `${cid}-hubs`, component: "Text", text: `核心: ${hubText}`, variant: "caption" });
});

// Perspective 2: cross-module relationships
const xrefLines = topXrefs.map(([, count], i) => `xref-${i}`);
add({ id: "xref-content", component: "Column", children: xrefLines });
topXrefs.forEach(([pair, count], i) => {
  const [from, to] = pair.split("→");
  add({ id: `xref-${i}`, component: "Text", text: `→ ${from} ─ ${count} 条关系 → ${to}`, variant: "body" });
});

const messages = [
  { version: "v0.9", createSurface: { surfaceId: "arch-root", catalogId: BASIC_CATALOG_ID } },
  { version: "v0.9", updateComponents: { surfaceId: "arch-root", components: comps } },
];

const outDir = path.join(root, ".deeporca", "prototypes");
fs.mkdirSync(outDir, { recursive: true });
const artifact = {
  surfaceId: "arch-root",
  title: `${rootName} 架构图（索引驱动）`,
  messages,
  dataModel: {},
  components: comps,
};
fs.writeFileSync(path.join(outDir, "arch-root.json"), JSON.stringify(artifact, null, 2), "utf8");
console.log(
  `[gen-arch-index] wrote ${outDir}/arch-root.json — ${modules.size} modules, ${topXrefs.length} top xrefs, ${comps.length} components`
);
console.log(`[gen-arch-index] top modules: ${sortedModules.map((m) => `${m.module}(${m.symbols})`).join(" | ")}`);
console.log(`[gen-arch-index] top xrefs: ${topXrefs.map(([p, c]) => `${p}:${c}`).join(" | ")}`);
