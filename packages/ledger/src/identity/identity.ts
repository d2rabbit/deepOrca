// Device identity (design §3): one Ed25519 keypair per machine, stored at
// ~/.deeporca/coordchain/device-key.json with 0600 permissions. The keyId is
// the on-chain member identifier and is derived from the public key so it is
// stable across loads without trusting the stored file for it.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface DeviceIdentity {
  /** "did:" + first 16 hex chars of SHA-256(SPKI DER) — stable member id. */
  keyId: string;
  /** SubjectPublicKeyInfo DER, base64. */
  publicKeyBase64: string;
  /** PKCS#8 DER, base64. Never leaves the machine. */
  privateKeyBase64: string;
  createdAt: string;
}

const IDENTITY_VERSION = 1;

export function generateDeviceIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = new Uint8Array(publicKey.export({ format: "der", type: "spki" }));
  const privateKeyDer = new Uint8Array(privateKey.export({ format: "der", type: "pkcs8" }));
  return {
    keyId: keyIdFromPublicKeyDer(publicKeyDer),
    publicKeyBase64: Buffer.from(publicKeyDer).toString("base64"),
    privateKeyBase64: Buffer.from(privateKeyDer).toString("base64"),
    createdAt: new Date().toISOString(),
  };
}

export function keyIdFromPublicKeyDer(publicKeyDer: Uint8Array): string {
  const digest = createHash("sha256").update(publicKeyDer).digest();
  return "did:" + digest.subarray(0, 8).toString("hex");
}

export function keyIdFromPublicKeyBase64(publicKeyBase64: string): string {
  return keyIdFromPublicKeyDer(new Uint8Array(Buffer.from(publicKeyBase64, "base64")));
}

/** Human-readable grouping of a keyId, e.g. "did:9f3a b1c2 d3e4 f506". */
export function fingerprint(keyId: string): string {
  const rest = keyId.startsWith("did:") ? keyId.slice(4) : keyId;
  const groups = rest.match(/.{1,4}/g) ?? [];
  return "did:" + groups.join(" ");
}

/** Persist the identity as versioned JSON with 0600 file permissions. */
export function saveDeviceIdentity(identity: DeviceIdentity, filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const payload = {
    version: IDENTITY_VERSION,
    createdAt: identity.createdAt,
    publicKey: identity.publicKeyBase64,
    privateKey: identity.privateKeyBase64,
  };
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  // Some platforms ignore the mode argument on write; chmod makes the intent explicit.
  chmodSync(filePath, 0o600);
}

export function loadDeviceIdentity(filePath: string): DeviceIdentity {
  if (!existsSync(filePath)) {
    throw new Error(`device identity not found: ${filePath}`);
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
    version?: number;
    createdAt?: string;
    publicKey?: string;
    privateKey?: string;
  };
  if (raw.version !== IDENTITY_VERSION || typeof raw.publicKey !== "string" || typeof raw.privateKey !== "string") {
    throw new Error(`unsupported device identity file: ${filePath}`);
  }
  const publicKeyDer = new Uint8Array(Buffer.from(raw.publicKey, "base64"));
  const keyId = keyIdFromPublicKeyDer(publicKeyDer);
  return {
    keyId,
    publicKeyBase64: raw.publicKey,
    privateKeyBase64: raw.privateKey,
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
  };
}

export function signBytes(identity: DeviceIdentity, data: Uint8Array): Uint8Array {
  const key = createPrivateKey({ key: Buffer.from(identity.privateKeyBase64, "base64"), format: "der", type: "pkcs8" });
  return new Uint8Array(sign(null, data, key));
}

export function verifyBytes(publicKeyBase64: string, data: Uint8Array, signature: Uint8Array): boolean {
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" });
  } catch {
    return false;
  }
  try {
    return verify(null, data, key, signature);
  } catch {
    return false;
  }
}
