import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Approval,
  type Block,
  type DeviceIdentity,
  type Genesis,
  blockHash,
  blockHashDigest,
  buildBlock,
  buildGenesis,
  buildSignedRecord,
  chainIdFromGenesis,
  chooseForkWinner,
  formatChainId,
  generateDeviceIdentity,
  genesisHash,
  merkleRoot,
  proposerKeyForHeight,
  quorumRequired,
  replayChain,
  signBytes,
  themeIdFromTheme,
  verifyThemeAnchor,
  withApprovals,
} from "../index.js";

const THEME = "git:github.com/zshipu/deeporca";
const BASE_TS = 1_800_000_000_000;

interface TestChain {
  devices: DeviceIdentity[];
  genesis: Genesis;
  blocks: Block[];
}

function joinRecord(device: DeviceIdentity, ts: number) {
  return buildSignedRecord(device, {
    type: "member.join",
    ts,
    author: device.keyId,
    body: { deviceName: `device-${device.keyId.slice(4, 8)}`, pubKey: device.publicKeyBase64 },
  });
}

function noteRecord(device: DeviceIdentity, ts: number, text: string) {
  return buildSignedRecord(device, { type: "note", ts, author: device.keyId, body: { text } });
}

function approvalsFor(
  header: { height: number; prevBlockHash: string; ts: number; proposer: string; merkleRoot: string },
  devices: DeviceIdentity[]
): Approval[] {
  const digest = blockHashDigest(header);
  return devices.map((device) => ({
    keyId: device.keyId,
    sig: Buffer.from(signBytes(device, digest)).toString("base64"),
  }));
}

/** Fresh 3-member chain: block 0 joins everyone, then `depth` note blocks. */
function makeChain(depth: number, saltHex = "ab".repeat(32)): TestChain {
  const devices = [generateDeviceIdentity(), generateDeviceIdentity(), generateDeviceIdentity()];
  const genesis = buildGenesis({ theme: THEME, creator: devices[0].keyId, saltHex });
  const keyIds = devices.map((device) => device.keyId);

  const blocks: Block[] = [];
  let prev = genesisHash(genesis);
  for (let height = 0; height <= depth; height++) {
    const records =
      height === 0
        ? devices.map((device, i) => joinRecord(device, BASE_TS - 10 + i))
        : [noteRecord(devices[height % devices.length], BASE_TS + height * 1000, `note ${height}`)];
    const header = {
      height,
      prevBlockHash: prev,
      ts: BASE_TS + height * 2000,
      // Height 0 is the membership bootstrap: the genesis creator proposes.
      proposer: height === 0 ? genesis.creator : proposerKeyForHeight(height, keyIds),
      merkleRoot: merkleRoot(records.map((record) => record.recordId)),
    };
    blocks.push(withApprovals(buildBlock({ ...header, records }), approvalsFor(header, devices)));
    prev = blockHash(header);
  }
  return { devices, genesis, blocks };
}

test("quorum: majority/twoThirds/all formulas", () => {
  assert.equal(quorumRequired(5, "majority"), 3);
  assert.equal(quorumRequired(4, "majority"), 3);
  assert.equal(quorumRequired(2, "majority"), 2);
  assert.equal(quorumRequired(5, "twoThirds"), 4);
  assert.equal(quorumRequired(3, "all"), 3);
});

test("merkle: deterministic and order-sensitive", () => {
  const root = merkleRoot(["r:a", "r:b", "r:c"]);
  assert.equal(root, merkleRoot(["r:a", "r:b", "r:c"]));
  assert.notEqual(root, merkleRoot(["r:c", "r:b", "r:a"]));
  assert.notEqual(root, merkleRoot(["r:a", "r:b"]));
});

test("genesis: chainId deterministic, grouped display, theme anchored", () => {
  const device = generateDeviceIdentity();
  // createdAt participates in the canonical bytes — pin it for the determinism check.
  const a = buildGenesis({
    theme: THEME,
    creator: device.keyId,
    saltHex: "11".repeat(32),
    createdAt: "2026-08-27T09:00:00Z",
  });
  const b = buildGenesis({
    theme: THEME,
    creator: device.keyId,
    saltHex: "11".repeat(32),
    createdAt: "2026-08-27T09:00:00Z",
  });
  const c = buildGenesis({
    theme: THEME,
    creator: device.keyId,
    saltHex: "22".repeat(32),
    createdAt: "2026-08-27T09:00:00Z",
  });
  assert.equal(chainIdFromGenesis(a), chainIdFromGenesis(b));
  assert.notEqual(chainIdFromGenesis(a), chainIdFromGenesis(c));
  assert.match(chainIdFromGenesis(a), /^orca1[a-z2-7]{20}$/);
  assert.match(formatChainId(chainIdFromGenesis(a)), /^orca1(-[a-z2-7]{5}){4}$/);

  const themeId = themeIdFromTheme(THEME);
  assert.equal(verifyThemeAnchor(a, THEME, themeId).ok, true);
  // Both legs must hold: wrong theme string AND wrong (recomputed) themeId.
  assert.equal(verifyThemeAnchor(a, "name:other-project", themeId).ok, false);
  assert.equal(verifyThemeAnchor(a, THEME, "wt:deadbeefdeadbeef").ok, false);
});

test("replay: a 3-member chain with note blocks verifies end to end", () => {
  const { genesis, blocks } = makeChain(5);
  const result = replayChain(genesis, blocks);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.height, 5);
    assert.equal(result.members.size, 3);
    assert.equal(result.recordCount, 3 + 5);
  }
});

test("replay: tampered record rejected at the first bad height", () => {
  const { genesis, blocks } = makeChain(4);
  const victim = blocks[3].records[0];
  blocks[3].records[0] = { ...victim, body: { text: "rewritten history" } };
  const result = replayChain(genesis, blocks);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.height, 3);
  }
});

test("replay: broken merkle root rejected", () => {
  const { genesis, blocks } = makeChain(2);
  blocks[2].merkleRoot = "0".repeat(64);
  assert.equal(replayChain(genesis, blocks).ok, false);
});

test("replay: broken prev-block link rejected at that height", () => {
  const { genesis, blocks } = makeChain(2);
  blocks[1].prevBlockHash = "1".repeat(64);
  const result = replayChain(genesis, blocks);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.height, 1);
  }
});

test("replay: quorum shortfall rejected (1 of 3 approvals)", () => {
  const { genesis, blocks } = makeChain(2);
  const flagged = blocks[1] as Block & { approvals: Approval[] };
  flagged.approvals = flagged.approvals.slice(0, 1);
  const result = replayChain(genesis, blocks);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /approvals/);
  }
});

test("replay: approval from a non-member does not count", () => {
  const { genesis, blocks } = makeChain(2);
  const outsider = generateDeviceIdentity();
  const flagged = blocks[2] as Block & { approvals: Approval[] };
  flagged.approvals = flagged.approvals.slice(0, 1);
  flagged.approvals.push({
    keyId: outsider.keyId,
    sig: Buffer.from(signBytes(outsider, blockHashDigest(flagged))).toString("base64"),
  });
  assert.equal(replayChain(genesis, blocks).ok, false);
});

test("replay: proposer outside the rotation rejected", () => {
  const { genesis, blocks } = makeChain(1);
  blocks[1].proposer = generateDeviceIdentity().keyId;
  assert.equal(replayChain(genesis, blocks).ok, false);
});

test("fork: winner by approval count, tie broken by proposer member order", () => {
  const { devices } = makeChain(0);
  const sorted = devices.map((device) => device.keyId).sort();
  const headerA = {
    height: 7,
    prevBlockHash: "a".repeat(64),
    ts: BASE_TS,
    proposer: sorted[1],
    merkleRoot: "1".repeat(64),
  };
  const headerB = {
    height: 7,
    prevBlockHash: "a".repeat(64),
    ts: BASE_TS,
    proposer: sorted[0],
    merkleRoot: "2".repeat(64),
  };
  // B has more approvals → B wins regardless of proposer order.
  assert.equal(
    chooseForkWinner(
      [
        { header: headerA, validApprovalCount: 2 },
        { header: headerB, validApprovalCount: 3 },
      ],
      sorted
    ).header,
    headerB
  );
  // Tie → proposer earliest in member order wins (sorted[0] = headerB's proposer).
  assert.equal(
    chooseForkWinner(
      [
        { header: headerA, validApprovalCount: 2 },
        { header: headerB, validApprovalCount: 2 },
      ],
      sorted
    ).header,
    headerB
  );
});

test("perf: genesis → 1000 blocks replays well under the CI guard (dev target <1s)", () => {
  const { genesis, blocks } = makeChain(1000);
  const started = process.hrtime.bigint();
  const result = replayChain(genesis, blocks);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(result.ok, true);
  // 1s is the design target on a dev machine; CI runners get 10x headroom.
  assert.ok(ms < 10_000, `replay took ${ms.toFixed(0)}ms`);
  console.log(`[ledger] 1000-block replay: ${ms.toFixed(0)}ms`);
});
