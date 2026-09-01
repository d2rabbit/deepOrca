/**
 * CRG query layer — regression against the ESM `require("node:sqlite")` bug
 * (user screenshot 2026-08-31): a bare require inside this ESM package throws
 * ReferenceError on every call, each query's catch swallows it, and review.full
 * permanently reads "CRG graph present but produced no structural data". These
 * tests run the REAL default implementation against a REAL graph.db — any
 * regression back to a broken loader fails here with the actual error instead
 * of degrading silently.
 */

import { strict as assert } from "node:assert";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CRG_DATA_DIR, CRG_LEGACY_DIR } from "../common/generated-dirs";
import { createCrgGraphQuery, mergeReviewWithCrgRisk } from "../actions/crg-query";

/** Minimal graph.db with the schema subset the query layer reads. */
async function makeGraphDb(
  root: string,
  files: { filePath: string; name: string }[],
  dirName = CRG_DATA_DIR
): Promise<void> {
  const dir = path.join(root, dirName);
  await fsp.mkdir(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "graph.db"));
  try {
    db.exec(`CREATE TABLE nodes (
      qualified_name TEXT, name TEXT, file_path TEXT, language TEXT,
      line_start INTEGER, line_end INTEGER, kind TEXT)`);
    db.exec(`CREATE TABLE risk_index (
      qualified_name TEXT, risk_score REAL, caller_count INTEGER,
      test_coverage TEXT, security_relevant INTEGER)`);
    db.exec(`CREATE TABLE edges (
      source_qualified TEXT, target_qualified TEXT, kind TEXT)`);
    const ins = db.prepare(`INSERT INTO nodes VALUES (?, ?, ?, 'typescript', 1, 10, 'Function')`);
    for (const f of files) ins.run(`${f.filePath}#${f.name}`, f.name, f.filePath);
    const risk = db.prepare(`INSERT INTO risk_index VALUES (?, ?, ?, ?, ?)`);
    for (const f of files) risk.run(`${f.filePath}#${f.name}`, 0.8, 3, "uncovered", 0);
  } finally {
    db.close();
  }
}

test("detectChanges finds changed functions in a real graph.db (ESM-safe loader)", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "crg-query-"));
  try {
    const file = path.join(root, "src", "auth.ts");
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, "export const login = () => 1;\n");
    await makeGraphDb(root, [{ filePath: file, name: "login" }]);

    const q = createCrgGraphQuery();
    assert.equal(q.hasGraph(root), true);
    const changes = q.detectChanges(root, [file]);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].name, "login");
    assert.equal(changes[0].qualifiedName, `${file}#login`);

    // Empty input short-circuits without touching the db.
    assert.deepEqual(q.detectChanges(root, []), []);
    // A file the graph doesn't know yields no rows, not an error.
    assert.deepEqual(q.detectChanges(root, [path.join(root, "src", "other.ts")]), []);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("getRiskData reads the risk_index table through the same loader", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "crg-risk-"));
  try {
    const file = path.join(root, "src", "pay.ts");
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, "export const pay = () => 2;\n");
    await makeGraphDb(root, [{ filePath: file, name: "pay" }]);

    const q = createCrgGraphQuery();
    const risks = q.getRiskData(root, [`${file}#pay`]);
    assert.equal(risks.length, 1);
    assert.equal(risks[0].riskScore, 0.8);
    assert.equal(risks[0].testCoverage, "uncovered");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("a pre-centralization legacy graph stays readable until migrated", async () => {
  // Generated-content centralization (user rule 2026-08-31): projects whose
  // graph still lives at the wheel's old default must keep their review.full
  // enrichment alive — queries are read-only, so the legacy location serves.
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "crg-legacy-"));
  try {
    const file = path.join(root, "src", "auth.ts");
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, "export const login = () => 1;\n");
    await makeGraphDb(root, [{ filePath: file, name: "login" }], CRG_LEGACY_DIR);

    const q = createCrgGraphQuery();
    assert.equal(q.hasGraph(root), true, "legacy graph.db must be found");
    const changes = q.detectChanges(root, [file]);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].name, "login");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("getRiskOverview returns top nodes ranked by risk plus in-set CALLS edges", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "crg-overview-"));
  try {
    const dir = path.join(root, CRG_DATA_DIR);
    await fsp.mkdir(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, "graph.db"));
    db.exec(`CREATE TABLE nodes (
      qualified_name TEXT, name TEXT, file_path TEXT, language TEXT,
      line_start INTEGER, line_end INTEGER, kind TEXT)`);
    db.exec(`CREATE TABLE risk_index (
      qualified_name TEXT, risk_score REAL, caller_count INTEGER,
      test_coverage TEXT, security_relevant INTEGER)`);
    db.exec(`CREATE TABLE edges (
      source_qualified TEXT, target_qualified TEXT, kind TEXT)`);
    const mk = (name: string, score: number, kind = "Function"): string => {
      const qn = `mod#${name}`;
      db.prepare(`INSERT INTO nodes VALUES (?, ?, ?, 'typescript', 1, 10, ?)`).run(qn, name, `src/${name}.ts`, kind);
      db.prepare(`INSERT INTO risk_index VALUES (?, ?, ?, ?, ?)`).run(
        qn,
        score,
        2,
        "uncovered",
        name === "hot" ? 1 : 0
      );
      return qn;
    };
    const hot = mk("hot", 0.95);
    const mid = mk("mid", 0.5);
    const low = mk("low", 0.1);
    const edge = db.prepare(`INSERT INTO edges VALUES (?, ?, 'CALLS')`);
    edge.run(hot, mid);
    edge.run(mid, low);
    edge.run(hot, "mod#outside"); // endpoint outside the set — dropped
    edge.run(hot, hot); // self edge — dropped
    db.close();

    const q = createCrgGraphQuery();
    const { nodes, edges } = q.getRiskOverview(root, 10);
    assert.deepEqual(
      nodes.map((n) => n.name),
      ["hot", "mid", "low"],
      "ranked by risk_score desc"
    );
    assert.equal(nodes[0].securityRelevant, true);
    assert.equal(edges.length, 2, "out-of-set and self edges are dropped");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("getRiskOverview degrades to empty without a risk_index table", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "crg-norisk-"));
  try {
    const dir = path.join(root, CRG_DATA_DIR);
    await fsp.mkdir(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, "graph.db"));
    db.exec(`CREATE TABLE nodes (
      qualified_name TEXT, name TEXT, file_path TEXT, language TEXT,
      line_start INTEGER, line_end INTEGER, kind TEXT)`);
    db.prepare(`INSERT INTO nodes VALUES ('m#x', 'x', 'src/x.ts', 'ts', 1, 5, 'Function')`).run();
    db.close();
    const q = createCrgGraphQuery();
    assert.deepEqual(q.getRiskOverview(root, 10), { nodes: [], edges: [] });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("detectChanges matches the graph's POSIX file identity from native/relative inputs", async () => {
  // Review round 2026-09-01: the wheel stores file_path POSIX-normalized
  // (invariant #774) while `path.resolve` yields native separators on Windows
  // — the verbatim `IN (...)` match silently returned nothing there.
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "crg-posix-"));
  try {
    const file = path.join(root, "src", "auth.ts");
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, "export const login = () => 1;\n");
    // Store the db row the way the wheel does: forward slashes, absolute.
    await makeGraphDb(root, [{ filePath: file.replace(/\\/g, "/"), name: "login" }]);

    const q = createCrgGraphQuery();
    // Native-separator input (Windows resolve output).
    assert.equal(q.detectChanges(root, [file]).length, 1, "native-separator absolute input must match");
    // Repo-relative input (what git name-output produces).
    assert.equal(q.detectChanges(root, ["src/auth.ts"]).length, 1, "relative input must resolve+match");
    // Forward-slash absolute input.
    assert.equal(q.detectChanges(root, [file.replace(/\\/g, "/")]).length, 1);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("mergeReviewWithCrgRisk attaches tags across the relative/absolute path shapes", () => {
  // Review round 2026-09-01: OCR comments carry git-style repo-relative
  // paths while the change set carries the graph's POSIX-absolute identity —
  // the verbatim lookup never matched, so CRG chips never rendered.
  const graphFile = "D:/repo/src/auth.ts";
  const changes = [
    {
      qualifiedName: "D:/repo/src/auth.ts#login",
      name: "login",
      filePath: graphFile,
      language: "ts",
      lineStart: 1,
      lineEnd: 9,
      kind: "Function",
    },
  ];
  const risks = [
    {
      qualifiedName: "D:/repo/src/auth.ts#login",
      riskScore: 0.9,
      callerCount: 7,
      testCoverage: "uncovered",
      securityRelevant: false,
    },
  ];
  const comments = [
    { path: "src/auth.ts", startLine: 2, content: "[HIGH] race" },
    { path: "D:/repo/src/auth.ts", startLine: 4, content: "absolute spelling too" },
    { path: "src/other.ts", startLine: 5, content: "unrelated file" },
  ];

  const withRoot = mergeReviewWithCrgRisk(comments, risks, changes, "D:\\repo");
  assert.equal(withRoot[0].crgRisk, "HIGH (7 callers)", "relative comment path resolves through the root");
  assert.equal(withRoot[1].crgRisk, "HIGH (7 callers)", "absolute comment path normalizes to graph form");
  assert.equal(withRoot[2].crgRisk, undefined, "unmatched files stay untagged");

  // Without a root, only verbatim matches can hit — documents WHY the caller
  // must pass projectRoot (the pre-fix behavior).
  const noRoot = mergeReviewWithCrgRisk(comments, risks, changes);
  assert.equal(noRoot[0].crgRisk, undefined);
});

test("mergeReviewWithCrgRisk maps risk scores to LOW/MEDIUM/HIGH bands", () => {
  const mk = (score: number, qn: string) => ({
    qualifiedName: qn,
    riskScore: score,
    callerCount: 2,
    testCoverage: "uncovered",
    securityRelevant: false,
  });
  const changes = [
    { qualifiedName: "h", name: "h", filePath: "h.ts", language: "ts", lineStart: 1, lineEnd: 2, kind: "Function" },
    { qualifiedName: "m", name: "m", filePath: "m.ts", language: "ts", lineStart: 1, lineEnd: 2, kind: "Function" },
    { qualifiedName: "l", name: "l", filePath: "l.ts", language: "ts", lineStart: 1, lineEnd: 2, kind: "Function" },
  ];
  const risks = [mk(0.9, "h"), mk(0.5, "m"), mk(0.1, "l")];
  const comments = [
    { path: "h.ts", startLine: 1, content: "a" },
    { path: "m.ts", startLine: 1, content: "b" },
    { path: "l.ts", startLine: 1, content: "c" },
  ];
  const got = mergeReviewWithCrgRisk(comments, risks, changes, "D:/repo");
  assert.match(got[0].crgRisk ?? "", /^HIGH/);
  assert.match(got[1].crgRisk ?? "", /^MEDIUM/);
  assert.equal(got[2].crgRisk, "LOW");
});
