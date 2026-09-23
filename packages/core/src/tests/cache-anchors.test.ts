// specs/model-vendor-profiles P3.2 — cache 锚点：TTL 单调归一（1h 前锚自动
// 提升）、wire 序、skipCacheWrite 前移。
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCacheAnchors } from "../common/cache-anchors";

test("anchors: default is all-ephemeral in wire order (tool → system → user.last)", () => {
  const anchors = resolveCacheAnchors({});
  assert.deepEqual(
    anchors.map((a) => a.anchor),
    ["tool", "system", "user.last"]
  );
  assert.ok(anchors.every((a) => a.retention === "ephemeral"));
});

test("anchors: a lone 1h on system lifts the EARLIER tool anchor too (monotonicity)", () => {
  // qwen 实测语义：{system:'1h'} → tool 自动提升为 '1h'（长 TTL 必须在短
  // TTL 之前上线——归一化保证任何组合都合法）。
  const anchors = resolveCacheAnchors({ system: "1h" });
  assert.deepEqual(
    anchors.map((a) => a.retention),
    ["1h", "1h", "ephemeral"]
  );
});

test("anchors: 1h on user.last lifts everything before it", () => {
  const anchors = resolveCacheAnchors({ "user.last": "1h" });
  assert.deepEqual(
    anchors.map((a) => a.retention),
    ["1h", "1h", "1h"]
  );
});

test("anchors: all-1h stays all-1h; per-anchor ephemeral earlier stays as-is", () => {
  assert.deepEqual(
    resolveCacheAnchors({ tool: "1h", system: "1h", "user.last": "1h" }).map((a) => a.retention),
    ["1h", "1h", "1h"]
  );
  // tool=1h 已在最前——不强制提升后续锚（单调不减即可）。
  assert.deepEqual(
    resolveCacheAnchors({ tool: "1h" }).map((a) => a.retention),
    ["1h", "ephemeral", "ephemeral"]
  );
});

test("anchors: skipCacheWrite drops the user.last write breakpoint (summary requests)", () => {
  const anchors = resolveCacheAnchors({}, { skipCacheWrite: true });
  assert.deepEqual(
    anchors.map((a) => a.anchor),
    ["tool", "system"]
  );
  // 1h + skipCacheWrite：归一照旧，user.last 仍然前移。
  const lifted = resolveCacheAnchors({ "user.last": "1h" }, { skipCacheWrite: true });
  assert.deepEqual(
    lifted.map((a) => a.anchor),
    ["tool", "system"]
  );
  assert.ok(lifted.every((a) => a.retention === "1h"));
});
