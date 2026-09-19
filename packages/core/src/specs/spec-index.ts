/**
 * SpecIndex — the derived read model over the spec domain
 * `<workspaceRoot>/.deeporca/specs/` (specs/spec-graph-adoption §1.2/§1.6).
 *
 * The FILESYSTEM IS THE ONLY SOURCE OF TRUTH. The index is a derived,
 * in-memory, read-only cache revalidated ON EVERY READ by `(mtimeMs, size)`:
 * unchanged files reuse their cached parse; changed/new files re-parse;
 * vanished files are evicted. One index instance per root (keyed by cwd), so
 * the stat cost amortizes across an agent's or the UI's repeated reads —
 * while any external edit (agent write/edit, human, git) is always current
 * on the next read. Design deliberately mirrors JetBrains ThinkRail's
 * SpecIndex (idea adoption, zero code).
 *
 * Drift detection (§1.6) is mechanical-only — mtime and existence, zero LLM —
 * and every gate is INDEPENDENT: a gate whose prerequisites are missing
 * reports `unknown`/nothing and never blocks the others (design §1.7).
 *
 * Layer rules: no UI imports, no console.* — a pure read model over Node
 * builtins. Consumers: desktop (Specs panel via specs-ipc) and any agent
 * guidance reading the same model, so the agent view and the UI view share
 * one home (design §1.2 双入口同源).
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { firstHeading, parseFrontmatter, type SpecFrontmatter } from "./frontmatter";

export type SpecDriftGate = "chain" | "implementation" | "knowledge";
export type SpecDriftState = "ok" | "stale" | "unimplemented" | "ahead" | "unknown";

export interface SpecDriftFinding {
  gate: SpecDriftGate;
  state: SpecDriftState;
  detail?: string;
}

export interface SpecNode {
  /** Unique node id: frontmatter `id`, or derived `<dir>#tasks` for tasks files. */
  id: string;
  type: string;
  status: string;
  /** First markdown heading, or the file base name. */
  title: string;
  /** Directory name under the specs root (the suite slug for design chains). */
  dir: string;
  /** Path relative to the WORKSPACE root (POSIX separators) — the wire open target. */
  relPath: string;
  parent?: string;
  dependsOn: string[];
  artifacts: string[];
  tags: string[];
  mtimeMs: number;
  drift: SpecDriftFinding[];
}

export interface SpecGraph {
  root: string;
  nodes: SpecNode[];
}

export interface SpecIssue {
  severity: "error" | "warn" | "info";
  code: string;
  /** Specs-root-relative file path the issue attaches to. */
  path: string;
  message: string;
}

const SPECS_DIR_SEGMENTS = [".deeporca", "specs"];
const PROTOTYPES_PREFIX = [".deeporca", "prototypes"];

interface CacheEntry {
  mtimeMs: number;
  size: number;
  node: SpecNode | null; // null = loose file (no usable frontmatter)
}

interface RootIndex {
  files: Map<string, CacheEntry>; // key: absolute file path
}

const indexes = new Map<string, RootIndex>();

const toPosix = (p: string): string => p.split(path.sep).join("/");

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await fs.stat(absPath);
    return true;
  } catch {
    return false;
  }
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return out; // missing domain dir → empty graph, never an error (design R2)
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectMarkdownFiles(abs)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) out.push(abs);
  }
  return out;
}

function deriveId(dir: string, baseName: string, fm: SpecFrontmatter): string {
  const explicit = fm.id;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  if (fm.type === "tasks") return `${dir}#tasks`;
  return dir || baseName;
}

function normalizeStatus(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "draft";
}

function stringList(fm: SpecFrontmatter, key: string): string[] {
  const value = fm[key];
  return Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
}

function parseNode(root: string, absFile: string, text: string): SpecNode | null {
  const fm = parseFrontmatter(text);
  // A node needs at least a `type` (for identity derivation and the closed
  // vocabulary). Anything else stays loose prose (validate reports it as info).
  if (!fm || typeof fm.type !== "string" || !fm.type.trim()) return null;
  const dir = path.basename(path.dirname(absFile));
  const baseName = path.basename(absFile, ".md");
  const relPath = toPosix(path.relative(root, absFile));
  return {
    id: deriveId(dir, baseName, fm),
    type: String(fm.type),
    status: normalizeStatus(fm.status),
    title: firstHeading(text) ?? baseName,
    dir,
    relPath,
    ...(typeof fm.parent === "string" && fm.parent.trim() ? { parent: fm.parent.trim() } : {}),
    dependsOn: stringList(fm, "depends-on"),
    artifacts: stringList(fm, "artifacts"),
    tags: stringList(fm, "tags"),
    mtimeMs: 0,
    drift: [],
  };
}

/** Revalidate the root's index and return the current node set + loose files. */
async function revalidate(root: string): Promise<{ nodes: SpecNode[]; loose: string[] }> {
  const specsDir = path.join(root, ...SPECS_DIR_SEGMENTS);
  let index = indexes.get(root);
  if (!index) {
    index = { files: new Map() };
    indexes.set(root, index);
  }
  const seen = new Set<string>();
  const nodes: SpecNode[] = [];
  const loose: string[] = [];
  for (const absFile of await collectMarkdownFiles(specsDir)) {
    seen.add(absFile);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    let text: string;
    try {
      stat = await fs.stat(absFile);
      text = await fs.readFile(absFile, "utf8");
    } catch {
      continue; // raced delete — evicted on next pass via `seen`
    }
    const cached = index.files.get(absFile);
    const mtimeMs = Math.round(stat.mtimeMs);
    if (cached && cached.mtimeMs === mtimeMs && cached.size === stat.size) {
      if (cached.node) nodes.push({ ...cached.node, mtimeMs });
      else loose.push(toPosix(path.relative(specsDir, absFile)));
      continue;
    }
    let node: SpecNode | null = null;
    try {
      node = parseNode(root, absFile, text);
    } catch {
      node = null; // unreadable content degrades to loose, never throws
    }
    index.files.set(absFile, { mtimeMs, size: stat.size, node });
    if (node) nodes.push({ ...node, mtimeMs });
    else loose.push(toPosix(path.relative(specsDir, absFile)));
  }
  for (const absFile of index.files.keys()) {
    if (!seen.has(absFile)) index.files.delete(absFile);
  }
  return { nodes, loose };
}

/** Gate A — chain drift: an architecture node lagging its product-design parent. */
async function chainDrift(root: string, node: SpecNode, byId: Map<string, SpecNode>): Promise<SpecDriftFinding | null> {
  if (node.type !== "architecture" || !node.parent) return null;
  const parent = byId.get(node.parent);
  if (!parent) return { gate: "chain", state: "unknown", detail: `parent ${node.parent} not found (dangling link)` };
  if (node.mtimeMs < parent.mtimeMs) {
    return { gate: "chain", state: "stale", detail: "技术设计落后于产品设计（产品设计更新在后）" };
  }
  return { gate: "chain", state: "ok" };
}

/** Gate B — implementation drift: artifacts registered as implementation outputs. */
async function implementationDrift(root: string, node: SpecNode): Promise<SpecDriftFinding | null> {
  const impl = node.artifacts.filter((p) => !isPrototypesArtifact(p));
  if (impl.length === 0) return null;
  let missing = 0;
  let ahead = 0;
  for (const rel of impl) {
    if (escapesRoot(rel)) continue;
    const abs = path.join(root, rel);
    if (!(await pathExists(abs))) {
      missing += 1;
      continue;
    }
    const stat = await fs.stat(abs);
    if (Math.round(stat.mtimeMs) > node.mtimeMs) ahead += 1;
  }
  if (missing > 0)
    return {
      gate: "implementation",
      state: "unimplemented",
      detail: `${missing} 个实现产物不存在（未实施或路径失效）`,
    };
  if (ahead > 0)
    return { gate: "implementation", state: "ahead", detail: "实现产物较新——实现可能已演进，设计或需回写" };
  return { gate: "implementation", state: "ok" };
}

/** Gate C — knowledge-track cross check (READ-ONLY; prototypes snapshots). */
async function knowledgeDrift(root: string, node: SpecNode): Promise<SpecDriftFinding | null> {
  const snapshots = node.artifacts.filter(isPrototypesArtifact);
  if (snapshots.length === 0) return null;
  let newer = 0;
  let missing = 0;
  for (const rel of snapshots) {
    const abs = path.join(root, rel);
    if (!(await pathExists(abs))) {
      missing += 1;
      continue;
    }
    const stat = await fs.stat(abs);
    if (Math.round(stat.mtimeMs) > node.mtimeMs) newer += 1;
  }
  if (newer > 0)
    return { gate: "knowledge", state: "stale", detail: "描述性快照较新——建议复核设计是否滞后（只读对照）" };
  if (missing > 0) return { gate: "knowledge", state: "unknown", detail: "知识轨快照缺失（可运行 arch-scan 重建）" };
  return { gate: "knowledge", state: "ok" };
}

function isPrototypesArtifact(rel: string): boolean {
  const normalized = toPosix(rel);
  return (
    normalized.startsWith(toPosix(path.join(...PROTOTYPES_PREFIX)) + "/") ||
    normalized.startsWith(".deeporca/prototypes/")
  );
}

function escapesRoot(rel: string): boolean {
  const normalized = toPosix(rel);
  return normalized.startsWith("/") || normalized.startsWith("../") || normalized === ".." || /:[/\\]/.test(normalized);
}

export interface SpecGraphBuild {
  graph: SpecGraph;
  /** Non-blocking findings across the domain (loose files, chain halves, …). */
  issues: SpecIssue[];
}

/** Build the current graph (revalidating first) with per-node drift findings. */
export async function getSpecGraph(root: string): Promise<SpecGraph> {
  const { nodes } = await revalidate(root);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const withDrift: SpecNode[] = [];
  for (const node of nodes) {
    const findings: SpecDriftFinding[] = [];
    const chain = await chainDrift(root, node, byId);
    if (chain) findings.push(chain);
    const implementation = await implementationDrift(root, node);
    if (implementation) findings.push(implementation);
    const knowledge = await knowledgeDrift(root, node);
    if (knowledge) findings.push(knowledge);
    withDrift.push({ ...node, drift: findings });
  }
  return { root, nodes: withDrift };
}

/** `listSpecs` — the plain node list (same revalidation, same freshness). */
export async function listSpecs(root: string): Promise<SpecNode[]> {
  return (await getSpecGraph(root)).nodes;
}

/**
 * Structural validation. Hard rules are LINK INTEGRITY only (design 拍板⑦):
 * dangling parent/depends-on references are errors; an incomplete chain is
 * NEVER an error — an independent architecture node is legal (info hint) and
 * a product-design without its architecture half is a normal intermediate
 * state (info hint).
 */
export async function validateSpecs(root: string): Promise<SpecIssue[]> {
  const { nodes, loose } = await revalidate(root);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const issues: SpecIssue[] = [];
  const seenIds = new Map<string, string>();
  for (const node of nodes) {
    if (seenIds.has(node.id)) {
      issues.push({
        severity: "error",
        code: "duplicate-id",
        path: node.relPath,
        message: `node id "${node.id}" is already used by ${seenIds.get(node.id)}`,
      });
    } else {
      seenIds.set(node.id, node.relPath);
    }
    if (!["product-design", "architecture", "design", "tasks"].includes(node.type)) {
      issues.push({
        severity: "warn",
        code: "unknown-type",
        path: node.relPath,
        message: `type "${node.type}" is outside the closed vocabulary`,
      });
    }
    if (!["draft", "active", "done", "stalled"].includes(node.status)) {
      issues.push({
        severity: "warn",
        code: "unknown-status",
        path: node.relPath,
        message: `status "${node.status}" is outside the closed vocabulary`,
      });
    }
    const linkTargets: Array<{ kind: string; id: string }> = [
      ...(node.parent ? [{ kind: "parent", id: node.parent }] : []),
      ...node.dependsOn.map((id) => ({ kind: "depends-on", id })),
    ];
    for (const link of linkTargets) {
      if (!byId.has(link.id)) {
        issues.push({
          severity: "error",
          code: "dangling-link",
          path: node.relPath,
          message: `${link.kind} → "${link.id}" points at no existing node`,
        });
      }
    }
    if (node.type === "architecture") {
      if (!node.parent) {
        issues.push({
          severity: "info",
          code: "independent-architecture",
          path: node.relPath,
          message:
            "独立架构节点（无产品设计上游）——合法；如属同一设计套件，建议补 parent 指向同目录 product-design 节点",
        });
      } else {
        const parent = byId.get(node.parent);
        if (parent && parent.type !== "product-design") {
          issues.push({
            severity: "info",
            code: "architecture-parent-not-product-design",
            path: node.relPath,
            message: `parent "${node.parent}" is a ${parent.type} node, not product-design`,
          });
        }
      }
    }
    if (node.type === "product-design") {
      const hasChild = nodes.some((other) => other.parent === node.id && other.type === "architecture");
      if (!hasChild) {
        issues.push({
          severity: "info",
          code: "chain-half",
          path: node.relPath,
          message: "未生成技术设计——合法中间态（技术架构尚未生成）",
        });
      }
    }
    if (node.type === "tasks") {
      const parent = node.parent ? byId.get(node.parent) : null;
      if (node.parent && (!parent || parent.dir !== node.dir || parent.type === "tasks")) {
        issues.push({
          severity: parent ? "warn" : "info",
          code: "tasks-parent",
          path: node.relPath,
          message: node.parent
            ? `tasks parent "${node.parent}" should be a design node in the same directory`
            : "tasks node without a parent — expected `<dir>#tasks` convention with parent set",
        });
      }
    }
    for (const artifact of node.artifacts) {
      if (escapesRoot(artifact)) {
        issues.push({
          severity: "warn",
          code: "artifact-escapes-root",
          path: node.relPath,
          message: `artifacts entry "${artifact}" escapes the workspace root`,
        });
      }
    }
  }
  for (const file of loose) {
    issues.push({
      severity: "info",
      code: "loose-file",
      path: file,
      message: "markdown file without usable frontmatter — not a graph node (add frontmatter to register it)",
    });
  }
  return issues;
}

/** Test/teardown helper: drop all cached indexes (never needed in production reads). */
export function resetSpecIndexCache(): void {
  indexes.clear();
}
