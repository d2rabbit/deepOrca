/**
 * Risk-board pure helpers (renderer lib) — grouping/tier/opinion rules of
 * the flat board. Pins:
 *   - tier thresholds (0.66 / 0.33 cut points),
 *   - community mode: named groups in id order, 未归类 trails, labels from
 *     the communities table (fallback `#id`),
 *   - file mode: one group per file, sorted by max risk,
 *   - cross-group counts count each boundary-crossing edge once per side,
 *   - opinions aggregate bindings per node with report-tier severity,
 *   - neighborsOf splits directed callers/callees.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { FindingBinding, RiskGraphData } from "../shared/ipc";
import {
  buildOpinions,
  buildRiskGroups,
  edgePath,
  LAYER,
  layoutBoard,
  neighborsOf,
  tierOf,
  type RiskGroup,
} from "../renderer/lib/risk-board";

const node = (qn: string, file: string, risk: number, community: number | null): RiskGraphData["nodes"][number] => ({
  qn,
  name: qn.split("#")[1] ?? qn,
  filePath: file,
  lineStart: 1,
  risk,
  callers: 1,
  security: false,
  community,
  coverage: "uncovered",
});

const data: RiskGraphData = {
  nodes: [
    node("/r/src/auth.ts#login", "/r/src/auth.ts", 0.9, 1),
    node("/r/src/auth.ts#logout", "/r/src/auth.ts", 0.2, 1),
    node("/r/src/pay.ts#charge", "/r/src/pay.ts", 0.7, 2),
    node("/r/src/util.ts#clamp", "/r/src/util.ts", 0.1, null),
  ],
  edges: [
    { source: "/r/src/pay.ts#charge", target: "/r/src/auth.ts#login" }, // cross 1↔2
    { source: "/r/src/auth.ts#login", target: "/r/src/auth.ts#logout" }, // inside 1
    { source: "/r/src/util.ts#clamp", target: "/r/src/auth.ts#logout" }, // cross null↔1
  ],
  communities: [
    { id: 1, name: "认证域" },
    { id: 2, name: "支付域" },
  ],
};

test("risk-board: tier cut points", () => {
  assert.equal(tierOf(0.66), "hi");
  assert.equal(tierOf(0.9), "hi");
  assert.equal(tierOf(0.33), "md");
  assert.equal(tierOf(0.5), "md");
  assert.equal(tierOf(0.32), "lo");
});

test("risk-board: community mode — named groups in id order, unassigned trails, risk-sorted chips", () => {
  const groups = buildRiskGroups(data, "community");
  // The unassigned group's label is "" at the lib level — the component fills
  // it with i18n `review.rgNoCommunity` (lib stays UI-free).
  assert.deepEqual(
    groups.map((g) => g.label),
    ["认证域", "支付域", ""]
  );
  const auth = groups[0];
  assert.deepEqual(
    auth.nodes.map((n) => n.name),
    ["login", "logout"],
    "chips sort risk-desc"
  );
  assert.equal(auth.hueIndex, 0);
  // 认证域 touches pay (cross) and util (cross) → 2 boundary-crossing edges.
  assert.equal(auth.cross, 2);
  assert.equal(groups[1].cross, 1);
  assert.equal(groups[2].cross, 1);
});

test("risk-board: file mode — one group per file sorted by max risk, neutral hue", () => {
  const groups = buildRiskGroups(data, "file");
  assert.deepEqual(
    groups.map((g) => g.label),
    ["auth.ts", "pay.ts", "util.ts"]
  );
  assert.ok(groups.every((g) => g.hueIndex === null));
  // Everything crosses in file mode except the login→logout pair (same file).
  assert.equal(groups[0].cross, 2); // auth.ts: charge→login, clamp→logout
});

test("risk-board: opinions aggregate per node with report tiers", () => {
  const findings = [
    { severity: "critical", content: "token replay window\nacross lines" },
    { severity: "medium", content: "hard-coded TTL" },
    { severity: undefined, content: "cosmetic naming" },
  ];
  const bindings: Record<number, FindingBinding> = {
    0: { index: 0, qn: "/r/src/auth.ts#login", name: "login", filePath: "/r/src/auth.ts", lineStart: 1, lineEnd: 20 },
    2: { index: 2, qn: "/r/src/auth.ts#login", name: "login", filePath: "/r/src/auth.ts", lineStart: 1, lineEnd: 20 },
    1: { index: 1, qn: "/r/src/pay.ts#charge", name: "charge", filePath: "/r/src/pay.ts", lineStart: 3, lineEnd: 9 },
  };
  const ops = buildOpinions(findings, bindings);
  const login = ops.get("/r/src/auth.ts#login")!;
  assert.equal(login.length, 2);
  assert.equal(login[0].sev, "hi");
  assert.equal(login[0].label, "token replay window across lines", "newlines collapse to one line");
  assert.equal(login[1].sev, "lo", "no severity parsed → low tier");
  assert.equal(ops.get("/r/src/pay.ts#charge")![0].sev, "md");
});

test("risk-board: neighbors split by direction, self excluded", () => {
  const { callers, callees } = neighborsOf(data.edges, "/r/src/auth.ts#logout");
  assert.deepEqual(callers, ["/r/src/auth.ts#login", "/r/src/util.ts#clamp"]);
  assert.deepEqual(callees, []);
  const charge = neighborsOf(data.edges, "/r/src/pay.ts#charge");
  assert.deepEqual(charge.callees, ["/r/src/auth.ts#login"]);
  assert.deepEqual(charge.callers, []);
});

test("risk-board: tier-layered layout is deterministic and stratifies by risk", () => {
  const l1 = layoutBoard(buildRiskGroups(data, "community"));
  const l2 = layoutBoard(buildRiskGroups(data, "community"));
  // Pixel-identical for identical input — no physics, no randomness.
  assert.deepEqual([...l1.nodes.values()], [...l2.nodes.values()]);
  // Fixture tiers: hi = login(.9)+charge(.7); lo = logout(.2)+clamp(.1);
  // md is empty and SKIPPED (no hollow band).
  assert.deepEqual(
    l1.tiers.map((b) => b.tier),
    ["hi", "lo"]
  );
  assert.ok(l1.tiers[0].y < l1.tiers[1].y, "高风险层在中低风险之上");
  assert.equal(l1.tiers[0].count, 2);
  // Full-width bands: the diagram spans the widest band, not a corner strip.
  const login = l1.nodes.get("/r/src/auth.ts#login")!;
  const charge = l1.nodes.get("/r/src/pay.ts#charge")!;
  const logout = l1.nodes.get("/r/src/auth.ts#logout")!;
  assert.equal(login.tier, "hi");
  assert.equal(charge.tier, "hi");
  assert.equal(logout.tier, "lo");
  // Same-band, different blocks → charge sits to the RIGHT of login (group
  // order), both above every lo-band node.
  assert.ok(charge.x > login.x, "groups tile left→right inside a band");
  assert.ok(logout.y > login.y, "lo band below hi band");
  // Radius grows with risk.
  assert.ok(login.r > logout.r);
  assert.equal(l1.width, LAYER.width);
});

test("risk-board: edge paths trim to the disc rims (arrow room)", () => {
  const l = layoutBoard(buildRiskGroups(data, "community"));
  const a = l.nodes.get("/r/src/pay.ts#charge")!;
  const b = l.nodes.get("/r/src/auth.ts#login")!;
  const path = edgePath(a, b);
  const m = path.match(/^M ([\d.]+) ([\d.]+).* ([\d.]+) ([\d.]+)$/);
  assert.ok(m, "path parses to start/end points");
  const [sx, sy, ex, ey] = m!.slice(1).map(Number);
  // Starts at the source rim, not its center; ends short of the target disc.
  assert.ok(Math.hypot(sx - a.x, sy - a.y) > a.r, "start lifted off the source center");
  assert.ok(Math.hypot(ex - b.x, ey - b.y) > b.r, "end kept clear of the target center");
  assert.ok(Math.hypot(sx - a.x, sy - a.y) <= a.r + 4, "start still at the rim");
  assert.ok(Math.hypot(ex - b.x, ey - b.y) <= b.r + 7, "end still near the rim");
});

test("risk-board: node grids stretch with the pane, then wrap", () => {
  // 13 nodes in ONE group on the default canvas: the elastic slot formula
  // gives slotW = clamp(bandInner/8, base, 150) = 137, cols = bandInner/slotW
  // = 8 → two node rows (8 + 5).
  const big: RiskGroup[] = [
    {
      key: "g",
      label: "g",
      hueIndex: 0,
      cross: 0,
      nodes: Array.from({ length: 13 }, (_, i) => node(`/r/src/big.ts#f${i}`, "/r/src/big.ts", 0.95 - i * 0.01, 1)),
    },
  ];
  const l = layoutBoard(big);
  const block = l.blocks[0];
  assert.equal(block.count, 13);
  const bandInner = LAYER.width - LAYER.padX * 2 - LAYER.bandPadX * 2;
  const slotW = Math.max(LAYER.nodeSlotW, Math.min(150, Math.floor(bandInner / 8)));
  const cols = Math.min(13, Math.floor(bandInner / slotW));
  assert.equal(block.w, LAYER.blockPadX * 2 + cols * slotW);
  const ys = new Set([...l.nodes.values()].map((n) => n.y));
  assert.equal(ys.size, Math.ceil(13 / cols));
  // Whole diagram keeps the pane width; height covers the rows.
  assert.equal(l.width, LAYER.width);
  assert.ok(l.height >= LAYER.blockHeadH + Math.ceil(13 / cols) * LAYER.nodeRowH);
});

test("risk-board: vertical spread fills a tall pane (no top-left clustering)", () => {
  const groups = buildRiskGroups(data, "community");
  const compact = layoutBoard(groups);
  const tall = layoutBoard(groups, { width: LAYER.width, height: compact.height * 2.2 });
  assert.ok(tall.height > compact.height * 1.8, "leftover pane height spreads into gaps");
  // Bands keep their ORDER and top node y grows accordingly.
  const firstTall = tall.tiers[0];
  const lastTall = tall.tiers[tall.tiers.length - 1];
  assert.ok(lastTall.y > firstTall.y + firstTall.h + 10, "bands separate when the pane is tall");
});
