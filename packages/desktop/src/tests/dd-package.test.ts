import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { buildDdpPackage, buildDduPackage, zipEntries } from "../main/tools/dd-package";

/**
 * Minimal zip READER for structural round-trip assertions: locate the EOCD,
 * walk the central directory, inflate each entry. Deliberately independent of
 * the writer's code path — if the writer emits a malformed archive (bad
 * signatures/offsets/sizes), these parses throw or mismatch.
 */
function readZip(buf: Buffer): Map<string, Buffer> {
  // EOCD is in the last 22 + comment bytes; comment is always 0 here, scan
  // backwards for the signature to stay robust anyway.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.ok(eocd >= 0, "EOCD signature not found");
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, `central header #${i}`);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    // Cross-check against the local header before inflating.
    assert.equal(buf.readUInt32LE(localOffset), 0x04034b50, `local header for ${name}`);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const stored = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 8 ? inflateRawSync(stored) : Buffer.from(stored);
    assert.equal(data.length, uncompSize, `uncompressed size for ${name}`);
    // CRC32 (same polynomial as the writer — computed independently here).
    let c = 0xffffffff;
    for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
    assert.equal((c ^ 0xffffffff) >>> 0, crc, `crc32 for ${name}`);
    out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

test("zipEntries round-trips text and binary entries (structure + crc verified)", () => {
  const binary = Buffer.from([0, 1, 2, 255, 254, 0, 7, 7, 7]);
  const zip = zipEntries([
    { name: "a.txt", data: Buffer.from("hello 中文", "utf8") },
    { name: "b.bin", data: binary },
  ]);
  const files = readZip(zip);
  assert.equal(files.get("a.txt")!.toString("utf8"), "hello 中文");
  assert.deepEqual(files.get("b.bin"), binary);
});

test("zipEntries handles incompressible data via the store fallback", () => {
  // Already-deflated content defeats compression → the writer must store it.
  const incompressible = deflateRawSync(Buffer.from("aaaaaaaaaaaaaaaaaaaa"));
  const zip = zipEntries([{ name: "blob", data: incompressible }]);
  const files = readZip(zip);
  assert.deepEqual(files.get("blob"), incompressible);
});

test("buildDduPackage: manifest + source.dd + standalone index.html", () => {
  const zip = buildDduPackage(
    { id: "art-1", title: "Landing V2" },
    "---\nname: Landing V2\n---\n<body>",
    "<!doctype html><html>…</html>",
    "2026-08-18T10:00:00.000Z"
  );
  const files = readZip(zip);
  assert.deepEqual([...files.keys()].sort(), ["index.html", "manifest.json", "source.dd"]);
  const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
  assert.equal(manifest.format, "ddu");
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.kind, "ui-design");
  assert.equal(manifest.pipeline, "design");
  assert.equal(manifest.title, "Landing V2");
  assert.equal(manifest.artifactId, "art-1");
  assert.equal(manifest.exportedAt, "2026-08-18T10:00:00.000Z");
  assert.equal(files.get("source.dd")!.toString("utf8"), "---\nname: Landing V2\n---\n<body>");
  assert.ok(files.get("index.html")!.toString("utf8").startsWith("<!doctype html>"));
});

test("buildDdpPackage: manifest + source.openui.txt + escaped viewer stub", () => {
  const source = 'root = Column([\n  Button("Click <me>")\n])';
  const zip = buildDdpPackage({ id: "art-2", title: "Checkout Proto" }, source, "2026-08-18T11:00:00.000Z");
  const files = readZip(zip);
  assert.deepEqual([...files.keys()].sort(), ["index.html", "manifest.json", "source.openui.txt"]);
  const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
  assert.equal(manifest.format, "ddp");
  assert.equal(manifest.kind, "pm-design");
  assert.equal(manifest.pipeline, "openui");
  assert.equal(files.get("source.openui.txt")!.toString("utf8"), source);
  const html = files.get("index.html")!.toString("utf8");
  assert.ok(html.includes("Checkout Proto"));
  // The source is HTML-escaped inside the viewer stub.
  assert.ok(html.includes("Click &lt;me&gt;"));
  assert.equal(html.includes("Click <me>"), false);
});
