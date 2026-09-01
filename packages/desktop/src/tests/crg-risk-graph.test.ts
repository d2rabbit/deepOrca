/**
 * Simplified risk map generator (crg-risk-graph.ts) — the replacement for the
 * CRG wheel's D3 `visualize` path. Runs the REAL generator against a REAL
 * graph.db fixture and pins: null without a graph / without risk data, node
 * names present, ALL model-controlled strings HTML-escaped, no external
 * scripts (the page renders inside a sandboxed iframe with allow-scripts
 * only, so remote or file references must never appear).
 */

import { strict as assert } from "node:assert";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CRG_DATA_DIR } from "@deeporca/core";
import { buildRiskGraphHtml } from "../main/tools/crg-risk-graph";

async function makeGraph(root: string, evilName = false): Promise<void> {
  const dir = path.join(root, CRG_DATA_DIR);
  await fsp.mkdir(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "graph.db"));
  const name = evilName ? '<script>alert("x")</script>' : "hot";
  db.exec(`CREATE TABLE nodes (
    qualified_name TEXT, name TEXT, file_path TEXT, language TEXT,
    line_start INTEGER, line_end INTEGER, kind TEXT)`);
  db.exec(`CREATE TABLE risk_index (
    qualified_name TEXT, risk_score REAL, caller_count INTEGER,
    test_coverage TEXT, security_relevant INTEGER)`);
  db.exec(`CREATE TABLE edges (
    source_qualified TEXT, target_qualified TEXT, kind TEXT)`);
  // Real CRG stores ABSOLUTE POSIX file_path (wheel invariant #774) — the
  // opinions binding matches findings against that identity.
  const filePath = path.join(root, "src", "hot.ts");
  const qn = `${filePath}#${name}`;
  db.prepare(`INSERT INTO nodes VALUES (?, ?, ?, 'ts', 7, 20, 'Function')`).run(qn, name, filePath);
  db.prepare(`INSERT INTO risk_index VALUES (?, 0.9, 4, 'uncovered', 1)`).run(qn);
  db.close();
}

test("risk map: null without a graph and null without risk data", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "riskmap-"));
  try {
    assert.equal(buildRiskGraphHtml(root, "P", "zh-CN", "light"), null, "no graph at all");
    await makeGraph(root);
    const dir = path.join(root, CRG_DATA_DIR, "graph.db");
    // Strip risk_index → overview empty → null.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dir);
    db.exec("DROP TABLE risk_index");
    db.close();
    assert.equal(buildRiskGraphHtml(root, "P", "zh-CN", "light"), null, "graph without risk data");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("risk map: renders nodes, escapes hostile names, ships no external scripts", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "riskmap2-"));
  try {
    await makeGraph(root, true);
    const html = buildRiskGraphHtml(root, "GVGL", "zh-CN", "light")!;
    assert.notEqual(html, null);
    assert.match(html, /审查风险图谱/);
    // The hostile name reaches the page ONLY through the JSON payload with
    // `<` escaped to \u003c — no raw <script> survives, in markup or JSON.
    assert.ok(!html.includes("<script>alert"), "raw script tag must not survive escaping");
    assert.match(html, /\\u003cscript>/);
    // No external resources — the iframe sandbox allows scripts only.
    assert.ok(!/src\s*=\s*"http/.test(html), "no external script/src references");
    assert.ok(!/href\s*=\s*"http/.test(html), "no external href references");
    // The canvas renderer ships its drawing surface + inline data payload.
    assert.match(html, /id="rc-canvas"/);
    assert.match(html, /var D = \{/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("risk map: theme is EXPLICIT, not prefers-color-scheme (the iframe must follow the app)", async () => {
  // Review round 2026-09-01: the page keyed its dark palette off the OS media
  // query, so the in-app appearance toggle did nothing inside the iframe.
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "riskmap3-"));
  try {
    await makeGraph(root);
    const light = buildRiskGraphHtml(root, "P", "en", "light")!;
    const dark = buildRiskGraphHtml(root, "P", "en", "dark")!;
    assert.match(light, /data-theme="light"/);
    assert.match(dark, /data-theme="dark"/);
    assert.match(dark, /#17191f/, "dark canvas palette baked into the payload");
    assert.match(light, /#f6f8fb/, "light canvas palette baked into the payload");
    assert.ok(!light.includes("prefers-color-scheme"), "OS media query must not drive the theme anymore");
    assert.ok(!dark.includes("prefers-color-scheme"), "OS media query must not drive the theme anymore");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("risk map: renders the opinions side card and the bidirectional postMessage bridge", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "riskmap3-"));
  try {
    await makeGraph(root);
    const findings = [
      { path: "src/hot.ts", startLine: 7, content: "[HIGH] token leak in login flow" },
      { path: "src/hot.ts", startLine: 2, content: "gap finding — should fall back to the node" },
    ];
    const html = buildRiskGraphHtml(root, "P", "zh-CN", "light", findings)!;
    assert.notEqual(html, null);
    // Opinions area: head label + one bound item (line 7 lands in node 7-20).
    assert.match(html, /相关审查意见/);
    assert.match(html, /token leak in login flow/);
    // The bridge: report→graph select-node listener + graph→report locate-finding post.
    assert.match(html, /crg:locate-finding/);
    assert.match(html, /crg:select-node/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("risk map: community grouping ships as first-class data with the mode switcher", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "riskmap-comm-"));
  try {
    const dir = path.join(root, CRG_DATA_DIR);
    await fsp.mkdir(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, "graph.db"));
    db.exec(`CREATE TABLE nodes (
      id INTEGER PRIMARY KEY, kind TEXT, name TEXT, qualified_name TEXT UNIQUE,
      file_path TEXT, line_start INTEGER, line_end INTEGER, language TEXT, community_id INTEGER)`);
    db.exec(`CREATE TABLE edges (source_qualified TEXT, target_qualified TEXT, kind TEXT)`);
    db.exec(
      `CREATE TABLE risk_index (qualified_name TEXT, risk_score REAL, caller_count INTEGER, test_coverage TEXT, security_relevant INTEGER)`
    );
    db.exec(
      `CREATE TABLE communities (id INTEGER PRIMARY KEY, name TEXT, cohesion REAL, size INTEGER, dominant_language TEXT, description TEXT)`
    );
    // Six-factor base query joins these (empty is fine — flow factor zeroes).
    db.exec(
      `CREATE TABLE flows (id INTEGER PRIMARY KEY, name TEXT, entry_point_id INTEGER, depth INTEGER, node_count INTEGER, file_count INTEGER, criticality REAL)`
    );
    db.exec(`CREATE TABLE flow_memberships (flow_id INTEGER, node_id INTEGER)`);
    const a = path.join(root, "src", "auth.ts");
    const b = path.join(root, "src", "pay.ts");
    db.prepare(`INSERT INTO nodes VALUES (1, 'Function', 'login', ?, ?, 7, 20, 'ts', 1)`).run(`${a}#login`, a);
    db.prepare(`INSERT INTO nodes VALUES (2, 'Function', 'pay', ?, ?, 3, 9, 'ts', 2)`).run(`${b}#pay`, b);
    db.prepare(`INSERT INTO edges VALUES (?, ?, 'CALLS')`).run(`${b}#pay`, `${a}#login`); // cross-community
    db.prepare(`INSERT INTO risk_index VALUES (?, 0.9, 5, 'uncovered', 1)`).run(`${a}#login`);
    db.prepare(`INSERT INTO risk_index VALUES (?, 0.4, 1, 'uncovered', 0)`).run(`${b}#pay`);
    db.prepare(`INSERT INTO communities VALUES (1, '认证域', 0.81, 9, 'ts', 'auth')`).run();
    db.prepare(`INSERT INTO communities VALUES (2, '支付域', 0.6, 4, 'ts', 'pay')`).run();
    db.close();

    const html = buildRiskGraphHtml(root, "P", "zh-CN", "light")!;
    // Canvas renderer: the payload carries BOTH communities + the toggle, and
    // the physics marks cross-community edges for the highlight pass.
    assert.match(html, /id="modeSeg"/, "community mode switcher present");
    assert.match(html, /认证域/, "community A name embedded");
    assert.match(html, /支付域/, "community B name embedded");
    assert.match(html, /"comm":1/, "node→community binding embedded");
    assert.match(html, /cross/i, "cross-community edge detection present");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
