// specs/model-vendor-profiles P2.4 — 退化图片守卫：魔数读尺寸、阈值判定、
// 非图片/无尺寸放行。
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDegenerateImage, MIN_PROVIDER_IMAGE_EDGE_PX } from "../common/input-guard";

/** 构造一个指定尺寸的最小 PNG data URL（IHDR 头 + IEND，无需有效像素）。 */
function pngOfSize(width: number, height: number): string {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [
    0,
    0,
    0,
    13, // length
    0x49,
    0x48,
    0x44,
    0x52, // "IHDR"
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
    8,
    0,
    0,
    0,
    0, // bit depth / color / …
    0,
    0,
    0,
    0, // CRC (wrong is fine — we only read the header)
  ];
  const bytes = [...signature, ...ihdr, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

test("guard: degenerate PNG (edge < 8px) is flagged; normal sizes pass", () => {
  assert.equal(isDegenerateImage(pngOfSize(4, 4)), true, "4×4");
  assert.equal(isDegenerateImage(pngOfSize(100, 4)), true, "100×4 — one degenerate edge is enough");
  assert.equal(isDegenerateImage(pngOfSize(8, 8)), false, "8×8 at the floor passes");
  assert.equal(isDegenerateImage(pngOfSize(1920, 1080)), false, "normal image passes");
});

test("guard: non-image / undecodable input passes (fail-open, not fail-closed)", () => {
  assert.equal(isDegenerateImage("https://example.com/img.png"), false, "remote URL");
  assert.equal(isDegenerateImage("data:image/png;base64,not!valid"), false, "broken base64");
  assert.equal(isDegenerateImage(""), false, "empty");
  assert.equal(isDegenerateImage("data:text/plain;base64,aGVsbG8="), false, "non-image data URL");
});

test("guard: threshold locked at MiniMax's measured value", () => {
  assert.equal(MIN_PROVIDER_IMAGE_EDGE_PX, 8);
});

test("guard: custom threshold honored", () => {
  assert.equal(isDegenerateImage(pngOfSize(16, 16), 32), true, "16px below a 32px floor");
});
