// Archify layout-contract checker battery (specs/arch-visual-readback 门①):
// pure golden cases over the renderer's real --layout-json shape (probed on
// the vendored checkout-platform example), plus the honest-skip paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLayoutContract, runArchifyLayoutCheck, type LayoutReport } from "../main/tools/archify-layout-check";

/** Minimal real-shape report builder (components carry x/y/width/height). */
function report(overrides: Partial<LayoutReport> = {}): LayoutReport {
  return {
    ok: true,
    diagram_type: "architecture",
    viewBox: [1020, 548],
    components: [
      { id: "buyers", label: "Buyers", x: 40, y: 250, width: 120, height: 60 },
      { id: "edge", label: "Edge Gateway", x: 220, y: 250, width: 130, height: 60 },
    ],
    ...overrides,
  };
}

test("clean geometry passes with zero violations", () => {
  const result = checkLayoutContract(report());
  assert.deepEqual(result, { violations: [] });
});

test("component overlap beyond the 1px tolerance is flagged with both node ids", () => {
  const result = checkLayoutContract(
    report({
      components: [
        { id: "a", label: "A", x: 0, y: 0, width: 100, height: 50 },
        { id: "b", label: "B", x: 90, y: 0, width: 100, height: 50 }, // 10px sliver overlap
      ],
    })
  );
  assert.equal(result.violations.length, 1);
  const violation = result.violations[0]!;
  assert.equal(violation.kind, "component-overlap");
  assert.deepEqual(violation.nodes, ["a", "b"]);
  assert.ok(violation.detail.includes("px²"));
});

test("touching boxes (0-area contact) do NOT count as overlaps", () => {
  const result = checkLayoutContract(
    report({
      components: [
        { id: "a", label: "A", x: 0, y: 0, width: 100, height: 50 },
        { id: "b", label: "B", x: 100, y: 0, width: 100, height: 50 }, // edge-touching
      ],
    })
  );
  assert.equal(result.violations.length, 0);
});

test("out-of-canvas: a component beyond the viewBox is flagged (boundary containment is not)", () => {
  const result = checkLayoutContract(
    report({
      components: [
        { id: "in", label: "In", x: 10, y: 10, width: 50, height: 30 },
        { id: "out", label: "Out", x: 1000, y: 500, width: 100, height: 60 }, // exceeds 1020×548
      ],
      boundaries: [{ id: "zone", label: "Zone", x: 0, y: 0, width: 1020, height: 548 }], // full canvas = fine
    })
  );
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0]!.kind, "out-of-canvas");
  assert.deepEqual(result.violations[0]!.nodes, ["out"]);
});

test("honest skips: unreadable report, renderer-invalid, empty geometry", () => {
  for (const input of [null, 42, "x", {}]) {
    const result = checkLayoutContract(input);
    assert.equal(result.skipped, true, `skip for ${JSON.stringify(input)}`);
  }
  assert.equal(checkLayoutContract({ ok: false }).skipped, true);
  assert.equal(checkLayoutContract(report({ components: [] })).skipped, true);
});

test("runner: non-architecture types skip honestly; spawn failures skip with reason", () => {
  const skippedType = runArchifyLayoutCheck({
    archifyBinPath: "/unused/archify.mjs",
    diagramType: "sequence",
    irPath: "/unused.json",
  });
  assert.equal(skippedType.skipped, true);
  assert.ok(skippedType.skipReason?.includes("architecture"));

  const spawnFail = runArchifyLayoutCheck({
    archifyBinPath: "/unused/archify.mjs",
    diagramType: "architecture",
    irPath: "/unused.json",
    spawnSync: () => ({ status: 1, stdout: "", stderr: "schema error" }),
  });
  assert.equal(spawnFail.skipped, true);
  assert.ok(spawnFail.skipReason?.includes("schema error"));

  const spawnOk = runArchifyLayoutCheck({
    archifyBinPath: "/unused/archify.mjs",
    diagramType: "architecture",
    irPath: "/unused.json",
    spawnSync: () => ({
      status: 0,
      stdout: JSON.stringify(report()),
      stderr: "",
    }),
  });
  assert.deepEqual(spawnOk, { violations: [] });
});
