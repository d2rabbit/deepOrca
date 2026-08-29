// Channel crypto for the LAN sync link (design §7, R19).
//
// Every byte that crosses the wire after the handshake is inside an
// AES-256-GCM frame. Session keys come from an X25519 ephemeral ECDH mixed
// through HKDF-SHA256 with both ephemeral public keys as the salt, so a
// compromised long-term Ed25519 key cannot passively decrypt past captures,
// and both sides contribute to the key. Frames carry a strictly increasing
// sequence number bound via AAD — reordering and replay fail decryption with
// ChannelError instead of being accepted silently.
//
// The frame layer is transport-agnostic raw bytes: desktop's transport.ts
// sends one frame per ws message; tests drive it over in-memory pipes and
// real TCP sockets alike.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { bytesEqual } from "../encode/bytes.js";

const SEQ_BYTES = 4;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HKDF_INFO = "deeporca-chain/v1 channel keys";

export type ChannelRole = "initiator" | "responder";

export class ChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelError";
  }
}

export interface EphemeralKeyPair {
  /** Raw 32-byte X25519 public key, base64 (goes on the wire). */
  publicKeyB64: string;
  /** Raw 32-byte X25519 private key. Never leaves the process. */
  privateKeyRaw: Uint8Array;
}

export function generateEphemeralKeyPair(): EphemeralKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  // X25519 SPKI DER is a fixed 12-byte prefix + the 32-byte raw key.
  const raw = new Uint8Array(der).subarray(der.length - 32);
  return {
    publicKeyB64: Buffer.from(raw).toString("base64"),
    privateKeyRaw: new Uint8Array(privateKey.export({ format: "der", type: "pkcs8" }).subarray(16)),
  };
}

const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

export function x25519PublicFromRaw(raw: Uint8Array) {
  return createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, Buffer.from(raw)]), format: "der", type: "spki" });
}

export function x25519PrivateFromRaw(raw: Uint8Array) {
  return createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, Buffer.from(raw)]),
    format: "der",
    type: "pkcs8",
  });
}

export interface SessionKeys {
  sendKey: Uint8Array;
  recvKey: Uint8Array;
}

/**
 * Derive the directional AES-256 keys from the ephemeral ECDH. The initiator
 * sends with the first half of the HKDF output, the responder with the second,
 * so the two directions never reuse (key, nonce) pairs even by coincidence.
 */
export function deriveSessionKeys(
  myEphemeral: EphemeralKeyPair,
  peerEphemeralPubB64: string,
  role: ChannelRole
): SessionKeys {
  const peerRaw = new Uint8Array(Buffer.from(peerEphemeralPubB64, "base64"));
  if (peerRaw.byteLength !== 32) {
    throw new ChannelError("peer ephemeral public key must be 32 raw bytes");
  }
  const shared = new Uint8Array(
    diffieHellman({
      privateKey: x25519PrivateFromRaw(myEphemeral.privateKeyRaw),
      publicKey: x25519PublicFromRaw(peerRaw),
    })
  );
  // All-zero X25519 output = degenerate key pair on the wire; refuse rather
  // than deriving a known key (contributory-behavior guard).
  if (shared.every((byte) => byte === 0)) {
    throw new ChannelError("degenerate ECDH shared secret");
  }
  const sortedPubs = [
    Buffer.from(new Uint8Array(Buffer.from(myEphemeral.publicKeyB64, "base64"))),
    Buffer.from(peerRaw),
  ].sort((a, b) => a.compare(b));
  const salt = createHash("sha256").update(Buffer.concat(sortedPubs)).digest();
  const okm = new Uint8Array(hkdfSync("sha256", shared, salt, Buffer.from(HKDF_INFO, "utf8"), 64));
  const first = okm.subarray(0, 32);
  const second = okm.subarray(32, 64);
  return role === "initiator" ? { sendKey: first, recvKey: second } : { sendKey: second, recvKey: first };
}

/** frame = seq(u32 BE) || nonce(12) || AES-256-GCM(plaintext, AAD=seq) || tag(16). */
export class FrameCodec {
  private sendSeq = 0;
  private recvSeq = 0;

  constructor(private readonly keys: SessionKeys) {}

  encryptFrame(plaintext: Uint8Array): Uint8Array {
    if (this.sendSeq >= 0xffffffff) {
      throw new ChannelError("send sequence exhausted — renegotiate the channel");
    }
    const seq = ++this.sendSeq;
    const seqBytes = Buffer.alloc(SEQ_BYTES);
    seqBytes.writeUInt32BE(seq);
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(this.keys.sendKey), nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(seqBytes);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    return Buffer.concat([seqBytes, nonce, ciphertext, cipher.getAuthTag()]);
  }

  /** Throws ChannelError on tampering, truncation, reordering or replay. */
  decryptFrame(frame: Uint8Array): Uint8Array {
    if (frame.byteLength < SEQ_BYTES + NONCE_BYTES + TAG_BYTES) {
      throw new ChannelError("frame too short");
    }
    const view = Buffer.from(frame);
    const seq = view.readUInt32BE(0);
    if (seq <= this.recvSeq) {
      throw new ChannelError(`frame sequence ${seq} not newer than ${this.recvSeq} (replay or reorder)`);
    }
    const seqBytes = view.subarray(0, SEQ_BYTES);
    const nonce = view.subarray(SEQ_BYTES, SEQ_BYTES + NONCE_BYTES);
    const body = view.subarray(SEQ_BYTES + NONCE_BYTES, view.byteLength - TAG_BYTES);
    const tag = view.subarray(view.byteLength - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(this.keys.recvKey), nonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(seqBytes);
    decipher.setAuthTag(tag);
    let plaintext: Buffer;
    try {
      plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      throw new ChannelError(`frame authentication failed at seq ${seq}`);
    }
    this.recvSeq = seq;
    return new Uint8Array(plaintext);
  }

  get lastReceivedSeq(): number {
    return this.recvSeq;
  }
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return bytesEqual(a, b);
}
