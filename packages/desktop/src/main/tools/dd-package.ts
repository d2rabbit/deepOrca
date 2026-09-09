/**
 * .ddp / .ddu export packages — the Designer's deliverable formats
 * (specs/pm-design-v2 P4-1, format decision 2026-08-18).
 *
 * Both formats are special ZIP archives ("特殊的压缩包") — readable by any
 * unzip tool, built with ZERO dependencies (node:zlib deflate + hand-rolled
 * CRC32/zip structures):
 *
 *   .ddp — PM-Design prototype export (pipeline "openui"):
 *          manifest.json + source.openui.txt + index.html (viewer stub —
 *          OpenUI Lang renders via the in-app React runtime, so the stub
 *          shows the source and explains where to open the live preview).
 *   .ddu — UI-Design document export: manifest.json + source + index.html.
 *          The current generation stack stores OpenUI Lang, so UI suites
 *          export source.openui.txt + viewer stub (buildDduOpenuiPackage);
 *          legacy .dd artifacts keep the standalone compiled render
 *          (source.dd, buildDduPackage).
 *
 * Pure logic only (no Electron imports) — unit-testable from the plain-Node
 * test runner, same as design-store.
 */

import { deflateRawSync } from "node:zlib";

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
  pipeline: "openui" | "design";
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

/** Build the .ddp package (PM-Design / openui pipeline). When a non-empty
 *  `verification` result is given, a fourth `verification.md` entry (the
 *  acceptance report) is added and `manifest.verification` is set. */
export function buildDdpPackage(
  artifact: { id: string; title: string },
  openuiSource: string,
  exportedAt: string,
  verification?: PackageVerification,
  /** WP4.1:平台变体(mobile/tablet)随包导出——三端生成是一等能力,交付物
   *  不该只有桌面端。每端附源码 + 可播放 standalone HTML。 */
  variants?: { mobile?: string; tablet?: string }
): Buffer {
  // "Present and non-empty": a verification object without any check carries
  // no acceptance evidence — skip both the entry and the manifest flag.
  const checks = Array.isArray(verification?.checks) ? verification.checks : [];
  const includeVerification = checks.length > 0;
  const manifest: DdPackageManifest = {
    format: "ddp",
    formatVersion: 1,
    kind: "pm-design",
    title: artifact.title,
    artifactId: artifact.id,
    pipeline: "openui",
    exportedAt,
    generator: GENERATOR,
    ...(includeVerification ? { verification: true } : {}),
    ...(variants?.mobile || variants?.tablet ? { platformVariants: true } : {}),
  };
  const entries: PackageEntry[] = [
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
    { name: "source.openui.txt", data: Buffer.from(openuiSource, "utf8") },
    { name: "index.html", data: Buffer.from(buildDdpViewerHtml(artifact.title, openuiSource), "utf8") },
  ];
  for (const device of ["mobile", "tablet"] as const) {
    const source = variants?.[device]?.trim();
    if (!source) continue;
    entries.push({ name: `source.openui.${device}.txt`, data: Buffer.from(source, "utf8") });
    entries.push({
      name: `standalone.${device}.html`,
      data: Buffer.from(buildStandaloneOpenuiHtml(`${artifact.title} · ${device}`, source), "utf8"),
    });
  }
  if (includeVerification) {
    entries.push({ name: "verification.md", data: Buffer.from(renderVerificationMarkdown(verification!), "utf8") });
  }
  return zipEntries(entries);
}

/**
 * WP4.3 standalone HTML for a platform variant — 交叉审查修正(2026-09-10):
 * OpenUI 官方没有浏览器 UMD bundle(@openuidev/browser 于 npm 不存在,404 实证),
 * 此前假设的 CDN+window.OpenUI.render 路线是死路径。诚实降级:交付一个自包含
 * 的「源码 + 平台说明」查看页(双击可开、零依赖、零网络),并在页面顶部说明
 * 在 DeepOrca 工作区内打开可获得完整交互预览。待官方提供浏览器 bundle 后
 * 再升级为可播放版本。
 */
export function buildStandaloneOpenuiHtml(title: string, openuiSource: string): string {
  // JSON.stringify 转义引号/换行,再做 </script> 转义防提前闭合(JSON 里 \/ 合法)。
  const embedded = JSON.stringify(openuiSource).replace(/<\/script>/gi, "<\\/script>");
  const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    "<!doctype html>",
    '<html lang="zh">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    "body{margin:0;padding:24px;font-family:system-ui,-apple-system,sans-serif;color:#1f2328;background:#fff}",
    ".note{padding:10px 14px;border:1px solid #d0d7de;border-radius:8px;background:#f6f8fa;font-size:13px;color:#57606a}",
    "pre{padding:16px;border:1px solid #d0d7de;border-radius:8px;background:#f6f8fa;font-size:12.5px;line-height:1.6;overflow:auto;white-space:pre-wrap}",
    "</style>",
    "</head>",
    "<body>",
    `<h2>${escapeHtml(title)}</h2>`,
    '<p class="note">这是该平台变体的 OpenUI Lang 源码交付件。在 DeepOrca 的原型工作区打开此套件可获得完整的交互预览（导航、表单、状态联动的渲染由应用内运行时承载）。</p>',
    `<pre>${escapeHtml(openuiSource)}</pre>`,
    `<script id="openui-source" type="application/json">${embedded}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
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

/** Build the .ddu package for the current UI-Design generation stack
 *  (OpenUI Lang source; viewer stub — same in-app runtime story as .ddp).
 *  Non-empty `extras.tokens` / non-empty `extras.components` each add a JSON
 *  entry (tokens.json / components.json) and are listed in `manifest.entries`. */
export function buildDduOpenuiPackage(
  artifact: { id: string; title: string },
  openuiSource: string,
  exportedAt: string,
  extras?: DduExtras
): Buffer {
  const tokens = extras?.tokens;
  const components = extras?.components;
  const hasTokens = isNonEmptyRecord(tokens);
  const componentList = Array.isArray(components) && components.length > 0 ? components : null;
  const extraNames: string[] = [];
  if (hasTokens) extraNames.push("tokens.json");
  if (componentList) extraNames.push("components.json");
  const manifest: DdPackageManifest = {
    format: "ddu",
    formatVersion: 1,
    kind: "ui-design",
    title: artifact.title,
    artifactId: artifact.id,
    pipeline: "openui",
    exportedAt,
    generator: GENERATOR,
    ...(extraNames.length > 0 ? { entries: extraNames } : {}),
  };
  const entries: PackageEntry[] = [
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
    { name: "source.openui.txt", data: Buffer.from(openuiSource, "utf8") },
    { name: "index.html", data: Buffer.from(buildDduOpenuiViewerHtml(artifact.title, openuiSource), "utf8") },
  ];
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

/** Viewer stub for the OpenUI-sourced .ddu (UI-Design). */
function buildDduOpenuiViewerHtml(title: string, source: string): string {
  const safeTitle = escapeHtml(title);
  const safeSource = escapeHtml(source);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle} — UI-Design source</title>
<style>
body{font-family:system-ui,sans-serif;background:#111418;color:#e6e6e6;margin:0;padding:32px;line-height:1.6}
h1{font-size:20px;margin:0 0 8px}
p{color:#9aa3ad;font-size:13px;margin:0 0 20px}
pre{background:#1b2027;border:1px solid #2a313a;border-radius:8px;padding:16px;font-size:12px;overflow:auto;white-space:pre-wrap}
</style>
</head>
<body>
<h1>${safeTitle}</h1>
<p>UI-Design document package (.ddu). The OpenUI Lang source below renders
interactively in DeepOrca (Designer → UI-Design preview); this file preserves
the exact source. See manifest.json for package metadata.</p>
<pre>${safeSource}</pre>
</body>
</html>`;
}

/**
 * Viewer stub for .ddp: OpenUI Lang has no standalone HTML compiler (it
 * renders through DeepOrca's in-app React runtime), so the stub surfaces the
 * source verbatim and points back to the app.
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
<p>PM-Design prototype package (.ddp). The OpenUI Lang source below renders
interactively in DeepOrca (Designer → PM-Design preview); this file preserves
the exact source. See manifest.json for package metadata.</p>
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
