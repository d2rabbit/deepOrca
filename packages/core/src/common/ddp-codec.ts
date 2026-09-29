/**
 * DDP container codec (specs/moonviz-engine-replacement T3.1) — TypeScript
 * in-process implementation of the MoonViz design-package container, format
 * gold-referenced against deepDesign's production vendor crate
 * (deepDesign/vendor/moonviz-ddp/src/lib.rs; same crate version the engine
 * reads). Zero subprocess, zero Rust toolchain.
 *
 *   DDP2 (无密码): "DDP2" + ver(1) + CRC32-IEEE(zstdFrame, 4B LE) + zstd(mbt, 8)
 *   DDP1 (密码):  "DDP1" + ver(1) + salt(16) + nonce(24)
 *                 + XChaCha20-Poly1305(key=Argon2id(m=19MiB,t=2,p=1,32B,v=0x13,
 *                   aad=45B header), msg=zstd(mbt, 8))
 *
 * Limits mirror the crate exactly (error codes are part of the format):
 * plaintext ≤ 8 MiB, ciphertext ≤ 16 MiB, empty mbt rejected, every failure
 * surfaced as a `ddp_*` code string.
 *
 * The empty password → DDP2 mapping is the ACTION-layer convention (P3 出口:
 * export_ddp with an empty password produces the freely viewable DDP2;
 * the DDP1 password UX remains a deferred product decision — the codec
 * itself supports both).
 *
 * NOTE on the `.ddp` extension: two producers share it with incompatible
 * payloads — the desktop suite export (buildDdpPackage) is a ZIP ("PK"
 * magic), this codec's container is binary DDP1/DDP2. Disambiguate by magic
 * bytes on any future import/viewer path; do NOT assume one format.
 */

import { zstdCompressSync, zstdDecompressSync, crc32 as zlibCrc32, constants as zlibConstants } from "node:zlib";
import { argon2id } from "@noble/hashes/argon2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "node:crypto";

const DDP_MAGIC: Uint8Array = Uint8Array.of(0x44, 0x44, 0x50, 0x31); // "DDP1"
const DDP_MAGIC_OPEN: Uint8Array = Uint8Array.of(0x44, 0x44, 0x50, 0x32); // "DDP2"
const DDP_VERSION = 1;
const DDP_SALT_BYTES = 16;
const DDP_NONCE_BYTES = 24;
const DDP_HEADER_BYTES = 4 + 1 + DDP_SALT_BYTES + DDP_NONCE_BYTES; // 45 (the AAD length)
const DDP_MAX_PLAINTEXT_BYTES = 8 * 1024 * 1024;
const DDP_MAX_CIPHERTEXT_BYTES = 16 * 1024 * 1024;
const ZSTD_LEVEL = 8;
const ARGON2_MEMORY_KIB = 19 * 1024;
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_KEY_BYTES = 32;

export class DdpError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "DdpError";
    this.code = code;
  }
}

function crc32Ieee(data: Uint8Array): number {
  // zlib.crc32 是 IEEE CRC32（与 Rust crate 的无查表实现同值域，Node ≥ 20.15）。
  return zlibCrc32(data);
}

function deriveDdpKey(password: string, salt: Uint8Array): Uint8Array {
  return argon2id(password, salt, {
    m: ARGON2_MEMORY_KIB,
    t: ARGON2_ITERATIONS,
    p: ARGON2_PARALLELISM,
    dkLen: ARGON2_KEY_BYTES,
  });
}

/** Encrypt one canonical `.mbt.md` into the DDP container. Empty password →
 *  DDP2 (zstd + CRC32, freely viewable); non-empty → DDP1 authenticated
 *  encryption with OS randomness for salt/nonce. */
export function encryptDdp(mbt: string, password: string): Buffer {
  if (mbt.length === 0) throw new DdpError("ddp_mbt_empty");
  const plaintext = Buffer.from(mbt, "utf8");
  if (plaintext.byteLength > DDP_MAX_PLAINTEXT_BYTES) throw new DdpError("ddp_mbt_too_large");

  let compressed: Buffer;
  try {
    // node:zlib 的 zstd 选项面是 params + ZSTD_c_* 常量（无 level 快捷键）；
    // 压缩级 8 对齐 Rust crate 的 encode_all(_, 8)。
    compressed = zstdCompressSync(plaintext, {
      params: { [zlibConstants.ZSTD_c_compressionLevel]: ZSTD_LEVEL },
    });
  } catch {
    throw new DdpError("ddp_compression_failed");
  }

  if (password.length === 0) {
    const header = Buffer.alloc(9);
    header.set(DDP_MAGIC_OPEN, 0);
    header[4] = DDP_VERSION;
    header.writeUInt32LE(crc32Ieee(compressed), 5);
    return Buffer.concat([header, compressed]);
  }

  const salt = randomBytes(DDP_SALT_BYTES);
  const nonce = randomBytes(DDP_NONCE_BYTES);
  try {
    const header = Buffer.concat([Buffer.from(DDP_MAGIC), Buffer.of(DDP_VERSION), salt, nonce]);
    const key = deriveDdpKey(password, salt);
    // noble-ciphers v2：AAD 在构造期传入（这里是 45B 明文头，与 crate 一致）。
    const ciphertext = xchacha20poly1305(key, nonce, header).encrypt(compressed);
    if (ciphertext.byteLength > DDP_MAX_CIPHERTEXT_BYTES) throw new DdpError("ddp_ciphertext_too_large");
    return Buffer.concat([header, Buffer.from(ciphertext)]);
  } catch (error) {
    if (error instanceof DdpError) throw error;
    throw new DdpError("ddp_encryption_failed");
  }
}

/** Decrypt a DDP container back to the canonical `.mbt.md`. All format and
 *  authentication failures throw DdpError with the crate's error codes. */
export function decryptDdp(bytes: Buffer, password: string): string {
  if (bytes.byteLength < 10 || bytes.byteLength > DDP_MAX_CIPHERTEXT_BYTES + 16) {
    throw new DdpError("ddp_container_invalid");
  }

  // DDP2 open mode: zstd + CRC32, no password.
  if (bytes.subarray(0, 4).every((byte, index) => byte === DDP_MAGIC_OPEN[index])) {
    if (bytes[4] !== DDP_VERSION) throw new DdpError("ddp_version_unsupported");
    const storedCrc = bytes.readUInt32LE(5);
    const payload = bytes.subarray(9);
    if (crc32Ieee(payload) !== storedCrc) throw new DdpError("ddp_checksum_failed");
    let plaintext: Buffer;
    try {
      plaintext = zstdDecompressSync(payload);
    } catch {
      throw new DdpError("ddp_decompression_failed");
    }
    if (plaintext.byteLength === 0 || plaintext.byteLength > DDP_MAX_PLAINTEXT_BYTES) {
      throw new DdpError("ddp_plaintext_invalid");
    }
    const text = plaintext.toString("utf8");
    if (Buffer.compare(Buffer.from(text, "utf8"), plaintext) !== 0) throw new DdpError("ddp_mbt_not_utf8");
    return text;
  }

  if (password.length === 0) throw new DdpError("ddp_password_required");
  if (bytes.byteLength < DDP_HEADER_BYTES + 16 || bytes.byteLength > DDP_MAX_CIPHERTEXT_BYTES + DDP_HEADER_BYTES) {
    throw new DdpError("ddp_container_invalid");
  }
  if (!bytes.subarray(0, 4).every((byte, index) => byte === DDP_MAGIC[index])) {
    throw new DdpError("ddp_magic_invalid");
  }
  if (bytes[4] !== DDP_VERSION) throw new DdpError("ddp_version_unsupported");

  const salt = bytes.subarray(5, 5 + DDP_SALT_BYTES);
  const nonce = bytes.subarray(5 + DDP_SALT_BYTES, DDP_HEADER_BYTES);
  const aad = bytes.subarray(0, DDP_HEADER_BYTES);
  const ciphertext = bytes.subarray(DDP_HEADER_BYTES);
  let compressed: Uint8Array;
  try {
    const key = deriveDdpKey(password, salt);
    compressed = xchacha20poly1305(key, nonce, aad).decrypt(ciphertext);
  } catch {
    throw new DdpError("ddp_authentication_failed");
  }
  let plaintext: Buffer;
  try {
    plaintext = zstdDecompressSync(compressed);
  } catch {
    throw new DdpError("ddp_decompression_failed");
  }
  if (plaintext.byteLength === 0 || plaintext.byteLength > DDP_MAX_PLAINTEXT_BYTES) {
    throw new DdpError("ddp_plaintext_invalid");
  }
  const text = plaintext.toString("utf8");
  if (Buffer.compare(Buffer.from(text, "utf8"), plaintext) !== 0) throw new DdpError("ddp_mbt_not_utf8");
  return text;
}

export const DDP_ERROR_SAMPLES = {
  empty: "ddp_mbt_empty",
  passwordRequired: "ddp_password_required",
  authentication: "ddp_authentication_failed",
  checksum: "ddp_checksum_failed",
} as const;
