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
