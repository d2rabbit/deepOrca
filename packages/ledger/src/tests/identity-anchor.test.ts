import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type Approval,
  type Block,
  type DeviceIdentity,
  type IdentityAnchor,
  AnchorError,
  blockHash,
  blockHashDigest,
  buildBlock,
  buildGenesis,
  buildSignedRecord,
  checkAnchorBinding,
  createIdentityAnchor,
  generateDeviceIdentity,
  genesisHash,
  loadIdentityAnchor,
  merkleRoot,
  parseIoRegistryUuid,
  parseMachineGuid,
  proposerKeyForHeight,
  replayChain,
  rotateAnchorKey,
  saveIdentityAnchor,
  signBytes,
  verifyRotationChain,
  withApprovals,
} from "../index.js";

const FP_THIS_MACHINE = "fp-device-a";
const FP_OTHER_MACHINE = "fp-device-b";

test("hardware-binding: platform parsers extract the machine ids (pure)", () => {
  const ioreg = `    "IOPlatformUUID" = "F0D3110A-8A5B-45C1-9C11-4488D53F0E6B"\n    "IOPlatformSerialNumber" = "C02XK2KJQ6HV"`;
  assert.equal(parseIoRegistryUuid(ioreg), "F0D3110A-8A5B-45C1-9C11-4488D53F0E6B");
  assert.equal(parseIoRegistryUuid("no uuid here"), null);

  const reg = `HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\n    MachineGuid    REG_SZ    a1b2c3d4-e5f6-7890-abcd-ef1234567890`;
  assert.equal(parseMachineGuid(reg), "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  assert.equal(parseMachineGuid("nothing"), null);
});

test("anchor: creation seals to the machine fingerprint; clone and tamper fail closed", () => {
  const anchor = createIdentityAnchor({ deviceName: "kelthas-mbp", fingerprint: FP_THIS_MACHINE });
  assert.equal(anchor.version, 3);
  assert.equal(anchor.anchorId, anchor.currentKeyId, "genesis key id is the anchor id");
  assert.equal(anchor.anchorId.startsWith("did:"), true);
  assert.equal(anchor.machineBinding?.kind, "machine-fingerprint");
  assert.notEqual(anchor.machineBinding?.fingerprintHash, FP_THIS_MACHINE, "only the hash is stored, never the raw id");

  // Same machine → bound; other machine → unbound clone.
  assert.deepEqual(checkAnchorBinding(anchor, FP_THIS_MACHINE), { bound: true });
  assert.deepEqual(checkAnchorBinding(anchor, FP_OTHER_MACHINE), { bound: false, reason: "clone" });

  // Tampered seal → rejected even on the right machine.
  const tampered = { ...anchor, machineBinding: { ...anchor.machineBinding, fingerprintHash: "0".repeat(64) } };
  assert.deepEqual(checkAnchorBinding(tampered, FP_THIS_MACHINE), { bound: false, reason: "tampered-seal" });

  // Unsealed → no binding, ever.
  const unsealed = { ...anchor, machineBinding: null };
  assert.deepEqual(checkAnchorBinding(unsealed, FP_THIS_MACHINE), { bound: false, reason: "no-seal" });

  // With collection disabled (empty env override) creation refuses to seal.
  const prevEnv = process.env.DEEPORCA_MACHINE_FINGERPRINT;
  process.env.DEEPORCA_MACHINE_FINGERPRINT = "";
  try {
    assert.throws(() => createIdentityAnchor({ deviceName: "x" }), AnchorError);
  } finally {
    if (prevEnv === undefined) {
      delete process.env.DEEPORCA_MACHINE_FINGERPRINT;
    } else {
      process.env.DEEPORCA_MACHINE_FINGERPRINT = prevEnv;
    }
  }
});

test("anchor: save/load round-trip is 0600 and preserves binding", () => {
  const anchor = createIdentityAnchor({ deviceName: "mbp", fingerprint: FP_THIS_MACHINE });
  const path = join(mkdtempSync(join(tmpdir(), "anchor-")), "identity-anchor.json");
  saveIdentityAnchor(anchor, path);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const loaded = loadIdentityAnchor(path);
  assert.equal(loaded.anchorId, anchor.anchorId);
  assert.deepEqual(checkAnchorBinding(loaded, FP_THIS_MACHINE), { bound: true });
  assert.throws(() => loadIdentityAnchor(join(tmpdir(), "no-such-anchor.json")), AnchorError);
});

test("anchor: rotation keeps the anchor id and forms a verifiable signature chain", () => {
  const seedIdentity = generateDeviceIdentity();
  const anchor0: IdentityAnchor = createIdentityAnchor({
    deviceName: "mbp",
    fingerprint: FP_THIS_MACHINE,
    identity: seedIdentity,
    createdAt: "2026-09-04T00:00:00.000Z",
  });

  const r1 = rotateAnchorKey(anchor0, seedIdentity);
  assert.equal(r1.anchor.anchorId, seedIdentity.keyId, "anchor id is unchanged by rotation");
  assert.notEqual(r1.anchor.currentKeyId, seedIdentity.keyId);
  assert.equal(r1.anchor.rotations.length, 1);
  const rotation = r1.anchor.rotations[0];
  assert.equal(rotation.from, seedIdentity.keyId);
  assert.equal(rotation.to, r1.identity.keyId);
  assert.equal(r1.anchor.keys[seedIdentity.keyId].rotatedOutAt, rotation.at);

  const chain1 = verifyRotationChain(r1.anchor);
  assert.equal(chain1.ok, true);
  if (chain1.ok) {
    assert.equal(chain1.currentPubKey, r1.identity.publicKeyBase64);
  }

  // Second rotation extends the chain; it signs with the CURRENT key.
  const r2 = rotateAnchorKey(r1.anchor, r1.identity);
  assert.equal(r2.anchor.rotations.length, 2);
  assert.equal(verifyRotationChain(r2.anchor).ok, true);

  // Tampering any link breaks the chain.
  const broken: IdentityAnchor = {
    ...r2.anchor,
    rotations: [{ ...r2.anchor.rotations[0], to: "did:deadbeefdeadbee" }, r2.anchor.rotations[1]],
  };
  assert.equal(verifyRotationChain(broken).ok, false);

  // Rotating with a stale identity is refused.
  assert.throws(() => rotateAnchorKey(r1.anchor, seedIdentity), AnchorError);
});

function approve(
  header: { height: number; prevBlockHash: string; ts: number; proposer: string; merkleRoot: string },
  by: DeviceIdentity
): Approval {
  return { keyId: by.keyId, sig: Buffer.from(signBytes(by, blockHashDigest(header))).toString("base64") };
}

function blockWithApproval(
  height: number,
  prevBlockHash: string,
  ts: number,
  proposer: string,
  records: ReturnType<typeof buildSignedRecord>[],
  by: DeviceIdentity
): Block {
  const header = {
    height,
    prevBlockHash,
    ts,
    proposer,
    merkleRoot: merkleRoot(records.map((record) => record.recordId)),
  };
  return withApprovals(buildBlock({ ...header, records }), [approve(header, by)]);
}

test("replay: member.rotate moves the pubkey timeline; history and later records both verify", () => {
  const identity = generateDeviceIdentity();
  const nextIdentity = generateDeviceIdentity();
  const genesis = buildGenesis({ theme: "git:example/x", creator: identity.keyId, saltHex: "cd".repeat(32) });

  const join = buildSignedRecord(identity, {
    type: "member.join",
    ts: 900,
    author: identity.keyId,
    body: { deviceName: "mbp", pubKey: identity.publicKeyBase64 },
  });
  const h0 = {
    height: 0,
    prevBlockHash: genesisHash(genesis),
    ts: 1000,
    proposer: identity.keyId,
    merkleRoot: merkleRoot([join.recordId]),
  };
  const b0 = blockWithApproval(0, genesisHash(genesis), 1000, identity.keyId, [join], identity);

  // Height 1: rotation signed by the OUTGOING key; the slot owner is still
  // the pre-rotation member and approves with its outgoing key — replay
  // accepts because the member table updates only AFTER this block.
  const rotate = buildSignedRecord(identity, {
    type: "member.rotate",
    ts: 2000,
    author: identity.keyId,
    body: { oldKeyId: identity.keyId, newPubKey: nextIdentity.publicKeyBase64 },
  });
  const b1 = blockWithApproval(1, blockHash(b0), 3000, proposerKeyForHeight(1, [identity.keyId]), [rotate], identity);

  // Height 2: a note signed by the NEW key — must verify against the moved entry.
  const note = buildSignedRecord(nextIdentity, {
    type: "note",
    ts: 4000,
    author: nextIdentity.keyId,
    body: { text: "after rotation" },
  });
  const b2 = blockWithApproval(
    2,
    blockHash(b1),
    5000,
    proposerKeyForHeight(2, [nextIdentity.keyId]),
    [note],
    nextIdentity
  );

  const result = replayChain(genesis, [b0, b1, b2]);
  assert.equal(result.ok, true, result.ok ? "" : (result as { reason: string }).reason);
  if (result.ok) {
    assert.equal(result.members.size, 1);
    const member = result.members.get(nextIdentity.keyId);
    assert.equal(member?.pubKey, nextIdentity.publicKeyBase64);
    assert.equal(member?.joinedHeight, 0, "the entry CONTINUES — rotation is not a re-join");
    assert.equal(result.members.has(identity.keyId), false, "the old key id is gone");
    assert.equal(result.recordCount, 3);
  }
  void h0;
});

test("replay: member.rotate negatives — same key, stale key after rotation", () => {
  const identity = generateDeviceIdentity();
  const nextIdentity = generateDeviceIdentity();
  const genesis = buildGenesis({ theme: "git:example/x", creator: identity.keyId, saltHex: "ef".repeat(32) });
  const join = buildSignedRecord(identity, {
    type: "member.join",
    ts: 1,
    author: identity.keyId,
    body: { deviceName: "a", pubKey: identity.publicKeyBase64 },
  });
  const b0 = blockWithApproval(0, genesisHash(genesis), 1000, identity.keyId, [join], identity);
  const proposer1 = proposerKeyForHeight(1, [identity.keyId]);

  // Rotating to the CURRENT key is rejected (must be fresh).
  const same = buildSignedRecord(identity, {
    type: "member.rotate",
    ts: 2,
    author: identity.keyId,
    body: { oldKeyId: identity.keyId, newPubKey: identity.publicKeyBase64 },
  });
  assert.equal(
    replayChain(genesis, [b0, blockWithApproval(1, blockHash(b0), 2000, proposer1, [same], identity)]).ok,
    false
  );

  // Healthy rotation, then the OLD key tries to sign again → rejected.
  const rotate = buildSignedRecord(identity, {
    type: "member.rotate",
    ts: 3,
    author: identity.keyId,
    body: { oldKeyId: identity.keyId, newPubKey: nextIdentity.publicKeyBase64 },
  });
  const b1 = blockWithApproval(1, blockHash(b0), 3000, proposer1, [rotate], identity);
  const stale = buildSignedRecord(identity, { type: "note", ts: 4, author: identity.keyId, body: { text: "ghost" } });
  const b2 = blockWithApproval(
    2,
    blockHash(b1),
    4000,
    proposerKeyForHeight(2, [nextIdentity.keyId]),
    [stale],
    nextIdentity
  );
  const result = replayChain(genesis, [b0, b1, b2]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.height, 2);
    assert.match(result.reason, /not an active member/);
  }
});
