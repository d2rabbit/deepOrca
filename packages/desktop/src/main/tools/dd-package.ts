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
 *   .ddu — UI-Design document export (pipeline "design", .dd artifacts):
 *          manifest.json + source.dd + index.html (STANDALONE compiled
 *          render: tokens + seed CSS + inlined Tailwind JIT).
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
}

const GENERATOR = "DeepOrca Desktop";

/** Build the .ddp package (PM-Design / openui pipeline). */
export function buildDdpPackage(
  artifact: { id: string; title: string },
  openuiSource: string,
  exportedAt: string
): Buffer {
  const manifest: DdPackageManifest = {
    format: "ddp",
    formatVersion: 1,
    kind: "pm-design",
    title: artifact.title,
    artifactId: artifact.id,
    pipeline: "openui",
    exportedAt,
    generator: GENERATOR,
  };
  return zipEntries([
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
    { name: "source.openui.txt", data: Buffer.from(openuiSource, "utf8") },
    { name: "index.html", data: Buffer.from(buildDdpViewerHtml(artifact.title, openuiSource), "utf8") },
  ]);
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
