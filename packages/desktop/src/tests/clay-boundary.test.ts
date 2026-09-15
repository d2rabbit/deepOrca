// clay-ui-runtime 边界 guard（specs/clay-ui-runtime EARS 13）：
// ① prototype.ts（core）零 clay 引用；② design.ts（core）主流程零 clay 导入；
// ③ clay 编译器/wrapper 不 import render_openui / render_leafer / leafer-editor。
// 三层定位红线纪律，对齐 design-a2ui-boundary 先例（源码文本扫描）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const coreActions = join(here, "..", "..", "..", "..", "packages", "core", "src", "actions");
const desktopMain = join(here, "..", "main");
const readSource = (base: string, rel: string): string => readFileSync(join(base, rel), "utf8");

test("guard ①: prototype.ts (PM-Design) has zero clay references", () => {
  const source = readSource(coreActions, "prototype.ts");
  assert.ok(!/clay/i.test(source), "prototype.ts must not reference clay (three-layer boundary)");
});

test("guard ②: design.ts (core) main flow has zero clay imports", () => {
  const source = readSource(coreActions, "design.ts");
  assert.ok(!/from ["'][^"']*clay/i.test(source), "design.ts must not import clay modules");
});

test("guard ③: clay compile/wrapper do not import leafer/openui runtimes", () => {
  for (const rel of ["clay/compile-leafer-to-clay.ts", "clay/clay-wrapper.ts"]) {
    const source = readSource(desktopMain, join("tools", rel));
    assert.ok(!/render_openui|render_leafer|leafer-editor/.test(source), `${rel} must stay runtime-free`);
  }
});
