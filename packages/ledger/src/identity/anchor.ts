// Identity anchor v3 — the DEVICE's persistent identity, sealed to hardware.
//
// Design intent (hardware-bound identity, no person tracking):
//   - `anchorId` is derived once from the genesis device key and NEVER changes;
//   - the active signing key CAN rotate (`rotations` is a self-authenticating
//     signature chain: each step is signed by the outgoing key, so anyone with
//     the public history can verify that the same device now holds the new key);
//   - the anchor is SEALED to one machine at creation (machineBinding.seal
//     signs over the machine fingerprint hash): on any other machine the
//     fingerprint mismatches → the anchor is an unbound clone and must not
//     sign. Key rotation only ever happens on the SEALED machine.
//   - nothing here is a person: no userName/email/account — only the device.
//
// The on-chain leg of rotation is the `member.rotate` record: the chain keeps
// a membership entry alive while its pubkey (and derived keyId) changes, so
// replay derives the pubkey timeline and history stays verifiable.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { jcsBytes, type JsonValue } from "../encode/jcs.js";
import {
  generateDeviceIdentity,
  keyIdFromPublicKeyDer,
  signBytes,
  verifyBytes,
  type DeviceIdentity,
} from "./identity.js";
import { fingerprintHash as hashFingerprint, machineFingerprintHash } from "./hardware-binding.js";

export const ANCHOR_VERSION = 3;

export interface AnchorSeal {
  kind: "machine-fingerprint";
  /** SHA-256 of the raw machine identifier — never the raw id itself. */
  fingerprintHash: string;
  at: string;
  /** Ed25519 signature over JCS({anchorId, fingerprintHash, at}), by the active key. */
  sigByKey: string;
}

export interface AnchorKeyEntry {
  pubKey: string;
  since: string;
  rotatedOutAt?: string;
}

export interface AnchorRotation {
  at: string;
  from: string;
  to: string;
  newPubKey: string;
  /** Signature by the OUTGOING key over JCS({at, from, to, newPubKey}). */
  sigByOldKey: string;
}

export interface IdentityAnchor {
  version: typeof ANCHOR_VERSION;
  /** Device identity that never changes across key rotations. */
  anchorId: string;
  deviceName: string;
  createdAt: string;
  /** Active signing key id — changes on rotation, anchorId does not. */
  currentKeyId: string;
  machineBinding: AnchorSeal | null;
  keys: Record<string, AnchorKeyEntry>;
  rotations: AnchorRotation[];
}

export class AnchorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorError";
  }
}

export interface CreateAnchorOptions {
  deviceName: string;
  /** Test/CI override — defaulting to real machine fingerprint collection. */
  fingerprint?: string;
  identity?: DeviceIdentity;
  createdAt?: string;
}

/** Create a hardware-sealed anchor. Refuses to seal without a fingerprint. */
export function createIdentityAnchor(options: CreateAnchorOptions): IdentityAnchor {
  const fingerprintHash =
    options.fingerprint && options.fingerprint.length > 0
      ? hashFingerprint(options.fingerprint)
      : machineFingerprintHash();
  if (!fingerprintHash) {
    throw new AnchorError(
      "no machine fingerprint available — cannot seal the anchor (set DEEPORCA_MACHINE_FINGERPRINT to override)"
    );
  }
  const identity = options.identity ?? generateDeviceIdentity();
  const createdAt = options.createdAt ?? new Date().toISOString();
  const seal: AnchorSeal = {
    kind: "machine-fingerprint",
    fingerprintHash,
    at: createdAt,
    sigByKey: sealSignature(identity, { anchorId: identity.keyId, fingerprintHash, at: createdAt }),
  };
  return {
    version: ANCHOR_VERSION,
    anchorId: identity.keyId,
    deviceName: options.deviceName,
    createdAt,
    currentKeyId: identity.keyId,
    machineBinding: seal,
    keys: { [identity.keyId]: { pubKey: identity.publicKeyBase64, since: createdAt } },
    rotations: [],
  };
}

/** Rotate the active key in place; the outgoing key signs the rotation. */
export interface RotateAnchorOptions {
  /** Reuse an already-generated incoming key (chain member.rotate) instead of minting a fresh one. */
  next?: DeviceIdentity;
}

export function rotateAnchorKey(
  anchor: IdentityAnchor,
  currentIdentity: DeviceIdentity,
  options: RotateAnchorOptions = {}
): { anchor: IdentityAnchor; identity: DeviceIdentity } {
  if (currentIdentity.keyId !== anchor.currentKeyId) {
    throw new AnchorError(`rotation identity mismatch: ${currentIdentity.keyId} != ${anchor.currentKeyId}`);
  }
  if (currentIdentity.publicKeyBase64 !== anchor.keys[currentIdentity.keyId]?.pubKey) {
    throw new AnchorError("rotation identity public key does not match the anchor entry");
  }
  const next = options.next ?? generateDeviceIdentity();
  const at = new Date().toISOString();
  const rotation: AnchorRotation = {
    at,
    from: currentIdentity.keyId,
    to: next.keyId,
    newPubKey: next.publicKeyBase64,
    sigByOldKey: rotationSignature(currentIdentity, {
      at,
      from: currentIdentity.keyId,
      to: next.keyId,
      newPubKey: next.publicKeyBase64,
    }),
  };
  const keys = { ...anchor.keys };
  keys[currentIdentity.keyId] = { ...(anchor.keys[currentIdentity.keyId] as AnchorKeyEntry), rotatedOutAt: at };
  keys[next.keyId] = { pubKey: next.publicKeyBase64, since: at };
  return {
    anchor: {
      ...anchor,
      currentKeyId: next.keyId,
      keys,
      rotations: [...anchor.rotations, rotation],
    },
    identity: next,
  };
}

export type AnchorBindingCheck = { bound: true } | { bound: false; reason: "tampered-seal" | "clone" | "no-seal" };

/**
 * Verify the seal against the CURRENT machine. A matching fingerprint means
 * this anchor lives on its sealed hardware. Anything else → unbound clone or
 * tampered seal → the anchor must not sign (callers fail closed).
 */
export function checkAnchorBinding(anchor: IdentityAnchor, fingerprint?: string): AnchorBindingCheck {
  const seal = anchor.machineBinding;
  if (!seal) {
    return { bound: false, reason: "no-seal" };
  }
  // The seal is signed by the GENESIS key (anchorId) — key rotation must not
  // invalidate the device's binding to its hardware.
  const sealKey = anchor.keys[anchor.anchorId];
  const digest = sealPayload({ anchorId: anchor.anchorId, fingerprintHash: seal.fingerprintHash, at: seal.at });
  if (!sealKey || !verifyBytes(sealKey.pubKey, digest, new Uint8Array(Buffer.from(seal.sigByKey, "base64")))) {
    return { bound: false, reason: "tampered-seal" };
  }
  const currentHash = fingerprint !== undefined ? hashFingerprint(fingerprint) : machineFingerprintHash();
  if (currentHash !== seal.fingerprintHash) {
    return { bound: false, reason: "clone" };
  }
  return { bound: true };
}

/**
 * Walk the rotation signature chain: every step signed by its outgoing key,
 * contiguous from anchorId to currentKeyId. Returns the current public key.
 */
export function verifyRotationChain(
  anchor: IdentityAnchor
): { ok: true; currentPubKey: string } | { ok: false; reason: string } {
  if (anchor.rotations.length === 0) {
    const entry = anchor.keys[anchor.currentKeyId];
    return entry ? { ok: true, currentPubKey: entry.pubKey } : { ok: false, reason: "current key missing" };
  }
  let previousTo = anchor.anchorId;
  for (const rotation of anchor.rotations) {
    if (rotation.from !== previousTo) {
      return { ok: false, reason: `rotation chain gap: ${previousTo} → ${rotation.from}` };
    }
    const fromEntry = anchor.keys[rotation.from];
    if (!fromEntry) {
      return { ok: false, reason: `missing key entry for ${rotation.from}` };
    }
    if (keyIdFromPublicKeyDer(new Uint8Array(Buffer.from(rotation.newPubKey, "base64"))) !== rotation.to) {
      return { ok: false, reason: `newPubKey does not derive to ${rotation.to}` };
    }
    const payload = jcsBytes(
      rotationPayload({ at: rotation.at, from: rotation.from, to: rotation.to, newPubKey: rotation.newPubKey })
    );
    if (!verifyBytes(fromEntry.pubKey, payload, new Uint8Array(Buffer.from(rotation.sigByOldKey, "base64")))) {
      return { ok: false, reason: `rotation signature broken at ${rotation.from} → ${rotation.to}` };
    }
    previousTo = rotation.to;
  }
  if (previousTo !== anchor.currentKeyId) {
    return { ok: false, reason: "rotation chain does not end at currentKeyId" };
  }
  const current = anchor.keys[anchor.currentKeyId];
  return current ? { ok: true, currentPubKey: current.pubKey } : { ok: false, reason: "current key missing" };
}

export function saveIdentityAnchor(anchor: IdentityAnchor, filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(anchor, null, 2) + "\n", { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

export function loadIdentityAnchor(filePath: string): IdentityAnchor {
  if (!existsSync(filePath)) {
    throw new AnchorError(`identity anchor not found: ${filePath}`);
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as IdentityAnchor;
  if (parsed.version !== ANCHOR_VERSION || typeof parsed.anchorId !== "string" || parsed.machineBinding === null) {
    throw new AnchorError(`unsupported or unsealed identity anchor: ${filePath}`);
  }
  if (parsed.machineBinding && typeof parsed.machineBinding.fingerprintHash !== "string") {
    throw new AnchorError(`malformed machine binding in: ${filePath}`);
  }
  return parsed;
}

function sealPayload(fields: { anchorId: string; fingerprintHash: string; at: string }): Uint8Array {
  return jcsBytes(fields as unknown as JsonValue);
}

function sealSignature(
  identity: DeviceIdentity,
  fields: { anchorId: string; fingerprintHash: string; at: string }
): string {
  return Buffer.from(signBytes(identity, sealPayload(fields))).toString("base64");
}

function rotationPayload(fields: { at: string; from: string; to: string; newPubKey: string }): JsonValue {
  return fields as unknown as JsonValue;
}

function rotationSignature(
  identity: DeviceIdentity,
  fields: { at: string; from: string; to: string; newPubKey: string }
): string {
  return Buffer.from(signBytes(identity, jcsBytes(rotationPayload(fields)))).toString("base64");
}
