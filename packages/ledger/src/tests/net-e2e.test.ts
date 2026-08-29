import assert from "node:assert/strict";
import * as net from "node:net";
import { test } from "node:test";
import {
  type HandshakeLink,
  ObjectStore,
  buildBlob,
  buildSignedRecord,
  chunkIdOf,
  decodeMessageBytes,
  encodeMessageBytes,
  generateDeviceIdentity,
  reassembleBlob,
  runHandshake,
  verifySignedRecord,
} from "../index.js";

/**
 * Length-prefixed link over a real TCP socket (4-byte BE length + payload).
 * Text phase = handshake JSON; binary phase = encrypted channel frames. The
 * mode flips exactly when runHandshake returns on each side (the handshake's
 * last message precedes any frame, and microtask ordering guarantees the flag
 * flips before the next socket data event is processed).
 */
class TcpLink implements HandshakeLink {
  private queue: Array<{ text?: string; bytes?: Uint8Array }> = [];
  private resolvers: Array<(item: { text?: string; bytes?: Uint8Array }) => void> = [];
  private buffer = Buffer.alloc(0);
  binary = false;
  private dead = false;

  constructor(private readonly socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    socket.on("close", () => {
      this.dead = true;
      for (const resolve of this.resolvers.splice(0)) {
        resolve({});
      }
    });
    socket.on("error", () => {
      /* close follows */
    });
  }

  private drain(): void {
    while (this.buffer.byteLength >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.byteLength < 4 + length) {
        break;
      }
      const payload = Buffer.from(this.buffer.subarray(4, 4 + length));
      this.buffer = this.buffer.subarray(4 + length);
      const item = this.binary ? { bytes: new Uint8Array(payload) } : { text: payload.toString("utf8") };
      const resolve = this.resolvers.shift();
      if (resolve) {
        resolve(item);
      } else {
        this.queue.push(item);
      }
    }
  }

  private sendRaw(payload: Buffer): void {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(payload.byteLength);
    this.socket.write(Buffer.concat([head, payload]));
  }

  send(text: string): void {
    this.sendRaw(Buffer.from(text, "utf8"));
  }

  sendFrame(bytes: Uint8Array): void {
    this.sendRaw(Buffer.from(bytes));
  }

  next(): Promise<string> {
    return this.nextItem().then((item) => {
      if (!item.text) {
        throw new Error("link closed or non-text message during handshake phase");
      }
      return item.text;
    });
  }

  nextItem(): Promise<{ text?: string; bytes?: Uint8Array }> {
    const queued = this.queue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    if (this.dead) {
      return Promise.resolve({});
    }
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  nextFrame(): Promise<Uint8Array> {
    return this.nextItem().then((item) => {
      if (!item.bytes) {
        throw new Error("link closed while waiting for a channel frame");
      }
      return item.bytes;
    });
  }
}

const BLOB_CONTENT = new TextEncoder().encode("architecture diagram bytes ".repeat(5000));

test("e2e over real TCP: handshake → encrypted record gossip → verified chunk transfer", async () => {
  const themeShort = "wt:cafe1234";
  const serverIdentity = generateDeviceIdentity();
  const clientIdentity = generateDeviceIdentity();
  const blob = buildBlob(BLOB_CONTENT);

  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  let acceptedSocket: net.Socket | undefined;

  const serverDone = (async () => {
    const socket = await new Promise<net.Socket>((resolve) => server.once("connection", resolve));
    acceptedSocket = socket;
    const link = new TcpLink(socket);
    const handshake = await runHandshake(link, "responder", serverIdentity, { themeShort, timeoutMs: 5000 });
    assert.equal(handshake.peerKeyId, clientIdentity.keyId);
    link.binary = true;

    // 1) Answer the ledger bootstrap request.
    const request = decodeMessageBytes(handshake.session.decryptFrame(await link.nextFrame()));
    assert.equal(request.kind, "getChain");
    if (request.kind === "getChain") {
      assert.equal(request.fromHeight, 0);
    }

    // 2) Gossip a signed record through the encrypted channel.
    const record = buildSignedRecord(serverIdentity, {
      type: "note",
      ts: 1234,
      author: serverIdentity.keyId,
      body: { text: "over the wire" },
    });
    link.sendFrame(handshake.session.encryptFrame(encodeMessageBytes({ kind: "record", record })));

    // 3) Serve chunk wants from the local object store.
    const store = new ObjectStore("/tmp/deeporca-ledger-e2e-server-objects");
    for (let i = 0; i < blob.chunks.length; i++) {
      store.putChunkVerified(blob.manifest.chunkIds[i], blob.chunks[i]);
    }
    const want = decodeMessageBytes(handshake.session.decryptFrame(await link.nextFrame()));
    assert.equal(want.kind, "wantChunks");
    if (want.kind === "wantChunks") {
      assert.deepEqual(want.chunkIds, blob.manifest.chunkIds);
      for (const chunkId of want.chunkIds) {
        const chunk = store.getChunk(chunkId) as Uint8Array;
        link.sendFrame(
          handshake.session.encryptFrame(
            encodeMessageBytes({ kind: "chunkData", chunkId, dataB64: Buffer.from(chunk).toString("base64") })
          )
        );
      }
    }
    return record;
  })();

  const socket = net.connect({ host: "127.0.0.1", port });
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  const clientLink = new TcpLink(socket);
  const clientHandshake = await runHandshake(clientLink, "initiator", clientIdentity, {
    themeShort,
    expectThemeShort: themeShort,
    timeoutMs: 5000,
  });
  assert.equal(clientHandshake.peerKeyId, serverIdentity.keyId);
  assert.equal(clientHandshake.peerThemeShort, themeShort);
  clientLink.binary = true;

  // 1) Bootstrap request.
  clientLink.sendFrame(clientHandshake.session.encryptFrame(encodeMessageBytes({ kind: "getChain", fromHeight: 0 })));

  // 2) Receive + signature-verify the gossiped record end-to-end.
  const recordMessage = decodeMessageBytes(clientHandshake.session.decryptFrame(await clientLink.nextFrame()));
  assert.equal(recordMessage.kind, "record");
  if (recordMessage.kind !== "record") {
    assert.fail("expected record gossip");
  }
  assert.equal(verifySignedRecord(recordMessage.record, clientHandshake.peerPubKey).ok, true);

  // 3) Want → receive → per-chunk verify → store → reassemble.
  clientLink.sendFrame(
    clientHandshake.session.encryptFrame(
      encodeMessageBytes({ kind: "wantChunks", manifestCid: blob.manifestCid, chunkIds: blob.manifest.chunkIds })
    )
  );
  const store = new ObjectStore("/tmp/deeporca-ledger-e2e-client-objects");
  const received = new Map<string, Uint8Array>();
  for (let i = 0; i < blob.manifest.chunkIds.length; i++) {
    const message = decodeMessageBytes(clientHandshake.session.decryptFrame(await clientLink.nextFrame()));
    assert.equal(message.kind, "chunkData");
    if (message.kind === "chunkData") {
      const bytes = new Uint8Array(Buffer.from(message.dataB64, "base64"));
      assert.equal(chunkIdOf(bytes), message.chunkId);
      store.putChunkVerified(message.chunkId, bytes);
      received.set(message.chunkId, bytes);
    }
  }
  const reassembled = reassembleBlob(blob.manifest, (id) => received.get(id));
  assert.equal(reassembled.ok, true);
  if (reassembled.ok) {
    assert.deepEqual(reassembled.data, BLOB_CONTENT);
  }

  const served = await serverDone;
  assert.equal(served.recordId, recordMessage.record.recordId);

  // Tear down both ends; server.close's callback can be swallowed when the
  // client socket is RST-destroyed, so guard with an unref'd timeout.
  socket.destroy();
  acceptedSocket?.destroy();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    setTimeout(resolve, 2000).unref();
  });
});
