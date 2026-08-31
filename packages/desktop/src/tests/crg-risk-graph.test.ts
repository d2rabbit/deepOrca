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
  const qn = `src/${name}.ts#${name}`;
  db.prepare(`INSERT INTO nodes VALUES (?, ?, 'src/hot.ts', 'ts', 7, 20, 'Function')`).run(qn, name);
  db.prepare(`INSERT INTO risk_index VALUES (?, 0.9, 4, 'uncovered', 1)`).run(qn);
  db.close();
}

test("risk map: null without a graph and null without risk data", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "riskmap-"));
  try {
    assert.equal(buildRiskGraphHtml(root, "P", "zh-CN"), null, "no graph at all");
    await makeGraph(root);
    const dir = path.join(root, CRG_DATA_DIR, "graph.db");
    // Strip risk_index → overview empty → null.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dir);
    db.exec("DROP TABLE risk_index");
    db.close();
    assert.equal(buildRiskGraphHtml(root, "P", "zh-CN"), null, "graph without risk data");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("risk map: renders nodes, escapes hostile names, ships no external scripts", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "riskmap2-"));
  try {
    await makeGraph(root, true);
    const html = buildRiskGraphHtml(root, "GVGL", "zh-CN")!;
    assert.notEqual(html, null);
    assert.match(html, /审查风险图谱/);
    // The hostile name must appear ONLY escaped — no raw <script> survives.
    assert.ok(!html.includes("<script>alert"), "raw script tag must not survive escaping");
    assert.match(html, /&lt;script&gt;/);
    // No external resources — the dock iframe sandbox allows scripts only.
    assert.ok(!/src\s*=\s*"http/.test(html), "no external script/src references");
    assert.ok(!/href\s*=\s*"http/.test(html), "no external href references");
    assert.match(html, /data-id=/, "interactive node hooks present");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
