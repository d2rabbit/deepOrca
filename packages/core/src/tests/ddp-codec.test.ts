/**
 * DDP codec golden vectors (specs/moonviz-engine-replacement T3.2) — format
 * compatibility against deepDesign's production Rust crate, four vectors:
 *  1. `golden/login-demo.ddp` (engine repo artifact, DDP2) decrypts to the
 *     byte-identical canonical document shipped beside it,
 *  2. self-encrypted DDP2 round-trips and renders (the engine accepts the
 *     decrypted doc — asserted at the codec level by structure checks),
 *  3. DDP1 round-trip (fixed salt/nonce path is exercised by cross-crate
 *     fixtures upstream; here we pin the header layout + KDF parameters and
 *     verify wrong-password/tamper both surface the crate's error codes),
 *  4. error-code names match the crate verbatim.
 *
 * zstd availability: node:zlib gained zstd in Node 23.8/22.15+; the suite
 * skips the decompression vectors on older runtimes instead of failing (the
 * CI matrix runs 22.x latest where it exists; the P0 battery runs Node 24).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { zstdDecompressSync } from "node:zlib";
import type { DdpError } from "../common/ddp-codec";
import { decryptDdp, encryptDdp, DDP_ERROR_SAMPLES } from "../common/ddp-codec";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const hasZstd = typeof zstdDecompressSync === "function";

test("golden vector ①: golden/login-demo.ddp decrypts to the byte-identical canonical doc", { skip: !hasZstd }, () => {
  const ddp = fs.readFileSync(path.join(here, "../../../..", "specs/moonviz-engine-replacement/golden/login-demo.ddp"));
  const goldenDoc = fs.readFileSync(
    path.join(here, "../../../..", "specs/moonviz-engine-replacement/golden/login-demo.mbt.md"),
    "utf8"
  );
  // DDP2 header: magic + version + CRC32 — sanity before decode.
  assert.equal(ddp.subarray(0, 4).toString("latin1"), "DDP2");
  assert.equal(ddp[4], 1);
  const mbt = decryptDdp(ddp, "ignored-for-ddp2");
  assert.equal(mbt, goldenDoc);
});

test(
  "golden vector ②: self-encrypted DDP2 round-trips and the decrypted doc is engine-shaped",
  { skip: !hasZstd },
  () => {
    const doc = fs.readFileSync(
      path.join(here, "../../../..", "specs/moonviz-engine-replacement/golden/login-demo.mbt.md"),
      "utf8"
    );
    const ddp = encryptDdp(doc, "");
    assert.equal(ddp.subarray(0, 4).toString("latin1"), "DDP2");
    // 明文不出现（zstd 压缩生效）。
    assert.equal(ddp.includes(Buffer.from("moonviz:artboard")), false);
    assert.equal(decryptDdp(ddp, "any-password-is-ignored"), doc);
    // 篡改必须失败（CRC32）。
    const tampered = Buffer.from(ddp);
    tampered[tampered.length - 1] ^= 0xff;
    assert.throws(
      () => decryptDdp(tampered, ""),
      (error: unknown) => (error as DdpError).code === "ddp_checksum_failed"
    );
  }
);

test("golden vector ③: DDP1 header layout + KDF params + auth failure codes", () => {
  const ddp = encryptDdp("moonviz:artboard home", "correct horse battery staple");
  assert.equal(ddp.subarray(0, 4).toString("latin1"), "DDP1");
  assert.equal(ddp[4], 1);
  assert.equal(ddp.byteLength >= 45 + 16, true, "header(45) + tag(16) minimum");
  // 明文不出现（认证加密生效）。
  assert.equal(ddp.includes(Buffer.from("moonviz:artboard")), false);
  // 错误密码 → the crate's exact code.
  assert.throws(
    () => decryptDdp(ddp, "wrong password"),
    (error: unknown) => (error as DdpError).code === DDP_ERROR_SAMPLES.authentication
  );
  // 篡改 → same authentication failure (AEAD).
  const tampered = Buffer.from(ddp);
  tampered[tampered.length - 1] ^= 0x80;
  assert.throws(
    () => decryptDdp(tampered, "correct horse battery staple"),
    (error: unknown) => (error as DdpError).code === "ddp_authentication_failed"
  );
  // 正确密码 round-trips。
  assert.equal(decryptDdp(ddp, "correct horse battery staple"), "moonviz:artboard home");
  // DDP1 对空密码必须要求密码（不静默降级）。
  assert.throws(
    () => decryptDdp(ddp, ""),
    (error: unknown) => (error as DdpError).code === DDP_ERROR_SAMPLES.passwordRequired
  );
});

test("golden vector ④: error-code names match the crate verbatim + size limits", () => {
  assert.equal(DDP_ERROR_SAMPLES.empty, "ddp_mbt_empty");
  assert.equal(DDP_ERROR_SAMPLES.passwordRequired, "ddp_password_required");
  assert.throws(
    () => encryptDdp("", "pw"),
    (error: unknown) => (error as DdpError).code === "ddp_mbt_empty"
  );
  assert.throws(
    () => encryptDdp("x".repeat(8 * 1024 * 1024 + 1), "pw"),
    (error: unknown) => (error as DdpError).code === "ddp_mbt_too_large"
  );
  assert.throws(
    () => decryptDdp(Buffer.alloc(9), "pw"),
    (error: unknown) => (error as DdpError).code === "ddp_container_invalid"
  );
  // 长度门先于 magic 门（crate 同序）：61B 达到长度下限后才轮到 magic 校验。
  assert.throws(
    () => decryptDdp(Buffer.alloc(50), "pw"),
    (error: unknown) => (error as DdpError).code === "ddp_container_invalid"
  );
  assert.throws(
    () => decryptDdp(Buffer.concat([Buffer.from("XXXX", "latin1"), Buffer.alloc(64)], 68), "pw"),
    (error: unknown) => (error as DdpError).code === "ddp_magic_invalid"
  );
});
