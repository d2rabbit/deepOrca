// specs/model-vendor-profiles P3.1 — 静态 patch 表：null 删除、深合并、
// 路径冲突检测（前缀重叠含父子）、原对象不可变。
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatches, PatchConflictError, type NamedPatch } from "../common/optimization-patches";

test("merge: null deletes the key (RFC 7386)", () => {
  const result = applyPatches({ thinking: { type: "enabled" }, extra: 1 } as never, [
    { name: "a", patch: { thinking: null } },
  ]);
  assert.deepEqual(result, { extra: 1 });
});

test("merge: nested objects deep-merge; scalars overwrite", () => {
  const base = { thinking: { type: "enabled", effort: "low" }, max_tokens: 4096 } as never;
  const result = applyPatches(base as never, [
    { name: "a", patch: { thinking: { effort: "high" } } },
    { name: "b", patch: { max_tokens: 8192 } },
  ]);
  assert.deepEqual(result, { thinking: { type: "enabled", effort: "high" }, max_tokens: 8192 });
});

test("conflict: two patches writing the same path throw", () => {
  const patches: NamedPatch[] = [
    { name: "reasoningLevel", patch: { thinking: { type: "adaptive" } } },
    { name: "maxOutputTokens", patch: { thinking: { type: "enabled" } } },
  ];
  assert.throws(() => applyPatches({} as never, patches), PatchConflictError);
});

test("conflict: parent/child paths also conflict (prefix overlap)", () => {
  const patches: NamedPatch[] = [
    { name: "a", patch: { thinking: { type: "enabled" } } },
    { name: "b", patch: { thinking: null } }, // 写到 $.thinking 本身（删除）
  ];
  assert.throws(() => applyPatches({} as never, patches), PatchConflictError);
});

test("conflict: disjoint paths never throw", () => {
  const patches: NamedPatch[] = [
    { name: "a", patch: { thinking: { type: "enabled" } } },
    { name: "b", patch: { max_tokens: 8192 } },
  ];
  const result = applyPatches({} as never, patches);
  assert.deepEqual(result, { thinking: { type: "enabled" }, max_tokens: 8192 });
});

test("immutability: base is never mutated", () => {
  const base = { nested: { keep: 1, drop: 2 } } as never;
  const baseSnapshot = JSON.stringify(base);
  applyPatches(base, [{ name: "a", patch: { nested: { drop: null } } }]);
  assert.equal(JSON.stringify(base), baseSnapshot);
});

test("error message names both conflicting patches and the path", () => {
  try {
    applyPatches({} as never, [
      { name: "patch-one", patch: { shared: { key: 1 } } },
      { name: "patch-two", patch: { shared: { key: 2 } } },
    ]);
    assert.fail("should have thrown");
  } catch (error) {
    assert.ok(error instanceof PatchConflictError);
    assert.ok(error.message.includes("$.shared.key"));
    assert.ok(error.message.includes("patch-one"));
    assert.ok(error.message.includes("patch-two"));
  }
});
