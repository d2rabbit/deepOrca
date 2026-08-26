/**
 * A2UI processor façade tests (specs/a2ui-integration R2): official v0.9
 * engine behavior + legacy-dialect conversion. The old tests locked the
 * homegrown processor's GC semantics; the official engine owns those now —
 * these lock the FAÇADE contract call sites depend on.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  a2uiProcessor,
  clearSurfaces,
  extractSurfaceId,
  getSurfaceModel,
  getSurfaceModels,
  processA2uiMessages,
} from "../renderer/a2ui/processor";
import { BASIC_CATALOG_ID, convertLegacyBatch, convertLegacyComponents, isLegacyBatch } from "../shared/a2ui-legacy";

const SURFACE = "façade-test-surface";

function reset(): void {
  clearSurfaces();
}

test("v0.9 batch: create → components → dataModel renders a surface model", () => {
  reset();
  processA2uiMessages(
    JSON.stringify([
      { version: "v0.9", createSurface: { surfaceId: SURFACE, catalogId: BASIC_CATALOG_ID } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: SURFACE,
          components: [
            { id: "root", component: "Column", children: ["title", "body"] },
            { id: "title", component: "Text", text: { path: "/heading" } },
            { id: "body", component: "Text", text: "plain literal" },
          ],
        },
      },
      { version: "v0.9", updateDataModel: { surfaceId: SURFACE, path: "/", value: { heading: "Hi" } } },
    ])
  );
  const surface = getSurfaceModel(SURFACE);
  assert.ok(surface, "surface model exists");
  assert.equal(a2uiProcessor.version, "v0.9.1");
  const cm = surface.componentsModel;
  assert.deepEqual(["body", "root", "title"].filter((id) => cm.get(id) != null).sort(), ["body", "root", "title"]);
});

test("v0.9 GC: removing a child from the children list prunes it (official semantics)", () => {
  reset();
  processA2uiMessages(
    JSON.stringify([
      { version: "v0.9", createSurface: { surfaceId: SURFACE, catalogId: BASIC_CATALOG_ID } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: SURFACE,
          components: [
            { id: "root", component: "Column", children: ["a", "b"] },
            { id: "a", component: "Text", text: "A" },
            { id: "b", component: "Text", text: "B" },
          ],
        },
      },
    ])
  );
  assert.ok(getSurfaceModel(SURFACE)?.componentsModel.get("b") != null);
  // Update: root no longer references b → unreachable → not rendered (the
  // official engine's GC is reachability-based at render time; the model may
  // retain the entry but the tree no longer contains it).
  processA2uiMessages(
    JSON.stringify([
      {
        version: "v0.9",
        updateComponents: { surfaceId: SURFACE, components: [{ id: "root", component: "Column", children: ["a"] }] },
      },
    ])
  );
  const rootModel = getSurfaceModel(SURFACE)?.componentsModel.get("root");
  assert.ok(rootModel, "root component model exists");
  const children = (rootModel as unknown as { properties: { children: string[] } }).properties.children;
  assert.deepEqual(children, ["a"], "removed child is no longer referenced by the tree");
});

test("legacy batch is detected and converted: parentId adjacency → forward children", () => {
  const legacy = [
    { type: "createSurface", surfaceId: "legacy-1", title: "T", catalog: "basic" },
    {
      type: "updateComponents",
      surfaceId: "legacy-1",
      components: [
        { id: "root", type: "card" },
        { id: "greet", type: "text", parentId: "root", properties: { text: "${/msg}", variant: "title" } },
        { id: "go", type: "button", parentId: "root", properties: { label: "Run", action: "run:now" } },
      ],
    },
    { type: "updateDataModel", surfaceId: "legacy-1", dataModel: { msg: "hello" } },
  ];
  assert.ok(isLegacyBatch(legacy));
  const v09 = convertLegacyBatch(legacy);
  assert.deepEqual(v09[0], { version: "v0.9", createSurface: { surfaceId: "legacy-1", catalogId: BASIC_CATALOG_ID } });

  const comps = (v09[1] as { updateComponents: { components: Array<Record<string, unknown>> } }).updateComponents
    .components;
  const root = comps.find((c) => c.id === "root") as { component: string; child: string };
  assert.equal(root.component, "Card");
  const greet = comps.find((c) => c.id === "greet") as { text: { path: string }; variant: string };
  assert.deepEqual(greet.text, { path: "/msg" });
  assert.equal(greet.variant, "h2");
  const btn = comps.find((c) => c.id === "go") as { child: string; action: { event: { name: string } } };
  assert.equal(btn.child, "go-label");
  assert.deepEqual(btn.action, { event: { name: "run:now" } });
  assert.deepEqual(v09[2], {
    version: "v0.9",
    updateDataModel: { surfaceId: "legacy-1", path: "/", value: { msg: "hello" } },
  });

  // And the full façade path processes it end-to-end.
  reset();
  processA2uiMessages(JSON.stringify(legacy));
  assert.ok(getSurfaceModel("legacy-1"), "legacy batch renders through the official engine");
});

test("convertLegacyComponents synthesizes a Column root when none has id 'root'", () => {
  const out = convertLegacyComponents([
    { id: "a", type: "text", properties: { text: "A" } },
    { id: "b", type: "text", properties: { text: "B" } },
  ]);
  const root = out.find((c) => c.id === "root") as unknown as { children: string[] };
  assert.deepEqual([...root.children].sort(), ["a", "b"]);
});

test("extractSurfaceId finds ids in both dialects; clearSurfaces empties the map", () => {
  assert.equal(
    extractSurfaceId(JSON.stringify([{ version: "v0.9", createSurface: { surfaceId: "s9", catalogId: "x" } }])),
    "s9"
  );
  assert.equal(extractSurfaceId(JSON.stringify([{ type: "updateComponents", surfaceId: "s8" }])), "s8");
  assert.equal(extractSurfaceId("not json"), null);

  reset();
  processA2uiMessages(
    JSON.stringify([{ version: "v0.9", createSurface: { surfaceId: SURFACE, catalogId: BASIC_CATALOG_ID } }])
  );
  assert.ok(getSurfaceModels().some((s) => s.id === SURFACE));
  clearSurfaces();
  assert.equal(getSurfaceModels().length, 0);
});

// ── Replay idempotency (black-screen fix) ───────────────────────────────────
// The processor is a renderer-wide singleton while panels remount freely
// (KnowledgePanel's arch preview on every sub-tab switch). Re-feeding a batch
// that creates an already-live surface must RESET that surface, never throw —
// an exception inside a component effect unmounts the whole React tree.

test("replaying a createSurface batch resets the surface instead of throwing", () => {
  reset();
  const batch = JSON.stringify([
    { version: "v0.9", createSurface: { surfaceId: SURFACE, catalogId: BASIC_CATALOG_ID } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: SURFACE,
        components: [
          { id: "root", component: "Column", children: ["t"] },
          { id: "t", component: "Text", text: "first" },
        ],
      },
    },
  ]);
  processA2uiMessages(batch);
  assert.equal(
    (getSurfaceModel(SURFACE)?.componentsModel.get("t") as unknown as { properties: { text: string } })?.properties
      .text,
    "first"
  );

  // Remount + replay with DIFFERENT content — must not throw, must refresh.
  const replay = JSON.stringify([
    { version: "v0.9", createSurface: { surfaceId: SURFACE, catalogId: BASIC_CATALOG_ID } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: SURFACE,
        components: [
          { id: "root", component: "Column", children: ["t"] },
          { id: "t", component: "Text", text: "second" },
        ],
      },
    },
  ]);
  assert.doesNotThrow(() => processA2uiMessages(replay));
  assert.ok(getSurfaceModel(SURFACE), "surface survives replay");
  assert.equal(
    (getSurfaceModel(SURFACE)?.componentsModel.get("t") as unknown as { properties: { text: string } })?.properties
      .text,
    "second",
    "replayed batch content wins"
  );
  assert.equal(getSurfaceModels().filter((s) => s.id === SURFACE).length, 1, "no duplicate surfaces");
});

test("a malformed batch degrades to a no-op instead of crashing the caller", () => {
  reset();
  processA2uiMessages(
    JSON.stringify([{ version: "v0.9", createSurface: { surfaceId: SURFACE, catalogId: "no-such-catalog" } }])
  );
  assert.ok(!getSurfaceModel(SURFACE), "unknown catalog did not create a surface");
  // Surfaces untouched by the bad batch keep working.
  processA2uiMessages(
    JSON.stringify([{ version: "v0.9", createSurface: { surfaceId: "ok-1", catalogId: BASIC_CATALOG_ID } }])
  );
  assert.ok(getSurfaceModel("ok-1"));
});
