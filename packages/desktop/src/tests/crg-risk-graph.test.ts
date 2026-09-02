/**
 * Risk-board DATA builder (crg-risk-graph.ts) — main now ships structure
 * (nodes/edges/communities) for the native flat board; layout/theme/i18n
 * live renderer-side. Pins: null without a graph / without risk data, node
 * + community content, endpoint filtering of edges, and the POSIX path
 * identity the finding binder matches against.
 */

import { strict as assert } from "node:assert";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CRG_DATA_DIR } from "@deeporca/core";
import { buildRiskGraphData, getRiskOverviewCached, OVERVIEW_LIMIT } from "../main/tools/crg-risk-graph";

async function makeGraph(root: string): Promise<void> {
  const dir = path.join(root, CRG_DATA_DIR);
  await fsp.mkdir(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "graph.db"));
  db.exec(`CREATE TABLE nodes (
    id INTEGER PRIMARY KEY, kind TEXT, name TEXT, qualified_name TEXT UNIQUE,
    file_path TEXT, line_start INTEGER, line_end INTEGER, language TEXT, community_id INTEGER)`);
  db.exec(`CREATE TABLE edges (source_qualified TEXT, target_qualified TEXT, kind TEXT)`);
  db.exec(`CREATE TABLE risk_index (qualified_name TEXT, risk_score REAL, caller_count INTEGER,
    test_coverage TEXT, security_relevant INTEGER)`);
  db.exec(`CREATE TABLE communities (id INTEGER PRIMARY KEY, name TEXT, cohesion REAL, size INTEGER,
    dominant_language TEXT, description TEXT)`);
  db.exec(`CREATE TABLE flows (id INTEGER PRIMARY KEY, name TEXT, entry_point_id INTEGER, depth INTEGER,
    node_count INTEGER, file_count INTEGER, criticality REAL)`);
  db.exec(`CREATE TABLE flow_memberships (flow_id INTEGER, node_id INTEGER)`);
  const a = path.join(root, "src", "auth.ts");
  const b = path.join(root, "src", "pay.ts");
  db.prepare(`INSERT INTO nodes VALUES (1, 'Function', 'login', ?, ?, 7, 20, 'ts', 1)`).run(`${a}#login`, a);
  db.prepare(`INSERT INTO nodes VALUES (2, 'Function', 'pay', ?, ?, 3, 9, 'ts', 2)`).run(`${b}#pay`, b);
  // Dangling edge (target outside the risk set) — must NOT ship.
  db.prepare(`INSERT INTO edges VALUES (?, ?, 'CALLS')`).run(`${b}#pay`, `${a}#ghost`);
  db.prepare(`INSERT INTO edges VALUES (?, ?, 'CALLS')`).run(`${b}#pay`, `${a}#login`);
  db.prepare(`INSERT INTO risk_index VALUES (?, 0.9, 5, 'uncovered', 1)`).run(`${a}#login`);
  db.prepare(`INSERT INTO risk_index VALUES (?, 0.4, 1, 'uncovered', 0)`).run(`${b}#pay`);
  db.prepare(`INSERT INTO communities VALUES (1, '认证域', 0.81, 9, 'ts', 'auth')`).run();
  db.prepare(`INSERT INTO communities VALUES (2, '支付域', 0.6, 4, 'ts', 'pay')`).run();
  db.close();
}

test("risk data: null without a graph and null without risk data", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "riskdata-"));
  try {
    assert.equal(buildRiskGraphData(root), null, "no graph at all");
    await makeGraph(root);
    // Empty (not dropped) tables: the six-factor query fail-opens to risk-0
    // rows on a missing TABLE, so "no risk data" means an empty overview.
    const db = new DatabaseSync(path.join(root, CRG_DATA_DIR, "graph.db"));
    db.exec("DELETE FROM risk_index; DELETE FROM nodes;");
    db.close();
    assert.equal(buildRiskGraphData(root), null, "graph without risk data");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("risk data: ships nodes, communities and endpoint-filtered edges", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "riskdata2-"));
  try {
    await makeGraph(root);
    const data = buildRiskGraphData(root)!;
    assert.notEqual(data, null);
    // Nodes: graph-identity fields the board + binder rely on.
    const login = data.nodes.find((n) => n.name === "login")!;
    assert.equal(login.qn, `${path.join(root, "src", "auth.ts")}#login`);
    assert.equal(login.community, 1);
    assert.equal(login.security, true);
    // Six-factor overview normalizes the wheel's "uncovered" to "untested"
    // (two-vocabulary rule, crg-query.ts) — pin the shipped value.
    assert.equal(login.coverage, "untested");
    assert.ok(typeof login.risk === "number" && login.risk > 0);
    // Communities: names for the 按社区 grouping's labels.
    assert.deepEqual(
      data.communities.map((c) => c.name),
      ["认证域", "支付域"]
    );
    // Edges: only pairs with BOTH endpoints in the node set — the ghost
    // target must have been dropped.
    assert.equal(data.edges.length, 1);
    assert.equal(data.edges[0].target, login.qn);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("risk data: a focused locate must NOT mutate the shared overview cache", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "riskdata3-"));
  try {
    await makeGraph(root);
    // Locate-jump pull path precondition: the focused node must rank OUTSIDE
    // the top-OVERVIEW_LIMIT overview. 65 extra low-risk nodes push ranks 61+
    // off the board; the lowest-ranked one is the focus target.
    const db = new DatabaseSync(path.join(root, CRG_DATA_DIR, "graph.db"));
    let focusQn = "";
    let focusRisk = Number.MAX_SAFE_INTEGER;
    for (let i = 1; i <= 65; i++) {
      const f = path.join(root, "src", `gen${i}.ts`);
      const qn = `${f}#fn${i}`;
      const risk = 0.3 - i * 0.001;
      db.prepare(`INSERT INTO nodes VALUES (?, 'Function', ?, ?, ?, 1, 2, 'ts', 1)`).run(5 + i, `fn${i}`, qn, f);
      db.prepare(`INSERT INTO risk_index VALUES (?, ?, 0, 'uncovered', 0)`).run(qn, risk);
      if (risk < focusRisk) {
        focusRisk = risk;
        focusQn = qn;
      }
    }
    db.close();

    const before = getRiskOverviewCached(root, OVERVIEW_LIMIT);
    assert.equal(before.nodes.length, 60, "overview must cap at the display limit");

    const focused = buildRiskGraphData(root, [focusQn])!;
    assert.notEqual(focused, null);
    assert.equal(focused.nodes.length, 61, "the focused node should be pulled into the board");

    // The cache entry itself must be untouched: buildRiskGraphData receives
    // the cached arrays by reference and once pushed into them in place, so
    // every later PLAIN fetch of the same root rendered the focused node too.
    const after = getRiskOverviewCached(root, OVERVIEW_LIMIT);
    assert.equal(after.nodes.length, 60, "overview cache was polluted by the focus pull");
    assert.equal(after, before, "cache entry identity changed");

    const plain = buildRiskGraphData(root)!;
    assert.equal(plain.nodes.length, 60, "a plain fetch rendered the previous report's focused node");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
