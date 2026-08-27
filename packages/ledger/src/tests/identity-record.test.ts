import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildSignedRecord,
  fingerprint,
  generateDeviceIdentity,
  keyIdFromPublicKeyBase64,
  loadDeviceIdentity,
  MAX_RECORD_BYTES,
  saveDeviceIdentity,
  verifySignedRecord,
  type SignedRecord,
} from "../index.js";

function tmpFile(name: string): string {
  return join(mkdtempSync(join(tmpdir(), "ledger-id-")), name);
}

test("identity: keyId is stable across save/load and file is 0600", () => {
  const identity = generateDeviceIdentity();
  const path = tmpFile("device-key.json");
  saveDeviceIdentity(identity, path);
  const loaded = loadDeviceIdentity(path);
  assert.equal(loaded.keyId, identity.keyId);
  assert.equal(keyIdFromPublicKeyBase64(identity.publicKeyBase64), identity.keyId);
  assert.match(identity.keyId, /^did:[0-9a-f]{16}$/);
  const mode = statSync(path).mode & 0o777;
  assert.equal(mode, 0o600, "device key file must be 0600");
});

test("identity: fingerprint groups the keyId for display", () => {
  const identity = generateDeviceIdentity();
  const shown = fingerprint(identity.keyId);
  assert.match(shown, /^did:(.... ?){4}$/);
});

test("record: sign/verify round-trip, recordId deterministic", () => {
  const identity = generateDeviceIdentity();
  const base = {
    type: "task.share" as const,
    ts: 1807286400000,
    author: identity.keyId,
    body: {
      title: "登录重构",
      goal: "替换鉴权中间件",
      trajectory: "edit auth.ts; run tests",
      filesTouched: ["src/auth.ts"],
      conclusion: "done",
      leftovers: [],
    },
  };
  const record = buildSignedRecord(identity, base);
  assert.match(record.recordId, /^r:[0-9a-f]{24}$/);
  assert.equal(verifySignedRecord(record, identity.publicKeyBase64).ok, true);
  // Same inputs → same recordId (content addressing, idempotent gossip).
  assert.equal(buildSignedRecord(identity, base).recordId, record.recordId);
  // parentRecordId changes the canonical bytes → different id.
  assert.notEqual(buildSignedRecord(identity, { ...base, parentRecordId: "r:aaa" }).recordId, record.recordId);
});

test("record: tampering body, id, or signature fails verification", () => {
  const identity = generateDeviceIdentity();
  const other = generateDeviceIdentity();
  const record = buildSignedRecord(identity, {
    type: "note",
    ts: 1000,
    author: identity.keyId,
    body: { text: "hello" },
  });

  const tamperedBody: SignedRecord = { ...record, body: { text: "HELLO" } };
  assert.equal(verifySignedRecord(tamperedBody, identity.publicKeyBase64).ok, false);

  const tamperedId: SignedRecord = { ...record, recordId: "r:" + "0".repeat(24) };
  assert.equal(verifySignedRecord(tamperedId, identity.publicKeyBase64).ok, false);

  assert.equal(verifySignedRecord(record, other.publicKeyBase64).ok, false);

  const tamperedSig: SignedRecord = { ...record, sig: Buffer.alloc(64).toString("base64") };
  assert.equal(verifySignedRecord(tamperedSig, identity.publicKeyBase64).ok, false);
});

test("record: 8KB ceiling enforced", () => {
  const identity = generateDeviceIdentity();
  assert.throws(() =>
    buildSignedRecord(identity, {
      type: "note",
      ts: 1,
      author: identity.keyId,
      body: { text: "x".repeat(MAX_RECORD_BYTES) },
    })
  );
});

test("record: structurally invalid bodies rejected", () => {
  const identity = generateDeviceIdentity();
  const bad = buildSignedRecord(identity, {
    type: "ws.commit",
    ts: 1,
    author: identity.keyId,
    // @ts-expect-error deliberately broken body for the negative test
    body: { message: "missing treeCid and parents" },
  });
  assert.equal(verifySignedRecord(bad, identity.publicKeyBase64).ok, false);
});
