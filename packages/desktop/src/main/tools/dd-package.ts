/**
 * .ddp / .ddu export packages — the Designer's deliverable formats
 * (specs/pm-design-v2 P4-1, format decision 2026-08-18).
 *
 * Both formats are special ZIP archives ("特殊的压缩包") — readable by any
 * unzip tool, built with ZERO dependencies (node:zlib deflate + hand-rolled
 * CRC32/zip structures):
 *
 *   .ddp — PM-Design prototype export (pipeline "moonviz", specs/
 *          moonviz-engine-replacement): manifest.json + source/doc.mbt.md
 *          (the canonical MoonViz document) + index.html — the REAL
 *          interactive viewer (the engine's export_html artifact) when a
 *          preview cache is provided, else a source-stub fallback.
 *   .ddu — UI-Design document export: manifest.json + source + index.html.
 *          The UI stack is leafer-only since MoonViz took over the prototype
 *          stack (buildDduLeaferPackage); legacy .dd artifacts keep the
 *          standalone compiled render (source.dd, buildDduPackage).
 *
 * Pure logic only (no Electron imports) — unit-testable from the plain-Node
 * test runner, same as design-store.
 */

import { deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildClayPreviewHtml } from "./clay/clay-preview-html";

function isDictLike(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Files that make up a package, in zip order. */
export interface PackageEntry {
  name: string;
  data: Buffer;
}

export interface DdPackageManifest {
  /** Package format id — the extension this file was exported as. */
  format: "ddp" | "ddu";
  formatVersion: 1;
  /** Product-side kind: pm-design prototypes vs ui-design documents. */
  kind: "pm-design" | "ui-design";
  title: string;
  artifactId: string;
  /** Generation stack: moonviz = PM-Design (specs/moonviz-engine-
   *  replacement), leafer = specs/leafer-ui-engine's UI-Design stack, design
   *  = legacy .dd. */
  pipeline: "moonviz" | "design" | "leafer";
  exportedAt: string;
  generator: string;
  /** .ddp only (additive, spec appendix C④): true when a `verification.md`
   *  acceptance-report entry is included in the package. */
  verification?: boolean;
  /** .ddu only (additive): extra entry names actually included beyond the
   *  base manifest/source/index set (e.g. ["tokens.json","components.json"]). */
  entries?: string[];
}

/** One check of the suite verification result (mirrors the stored meta shape). */
export interface PackageVerificationCheck {
  id: string;
  label: string;
  status: string;
  action?: string;
  observation?: string;
}

/** The suite verification result (spec §6.6 / appendix C①): shipped inside
 *  .ddp as the human-readable `verification.md` acceptance report. */
export interface PackageVerification {
  status: string;
  checks: PackageVerificationCheck[];
  generatedAt?: string;
  healingRounds?: number;
}

/** Optional .ddu extras (spec §6.6): design tokens + component inventory. */
export interface DduExtras {
  tokens?: unknown;
  components?: unknown;
}

const GENERATOR = "DeepOrca Desktop";

/** Build the .ddp package (PM-Design / moonviz pipeline). When a non-empty
 *  `verification` result is given, a `verification.md` entry (the acceptance
 *  report) is added and `manifest.verification` is set. When an interactive
 *  preview cache (prototype.html) is available it ships as the REAL viewer;
 *  otherwise index.html falls back to the source stub. */
export function buildDdpPackage(
  artifact: { id: string; title: string },
  moonvizDoc: string,
  exportedAt: string,
  verification?: PackageVerification,
  previewHtml?: string
): Buffer {
  // "Present and non-empty": a verification object without any check carries
  // no acceptance evidence — skip both the entry and the manifest flag.
  const checks = Array.isArray(verification?.checks) ? verification.checks : [];
  const includeVerification = checks.length > 0;
  const interactive = Boolean(previewHtml?.trim());
  const manifest: DdPackageManifest = {
    format: "ddp",
    formatVersion: 1,
    kind: "pm-design",
    title: artifact.title,
    artifactId: artifact.id,
    pipeline: "moonviz",
    exportedAt,
    generator: GENERATOR,
    ...(includeVerification ? { verification: true } : {}),
    ...(interactive ? { interactivePreview: true } : {}),
  };
  const entries: PackageEntry[] = [
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
    { name: "source/doc.mbt.md", data: Buffer.from(moonvizDoc, "utf8") },
    {
      name: "index.html",
      data: Buffer.from(interactive ? previewHtml! : buildDdpViewerHtml(artifact.title, moonvizDoc), "utf8"),
    },
  ];
  if (includeVerification) {
    entries.push({ name: "verification.md", data: Buffer.from(renderVerificationMarkdown(verification!), "utf8") });
  }
  return zipEntries(entries);
}

/** Build the .ddu package (UI-Design / design pipeline) with a standalone render. */
export function buildDduPackage(
  artifact: { id: string; title: string },
  ddSource: string,
  standaloneHtml: string,
  exportedAt: string
): Buffer {
  const manifest: DdPackageManifest = {
    format: "ddu",
    formatVersion: 1,
    kind: "ui-design",
    title: artifact.title,
    artifactId: artifact.id,
    pipeline: "design",
    exportedAt,
    generator: GENERATOR,
  };
  return zipEntries([
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
    { name: "source.dd", data: Buffer.from(ddSource, "utf8") },
    { name: "index.html", data: Buffer.from(standaloneHtml, "utf8") },
  ]);
}

// ── .ddu leafer pipeline (specs/leafer-ui-engine WP3) ────────────────────────

/** Name of the leafer-editor runtime entry inside a leafer .ddu package.
 *  build.mjs copies the build-time artifact under exactly this name so the
 *  resolver's first candidates hit (constant, copy target and JSDoc must
 *  agree — they historically drifted between dot/hyphen spellings). */
export const LEAFER_RUNTIME_FILE = "leafer.web.min.js";
/** Flow layout plugin build — loaded right AFTER the main runtime inside the
 *  .ddu viewer: its global build wires into the `LeaferUI` namespace the main
 *  runtime declares, registering flow/gap/padding layout support. */
export const LEAFER_FLOW_RUNTIME_FILE = "leafer-flow.web.min.js";

/** The leafer web runtime bytes carried inside the package. */
export interface LeaferRuntime {
  fileName: string;
  data: Buffer;
}

/** Both web builds the interactive .ddu needs: the editor runtime and the
 *  flow layout plugin (LEAFER_CREATE_CONTRACT composes with flow/gap/padding
 *  — an editor-only package renders flow-composed scenes collapsed). */
export interface LeaferRuntimeBundle {
  editor: LeaferRuntime;
  flow: LeaferRuntime;
}

/** Candidate roots shared by both runtime resolutions, in order: 1. the
 *  build-time copy next to the main bundle (`dist/<name>`, written by
 *  build.mjs — the production truth, stable across asar layout), 2. the
 *  build-time copy one level up (running from src/ in tests), 3./4. the
 *  installed dependency (package-local, then the workspace-hoisted layout). */
function runtimeCandidates(fileName: string, packageName: string, distFile: string): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  // Bundled: here = <desktop>/dist → package root one level up.
  // Tests/tsx: here = <desktop>/src/main/tools → package root three up.
  const fromSrc = resolve(here, "..", "..", "..");
  const packageRoot = basename(here) === "dist" ? resolve(here, "..") : fromSrc;
  return [
    join(here, fileName),
    join(fromSrc, "dist", fileName),
    join(packageRoot, "node_modules", packageName, "dist", distFile),
    // Workspace-hoisted install (the common layout): <repo>/node_modules.
    join(packageRoot, "..", "..", "node_modules", packageName, "dist", distFile),
  ];
}

function readRuntime(candidates: string[], fileName: string): LeaferRuntime | null {
  for (const candidate of candidates) {
    try {
      const data = readFileSync(candidate);
      if (data.length > 0) return { fileName, data };
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/** Locate the leafer-editor web runtime (dist/web.min.js). Null when none
 *  exists — the export surface then fails with an explicit "rebuild the
 *  desktop bundle" error instead of shipping a dead package. */
export function resolveLeaferRuntimeSource(): LeaferRuntime | null {
  return readRuntime(runtimeCandidates(LEAFER_RUNTIME_FILE, "leafer-editor", "web.min.js"), LEAFER_RUNTIME_FILE);
}

/** Locate the @leafer-in/flow web build (dist/flow.min.js — the plugin's
 *  global build that wires into the editor runtime's `LeaferUI`). */
export function resolveLeaferFlowRuntimeSource(): LeaferRuntime | null {
  return readRuntime(
    runtimeCandidates(LEAFER_FLOW_RUNTIME_FILE, "@leafer-in/flow", "flow.min.js"),
    LEAFER_FLOW_RUNTIME_FILE
  );
}

/** Resolve both builds; null when either is missing. The export is
 *  fail-closed on the pair — a viewer without the flow plugin breaks
 *  flow-composed scenes, the create contract's core layout mechanism. */
export function resolveLeaferRuntimeBundle(): LeaferRuntimeBundle | null {
  const editor = resolveLeaferRuntimeSource();
  const flow = resolveLeaferFlowRuntimeSource();
  return editor && flow ? { editor, flow } : null;
}

/** Escape a JSON document for inline <script type="application/json">
 *  embedding: `<` becomes \u003c so `</script>` can never terminate the
 *  block, plus the line-separator characters JSON allows raw. */
function embedJson(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** The interactive .ddu viewer: leafer runtime + flow plugin + embedded
 *  design JSON — double-click renders an editable canvas (pan/zoom/select/
 *  adjust, flow-aware layout), fully offline via the relative runtime
 *  scripts. The flow build MUST load after the main runtime: it wires into
 *  the `LeaferUI` global namespace that runtime declares. */
export function buildDduLeaferViewerHtml(
  title: string,
  leaferJson: string,
  runtimeFileName: string,
  flowRuntimeFileName: string
): string {
  const safeTitle = title.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle} — DeepOrca UI Design</title>
<style>
  html, body { margin: 0; height: 100%; background: #17181c; }
  #stage { position: fixed; inset: 0; }
  #err {
    display: none; position: fixed; inset: 24px; margin: auto; width: fit-content; height: fit-content;
    max-width: 70ch; padding: 14px 18px; border-radius: 10px; background: #2a2c33; color: #f2f3f5;
    font: 13px/1.6 ui-monospace, monospace; white-space: pre-wrap;
  }
</style>
</head>
<body>
<div id="stage"></div>
<pre id="err"></pre>
<script type="application/json" id="ddu-design">${embedJson(leaferJson)}</script>
<script src="./${runtimeFileName}"></script>
<!-- Flow layout plugin: must load AFTER the main runtime (registers into its LeaferUI namespace). -->
<script src="./${flowRuntimeFileName}"></script>
<script>
(function () {
  var stage = document.getElementById("stage");
  var err = document.getElementById("err");
  function fail(message) {
    err.style.display = "block";
    err.textContent = "Failed to render the design: " + message;
  }
  try {
    var data = JSON.parse(document.getElementById("ddu-design").textContent);
    if (typeof Leafer !== "function") throw new Error("leafer runtime missing (" + ${JSON.stringify(runtimeFileName)} + ")");
    var leafer = new Leafer({ view: stage, fill: "#17181c" });
    leafer.set(data);
    if (typeof Editor === "function") leafer.add(new Editor());
  } catch (error) {
    fail(error && error.message ? error.message : String(error));
  }
})();
</script>
</body>
</html>
`;
}

/** Build the .ddu package for the leafer UI-Design stack: manifest +
 *  design.leafer.json + the interactive index.html + the leafer web runtime
 *  and its flow layout plugin. Non-empty token/component extras ride along
 *  like the moonviz pipeline. */
export function buildDduLeaferPackage(
  artifact: { id: string; title: string },
  leaferJson: string,
  exportedAt: string,
  runtimes: LeaferRuntimeBundle,
  extras?: DduExtras,
  clay?: { wasmBase64: string }
): Buffer {
  // Normalize the stored document (pretty-printed entry) — a parse failure
  // here means corrupted suite content and must fail the export loudly.
  const normalized = JSON.stringify(JSON.parse(leaferJson), null, 2);
  const tokens = extras?.tokens;
  const components = extras?.components;
  const hasTokens = isNonEmptyRecord(tokens);
  const componentList = Array.isArray(components) && components.length > 0 ? components : null;
  const extraNames: string[] = [];
  if (hasTokens) extraNames.push("tokens.json");
  if (componentList) extraNames.push("components.json");

  // clay-ui-runtime（specs/clay-ui-runtime WP3）：可选 preview.html——wasm 缺失
  // 时静默跳过（附加形态，不替换 index.html，不改 EARS 17 路由）。
  let clayPreviewHtml: string | null = null;
  let canvasSize: { width: number; height: number } | null = null;
  if (clay?.wasmBase64) {
    const doc: unknown = JSON.parse(normalized);
    if (isDictLike(doc)) {
      const width = typeof doc.width === "number" ? doc.width : 1280;
      const height = typeof doc.height === "number" ? doc.height : 800;
      canvasSize = { width, height };
      const built = buildClayPreviewHtml({
        title: artifact.title,
        doc,
        wasmBase64: clay.wasmBase64,
        canvasWidth: width,
        canvasHeight: height,
      });
      clayPreviewHtml = built.html;
      if (built.skipped.length > 0) extraNames.push(`clay-skipped:${built.skipped.length}`);
    }
  }

  // preview.html 先登记进 extraNames 再序列化 manifest——manifest.entries 语义是
  // "包内实际包含的额外条目"，事后补写改不动已生成的 Buffer。
  const hasPreview = Boolean(clayPreviewHtml && canvasSize);
  if (hasPreview) extraNames.push("preview.html");

  const manifest: DdPackageManifest = {
    format: "ddu",
    formatVersion: 1,
    kind: "ui-design",
    title: artifact.title,
    artifactId: artifact.id,
    pipeline: "leafer",
    exportedAt,
    generator: GENERATOR,
    ...(extraNames.length > 0 ? { entries: extraNames } : {}),
  };
  const entries: PackageEntry[] = [
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
    { name: "design.leafer.json", data: Buffer.from(normalized, "utf8") },
    {
      name: "index.html",
      data: Buffer.from(
        buildDduLeaferViewerHtml(artifact.title, leaferJson, runtimes.editor.fileName, runtimes.flow.fileName),
        "utf8"
      ),
    },
    { name: runtimes.editor.fileName, data: runtimes.editor.data },
    { name: runtimes.flow.fileName, data: runtimes.flow.data },
  ];
  if (hasPreview && clayPreviewHtml) {
    entries.push({ name: "preview.html", data: Buffer.from(clayPreviewHtml, "utf8") });
  }
  if (hasTokens) {
    entries.push({ name: "tokens.json", data: Buffer.from(JSON.stringify(tokens, null, 2), "utf8") });
  }
  if (componentList) {
    entries.push({ name: "components.json", data: Buffer.from(JSON.stringify(componentList, null, 2), "utf8") });
  }
  return zipEntries(entries);
}

/** The .ddp acceptance report (verification.md) — human-readable markdown:
 *  status header + one ASCII-marker line per check ([x] passed / [ ] failed /
 *  [~] pending; healed passes with an auto-healed note). */
function renderVerificationMarkdown(verification: PackageVerification): string {
  const lines: string[] = ["# 验收报告", "", `- 状态：${verification.status}`];
  if (verification.generatedAt) lines.push(`- 生成时间：${verification.generatedAt}`);
  if (typeof verification.healingRounds === "number") {
    lines.push(`- 自动修复轮数：${verification.healingRounds}`);
  }
  lines.push("", "## 检查项", "");
  for (const check of verification.checks) {
    const passed = check.status === "passed" || check.status === "healed";
    const marker = passed ? "[x]" : check.status === "pending" ? "[~]" : "[ ]";
    const parts = [`- ${marker} ${check.label}`, check.status];
    const observation = check.observation?.trim();
    if (observation) parts.push(observation);
    else if (check.status === "healed") parts.push("已自动修复");
    lines.push(parts.join(" — "));
  }
  return `${lines.join("\n")}\n`;
}

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

/**
 * Viewer stub for .ddp — the fallback when no interactive preview cache was
 * exported (the real viewer is the engine's export_html artifact). Surfaces
 * the canonical MoonViz document verbatim and points back to the app.
 */
function buildDdpViewerHtml(title: string, source: string): string {
  const safeTitle = escapeHtml(title);
  const safeSource = escapeHtml(source);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle} — PM-Design prototype source</title>
<style>
body{font-family:system-ui,sans-serif;background:#111418;color:#e6e6e6;margin:0;padding:32px;line-height:1.6}
h1{font-size:20px;margin:0 0 8px}
p{color:#9aa3ad;font-size:13px;margin:0 0 20px}
pre{background:#1b2027;border:1px solid #2a313a;border-radius:8px;padding:16px;font-size:12px;overflow:auto;white-space:pre-wrap}
</style>
</head>
<body>
<h1>${safeTitle}</h1>
<p>PM-Design prototype package (.ddp). The canonical MoonViz document below is
rendered interactively in DeepOrca (Designer → PM-Design preview); this file
preserves the exact source. See manifest.json for package metadata.</p>
<pre>${safeSource}</pre>
</body>
</html>`;
}

// ── Minimal ZIP writer (deflate entries, store fallback) ────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date/time pair for the zip headers (local clock, 2-second resolution). */
function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.max(at.getFullYear(), 1980);
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >>> 1),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/**
 * Zip a fixed set of entries into a single archive buffer. Deflate each
 * entry; when deflated ≥ original (incompressible data) store it raw.
 */
export function zipEntries(entries: PackageEntry[], at: Date = new Date()): Buffer {
  const { time, date } = dosDateTime(at);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const deflated = deflateRawSync(entry.data, { level: 9 });
    const useDeflate = deflated.length < entry.data.length;
    const method = useDeflate ? 8 : 0;
    const stored = useDeflate ? deflated : entry.data;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags: UTF-8 names
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, stored);
    centrals.push(central);
    offset += local.length + stored.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central dir disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralDir, eocd]);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
