// WebSocket transport for the Coord Chain (design §7, R19; OC2 task 8).
//
// One ws message = one protocol unit. The HANDSHAKE runs over TEXT messages;
// after `runHandshake` returns, the same socket switches to BINARY messages,
// each being one AES-256-GCM frame produced by the session's FrameCodec. Any
// TEXT message after the handshake — i.e. any plaintext attempt — terminates
// the connection immediately (design §7: 明文帧直接断连).
//
// This module owns sockets only; chain semantics live in node.ts. It is
// Electron-free so the loopback e2e can run it under plain Node.

import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  encodeMessageBytes,
  runHandshake,
  type ChannelRole,
  type DeviceIdentity,
  type FrameCodec,
  type HandshakeLink,
  type HandshakeOptions,
  type SyncMessage,
} from "@deeporca/ledger";

export interface TransportOptions extends HandshakeOptions {
  identity: DeviceIdentity;
  /** Listen port; 0 (default) picks a free port (design §7). */
  port?: number;
}

export interface PeerMeta {
  keyId: string;
  pubKey: string;
  themeShort?: string;
  role: ChannelRole;
}

/**
 * An authenticated, encrypted peer link. Frames are pulled via `nextFrame()`
 * (the node's per-peer read loop) and pushed via `sendSyncMessage`.
 */
export class PeerConnection {
  readonly session: FrameCodec;
  readonly info: PeerMeta;
  private closed = false;
  /** Frames decrypted but not yet consumed by nextFrame(). */
  private readonly frameQueue: Uint8Array[] = [];
  private readonly frameResolvers: Array<(frame: Uint8Array) => void> = [];

  constructor(
    private readonly ws: WebSocket,
    session: FrameCodec,
    info: PeerMeta,
    private readonly onEnded: (peer: PeerConnection) => void
  ) {
    this.session = session;
    this.info = info;
    // ONE persistent 'message' listener for the whole connection: frames that
    // arrive while no nextFrame() is pending are QUEUED, never dropped. A
    // per-call off/on listener has an attach window in which ws emits a frame
    // to zero listeners and the frame is gone for good.
    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (!isBinary) {
        // Plaintext after the handshake = protocol violation → drop (R19).
        this.terminate();
        return;
      }
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      try {
        const frame = new Uint8Array(this.session.decryptFrame(new Uint8Array(buffer)));
        const resolve = this.frameResolvers.shift();
        if (resolve) {
          resolve(frame);
        } else {
          this.frameQueue.push(frame);
        }
      } catch {
        // Tampering/replay: the channel is no longer trustworthy.
        this.terminate();
      }
    });
    ws.on("close", () => {
      if (!this.closed) {
        this.closed = true;
        this.onEnded(this);
      }
    });
    ws.on("error", () => {
      /* 'close' follows */
    });
  }

  private terminate(): void {
    try {
      this.ws.terminate();
    } catch {
      /* already dead */
    }
  }

  get keyId(): string {
    return this.info.keyId;
  }

  get isOpen(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  sendFrame(bytes: Uint8Array): void {
    if (this.isOpen) {
      this.ws.send(Buffer.from(bytes), { binary: true });
    }
  }

  sendSyncMessage(message: SyncMessage): void {
    // Encrypt before the wire — sendFrame is the raw (already-encrypted) path.
    this.sendFrame(this.session.encryptFrame(encodeMessageBytes(message)));
  }

  /** Resolve the next encrypted frame; rejects when the peer disconnects. */
  nextFrame(): Promise<Uint8Array> {
    const queued = this.frameQueue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    if (this.closed) {
      return Promise.reject(new Error("peer closed"));
    }
    return new Promise<Uint8Array>((resolve, reject) => {
      this.frameResolvers.push(resolve);
      this.ws.once("close", () => reject(new Error("peer closed")));
    });
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      try {
        this.ws.close();
      } catch {
        this.ws.terminate();
      }
    }
  }
}

export interface Transport {
  /** Bound port of the ws listener (for mDNS TXT + invite codes). */
  port: number;
  onPeer(handler: (peer: PeerConnection) => void): void;
  /** Dial a peer URL (ws://host:port) and run the handshake as initiator. */
  connect(url: string, options?: HandshakeOptions): Promise<PeerConnection>;
  close(): Promise<void>;
}

interface QueuedMessage {
  isBinary: boolean;
  data: Buffer;
}

/** Sequential message pump shared by the handshake (text) and frames (binary). */
class MessagePump {
  private queue: QueuedMessage[] = [];
  private resolvers: Array<(item: QueuedMessage) => void> = [];
  private dead = false;

  constructor(ws: WebSocket) {
    ws.on("message", (data: RawData, isBinary: boolean) => {
      const item: QueuedMessage = { isBinary, data: Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer) };
      const resolve = this.resolvers.shift();
      if (resolve) {
        resolve(item);
      } else {
        this.queue.push(item);
      }
    });
    ws.on("close", () => {
      this.dead = true;
      // Empty payload = EOF marker; link.next() turns it into an error.
      for (const resolve of this.resolvers.splice(0)) {
        resolve({ isBinary: false, data: Buffer.alloc(0) });
      }
    });
  }

  next(): Promise<QueuedMessage> {
    const queued = this.queue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    if (this.dead) {
      return Promise.reject(new Error("link closed"));
    }
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }
}

function handshakeLinkFrom(ws: WebSocket): { link: HandshakeLink } {
  const pump = new MessagePump(ws);
  const link: HandshakeLink = {
    send: (text: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(text, { binary: false });
      }
    },
    next: async () => {
      for (;;) {
        const item = await pump.next();
        if (item.isBinary) {
          // Binary during handshake = violation; drop the socket.
          ws.terminate();
          throw new Error("binary message during handshake");
        }
        if (item.data.byteLength === 0) {
          throw new Error("peer closed during handshake");
        }
        return item.data.toString("utf8");
      }
    },
  };
  return { link };
}

/** Start the ws listener; every accepted socket becomes a PeerConnection. */
export function startTransport(options: TransportOptions): Promise<Transport> {
  const wss = new WebSocketServer({ port: options.port ?? 0 });
  const peerHandlers: Array<(peer: PeerConnection) => void> = [];
  const emitEnded = (peer: PeerConnection): void => {
    for (const handler of peerHandlers) {
      handler(peer);
    }
  };

  const attachResponder = (ws: WebSocket): void => {
    const { link } = handshakeLinkFrom(ws);
    runHandshake(link, "responder", options.identity, options)
      .then((result) => {
        const peer = new PeerConnection(
          ws,
          result.session,
          { keyId: result.peerKeyId, pubKey: result.peerPubKey, themeShort: result.peerThemeShort, role: "responder" },
          emitEnded
        );
        for (const handler of peerHandlers) {
          handler(peer);
        }
      })
      .catch(() => {
        try {
          ws.close();
        } catch {
          ws.terminate();
        }
      });
  };

  wss.on("connection", attachResponder);

  return new Promise((resolve, reject) => {
    wss.once("error", reject);
    wss.once("listening", () => {
      const address = wss.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        port,
        onPeer: (handler) => peerHandlers.push(handler),
        connect: async (url, connectOptions) => {
          const ws = new WebSocket(url);
          await new Promise<void>((res, rej) => {
            ws.once("open", res);
            ws.once("error", rej);
          });
          const { link } = handshakeLinkFrom(ws);
          const handshakeOptions = { ...options, ...connectOptions };
          const result = await runHandshake(link, "initiator", options.identity, handshakeOptions);
          return new PeerConnection(
            ws,
            result.session,
            {
              keyId: result.peerKeyId,
              pubKey: result.peerPubKey,
              themeShort: result.peerThemeShort,
              role: "initiator",
            },
            emitEnded
          );
        },
        close: () =>
          new Promise<void>((res) => {
            for (const client of wss.clients) {
              client.terminate();
            }
            wss.close(() => res());
          }),
      });
    });
  });
}
