import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ChannelError,
  FrameCodec,
  PROTOCOL_VERSION,
  type ChannelRole,
  type DeviceIdentity,
  type HandshakeLink,
  type HandshakeOptions,
  bytesEqual,
  decodeMessageBytes,
  deriveSessionKeys,
  encodeMessageBytes,
  generateDeviceIdentity,
  generateEphemeralKeyPair,
  HandshakeError,
  runHandshake,
} from "../index.js";

/** In-memory text pipe pair implementing HandshakeLink. */
class MemoryLink implements HandshakeLink {
  private peer?: MemoryLink;
  private queue: string[] = [];
  private wake?: () => void;

  static createPair(): [MemoryLink, MemoryLink] {
    const a = new MemoryLink();
    const b = new MemoryLink();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  send(text: string): void {
    this.peer?.deliver(text);
  }

  private deliver(text: string): void {
    // Queue FIRST, then wake — the wake callback drains the queue.
    this.queue.push(text);
    if (this.wake) {
      const resolve = this.wake;
      this.wake = undefined;
      resolve();
    }
  }

  next(): Promise<string> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift() as string);
    }
    return new Promise((resolve) => {
      this.wake = () => resolve(this.queue.shift() as string);
    });
  }
}

test("channel: both roles derive complementary directional keys", () => {
  const a = generateEphemeralKeyPair();
  const b = generateEphemeralKeyPair();
  const init = deriveSessionKeys(a, b.publicKeyB64, "initiator");
  const resp = deriveSessionKeys(b, a.publicKeyB64, "responder");
  assert.ok(bytesEqual(init.sendKey, resp.recvKey));
  assert.ok(bytesEqual(init.recvKey, resp.sendKey));
  assert.ok(!bytesEqual(init.sendKey, init.recvKey), "directions must use different keys");
});

test("channel: frames round-trip; tamper and replay are rejected", () => {
  const a = generateEphemeralKeyPair();
  const b = generateEphemeralKeyPair();
  const init = new FrameCodec(deriveSessionKeys(a, b.publicKeyB64, "initiator"));
  const resp = new FrameCodec(deriveSessionKeys(b, a.publicKeyB64, "responder"));

  const plaintext = encodeMessageBytes({ kind: "ping" });
  const frame = init.encryptFrame(plaintext);
  assert.deepEqual(resp.decryptFrame(frame), plaintext);

  // Tampered ciphertext body fails authentication.
  const tampered = Uint8Array.from(frame);
  tampered[tampered.length - 20] ^= 0x01;
  assert.throws(() => resp.decryptFrame(tampered), ChannelError);

  // Replayed (or reordered) sequence numbers are rejected before any crypto.
  assert.throws(() => resp.decryptFrame(frame), ChannelError);

  // The reverse direction works with the other key.
  const back = resp.encryptFrame(encodeMessageBytes({ kind: "pong" }));
  assert.deepEqual(init.decryptFrame(back), encodeMessageBytes({ kind: "pong" }));

  // A peer deriving with the wrong role cannot read the traffic.
  const wrongRole = new FrameCodec(deriveSessionKeys(b, a.publicKeyB64, "initiator"));
  assert.throws(() => wrongRole.decryptFrame(frame), ChannelError);
});

test("channel: oversized/undersized frames rejected", () => {
  const a = generateEphemeralKeyPair();
  const b = generateEphemeralKeyPair();
  const codec = new FrameCodec(deriveSessionKeys(a, b.publicKeyB64, "initiator"));
  assert.throws(() => codec.decryptFrame(new Uint8Array(4)), ChannelError);
  assert.throws(() => deriveSessionKeys(a, Buffer.alloc(10).toString("base64"), "initiator"), ChannelError);
});

function handshakePair(
  aOptions: HandshakeOptions = {},
  bOptions: HandshakeOptions = {}
): {
  run: (
    roleA?: ChannelRole
  ) => Promise<[Awaited<ReturnType<typeof runHandshake>>, Awaited<ReturnType<typeof runHandshake>>]>;
  links: [MemoryLink, MemoryLink];
  identityA: DeviceIdentity;
  identityB: DeviceIdentity;
} {
  const identityA = generateDeviceIdentity();
  const identityB = generateDeviceIdentity();
  const [linkA, linkB] = MemoryLink.createPair();
  return {
    links: [linkA, linkB],
    identityA,
    identityB,
    run: (roleA: ChannelRole = "initiator") => {
      const runA = runHandshake(linkA, roleA, identityA, aOptions);
      const runB = runHandshake(linkB, roleA === "initiator" ? "responder" : "initiator", identityB, bOptions);
      return Promise.all([runA, runB]) as Promise<
        [Awaited<ReturnType<typeof runHandshake>>, Awaited<ReturnType<typeof runHandshake>>]
      >;
    },
  };
}

test("handshake: happy path yields mutual identity and a working session", async () => {
  const setup = handshakePair({ themeShort: "wt:aaaaaaaa" }, { themeShort: "wt:aaaaaaaa" });
  const [a, b] = await setup.run();
  assert.equal(a.peerKeyId, setup.identityB.keyId);
  assert.equal(b.peerKeyId, setup.identityA.keyId);
  assert.equal(a.peerThemeShort, "wt:aaaaaaaa");
  // Post-handshake frames decrypt on both ends.
  const frame = a.session.encryptFrame(encodeMessageBytes({ kind: "ping" }));
  assert.deepEqual(decodeMessageBytes(b.session.decryptFrame(frame)), { kind: "ping" });
});

test("handshake: protocol version mismatch aborts with a bye", async () => {
  const identityA = generateDeviceIdentity();
  const identityB = generateDeviceIdentity();
  const [linkA, linkB] = MemoryLink.createPair();
  const peerB = runHandshake(linkB, "responder", identityB, {});
  // Rogue "initiator" speaks version 99.
  const rogue = (async () => {
    linkA.send(JSON.stringify({ kind: "hello", v: 99, keyId: identityA.keyId, pubKey: identityA.publicKeyBase64 }));
    const bye = JSON.parse(await linkA.next()) as { kind: string; reason: string };
    assert.equal(bye.kind, "bye");
    assert.equal(bye.reason, "version");
  })();
  await assert.rejects(peerB, (error: unknown) => error instanceof HandshakeError && error.reason === "version");
  await rogue;
});

test("handshake: theme mismatch aborts before any key material is derived", async () => {
  const setup = handshakePair(
    { themeShort: "wt:aaaaaaaa", expectThemeShort: "wt:aaaaaaaa" },
    { themeShort: "wt:bbbbbbbb" }
  );
  await assert.rejects(setup.run(), (error: unknown) => error instanceof HandshakeError && error.reason === "theme");
});

test("handshake: pinned keyId mismatch aborts", async () => {
  const setup = handshakePair({ expectKeyId: "did:0000000000000000" }, {});
  await assert.rejects(setup.run(), (error: unknown) => error instanceof HandshakeError && error.reason === "keyId");
});

test("handshake: forged transcript signature rejected", async () => {
  // The initiator announces A's identity but cannot produce a valid
  // transcript signature — the responder must abort with "authenticity".
  const identityA = generateDeviceIdentity();
  const identityB = generateDeviceIdentity();
  const [linkA, linkB] = MemoryLink.createPair();
  const peerB = runHandshake(linkB, "responder", identityB, {});
  const rogue = (async () => {
    linkA.send(
      JSON.stringify({ kind: "hello", v: PROTOCOL_VERSION, keyId: identityA.keyId, pubKey: identityA.publicKeyBase64 })
    );
    const challenge = JSON.parse(await linkA.next()) as { kind: string; nonce: string };
    assert.equal(challenge.kind, "challenge");
    const eph = generateEphemeralKeyPair();
    linkA.send(
      JSON.stringify({
        kind: "response",
        nonce: challenge.nonce,
        ephPub: eph.publicKeyB64,
        sig: Buffer.alloc(64).toString("base64"),
      })
    );
    const bye = JSON.parse(await linkA.next()) as { kind: string; reason: string };
    assert.equal(bye.reason, "authenticity");
  })();
  await assert.rejects(peerB, (error: unknown) => error instanceof HandshakeError && error.reason === "authenticity");
  await rogue;
});

test("handshake: unbound keyId/pubKey pair rejected", async () => {
  const identityA = generateDeviceIdentity();
  const identityB = generateDeviceIdentity();
  const impostor = generateDeviceIdentity();
  const [linkA, linkB] = MemoryLink.createPair();
  const peerB = runHandshake(linkB, "responder", identityB, {});
  const rogue = (async () => {
    // Announces B's keyId with A's public key — binding check must trip.
    linkA.send(
      JSON.stringify({ kind: "hello", v: PROTOCOL_VERSION, keyId: identityB.keyId, pubKey: identityA.publicKeyBase64 })
    );
    const bye = JSON.parse(await linkA.next()) as { kind: string; reason: string };
    assert.equal(bye.reason, "binding");
  })();
  await assert.rejects(peerB, (error: unknown) => error instanceof HandshakeError && error.reason === "binding");
  await rogue;
  assert.ok(impostor.keyId.length > 0);
});
