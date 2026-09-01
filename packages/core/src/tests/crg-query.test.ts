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

test("mergeReviewWithCrgRisk attaches tags across the relative/absolute path shapes", async () => {
  // Review round 2026-09-01: OCR comments carry git-style repo-relative
  // paths while the change set carries the graph's POSIX-absolute identity —
  // the verbatim lookup never matched, so CRG chips never rendered. Built off
  // a REAL temp root (not a literal "D:\\repo\\…" fixture): path.resolve must
  // behave on every platform, and merge resolution is driven by the actual
  // root spelling each OS produces.
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "crg-merge-"));
  try {
    const absNative = path.join(root, "src", "auth.ts"); // path.resolve styling (native separators on Windows)
    const absPosix = absNative.replace(/\\/g, "/"); // graph identity (#774)
    const changes = [
      {
        qualifiedName: `${absPosix}#login`,
        name: "login",
        filePath: absPosix,
        language: "ts",
        lineStart: 1,
        lineEnd: 9,
        kind: "Function",
      },
    ];
    const risks = [
      {
        qualifiedName: `${absPosix}#login`,
        riskScore: 0.9,
        callerCount: 7,
        testCoverage: "uncovered",
        securityRelevant: false,
      },
    ];
    const comments = [
      { path: "src/auth.ts", startLine: 2, content: "[HIGH] race" },
      { path: absPosix, startLine: 4, content: "absolute posix spelling" },
      { path: absNative, startLine: 6, content: "absolute native spelling" },
      { path: "src/other.ts", startLine: 5, content: "unrelated file" },
    ];

    const withRoot = mergeReviewWithCrgRisk(comments, risks, changes, root);
    assert.equal(withRoot[0].crgRisk, "HIGH (7 callers)", "relative comment path resolves through the root");
    assert.equal(withRoot[1].crgRisk, "HIGH (7 callers)", "absolute posix spelling normalizes to graph form");
    assert.equal(withRoot[2].crgRisk, "HIGH (7 callers)", "absolute native spelling normalizes to graph form");
    assert.equal(withRoot[3].crgRisk, undefined, "unmatched files stay untagged");

    // Without a root, only verbatim matches can hit — documents WHY the
    // caller must pass projectRoot (the pre-fix behavior).
    const noRoot = mergeReviewWithCrgRisk(comments, risks, changes);
    assert.equal(noRoot[0].crgRisk, undefined);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
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

test("detectChanges narrows to line ranges when hunks are provided", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "crg-ranges-"));
  try {
    // Node spans lines 1..10 (makeGraphDb inserts line_start 1, line_end 10).
    const file = path.join(root, "src", "auth.ts");
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, "export {};\n");
    await makeGraphDb(root, [{ filePath: file, name: "login" }]);

    const q = createCrgGraphQuery();
    const overlapping = q.detectChanges(root, [file], { "src/auth.ts": [[3, 4]] });
    assert.equal(overlapping.length, 1, "range inside the node's span binds it");
    const outside = q.detectChanges(root, [file], { "src/auth.ts": [[20, 25]] });
    assert.equal(outside.length, 0, "range outside every node span drops the file");
    const noRanges = q.detectChanges(root, [file]);
    assert.equal(noRanges.length, 1, "no ranges → file-level fallback");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("detectChanges: a file with NO hunk intervals falls back to file-level when others have ranges", async () => {
  // Review round 2026-09-01: the most common working state is "tracked files
  // modified + a new file not yet `git add`ed" — untracked files never
  // appear in the diff, so a non-empty ranges map used to drop their nodes
  // entirely. Ranges must only NARROW files that have them.
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "crg-mixed-"));
  try {
    const tracked = path.join(root, "src", "tracked.ts");
    const untracked = path.join(root, "src", "fresh.ts");
    await fsp.mkdir(path.dirname(tracked), { recursive: true });
    await fsp.writeFile(tracked, "export {};\n");
    await fsp.writeFile(untracked, "export {};\n");
    await makeGraphDb(root, [
      { filePath: tracked, name: "trackedFn" },
      { filePath: untracked, name: "freshFn" },
    ]);

    const q = createCrgGraphQuery();
    const got = q.detectChanges(root, [tracked, untracked], { "src/tracked.ts": [[999, 1000]] });
    const names = got.map((c) => c.name).sort();
    assert.deepEqual(names, ["freshFn", "trackedFn"], "no-hunk file keeps file-level detection");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("getFileHashes returns build-time hashes for File nodes (freshness probe)", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "crg-hashes-"));
  try {
    const file = path.join(root, "src", "auth.ts");
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, "v1");
    const dir = path.join(root, CRG_DATA_DIR);
    await fsp.mkdir(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, "graph.db"));
    db.exec(`CREATE TABLE nodes (kind TEXT, file_path TEXT, file_hash TEXT)`);
    db.prepare(`INSERT INTO nodes VALUES ('File', ?, 'abc123')`).run(file.replace(/\\/g, "/"));
    db.close();

    const q = createCrgGraphQuery();
    const hashes = q.getFileHashes(root, ["src/auth.ts"]);
    assert.deepEqual(hashes, { [file.replace(/\\/g, "/")]: "abc123" });
    assert.deepEqual(q.getFileHashes(root, ["src/miss.ts"]), {}, "unknown file → no entry");
    assert.deepEqual(q.getFileHashes(root, []), {});
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("getRiskOverview ranks with the six-factor model (flows, cross-community, tests, security)", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "crg-sixfactor-"));
  try {
    const dir = path.join(root, CRG_DATA_DIR);
    await fsp.mkdir(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, "graph.db"));
    db.exec(`CREATE TABLE nodes (
      id INTEGER PRIMARY KEY, kind TEXT, name TEXT, qualified_name TEXT UNIQUE,
      file_path TEXT, line_start INTEGER, line_end INTEGER, language TEXT,
      community_id INTEGER)`);
    db.exec(`CREATE TABLE edges (source_qualified TEXT, target_qualified TEXT, kind TEXT)`);
    db.exec(
      `CREATE TABLE risk_index (qualified_name TEXT, risk_score REAL, caller_count INTEGER, test_coverage TEXT, security_relevant INTEGER)`
    );
    db.exec(
      `CREATE TABLE flows (id INTEGER PRIMARY KEY, name TEXT, entry_point_id INTEGER, depth INTEGER, node_count INTEGER, file_count INTEGER, criticality REAL)`
    );
    db.exec(`CREATE TABLE flow_memberships (flow_id INTEGER, node_id INTEGER)`);
    const root2 = path.join(root, ".."); // any base
    const a = path.join(root, "src", "a.ts").replace(/\\/g, "/");
    const b = path.join(root, "src", "b.ts").replace(/\\/g, "/");
    const aQn = `${a}#login`; // security keyword in name
    const bQn = `${b}#plain`;
    db.prepare(`INSERT INTO nodes VALUES (1, 'Function', 'login', ?, ?, 1, 20, 'ts', 1)`).run(aQn, a);
    db.prepare(`INSERT INTO nodes VALUES (2, 'Function', 'plain', ?, ?, 1, 20, 'ts', 2)`).run(bQn, b);
    db.prepare(`INSERT INTO edges VALUES (?, ?, 'CALLS')`).run(bQn, aQn); // cross-community caller
    db.prepare(`INSERT INTO edges VALUES (?, ?, 'TESTED_BY')`).run(aQn, `${b}#t1`);
    db.prepare(`INSERT INTO flows VALUES (1, 'login-flow', 1, 3, 2, 1, 0.4)`).run();
    db.prepare(`INSERT INTO flow_memberships VALUES (1, 1)`).run();
    // risk_index rows also exist — the six-factor path must win over them.
    db.prepare(`INSERT INTO risk_index VALUES (?, 0.1, 0, 'untested', 0)`).run(aQn);
    db.prepare(`INSERT INTO risk_index VALUES (?, 0.9, 0, 'untested', 0)`).run(bQn);
    db.close();

    const q = createCrgGraphQuery();
    const { nodes } = q.getRiskOverview(root, 10);
    assert.equal(nodes.length, 2);
    const login = nodes.find((n) => n.name === "login");
    assert.ok(login, "login node present");
    assert.equal(login!.securityRelevant, true, "full 24-word security list (risk_index only has 11)");
    assert.equal(login!.testCoverage, "tested", "direct test counted");
    assert.equal(login!.communityId, 1, "community membership rides the overview node (grouping axis)");
    // flow 0.4→cap 0.25 + cross-community 0.05 + tests (1 → 0.30−0.05)
    // + security 0.20 + callers 1 → 0.05 = 0.80
    assert.equal(login!.riskScore, 0.8, "six-factor score — flow/cross-community/tests/security/callers");
    const plain = nodes.find((n) => n.name === "plain");
    // plain CALLS login, and login IS tested — the transitive window (depth 1)
    // counts login's TESTED_BY for plain, so its test factor is 0.25 too.
    assert.equal(plain!.riskScore, 0.25, "direct callee tested → transitive coverage factor");
    assert.ok(nodes[0].qualifiedName === login!.qualifiedName, "higher-risk node ranks first");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("getRiskOverview falls back to risk_index when six-factor tables are absent", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "crg-sixfallback-"));
  try {
    const dir = path.join(root, CRG_DATA_DIR);
    await fsp.mkdir(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, "graph.db"));
    db.exec(
      `CREATE TABLE nodes (qualified_name TEXT, name TEXT, file_path TEXT, language TEXT, line_start INTEGER, line_end INTEGER, kind TEXT)`
    );
    db.exec(`CREATE TABLE edges (source_qualified TEXT, target_qualified TEXT, kind TEXT)`);
    db.exec(
      `CREATE TABLE risk_index (qualified_name TEXT, risk_score REAL, caller_count INTEGER, test_coverage TEXT, security_relevant INTEGER)`
    );
    db.prepare(`INSERT INTO nodes VALUES ('m#x', 'x', 'src/x.ts', 'ts', 1, 5, 'Function')`).run();
    db.prepare(`INSERT INTO risk_index VALUES ('m#x', 0.8, 3, 'uncovered', 0)`).run();
    db.close();
    const q = createCrgGraphQuery();
    const { nodes } = q.getRiskOverview(root, 10);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].riskScore, 0.8, "risk_index ranking survives without flows/communities");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("getAffectedFlows returns flows touching changed files (with critical path)", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "crg-flows-"));
  try {
    const dir = path.join(root, CRG_DATA_DIR);
    await fsp.mkdir(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, "graph.db"));
    db.exec(`CREATE TABLE nodes (id INTEGER PRIMARY KEY, name TEXT, file_path TEXT)`);
    db.exec(
      `CREATE TABLE flows (id INTEGER PRIMARY KEY, name TEXT, entry_point_id INTEGER, depth INTEGER, node_count INTEGER, file_count INTEGER, criticality REAL)`
    );
    db.exec(`CREATE TABLE flow_memberships (flow_id INTEGER, node_id INTEGER)`);
    db.exec(
      `CREATE TABLE flow_snapshots (flow_id INTEGER PRIMARY KEY, name TEXT, entry_point TEXT, critical_path TEXT)`
    );
    const file = path.join(root, "src", "a.ts");
    db.prepare(`INSERT INTO nodes VALUES (1, 'main', ?)`).run(file);
    db.prepare(`INSERT INTO nodes VALUES (2, 'handler', ?)`).run(file);
    db.prepare(`INSERT INTO flows VALUES (1, 'request-flow', 1, 3, 2, 1, 0.7)`).run();
    db.prepare(`INSERT INTO flow_memberships VALUES (1, 1)`).run();
    db.prepare(`INSERT INTO flow_memberships VALUES (1, 2)`).run();
    db.prepare(`INSERT INTO flow_snapshots VALUES (1, 'request-flow', 'main', '["main","handler"]')`).run();
    db.close();

    const q = createCrgGraphQuery();
    const flows = q.getAffectedFlows(root, [file]);
    assert.equal(flows.length, 1);
    assert.equal(flows[0].name, "request-flow");
    assert.equal(flows[0].entryPoint, "main");
    assert.equal(flows[0].criticality, 0.7);
    assert.deepEqual(flows[0].criticalPath, ["main", "handler"]);
    assert.deepEqual(q.getAffectedFlows(root, [path.join(root, "src", "miss.ts")]), [], "unrelated files → no flows");
    assert.deepEqual(q.getAffectedFlows(root, []), []);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("getInheritanceEdges counts INHERITS/IMPLEMENTS touching the nodes", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "crg-inherit-"));
  try {
    const dir = path.join(root, CRG_DATA_DIR);
    await fsp.mkdir(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, "graph.db"));
    db.exec(`CREATE TABLE edges (source_qualified TEXT, target_qualified TEXT, kind TEXT)`);
    db.prepare(`INSERT INTO edges VALUES ('A', 'B', 'INHERITS')`).run();
    db.prepare(`INSERT INTO edges VALUES ('C', 'I', 'IMPLEMENTS')`).run();
    db.prepare(`INSERT INTO edges VALUES ('X', 'Y', 'CALLS')`).run();
    db.close();
    const q = createCrgGraphQuery();
    assert.equal(q.getInheritanceEdges(root, ["A", "C"]), 2);
    assert.equal(q.getInheritanceEdges(root, ["X"]), 0);
    assert.equal(q.getInheritanceEdges(root, []), 0);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
