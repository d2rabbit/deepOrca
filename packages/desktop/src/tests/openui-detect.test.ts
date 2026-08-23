import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPrototypeArtifact } from "../renderer/openui/detect-artifact";

function toolResult(name: string, metadata: Record<string, unknown>): string {
  return JSON.stringify({ ok: true, name, output: "done", metadata });
}

test("detectPrototypeArtifact keys off metadata.design for UI-Design results", () => {
  const artifact = detectPrototypeArtifact(toolResult("render_design", { design: "---\nname: x\n---" }));
  assert.deepEqual(artifact, { mode: "design", payload: "---\nname: x\n---" });
});

test("detectPrototypeArtifact keys off metadata.openui for PM-Design results", () => {
  const code = "root = Column([title])";
  const artifact = detectPrototypeArtifact(toolResult("update_openui", { openui: code }));
  assert.deepEqual(artifact, { mode: "openui", payload: code });
});

test("detectPrototypeArtifact handles A2UI render vs update", () => {
  const json = '{"messages":[]}';
  const render = detectPrototypeArtifact(toolResult("render_surface", { a2ui: json }));
  assert.equal(render?.mode, "a2ui");
  assert.notEqual(render?.isUpdate, true);

  const update = detectPrototypeArtifact(toolResult("update_surface", { a2ui: json }));
  assert.equal(update?.mode, "a2ui");
  assert.equal(update?.isUpdate, true);
});

test("arch-* surfaces never trigger the design preview (knowledge module owns them)", () => {
  // render_surface batch carries a createSurface message with the arch- id.
  const renderBatch = JSON.stringify([
    { type: "createSurface", surfaceId: "arch-root", title: "Arch" },
    { type: "updateComponents", surfaceId: "arch-root", components: [] },
  ]);
  assert.equal(detectPrototypeArtifact(toolResult("render_surface", { a2ui: renderBatch })), null);
  // update_surface batches have no createSurface — the id rides every message.
  const updateBatch = JSON.stringify([{ type: "updateComponents", surfaceId: "arch-root", components: [] }]);
  assert.equal(detectPrototypeArtifact(toolResult("update_surface", { a2ui: updateBatch })), null);
  // Non-arch surfaces still open the preview.
  const protoBatch = JSON.stringify([{ type: "createSurface", surfaceId: "proto-1", title: "P" }]);
  assert.equal(detectPrototypeArtifact(toolResult("render_surface", { a2ui: protoBatch }))?.mode, "a2ui");
});

test("tool name in ordinary text never triggers the panel (metadata is required)", () => {
  // Fast-path hit (mentions render_openui) but no parseable tool result.
  assert.equal(detectPrototypeArtifact("Let's call render_openui with some code"), null);
  // Parseable JSON but no metadata keys.
  assert.equal(detectPrototypeArtifact(toolResult("render_openui", {})), null);
  // Parseable JSON with an unrelated metadata key.
  assert.equal(detectPrototypeArtifact(toolResult("bash", { exitCode: 0 })), null);
});

test("non-tool payloads and garbage return null", () => {
  assert.equal(detectPrototypeArtifact("not json at all"), null);
  assert.equal(detectPrototypeArtifact(""), null);
  assert.equal(detectPrototypeArtifact(JSON.stringify([1, 2, 3])), null);
});
