// @deeporca/ledger — Coord Chain (OC) protocol library (OC1).
//
// Zero runtime dependencies, UI-free and Electron-free by design (R22): the
// desktop main process owns node lifecycle and networking (OC2), this package
// only owns the offline-verifiable protocol surface.

export { JcsError, jcsBytes, jcsStringify, parseCanonicalJson } from "./encode/jcs.js";
export type { JsonValue } from "./encode/jcs.js";
export { base32LowerNoPad } from "./encode/base32.js";
export { bytesEqual, concatBytes, toHex, utf8Bytes } from "./encode/bytes.js";

export {
  fingerprint,
  generateDeviceIdentity,
  keyIdFromPublicKeyBase64,
  keyIdFromPublicKeyDer,
  loadDeviceIdentity,
  saveDeviceIdentity,
  signBytes,
  verifyBytes,
} from "./identity/identity.js";
export type { DeviceIdentity } from "./identity/identity.js";
export {
  AnchorError,
  checkAnchorBinding,
  createIdentityAnchor,
  loadIdentityAnchor,
  rotateAnchorKey,
  saveIdentityAnchor,
  verifyRotationChain,
} from "./identity/anchor.js";
export type { AnchorRotation, AnchorSeal, CreateAnchorOptions, IdentityAnchor } from "./identity/anchor.js";
export {
  collectRawFingerprint,
  fingerprintHash,
  machineFingerprintHash,
  parseIoRegistryUuid,
  parseMachineGuid,
} from "./identity/hardware-binding.js";

export { normalizeGitRemote, normalizeThemeName, resolveWorkspaceTheme, themeIdFromTheme } from "./theme/theme.js";
export type { ResolveThemeInput, ResolvedTheme } from "./theme/theme.js";

export {
  MAX_RECORD_BYTES,
  buildSignedRecord,
  recordIdFromPayloadBytes,
  recordPayload,
  validateRecordShape,
  verifySignedRecord,
} from "./record/record.js";
export type {
  AssetKind,
  AssetPublishBody,
  AssetRevokeBody,
  AssetUpdateBody,
  MemberJoinBody,
  MemberLeaveBody,
  MemberRotateBody,
  NoteBody,
  RecordBody,
  RecordType,
  SessionOfferBody,
  SignedRecord,
  TaskClaimBody,
  TaskDoneBody,
  TaskProgressBody,
  TaskShareBody,
  UnsignedRecord,
  RecordVerification,
  WsCommitBody,
} from "./record/record.js";

export {
  RecordIdIndex,
  blockHash,
  blockHashDigest,
  buildBlock,
  checkApprovals,
  chooseForkWinner,
  merkleRoot,
  proposerKeyForHeight,
  quorumRequired,
} from "./block/block.js";
export type { Approval, ApprovalCheck, Block, BlockHeader, ForkCandidate, QuorumPolicy } from "./block/block.js";

export {
  DEFAULT_CHAIN_PARAMS,
  buildGenesis,
  chainIdFromGenesis,
  formatChainId,
  genesisHash,
  genesisHashDigest,
  verifyThemeAnchor,
} from "./chain/genesis.js";
export type { ChainParams, Genesis } from "./chain/genesis.js";
export { replayChain, withApprovals } from "./chain/replay.js";
export type { MemberEntry, ReplayResult } from "./chain/replay.js";

export { CHUNK_SIZE, buildBlob, chunkBytes, chunkIdOf, manifestCidOf, reassembleBlob, sha256Hex } from "./cid/cid.js";
export type { BlobManifest, BuiltBlob, ReassembleResult } from "./cid/cid.js";

export {
  applyChangesToTree,
  assertValidPath,
  emptyTree,
  isSafeWorkspacePath,
  removeTreeEntry,
  setTreeEntry,
  treeCidOf,
} from "./ws/tree.js";
export type { FileMode, Tree, TreeEntry } from "./ws/tree.js";
export { buildCommit, commitCidOf, commitUnsignedPayload, verifyCommit } from "./ws/commit.js";
export type { BuildCommitInput, Commit, CommitUnsigned, CommitVerification } from "./ws/commit.js";
export { diffTrees } from "./ws/diff.js";
export type { TreeDiff } from "./ws/diff.js";
export { ancestorsOf, headsOf, lwwHead } from "./ws/lineage.js";

export { LedgerView, rebuildView } from "./view/view.js";
export type { AssetRow, BlockRow, CommitRow, MemberRow, RecordRow, TaskRow } from "./view/view.js";

// --- OC2: networking protocol core (transport-agnostic; desktop owns sockets) ---

export {
  ChannelError,
  FrameCodec,
  constantTimeEqual,
  deriveSessionKeys,
  generateEphemeralKeyPair,
  x25519PrivateFromRaw,
  x25519PublicFromRaw,
} from "./net/channel-crypto.js";
export type { ChannelRole, EphemeralKeyPair, SessionKeys } from "./net/channel-crypto.js";
export { PROTOCOL_VERSION, HandshakeError, runHandshake } from "./net/handshake.js";
export type { HandshakeLink, HandshakeOptions, HandshakeResult } from "./net/handshake.js";
export {
  MAX_MESSAGE_BYTES,
  MessageError,
  decodeMessage,
  decodeMessageBytes,
  encodeMessage,
  encodeMessageBytes,
} from "./net/messages.js";
export type { SyncMessage } from "./net/messages.js";
export { DEFAULT_QUOTA_BYTES, ObjectStore, ObjectStoreError } from "./objects/store.js";
export type { ObjectStoreOptions } from "./objects/store.js";
