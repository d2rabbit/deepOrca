// ChainNode — the local Coord Chain participant (design §5–§9; OC2 task 10).
//
// Responsibilities, all verified against @deeporca/ledger primitives:
//   create/join a theme-anchored chain (genesis + full-replay admission, R3/R5/R26)
//   gossip pre-finality records; rotate block proposals by slot
//   collect quorum approvals → finalize → persist + advance the SQLite view (R7–R10)
//   serve getChain / chainSnapshot; catch up after reconnect (R5)
//   serve + fetch assets: getManifest → wantChunks → per-chunk verify (R11/R12)
//
// Deliberate v1 simplifications (documented against design §6):
//   - the proposer for height h is strictly slot owner of h (height 0 = the
//     genesis creator), so replay stays deterministic; the design's
//     view-change-lite (idle slot skip) is deferred — an offline slot owner
//     stalls finality until it returns.
//   - approvals for an unknown proposal are dropped (no orphan stash);
//     proposals and approvals are both broadcast to every peer, so the
//     common order (proposal first) always works.

import {
  buildBlock,
  buildBlob,
  buildGenesis,
  buildSignedRecord,
  blockHash,
  blockHashDigest,
  chainIdFromGenesis,
  checkApprovals,
  chunkIdOf,
  decodeMessageBytes,
  genesisHash,
  keyIdFromPublicKeyBase64,
  merkleRoot,
  proposerKeyForHeight,
  RecordIdIndex,
  reassembleBlob,
  replayChain,
  signBytes,
  themeIdFromTheme,
  verifySignedRecord,
  verifyThemeAnchor,
  type Approval,
  type Block,
  type BlobManifest,
  type DeviceIdentity,
  type Genesis,
  type MemberEntry,
  type RecordType,
  type SignedRecord,
  type SyncMessage,
} from "@deeporca/ledger";
import { startTransport, type PeerConnection, type Transport } from "./transport.js";
import type { ChainTaskNode } from "./task-tree-bridge.js";
import { ChainStore, type StoredBlock } from "./chain-store.js";
import { coordChainRoot } from "./paths.js";

export type ChainNodeMode = "create" | "join";

export interface ChainNodeOptions {
  identity: DeviceIdentity;
  deviceName: string;
  /** Canonical theme string (theme/theme.ts) — the chain's namespace. */
  theme: string;
  mode: ChainNodeMode;
  /** Join mode: ws URL of an existing member to bootstrap from (R4 fallback). */
  joinUrl?: string;
  dataRoot?: string;
  blockIntervalMs?: number;
  requestTimeoutMs?: number;
}

export interface ChainNodeStatus {
  chainId: string;
  theme: string;
  themeId: string;
  keyId: string;
  deviceName: string;
  /** -1 before the first block exists. */
  height: number;
  memberCount: number;
  peerCount: number;
  pendingRecords: number;
  port: number;
}

interface BlockCandidate {
  block: Block;
  approvals: Map<string, Approval>;
  /** Membership AFTER this block seals — joins inside it count (with pubkeys). */
  postMembers: Map<string, MemberEntry>;
}

interface BlockVerification {
  approvals: Approval[];
}

const DEFAULT_BLOCK_INTERVAL_MS = 2000;
const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

export class ChainNode {
  readonly themeId: string;
  private readonly blockIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly dataRoot: string;

  private transport: Transport | null = null;
  private store: ChainStore | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private view: ReturnType<ChainStore["openView"]> | null = null;

  private genesis: Genesis | null = null;
  private chainId = "";
  private storedBlocks: StoredBlock[] = [];
  private members = new Map<string, MemberEntry>();
  private readonly peers = new Map<string, PeerConnection>();
  private pendingRecords: SignedRecord[] = [];
  private readonly seenRecords = new RecordIdIndex();
  private readonly candidates = new Map<string, BlockCandidate>();
  private readonly manifests = new Map<string, BlobManifest>();
  private readonly waiters = new Map<string, Array<(message: SyncMessage) => void>>();

  constructor(private readonly options: ChainNodeOptions) {
    this.themeId = themeIdFromTheme(options.theme);
    this.blockIntervalMs = options.blockIntervalMs ?? DEFAULT_BLOCK_INTERVAL_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.dataRoot = options.dataRoot ?? coordChainRoot();
  }

  // ---------------------------------------------------------------- lifecycle

  get theme(): string {
    return this.options.theme;
  }

  get identity(): DeviceIdentity {
    return this.options.identity;
  }

  get chainIdValue(): string {
    return this.chainId;
  }

  get height(): number {
    return this.storedBlocks.length - 1;
  }

  get headBlockHash(): string {
    return this.storedBlocks.length > 0 ? blockHash(this.storedBlocks[this.storedBlocks.length - 1].block) : "";
  }

  get isMember(): boolean {
    const entry = this.members.get(this.identity.keyId);
    return entry !== undefined && entry.leftHeight === undefined;
  }

  get peerCount(): number {
    return this.peers.size;
  }

  get pendingCount(): number {
    return this.pendingRecords.length;
  }

  /** Read-only access to the materialized view (panel queries / tests). */
  get ledgerView(): ReturnType<ChainStore["openView"]> | null {
    return this.view;
  }

  status(): ChainNodeStatus {
    return {
      chainId: this.chainId,
      theme: this.theme,
      themeId: this.themeId,
      keyId: this.identity.keyId,
      deviceName: this.options.deviceName,
      height: this.height,
      memberCount: this.activeMemberKeyIds().length,
      peerCount: this.peers.size,
      pendingRecords: this.pendingRecords.length,
      port: this.transport?.port ?? 0,
    };
  }

  async start(): Promise<void> {
    if (this.transport) {
      throw new Error("chain node already started");
    }
    this.transport = await startTransport({
      identity: this.identity,
      themeShort: this.themeId.slice(0, 8),
    });
    this.transport.onPeer((peer) => void this.onPeer(peer));
    if (this.options.mode === "create") {
      this.createChain();
    }
    this.timer = setInterval(() => this.maybePropose(), this.blockIntervalMs);
    if (this.options.mode === "join") {
      if (!this.options.joinUrl) {
        throw new Error("join mode requires joinUrl");
      }
      // Handshake pins the short theme id — cross-theme peers never attach (R25).
      const peer = await this.transport.connect(this.options.joinUrl, { expectThemeShort: this.themeId.slice(0, 8) });
      // The transport only pushes SERVER-accepted peers; wire the outbound
      // one explicitly.
      void this.onPeer(peer);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const peer of this.peers.values()) {
      peer.close();
    }
    this.peers.clear();
    await this.transport?.close();
    this.transport = null;
    this.store?.closeView();
    this.store = null;
    this.view = null;
  }

  // ------------------------------------------------------------ peer plumbing

  private async onPeer(peer: PeerConnection): Promise<void> {
    const existing = this.peers.get(peer.keyId);
    if (existing) {
      peer.close();
      return;
    }
    this.peers.set(peer.keyId, peer);
    this.sendChainInfo(peer);
    try {
      while (peer.isOpen) {
        const frame = await peer.nextFrame();
        this.handleMessage(peer, decodeMessageBytes(frame));
      }
    } catch {
      // Channel error or disconnect — drop; reconnect logic reattaches.
    } finally {
      if (this.peers.get(peer.keyId) === peer) {
        this.peers.delete(peer.keyId);
      }
      peer.close();
    }
  }

  private broadcast(message: SyncMessage): void {
    for (const peer of this.peers.values()) {
      peer.sendSyncMessage(message);
    }
  }

  // --------------------------------------------------------------- chain data

  private createChain(): void {
    const genesis = buildGenesis({ theme: this.theme, creator: this.identity.keyId });
    this.adoptChain(genesis, [], { persist: true });
    this.acceptLocalRecord(
      this.signRecord("member.join", { deviceName: this.options.deviceName, pubKey: this.identity.publicKeyBase64 })
    );
    this.maybePropose();
  }

  /** Adopt a verified genesis + block list (fresh create or joined snapshot). */
  private adoptChain(genesis: Genesis, blocks: Block[], options: { persist: boolean }): void {
    const anchor = verifyThemeAnchor(genesis, this.theme, this.themeId);
    if (!anchor.ok) {
      throw new Error(`theme anchor failed: ${anchor.reason}`);
    }
    const replay = replayChain(genesis, blocks);
    if (!replay.ok) {
      throw new Error(`replay failed at height ${replay.height}: ${replay.reason}`);
    }
    this.genesis = genesis;
    this.chainId = chainIdFromGenesis(genesis);
    this.members = replay.members;
    this.storedBlocks = blocks.map((block) => {
      const approvals = (block as Block & { approvals?: Approval[] }).approvals ?? [];
      return { block, approvals };
    });
    for (const stored of this.storedBlocks) {
      this.seenRecords.addAll(stored.block.records.map((record) => record.recordId));
    }
    if (options.persist) {
      this.store = new ChainStore(this.chainId, this.dataRoot);
      for (const stored of this.storedBlocks) {
        this.store.appendBlock(stored);
      }
      this.view = this.store.rebuildView(this.storedBlocks.map((stored) => stored.block));
    }
    // Pending gossip that is already sealed elsewhere must not be re-proposed.
    this.pendingRecords = this.pendingRecords.filter((record) => !this.seenRecords.has(record.recordId));
  }

  private requireStore(): ChainStore {
    if (!this.store) {
      throw new Error("chain not open");
    }
    return this.store;
  }

  private activeMemberKeyIds(): string[] {
    const ids: string[] = [];
    for (const [keyId, entry] of this.members) {
      if (entry.leftHeight === undefined) {
        ids.push(keyId);
      }
    }
    return ids;
  }

  private currentParams() {
    return (
      this.genesis?.params ?? {
        quorum: "majority" as const,
        blockIntervalMs: this.blockIntervalMs,
        maxBlockRecords: 256,
        admission: "open" as const,
      }
    );
  }

  // ----------------------------------------------------------------- messages

  private chainInfoMessage(): SyncMessage {
    return {
      kind: "chainInfo",
      chainId: this.chainId,
      height: Math.max(this.height, 0),
      headBlockHash: this.headBlockHash,
      genesisHash: this.genesis ? genesisHash(this.genesis) : "",
    };
  }

  private sendChainInfo(peer: PeerConnection): void {
    peer.sendSyncMessage(this.chainInfoMessage());
  }

  private handleMessage(peer: PeerConnection, message: SyncMessage): void {
    switch (message.kind) {
      case "chainInfo":
        this.handleChainInfo(peer, message);
        break;
      case "chainSnapshot":
        if (!this.genesis) {
          try {
            this.adoptChain(message.genesis, message.blocks, { persist: true });
            if (!this.isMember) {
              this.acceptLocalRecord(
                this.signRecord("member.join", {
                  deviceName: this.options.deviceName,
                  pubKey: this.identity.publicKeyBase64,
                })
              );
            }
            this.broadcast(this.chainInfoMessage());
          } catch {
            peer.close();
          }
        }
        break;
      case "getChain":
        this.serveChain(peer, message.fromHeight);
        break;
      case "blocks":
        for (const block of message.blocks) {
          this.handleFinalizedBlock(block);
        }
        break;
      case "record":
        this.handleGossipedRecord(message.record);
        break;
      case "blockProposal":
        this.handleProposal(message.block);
        break;
      case "approval":
        this.handleApproval(message);
        break;
      case "getManifest":
        this.serveManifest(peer, message.manifestCid);
        break;
      case "manifestData":
        this.resolveWaiter(`manifest:${message.manifestCid}`, message);
        break;
      case "wantChunks":
        this.serveChunks(peer, message.chunkIds);
        break;
      case "chunkData": {
        const bytes = new Uint8Array(Buffer.from(message.dataB64, "base64"));
        if (this.verifyAndStoreChunk(message.chunkId, bytes)) {
          this.resolveWaiter(`chunk:${message.chunkId}`, message);
        }
        break;
      }
      case "ping":
        peer.sendSyncMessage({ kind: "pong" });
        break;
      default:
        break;
    }
  }

  private handleChainInfo(peer: PeerConnection, info: Extract<SyncMessage, { kind: "chainInfo" }>): void {
    // Fresh peer (no chain yet) → hand it the whole ledger (R4/R5).
    if (info.genesisHash === "" && this.genesis) {
      peer.sendSyncMessage({
        kind: "chainSnapshot",
        genesis: this.genesis,
        blocks: this.storedBlocks.map((stored) => this.withApprovals(stored)),
      });
      return;
    }
    if (!this.genesis) {
      // We are fresh and the peer has a chain → pull the snapshot.
      if (info.genesisHash !== "") {
        peer.sendSyncMessage({ kind: "getChain", fromHeight: 0 });
      }
      return;
    }
    if (info.chainId !== this.chainId) {
      // Different theme chain — must never happen post-handshake; cut it.
      peer.close();
      return;
    }
    if (info.height > this.height) {
      peer.sendSyncMessage({ kind: "getChain", fromHeight: this.height + 1 });
    }
    // Equal or behind → nothing to do; gossip keeps us current.
  }

  private withApprovals(stored: StoredBlock): Block {
    return Object.assign(stored.block, { approvals: stored.approvals });
  }

  private serveChain(peer: PeerConnection, fromHeight: number): void {
    if (!this.genesis) {
      return;
    }
    if (fromHeight <= 0) {
      peer.sendSyncMessage({
        kind: "chainSnapshot",
        genesis: this.genesis,
        blocks: this.storedBlocks.map((stored) => this.withApprovals(stored)),
      });
      return;
    }
    const slice = this.storedBlocks
      .filter((stored) => stored.block.height >= fromHeight)
      .map((stored) => this.withApprovals(stored));
    peer.sendSyncMessage({ kind: "blocks", blocks: slice });
  }

  private handleFinalizedBlock(block: Block): void {
    if (block.height <= this.height) {
      return; // duplicate or stale
    }
    if (block.height !== this.height + 1) {
      // Gap → request catch-up (design §7: (height, blockHash) alignment).
      this.pickAnyPeer()?.sendSyncMessage({ kind: "getChain", fromHeight: this.height + 1 });
      return;
    }
    const verification = this.verifyBlock(block, true);
    if (!verification) {
      return;
    }
    this.finalize({ block, approvals: verification.approvals });
  }

  /**
   * Full local verification of a block against our state. With
   * `requireApprovals` the block must already carry a quorum (finalized
   * gossip); without it we only check everything the approvers check
   * (proposal handling).
   */
  private verifyBlock(block: Block, requireApprovals: boolean): BlockVerification | null {
    if (!this.genesis) {
      return null;
    }
    const params = this.currentParams();
    if (block.records.length > params.maxBlockRecords) {
      return null;
    }
    const expectedPrev = this.height >= 0 ? this.headBlockHash : genesisHash(this.genesis);
    if (block.prevBlockHash !== expectedPrev) {
      return null;
    }
    const lastTs = this.storedBlocks.length > 0 ? this.storedBlocks[this.storedBlocks.length - 1].block.ts : -1;
    if (block.ts < lastTs) {
      return null;
    }
    if (block.height === 0) {
      if (block.proposer !== this.genesis.creator) {
        return null;
      }
    } else if (block.proposer !== proposerKeyForHeight(block.height, this.activeMemberKeyIds())) {
      return null;
    }
    if (merkleRoot(block.records.map((record) => record.recordId)) !== block.merkleRoot) {
      return null;
    }
    // Record loop mirrors replay's rules: FIFO membership simulation. A
    // record we have "seen" because WE gossiped it (still pending) is exactly
    // what a proposal is supposed to seal — only already-FINALIZED records
    // (seen and no longer pending) are duplicates.
    const tempMembers = new Map(this.members);
    for (const record of block.records) {
      if (
        this.seenRecords.has(record.recordId) &&
        !this.pendingRecords.some((pending) => pending.recordId === record.recordId)
      ) {
        return null;
      }
      if (record.ts > block.ts) {
        return null;
      }
      if (record.type === "member.join") {
        const body = record.body as { deviceName: string; pubKey: string };
        if (record.author !== keyIdFromPublicKeyBase64(body.pubKey) || !verifySignedRecord(record, body.pubKey).ok) {
          return null;
        }
        tempMembers.set(record.author, {
          keyId: record.author,
          deviceName: body.deviceName,
          pubKey: body.pubKey,
          joinedHeight: block.height,
        });
      } else {
        const member = tempMembers.get(record.author);
        if (!member || member.leftHeight !== undefined || !verifySignedRecord(record, member.pubKey).ok) {
          return null;
        }
        if (record.type === "member.leave") {
          member.leftHeight = block.height;
        }
      }
    }
    if (!requireApprovals) {
      return { approvals: [] };
    }
    const pubKeys = new Map<string, string>();
    for (const [keyId, member] of tempMembers) {
      if (member.leftHeight === undefined) {
        pubKeys.set(keyId, member.pubKey);
      }
    }
    if (pubKeys.size === 0) {
      return null;
    }
    const rawApprovals = (block as Block & { approvals?: Approval[] }).approvals;
    const approvals: Approval[] = Array.isArray(rawApprovals) ? rawApprovals : [];
    const check = checkApprovals(block, approvals, pubKeys, params.quorum);
    if (!check.finalized) {
      return null;
    }
    return { approvals: check.validApprovals };
  }

  // ------------------------------------------------------------ record gossip

  private signRecord(type: RecordType, body: unknown): SignedRecord {
    return buildSignedRecord(this.identity, { type, ts: Date.now(), author: this.identity.keyId, body: body as never });
  }

  /** Submit one of our own records: sign, stage, gossip (design §7). */
  submitRecord(type: RecordType, body: unknown, opts?: { parentRecordId?: string }): SignedRecord {
    if (!this.genesis) {
      throw new Error("chain not open");
    }
    if (type !== "member.join" && !this.isMember) {
      throw new Error("not a chain member yet — member.join still pending");
    }
    const record = buildSignedRecord(this.identity, {
      type,
      ts: Date.now(),
      author: this.identity.keyId,
      body: body as never,
      ...(opts?.parentRecordId !== undefined ? { parentRecordId: opts.parentRecordId } : {}),
    });
    this.acceptLocalRecord(record);
    return record;
  }

  /**
   * Chain-side task genealogy: every task.share record resolved into a node
   * with its parentRecordId lineage and ws.commit cross-reference — the
   * decentralized mirror of the local TaskTree fork graph (R14/R15).
   */
  taskGenealogy(): ChainTaskNode[] {
    const rows = this.view?.listRecords("task.share") ?? [];
    return rows.map((row) => {
      const body = JSON.parse(row.body_json) as {
        title?: string;
        conclusion?: string;
        goal?: string;
        commitRef?: string;
      };
      return {
        recordId: row.record_id,
        parentRecordId: row.parent_record_id ?? undefined,
        title: body.title ?? row.record_id,
        goal: body.goal ?? "",
        conclusion: body.conclusion ?? "",
        author: row.author,
        ts: row.ts,
        ...(typeof body.commitRef === "string" ? { commitRef: body.commitRef } : {}),
      };
    });
  }

  private acceptLocalRecord(record: SignedRecord): void {
    if (this.seenRecords.addAll([record.recordId]).length === 0) {
      return;
    }
    this.pendingRecords.push(record);
    this.broadcast({ kind: "record", record });
  }

  private handleGossipedRecord(record: SignedRecord): void {
    if (this.seenRecords.has(record.recordId) || !this.genesis) {
      return;
    }
    if (record.type === "member.join") {
      const body = record.body as { deviceName: string; pubKey: string };
      if (record.author !== keyIdFromPublicKeyBase64(body.pubKey) || !verifySignedRecord(record, body.pubKey).ok) {
        return;
      }
    } else {
      const member = this.members.get(record.author);
      if (!member || member.leftHeight !== undefined || !verifySignedRecord(record, member.pubKey).ok) {
        return;
      }
    }
    this.seenRecords.addAll([record.recordId]);
    this.pendingRecords.push(record);
  }

  // ------------------------------------------------------- proposal/finality

  private maybePropose(): void {
    if (!this.genesis || this.pendingRecords.length === 0) {
      return;
    }
    const nextHeight = this.height + 1;
    const proposer =
      nextHeight === 0 ? this.genesis.creator : proposerKeyForHeight(nextHeight, this.activeMemberKeyIds());
    if (proposer !== this.identity.keyId) {
      return;
    }
    const params = this.currentParams();
    const records = this.pendingRecords.slice(0, params.maxBlockRecords);
    const header = {
      height: nextHeight,
      prevBlockHash: this.height >= 0 ? this.headBlockHash : genesisHash(this.genesis),
      ts: Date.now(),
      proposer,
      merkleRoot: merkleRoot(records.map((record) => record.recordId)),
    };
    const block = buildBlock({ ...header, records });
    const ownApproval: Approval = {
      keyId: this.identity.keyId,
      sig: Buffer.from(signBytes(this.identity, blockHashDigest(block))).toString("base64"),
    };
    this.candidates.set(blockHash(block), {
      block,
      approvals: new Map([[this.identity.keyId, ownApproval]]),
      postMembers: this.postBlockMembers(block),
    });
    this.broadcast({ kind: "blockProposal", block });
    this.tryFinalize(blockHash(block));
  }

  private postBlockMembers(block: Block): Map<string, MemberEntry> {
    const temp = new Map(this.members);
    for (const record of block.records) {
      if (record.type === "member.join") {
        const body = record.body as { deviceName: string; pubKey: string };
        temp.set(record.author, {
          keyId: record.author,
          deviceName: body.deviceName,
          pubKey: body.pubKey,
          joinedHeight: block.height,
        });
      } else if (record.type === "member.leave") {
        const entry = temp.get(record.author);
        if (entry) {
          entry.leftHeight = block.height;
        }
      }
    }
    for (const [keyId, entry] of [...temp]) {
      if (entry.leftHeight !== undefined) {
        temp.delete(keyId);
      }
    }
    return temp;
  }

  private handleProposal(block: Block): void {
    if (!this.genesis || block.height !== this.height + 1) {
      return;
    }
    const verification = this.verifyBlock(block, false);
    if (!verification) {
      return;
    }
    const hash = blockHash(block);
    const approval: Approval = {
      keyId: this.identity.keyId,
      sig: Buffer.from(signBytes(this.identity, blockHashDigest(block))).toString("base64"),
    };
    const candidate = this.candidates.get(hash) ?? {
      block,
      approvals: new Map<string, Approval>(),
      postMembers: this.postBlockMembers(block),
    };
    candidate.approvals.set(this.identity.keyId, approval);
    this.candidates.set(hash, candidate);
    // Approvals go to everyone so every member can finalize independently.
    this.broadcast({ kind: "approval", height: block.height, blockHash: hash, approval });
    this.tryFinalize(hash);
  }

  private handleApproval(message: Extract<SyncMessage, { kind: "approval" }>): void {
    const candidate = this.candidates.get(message.blockHash);
    if (!candidate || candidate.approvals.has(message.approval.keyId)) {
      return;
    }
    // Signature verification happens in checkApprovals at finalize; the cheap
    // membership filter here keeps junk out of the candidate. postMembers —
    // NOT this.members — is authoritative: joins inside the candidate block
    // must be able to approve it.
    if (!candidate.postMembers.has(message.approval.keyId)) {
      return;
    }
    candidate.approvals.set(message.approval.keyId, message.approval);
    this.tryFinalize(message.blockHash);
  }

  private tryFinalize(hash: string): void {
    const candidate = this.candidates.get(hash);
    if (!candidate || !this.genesis || candidate.postMembers.size === 0) {
      return;
    }
    const pubKeys = new Map<string, string>();
    for (const [keyId, member] of candidate.postMembers) {
      pubKeys.set(keyId, member.pubKey);
    }
    const check = checkApprovals(
      candidate.block,
      [...candidate.approvals.values()],
      pubKeys,
      this.currentParams().quorum
    );
    if (!check.finalized) {
      return;
    }
    const block = candidate.block;
    this.candidates.clear(); // same-height competition is decided by first finalize
    this.finalize({ block, approvals: check.validApprovals });
  }

  private finalize(stored: StoredBlock): void {
    const block = stored.block;
    this.storedBlocks.push(stored);
    this.seenRecords.addAll(block.records.map((record) => record.recordId));
    this.pendingRecords = this.pendingRecords.filter((record) => !this.seenRecords.has(record.recordId));
    // Membership evolution.
    for (const record of block.records) {
      if (record.type === "member.join") {
        const body = record.body as { deviceName: string; pubKey: string };
        const existing = this.members.get(record.author);
        if (!existing || existing.leftHeight !== undefined) {
          this.members.set(record.author, {
            keyId: record.author,
            deviceName: body.deviceName,
            pubKey: body.pubKey,
            joinedHeight: block.height,
          });
        }
      } else if (record.type === "member.leave") {
        const entry = this.members.get(record.author);
        if (entry) {
          entry.leftHeight = block.height;
        }
      }
    }
    try {
      const store = this.requireStore();
      store.appendBlock(stored);
      this.view = store.openView();
      this.view.applyBlock(block);
    } catch {
      // Store failures must never break consensus progress.
    }
    this.broadcast({ kind: "blocks", blocks: [this.withApprovals(stored)] });
    // More pending records? Propose again without waiting for the next tick.
    this.maybePropose();
  }

  // -------------------------------------------------------------------- assets

  /** Publish bytes as a chain asset: chunk locally + asset.publish record (R11). */
  publishAsset(
    bytes: Uint8Array,
    meta: {
      name: string;
      mime: string;
      kind: "requirement" | "design" | "architecture" | "file" | "other";
      note?: string;
    }
  ): { record: SignedRecord; manifestCid: string } {
    const built = buildBlob(bytes);
    const store = this.requireStore();
    for (let i = 0; i < built.chunks.length; i++) {
      store.objects.putChunkVerified(built.manifest.chunkIds[i], built.chunks[i]);
    }
    store.writeManifest(built.manifestCid, built.manifest);
    this.manifests.set(built.manifestCid, built.manifest);
    const record = this.submitRecord("asset.publish", {
      cid: built.manifestCid,
      name: meta.name,
      mime: meta.mime,
      size: bytes.byteLength,
      kind: meta.kind,
      ...(meta.note !== undefined ? { note: meta.note } : {}),
    });
    return { record, manifestCid: built.manifestCid };
  }

  /** Fetch a published asset from peers: manifest → chunks → verify (R12). */
  async fetchAsset(manifestCid: string): Promise<Uint8Array> {
    const peer = this.pickAnyPeer();
    if (!peer) {
      throw new Error("no connected peer to fetch from");
    }
    const manifest = await this.requestManifest(peer, manifestCid);
    peer.sendSyncMessage({ kind: "wantChunks", manifestCid, chunkIds: manifest.chunkIds });
    const received = new Map<string, Uint8Array>();
    for (const chunkId of manifest.chunkIds) {
      const message = await this.waitFor(`chunk:${chunkId}`);
      if (message.kind !== "chunkData") {
        throw new Error(`unexpected response for ${chunkId}`);
      }
      const bytes = new Uint8Array(Buffer.from(message.dataB64, "base64"));
      if (!this.verifyAndStoreChunk(chunkId, bytes)) {
        throw new Error(`chunk ${chunkId} failed verification`);
      }
      received.set(chunkId, bytes);
    }
    const result = reassembleBlob(manifest, (id) => received.get(id));
    if (!result.ok) {
      throw new Error(`asset reassembly failed: ${result.missing.length} missing, ${result.corrupt.length} corrupt`);
    }
    return result.data;
  }

  private async requestManifest(peer: PeerConnection, manifestCid: string): Promise<BlobManifest> {
    const local = this.manifests.get(manifestCid) ?? this.store?.readManifest(manifestCid);
    if (local) {
      return local;
    }
    peer.sendSyncMessage({ kind: "getManifest", manifestCid });
    const message = await this.waitFor(`manifest:${manifestCid}`);
    if (message.kind !== "manifestData") {
      throw new Error("unexpected manifest response");
    }
    this.manifests.set(manifestCid, message.manifest);
    return message.manifest;
  }

  private serveManifest(peer: PeerConnection, manifestCid: string): void {
    const manifest = this.manifests.get(manifestCid) ?? this.store?.readManifest(manifestCid);
    if (manifest) {
      peer.sendSyncMessage({ kind: "manifestData", manifestCid, manifest });
    }
  }

  private serveChunks(peer: PeerConnection, chunkIds: string[]): void {
    const store = this.store;
    if (!store) {
      return;
    }
    for (const chunkId of chunkIds) {
      const chunk = store.objects.getChunk(chunkId);
      if (chunk) {
        peer.sendSyncMessage({ kind: "chunkData", chunkId, dataB64: Buffer.from(chunk).toString("base64") });
      }
    }
  }

  private verifyAndStoreChunk(chunkId: string, bytes: Uint8Array): boolean {
    if (chunkIdOf(bytes) !== chunkId || !this.store) {
      return false;
    }
    try {
      this.store.objects.putChunkVerified(chunkId, bytes);
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ helpers

  private pickAnyPeer(): PeerConnection | null {
    for (const peer of this.peers.values()) {
      if (peer.isOpen) {
        return peer;
      }
    }
    return null;
  }

  private waitFor(key: string): Promise<SyncMessage> {
    return new Promise<SyncMessage>((resolve, reject) => {
      const handler = (message: SyncMessage): void => {
        clearTimeout(timeout);
        resolve(message);
      };
      const timeout = setTimeout(() => {
        const list = this.waiters.get(key) ?? [];
        this.waiters.set(
          key,
          list.filter((entry) => entry !== handler)
        );
        reject(new Error(`timeout waiting for ${key}`));
      }, this.requestTimeoutMs);
      const list = this.waiters.get(key) ?? [];
      list.push(handler);
      this.waiters.set(key, list);
    });
  }

  private resolveWaiter(key: string, message: SyncMessage): void {
    const list = this.waiters.get(key);
    if (!list || list.length === 0) {
      return;
    }
    this.waiters.set(key, list.slice(1));
    list[0](message);
  }
}
