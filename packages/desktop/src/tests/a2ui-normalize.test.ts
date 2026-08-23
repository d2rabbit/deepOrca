/**
 * v0.9 shape-repair tests for the MCP boundary normalizer (a2ui-mcp).
 * These lock the repairs observed on the real 2026-08-24 arch-scan run:
 * sibling Tabs, Card-with-children, childless Cards, single-child layouts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeComponents } from "../main/tools/a2ui/a2ui-mcp";

type Comp = Record<string, unknown>;

function byId(comps: Comp[]): Map<string, Comp> {
  return new Map(comps.map((c) => [String(c.id), c]));
}

test("sibling Tabs(title, child) merge into ONE container with tabs[]", () => {
  const out = normalizeComponents([
    { id: "root", component: "Column", children: ["t1", "t2", "t3"] },
    { id: "t1", component: "Tabs", title: "总体", child: "c1" },
    { id: "t2", component: "Tabs", title: "数据流", child: "c2" },
    { id: "t3", component: "Tabs", title: "依赖", child: "c3" },
    { id: "c1", component: "Text", text: "a" },
    { id: "c2", component: "Text", text: "b" },
    { id: "c3", component: "Text", text: "c" },
  ]);
  const m = byId(out);
  const tabsComps = out.filter((c) => c.component === "Tabs");
  assert.equal(tabsComps.length, 1, "exactly one Tabs container survives");
  const merged = tabsComps[0] as { id: string; tabs: Array<{ title: string; child: string }> };
  assert.equal(merged.id, "t1");
  assert.equal(merged.tabs.length, 3);
  assert.deepEqual(merged.tabs[1], { title: "数据流", child: "c2" });
  // Children list dedups the merged siblings, order preserved.
  assert.deepEqual(m.get("root")?.children, ["t1"]);
  // Content children untouched.
  assert.ok(m.has("c2"));
});

test("Card with children wraps them in an inner Column; childless Card gets a placeholder", () => {
  const out = normalizeComponents([
    { id: "root", component: "Column", children: ["card1", "card2"] },
    { id: "card1", component: "Card", children: ["a", "b"] },
    { id: "card2", component: "Card" },
    { id: "a", component: "Text", text: "a" },
    { id: "b", component: "Text", text: "b" },
  ]);
  const m = byId(out);
  const card1 = m.get("card1") as { child: string };
  assert.equal(typeof card1.child, "string");
  const inner = m.get(card1.child) as { component: string; children: string[] };
  assert.equal(inner.component, "Column");
  assert.deepEqual(inner.children, ["a", "b"]);
  const card2 = m.get("card2") as { child: string };
  assert.equal(m.get(card2.child)?.component, "Text");
});

test("Row/Column/List with a single `child` becomes children:[child]", () => {
  const out = normalizeComponents([
    { id: "root", component: "Column", child: "x" },
    { id: "x", component: "Text", text: "hi" },
  ]);
  const m = byId(out);
  assert.deepEqual(m.get("root")?.children, ["x"]);
  assert.ok(!("child" in (m.get("root") as Comp)));
});

test("already-valid v0.9 trees pass through untouched", () => {
  const input = [
    { id: "root", component: "Column", children: ["t", "txt"] },
    {
      id: "t",
      component: "Tabs",
      tabs: [
        { title: "A", child: "txt" },
        { title: "B", child: "txt" },
      ],
    },
    { id: "txt", component: "Text", text: "x", variant: "body" },
  ];
  const out = normalizeComponents(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(out, input);
});
