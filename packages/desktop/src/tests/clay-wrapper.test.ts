// clay-wrapper（clay-ui-runtime WP1）— Node WebAssembly 实测：
// vendored clay.wasm 实例化 → 元素树写入 → 布局 → 命令数组遍历。
// 度量注入确定性桩：CJK 每字 = fontSize，ASCII = fontSize/2。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ClayLayoutRuntime } from "../main/tools/clay/clay-wrapper";

const WASM_PATH = new URL("../../vendor/clay/clay.wasm", import.meta.url);

function stubMeasure(text: string, fontId: number, fontSize: number): { width: number; height: number } {
  void fontId;
  let width = 0;
  for (const ch of text) width += ch.charCodeAt(0) > 0x2e80 ? fontSize : fontSize * 0.5;
  return { width, height: fontSize };
}

async function createRuntime(): Promise<ClayLayoutRuntime> {
  const wasm = new Uint8Array(readFileSync(WASM_PATH));
  return ClayLayoutRuntime.create({
    wasm,
    width: 1280,
    height: 800,
    fonts: ['"Microsoft YaHei UI", sans-serif'],
    measureText: stubMeasure,
  });
}

test("clay-wrapper: instantiates from the vendored clay.wasm", async () => {
  const runtime = await createRuntime();
  const commands = runtime.frame(() => {
    runtime.open({
      backgroundColor: [244, 245, 248, 255],
      layout: {
        direction: "TTB",
        padding: [24, 24, 24, 24],
        childGap: 16,
        sizing: { width: { type: "grow" }, height: { type: "grow" } },
      },
    });
    runtime.close();
  });
  assert.ok(commands.length >= 1);
  const root = commands.find((c) => c.type === "RECTANGLE");
  assert.ok(root, "root rectangle command exists");
  assert.equal(root.background, "rgba(244,245,248,1)");
  assert.equal(root.width, 1280);
  assert.equal(root.height, 800);
});

test("clay-wrapper: element tree produces background and text commands", async () => {
  const runtime = await createRuntime();
  const commands = runtime.frame(() => {
    runtime.open({
      layout: {
        direction: "TTB",
        padding: [24, 24, 24, 24],
        childGap: 16,
        sizing: { width: { type: "grow" }, height: { type: "grow" } },
      },
      backgroundColor: [244, 245, 248, 255],
    });
    runtime.open({
      layout: {
        direction: "TTB",
        padding: [16, 16, 16, 16],
        childGap: 8,
        sizing: { width: { type: "fixed", value: 460 }, height: { type: "fit" } },
      },
      backgroundColor: [255, 255, 255, 255],
      cornerRadius: [12, 12, 12, 12],
      border: { color: [222, 226, 234, 255], width: [1, 1, 1, 1] },
    });
    runtime.text("策略 C · 逐字符度量 + 手动换行", { fontSize: 13, color: [110, 118, 129, 255], lineHeight: 18 });
    runtime.text("深度编排器是一个面向国产大模型的智能编码工作台。", {
      fontSize: 15,
      color: [30, 33, 41, 255],
      lineHeight: 24,
    });
    runtime.close();
    runtime.close();
  });
  const textCommands = commands.filter((c) => c.type === "TEXT" && typeof c.text === "string");
  assert.equal(textCommands.length, 2, "both text elements produce TEXT commands");
  assert.ok(
    textCommands.some((c) => c.text!.includes("深度编排器")),
    "CJK body text survives the layout round-trip"
  );
  assert.equal(textCommands[0]?.fontFamily, '"Microsoft YaHei UI", sans-serif');
  const card = commands.find((c) => c.type === "RECTANGLE" && Math.round(c.width) === 460);
  assert.ok(card, "fixed-width card rectangle exists");
  assert.equal(card.background, "rgba(255,255,255,1)");
  assert.deepEqual(card.radius, [12, 12, 12, 12]);
});

test("clay-wrapper: two identical frames produce identical command streams", async () => {
  const runtime = await createRuntime();
  const build = () => {
    runtime.open({
      layout: {
        direction: "TTB",
        padding: [16, 16, 16, 16],
        sizing: { width: { type: "fixed", value: 400 }, height: { type: "fit" } },
      },
      backgroundColor: [10, 20, 30, 255],
    });
    runtime.text("断行样张文本", { fontSize: 15, color: [0, 0, 0, 255], lineHeight: 24 });
    runtime.close();
  };
  const first = runtime
    .frame(build)
    .map((c) => `${c.type}:${Math.round(c.x)},${Math.round(c.y)},${Math.round(c.width)},${Math.round(c.height)}`);
  const second = runtime
    .frame(build)
    .map((c) => `${c.type}:${Math.round(c.x)},${Math.round(c.y)},${Math.round(c.width)},${Math.round(c.height)}`);
  assert.deepEqual(first, second, "deterministic layout: same input → same geometry");
});
