// Transport handshake (design §7, R19/R25/R26).
//
// Sequence over any text-link (one canonical-JSON message per link message):
//   i→r  hello      { v, keyId, pubKey, themeShort? }
//   r→i  challenge  { v, keyId, pubKey, nonce(32B), ephPub }
//   i→r  response   { nonce(echo), ephPub, sig }
//   r→i  done       { sig }
//   either side may send bye { reason } to abort cleanly.
//
// The signatures cover the full transcript (both keyIds, the challenge nonce
// and both ephemeral X25519 public keys), so after `done` both sides hold a
// mutually-authenticated, forward-secret FrameCodec. `pubKey` is
// self-asserted but binding-checked (keyId must derive from it); whether the
// peer is a chain MEMBER is enforced above this layer during sync (the
// member.join record carries the authoritative key).
//
// Theme pinning here is defense in depth: discovery (OC2 discovery.ts)
// already isolates cross-theme instances, and the handshake re-checks
// themeShort so a mis-wired connection can never progress (R25/R26).

import { randomBytes } from "node:crypto";
import { jcsBytes, jcsStringify, type JsonValue } from "../encode/jcs.js";
import { keyIdFromPublicKeyBase64, signBytes, verifyBytes, type DeviceIdentity } from "../identity/identity.js";
import {
  deriveSessionKeys,
  generateEphemeralKeyPair,
  FrameCodec,
  type ChannelRole,
  type EphemeralKeyPair,
} from "./channel-crypto.js";

export const PROTOCOL_VERSION = 1;
const NONCE_BYTES = 32;
const DEFAULT_TIMEOUT_MS = 10_000;

export class HandshakeError extends Error {
  constructor(
    message: string,
    readonly reason: string
  ) {
    super(message);
    this.name = "HandshakeError";
  }
}

export type { ChannelRole };

export interface HandshakeResult {
  role: ChannelRole;
  peerKeyId: string;
  peerPubKey: string;
  peerThemeShort?: string;
  session: FrameCodec;
}

/** Minimal text link the driver runs over (ws / TCP / in-memory pipe adapters). */
export interface HandshakeLink {
  send(text: string): void;
  /** Resolves with the next inbound text; rejects when the link closes. */
  next(): Promise<string>;
}

export interface HandshakeOptions {
  /** Our own short theme id advertised to the peer. */
  themeShort?: string;
  /** Abort unless the peer advertises exactly this short theme id (R25/R26). */
  expectThemeShort?: string;
  /** Abort unless the peer's keyId matches (invite/known-member pinning). */
  expectKeyId?: string;
  timeoutMs?: number;
}

type WireMessage = Record<string, JsonValue> & { kind: string };

function wire(kind: string, fields: Record<string, JsonValue>): string {
  return jcsStringify({ kind, ...fields });
}

function parseWire(text: string): WireMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HandshakeError("handshake message is not JSON", "malformed");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HandshakeError("handshake message is not an object", "malformed");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.kind !== "string") {
    throw new HandshakeError("handshake message missing kind", "malformed");
  }
  return record as WireMessage;
}

function checkBinding(keyId: unknown, pubKey: unknown): { keyId: string; pubKey: string } {
  if (typeof keyId !== "string" || typeof pubKey !== "string") {
    throw new HandshakeError("handshake message missing keyId/pubKey", "malformed");
  }
  if (keyIdFromPublicKeyBase64(pubKey) !== keyId) {
    throw new HandshakeError(`announced keyId ${keyId} does not bind to its public key`, "binding");
  }
  return { keyId, pubKey };
}

function checkVersion(v: unknown): void {
  if (v !== PROTOCOL_VERSION) {
    throw new HandshakeError(`protocol version mismatch: ${String(v)} != ${PROTOCOL_VERSION}`, "version");
  }
}

function checkTheme(peerThemeShort: unknown, expect: string | undefined, label: string): string | undefined {
  const themeShort = typeof peerThemeShort === "string" ? peerThemeShort : undefined;
  if (expect !== undefined && themeShort !== expect) {
    throw new HandshakeError(`${label} theme mismatch: ${String(themeShort)} != ${expect}`, "theme");
  }
  return themeShort;
}

function transcriptPayload(fields: {
  role: "initiator" | "responder";
  initiatorKeyId: string;
  responderKeyId: string;
  nonce: string;
  initiatorEph: string;
  responderEph: string;
}): JsonValue {
  return { ...fields, v: PROTOCOL_VERSION };
}

function signTranscript(identity: DeviceIdentity, payload: JsonValue): string {
  return Buffer.from(signBytes(identity, jcsBytes(payload))).toString("base64");
}

function verifyTranscript(pubKey: string, payload: JsonValue, sig: unknown): void {
  if (typeof sig !== "string") {
    throw new HandshakeError("missing transcript signature", "malformed");
  }
  const ok = verifyBytes(pubKey, jcsBytes(payload), new Uint8Array(Buffer.from(sig, "base64")));
  if (!ok) {
    throw new HandshakeError("transcript signature verification failed", "authenticity");
  }
}

interface Transcript {
  initiatorKeyId: string;
  responderKeyId: string;
  nonce: string;
  initiatorEph: string;
  responderEph: string;
}

/**
 * Run the full handshake over `link` and return the authenticated peer
 * identity plus the ready-to-use encrypted session. Throws HandshakeError on
 * version/binding/theme/signature mismatch or timeout; bye-reasons surface as
 * the error's `reason`.
 */
export async function runHandshake(
  link: HandshakeLink,
  role: ChannelRole,
  identity: DeviceIdentity,
  options: HandshakeOptions = {}
): Promise<HandshakeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runHandshakeInner(link, role, identity, options),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HandshakeError("handshake timed out", "timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function runHandshakeInner(
  link: HandshakeLink,
  role: ChannelRole,
  identity: DeviceIdentity,
  options: HandshakeOptions
): Promise<HandshakeResult> {
  const eph = generateEphemeralKeyPair();
  if (role === "initiator") {
    return runInitiator(link, identity, options, eph);
  }
  return runResponder(link, identity, options, eph);
}

async function nextMessage(link: HandshakeLink, expected: string[]): Promise<WireMessage> {
  const message = parseWire(await link.next());
  if (message.kind === "bye") {
    const reason = typeof message.reason === "string" ? message.reason : "unknown";
    throw new HandshakeError(`peer aborted handshake: ${reason}`, reason);
  }
  if (!expected.includes(message.kind)) {
    throw new HandshakeError(
      `unexpected handshake message ${message.kind}, expected ${expected.join("|")}`,
      "sequence"
    );
  }
  return message;
}

function abort(link: HandshakeLink, reason: string): never {
  try {
    link.send(wire("bye", { reason }));
  } catch {
    // link already dead — the HandshakeError below is what matters.
  }
  throw new HandshakeError(`handshake aborted: ${reason}`, reason);
}

async function runInitiator(
  link: HandshakeLink,
  identity: DeviceIdentity,
  options: HandshakeOptions,
  eph: EphemeralKeyPair
): Promise<HandshakeResult> {
  link.send(
    wire("hello", {
      v: PROTOCOL_VERSION,
      keyId: identity.keyId,
      pubKey: identity.publicKeyBase64,
      ...(options.themeShort ? { themeShort: options.themeShort } : {}),
    })
  );

  const challenge = await nextMessage(link, ["challenge"]);
  if (challenge.kind === "challenge") {
    try {
      checkVersion(challenge.v);
      const peer = checkBinding(challenge.keyId, challenge.pubKey);
      if (options.expectKeyId !== undefined && peer.keyId !== options.expectKeyId) {
        abort(link, "keyId");
      }
      const themeShort = checkTheme(challenge.themeShort, options.expectThemeShort, "peer");
      const nonce = challenge.nonce;
      const peerEph = challenge.ephPub;
      if (typeof nonce !== "string" || typeof peerEph !== "string") {
        throw new HandshakeError("challenge missing nonce/ephPub", "malformed");
      }
      const keys = deriveSessionKeys(eph, peerEph, "initiator");
      const transcript: Transcript = {
        initiatorKeyId: identity.keyId,
        responderKeyId: peer.keyId,
        nonce,
        initiatorEph: eph.publicKeyB64,
        responderEph: peerEph,
      };
      const sig = signTranscript(identity, transcriptPayload({ ...transcript, role: "initiator" }));
      link.send(wire("response", { nonce, ephPub: eph.publicKeyB64, sig }));
      const done = await nextMessage(link, ["done"]);
      if (done.kind === "done") {
        verifyTranscript(peer.pubKey, transcriptPayload({ ...transcript, role: "responder" }), done.sig);
        return {
          role: "initiator",
          peerKeyId: peer.keyId,
          peerPubKey: peer.pubKey,
          ...(themeShort ? { peerThemeShort: themeShort } : {}),
          session: new FrameCodec(keys),
        };
      }
    } catch (error) {
      if (error instanceof HandshakeError) {
        abort(link, error.reason);
      }
      throw error;
    }
  }
  throw new HandshakeError("unreachable", "sequence");
}

async function runResponder(
  link: HandshakeLink,
  identity: DeviceIdentity,
  options: HandshakeOptions,
  eph: EphemeralKeyPair
): Promise<HandshakeResult> {
  const hello = await nextMessage(link, ["hello"]);
  let peer = { keyId: "", pubKey: "" };
  let themeShort: string | undefined;
  let transcript: Transcript | undefined;
  let keys: ReturnType<typeof deriveSessionKeys>;
  if (hello.kind === "hello") {
    try {
      checkVersion(hello.v);
      peer = checkBinding(hello.keyId, hello.pubKey);
      themeShort = checkTheme(hello.themeShort, options.expectThemeShort, "peer");
      if (options.expectKeyId !== undefined && peer.keyId !== options.expectKeyId) {
        abort(link, "keyId");
      }
      const nonce = Buffer.from(randomBytes(NONCE_BYTES)).toString("base64");
      link.send(
        wire("challenge", {
          v: PROTOCOL_VERSION,
          keyId: identity.keyId,
          pubKey: identity.publicKeyBase64,
          ...(options.themeShort ? { themeShort: options.themeShort } : {}),
          nonce,
          ephPub: eph.publicKeyB64,
        })
      );

      const response = await nextMessage(link, ["response"]);
      if (response.kind === "response") {
        if (response.nonce !== nonce || typeof response.ephPub !== "string") {
          abort(link, "nonce");
        }
        keys = deriveSessionKeys(eph, response.ephPub, "responder");
        transcript = {
          initiatorKeyId: peer.keyId,
          responderKeyId: identity.keyId,
          nonce,
          initiatorEph: response.ephPub,
          responderEph: eph.publicKeyB64,
        };
        verifyTranscript(peer.pubKey, transcriptPayload({ ...transcript, role: "initiator" }), response.sig);
        const sig = signTranscript(identity, transcriptPayload({ ...transcript, role: "responder" }));
        link.send(wire("done", { sig }));
        return {
          role: "responder",
          peerKeyId: peer.keyId,
          peerPubKey: peer.pubKey,
          ...(themeShort ? { peerThemeShort: themeShort } : {}),
          session: new FrameCodec(keys),
        };
      }
    } catch (error) {
      if (error instanceof HandshakeError) {
        abort(link, error.reason);
      }
      throw error;
    }
  }
  throw new HandshakeError("unreachable", "sequence");
}
