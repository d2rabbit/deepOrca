// specs/model-vendor-profiles P1.5 — 装配指纹：排除消息历史、空白敏感、
// 工具键序规范化、变更 diff。
import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprintAssembly, diffAssemblyFingerprints } from "../common/assembly-fingerprint";

test("fingerprint: deterministic + whitespace-sensitive (prompt caches observe it)", () => {
  const a = fingerprintAssembly({ systemPrompt: "hello world", tools: [] });
  const b = fingerprintAssembly({ systemPrompt: "hello world", tools: [] });
  assert.equal(a.systemPrompt, b.systemPrompt);
  // 空白差异 → 指纹不同（即使人眼认为等价）。
  const c = fingerprintAssembly({ systemPrompt: "hello  world", tools: [] });
  assert.notEqual(a.systemPrompt, c.systemPrompt);
});

test("fingerprint: message history is NOT an input (by construction — only prompt+tools)", () => {
  // 该模块的输入面就只有 systemPrompt + tools；消息历史根本不是参数。
  // 结构性锁定：输入类型只有这两个字段（编译期已保证），运行期断言对象形状。
  const fp = fingerprintAssembly({ systemPrompt: "s", tools: [{ name: "t", description: "d", parameters: {} }] });
  assert.deepEqual(Object.keys(fp).sort(), ["systemPrompt", "tools"]);
});

test("fingerprint: tool order preserved, object key order normalized", () => {
  const toolsA = [
    { name: "bash", description: "run", parameters: { a: 1, b: { x: 1, y: 2 } } },
    { name: "read", description: "r", parameters: {} },
  ];
  const toolsB = [
    { name: "bash", description: "run", parameters: { b: { y: 2, x: 1 }, a: 1 } }, // 键序不同
    { name: "read", description: "r", parameters: {} },
  ];
  const toolsSwapped = [
    { name: "read", description: "r", parameters: {} },
    { name: "bash", description: "run", parameters: { a: 1, b: { x: 1, y: 2 } } },
  ];
  assert.equal(fingerprintAssembly({ tools: toolsA }).tools, fingerprintAssembly({ tools: toolsB }).tools);
  // 工具顺序变化 → 指纹不同（provider 看到的数组顺序是 wire 的一部分）。
  assert.notEqual(fingerprintAssembly({ tools: toolsA }).tools, fingerprintAssembly({ tools: toolsSwapped }).tools);
});

test("diff: names exactly the changed parts; empty when stable", () => {
  const prev = fingerprintAssembly({ systemPrompt: "s", tools: [{ name: "t", description: "d", parameters: {} }] });
  assert.deepEqual(diffAssemblyFingerprints(prev, prev), []);
  const promptChanged = fingerprintAssembly({
    systemPrompt: "s2",
    tools: [{ name: "t", description: "d", parameters: {} }],
  });
  assert.deepEqual(diffAssemblyFingerprints(prev, promptChanged), ["system_prompt"]);
  const toolsChanged = fingerprintAssembly({
    systemPrompt: "s",
    tools: [{ name: "t", description: "d2", parameters: {} }],
  });
  assert.deepEqual(diffAssemblyFingerprints(prev, toolsChanged), ["tools"]);
  const bothChanged = fingerprintAssembly({ systemPrompt: "s2", tools: [] });
  assert.deepEqual(diffAssemblyFingerprints(prev, bothChanged), ["system_prompt", "tools"]);
  // 首次（无前值）→ 空数组（不误报）。
  assert.deepEqual(diffAssemblyFingerprints(null, prev), []);
});

test("fingerprint: undefined/function/symbol values in tool defs are dropped, not thrown", () => {
  const tools = [
    // biome-ignore format: 故意带不可序列化成员
    { name: "t", description: "d", parameters: { keep: 1, fn: () => 1 } as unknown as Record<string, unknown> },
  ];
  const fp = fingerprintAssembly({ tools });
  assert.equal(typeof fp.tools, "string");
  assert.equal(fp.tools.length, 16);
});
