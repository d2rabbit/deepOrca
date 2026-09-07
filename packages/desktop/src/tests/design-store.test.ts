import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  saveDesignArtifact,
  listDesignArtifacts,
  readDesignArtifact,
  deleteDesignArtifact,
  saveFormState,
  readFormState,
  onDesignStoreChange,
  createDesignSuite,
  appendDesignSuiteVersion,
  readDesignSuite,
  readDesignSuiteVersion,
  listDesignSuites,
  deleteDesignSuite,
  onDesignSuiteChange,
} from "../main/tools/design-store";
import type {
  DesignQualityResult,
  DesignSuiteChangeEvent,
  PrototypeSuiteContent,
  UiSuiteContent,
} from "../main/tools/design-store";

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "design-store-test-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

test("save + list + read + delete round-trips an artifact", () => {
  const root = tempRoot();
  const meta = saveDesignArtifact(root, { title: "Login", pipeline: "openui", content: "root = Column([])" });
  assert.ok(meta);

  assert.equal(listDesignArtifacts(root).length, 1);
  const artifact = readDesignArtifact(root, meta!.id);
  assert.equal(artifact?.content, "root = Column([])");
  assert.equal(artifact?.pipeline, "openui");

  assert.equal(deleteDesignArtifact(root, meta!.id), true);
  assert.equal(listDesignArtifacts(root).length, 0);
  assert.equal(readDesignArtifact(root, meta!.id), null);
});

test("content changes snapshot the previous version; same content does not", () => {
  const root = tempRoot();
  const first = saveDesignArtifact(root, { title: "Proto", pipeline: "openui", content: "v1" });
  assert.ok(first);
  assert.equal(first?.versions, undefined);

  // Unchanged content → no new version.
  const same = saveDesignArtifact(root, { id: first!.id, title: "Proto", pipeline: "openui", content: "v1" });
  assert.equal(same?.versions?.length ?? 0, 0);

  // Changed content → previous content becomes a version.
  const second = saveDesignArtifact(root, { id: first!.id, title: "Proto", pipeline: "openui", content: "v2" });
  assert.equal(second?.versions?.length, 1);
  assert.equal(second?.versions?.[0]?.content, "v1");

  const third = saveDesignArtifact(root, { id: first!.id, title: "Proto", pipeline: "openui", content: "v3" });
  assert.equal(third?.versions?.length, 2);
  assert.deepEqual(
    third?.versions?.map((v) => v.content),
    ["v1", "v2"]
  );
  assert.equal(readDesignArtifact(root, first!.id)?.content, "v3");
});

test("requirement is persisted as requirement.md and returned on read", () => {
  const root = tempRoot();
  const meta = saveDesignArtifact(root, {
    title: "Dash",
    pipeline: "design",
    content: "---\nname: dash\n---",
    requirement: "需要一个月度经营看板",
  });
  assert.ok(meta);
  const artifact = readDesignArtifact(root, meta!.id);
  assert.equal(artifact?.requirement, "需要一个月度经营看板");
  assert.ok(
    fs.existsSync(path.join(root, ".deeporca", "designs", meta!.id, "requirement.md")),
    "requirement.md should exist on disk"
  );

  // Update without requirement keeps the existing file.
  saveDesignArtifact(root, { id: meta!.id, title: "Dash", pipeline: "design", content: "---\nname: dash2\n---" });
  assert.equal(readDesignArtifact(root, meta!.id)?.requirement, "需要一个月度经营看板");
});

test("formState round-trips and reads null when absent", () => {
  const root = tempRoot();
  const meta = saveDesignArtifact(root, { title: "Form", pipeline: "openui", content: "root = Column([])" });
  assert.ok(meta);

  assert.equal(readFormState(root, meta!.id), null);
  assert.equal(saveFormState(root, meta!.id, { email: "a@b.c" }), true);
  assert.deepEqual(readFormState(root, meta!.id), { email: "a@b.c" });
});

test("version snapshots are capped (FIFO beyond the limit)", () => {
  const root = tempRoot();
  const meta = saveDesignArtifact(root, { title: "Cap", pipeline: "openui", content: "v0" });
  assert.ok(meta);
  // MAX_VERSIONS is 20 — save 25 distinct contents.
  for (let i = 1; i <= 25; i += 1) {
    saveDesignArtifact(root, { id: meta!.id, title: "Cap", pipeline: "openui", content: `v${i}` });
  }
  const artifact = readDesignArtifact(root, meta!.id);
  assert.equal(artifact?.versions?.length, 20);
  assert.equal(artifact?.versions?.[0]?.content, "v5");
  assert.equal(artifact?.content, "v25");
});

test("artifact ids with traversal/absolute/separator are rejected (containment)", () => {
  const root = tempRoot();
  const meta = saveDesignArtifact(root, { title: "Victim", pipeline: "openui", content: "root = Column([])" });
  assert.ok(meta);

  const evil = ["../../outside", "..", "/etc", "sub/dir", "a\\b", "."];
  for (const id of evil) {
    assert.equal(readDesignArtifact(root, id), null, `read must reject ${id}`);
    assert.equal(deleteDesignArtifact(root, id), false, `delete must reject ${id}`);
    assert.equal(readFormState(root, id), null, `formState must reject ${id}`);
  }
  // The legitimate artifact is untouched.
  assert.ok(readDesignArtifact(root, meta!.id));
});

// ── design-module split: the spec pipeline + change events ───────────────────

test("spec pipeline round-trips (需求文档 artifacts, spec.md)", () => {
  const root = tempRoot();
  const meta = saveDesignArtifact(root, {
    title: "任务看板 需求文档",
    pipeline: "spec",
    content: "# 任务看板 需求文档\n\n## 4. 页面清单\n- 看板视图\n",
    requirement: "一个任务看板",
  });
  assert.ok(meta, "spec save must succeed");

  const listed = listDesignArtifacts(root);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].pipeline, "spec");

  const full = readDesignArtifact(root, meta!.id);
  assert.ok(full);
  assert.match(full!.content, /页面清单/);
  assert.equal(full!.requirement, "一个任务看板");
});

test("spec, prototype and design artifacts coexist in one index", () => {
  const root = tempRoot();
  saveDesignArtifact(root, { title: "spec", pipeline: "spec", content: "# S" });
  saveDesignArtifact(root, { title: "proto", pipeline: "openui", content: "root = Column([])" });
  saveDesignArtifact(root, { title: "dd", pipeline: "design", content: "---\nname: d\n---\n" });
  const pipelines = listDesignArtifacts(root)
    .map((a) => a.pipeline)
    .sort();
  assert.deepEqual(pipelines, ["design", "openui", "spec"]);
});

test("save and delete fire change events with the root (live panel refresh)", () => {
  const root = tempRoot();
  const events: string[] = [];
  const off = onDesignStoreChange((r) => events.push(r));
  try {
    const meta = saveDesignArtifact(root, { title: "s", pipeline: "spec", content: "# x" });
    assert.ok(meta);
    assert.equal(events.length, 1, "save must notify");
    assert.equal(events[0], root);

    deleteDesignArtifact(root, meta!.id);
    assert.equal(events.length, 2, "delete must notify");
  } finally {
    off();
  }
  // Unsubscribed: no further events.
  saveDesignArtifact(root, { title: "s2", pipeline: "spec", content: "# y" });
  assert.equal(events.length, 2);
});

test("spec updates keep lineage (same id, prior content snapshotted)", () => {
  const root = tempRoot();
  const first = saveDesignArtifact(root, { title: "spec", pipeline: "spec", content: "# v1" });
  assert.ok(first);
  const second = saveDesignArtifact(root, {
    id: first!.id,
    title: "spec",
    pipeline: "spec",
    content: "# v2",
  });
  assert.equal(second!.id, first!.id, "same-artifact update keeps the id");
  const full = readDesignArtifact(root, first!.id);
  assert.match(full!.content, /v2/);
  assert.ok(
    full!.versions?.some((v) => v.content.includes("v1")),
    "prior content snapshotted"
  );
});

// ── suite/version v2 ──────────────────────────────────────────────────────────

function suiteDir(root: string, suiteId: string): string {
  return path.join(root, ".deeporca", "designs", suiteId);
}

test("prototype suite creates one version and reads/lists lightweight metadata", () => {
  const root = tempRoot();
  const content: PrototypeSuiteContent = {
    requirement: "A task board",
    spec: "# Task board",
    openui: "root = Column([])",
    verification: {
      status: "passed",
      checks: [{ id: "render", label: "Renders", status: "healed", action: "fixed spacing" }],
      healingRounds: 1,
    },
  };
  const created = createDesignSuite(root, {
    title: "Task board",
    kind: "prototype",
    content,
    note: "initial",
    status: "ready",
  });
  assert.ok(created);
  assert.equal(created.versions.length, 1);
  assert.equal(created.currentVersionId, created.versions[0].versionId);
  assert.deepEqual(created.currentContent, content);
  assert.deepEqual(readDesignSuiteVersion(root, created.id, created.currentVersionId)?.content, content);

  const listed = listDesignSuites(root);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].kind, "prototype");
  assert.equal(listed[0].versionCount, 1);
  assert.equal(listed[0].partial, undefined);

  const metaText = fs.readFileSync(path.join(suiteDir(root, created.id), "meta.json"), "utf8");
  assert.equal(metaText.includes("root = Column"), false, "meta must not contain version content");
  assert.equal(fs.readdirSync(path.join(suiteDir(root, created.id), "versions")).length, 1);
  assert.equal(fs.readFileSync(path.join(suiteDir(root, created.id), "spec.md"), "utf8"), content.spec);
  assert.equal(fs.readFileSync(path.join(suiteDir(root, created.id), "prototype.openui.txt"), "utf8"), content.openui);
});

test("ui suite preserves source prototype, design system and quality projections", () => {
  const root = tempRoot();
  const prototype = createDesignSuite(root, {
    title: "Source",
    kind: "prototype",
    content: { openui: 'root = Text("source")' },
  });
  assert.ok(prototype);
  const quality: DesignQualityResult = {
    lintFindings: [
      {
        id: "contrast",
        preset: "wcag",
        ruleId: "color-contrast",
        severity: "warning",
        nodePath: "screen/header",
        message: "Contrast is low",
        suggestion: "Use darker text",
      },
    ],
    runtimeChecks: [{ id: "overflow", label: "No overflow", status: "passed", value: true }],
    review: { status: "passed", composite: 0.94, rounds: 2, evidence: { screenshot: "shot.png" } },
  };
  const content: UiSuiteContent = {
    requirement: "Polished task board",
    openui: 'root = Screen("task-board")',
    tokens: { colors: { accent: "#0066cc" } },
    components: [{ name: "TaskCard" }],
    quality,
    sourcePrototype: { suiteId: prototype.id, versionId: prototype.currentVersionId },
    designSystemId: "deeporca-default",
  };
  const ui = createDesignSuite(root, { title: "Task board UI", kind: "ui", content, status: "verified" });
  assert.ok(ui);
  assert.deepEqual(ui.currentContent, content);
  assert.equal(fs.readFileSync(path.join(suiteDir(root, ui.id), "prototype.openui.txt"), "utf8"), content.openui);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(suiteDir(root, ui.id), "quality.json"), "utf8")), quality);
  assert.equal(listDesignSuites(root, "ui").length, 1);
  assert.equal(listDesignSuites(root, "prototype").length, 1);
});

test("append ignores identical content and caps retained versions at 20 including current", () => {
  const root = tempRoot();
  const initial = createDesignSuite(root, { title: "Cap", kind: "prototype", content: { spec: "v0" } });
  assert.ok(initial);
  const same = appendDesignSuiteVersion(root, {
    suiteId: initial.id,
    content: { spec: "v0" },
    note: "must not create",
    status: "verified",
  });
  assert.equal(same?.versions.length, 1);
  assert.equal(same?.status, "draft", "status belongs to a created version and is unchanged on a no-op");

  for (let i = 1; i <= 25; i += 1) {
    assert.ok(appendDesignSuiteVersion(root, { suiteId: initial.id, content: { spec: `v${i}` } }));
  }
  const suite = readDesignSuite(root, initial.id);
  assert.equal(suite?.versions.length, 20);
  assert.equal((suite?.versions[0].content as PrototypeSuiteContent).spec, "v6");
  assert.equal((suite?.currentContent as PrototypeSuiteContent).spec, "v25");
  assert.equal(fs.readdirSync(path.join(suiteDir(root, initial.id), "versions")).length, 20);
});

test("append removes stale current projection files", () => {
  const root = tempRoot();
  const initial = createDesignSuite(root, {
    title: "Projection",
    kind: "prototype",
    content: { requirement: "old req", spec: "old spec", openui: "old ui" },
  });
  assert.ok(initial);
  const updated = appendDesignSuiteVersion(root, { suiteId: initial.id, content: { openui: "new ui" } });
  assert.ok(updated);
  const dir = suiteDir(root, initial.id);
  assert.equal(fs.existsSync(path.join(dir, "requirement.md")), false);
  assert.equal(fs.existsSync(path.join(dir, "spec.md")), false);
  assert.equal(fs.readFileSync(path.join(dir, "prototype.openui.txt"), "utf8"), "new ui");
});

test("legacy artifacts lazily normalize one-to-one without writing migration files", () => {
  const root = tempRoot();
  const spec = saveDesignArtifact(root, { title: "Spec", pipeline: "spec", content: "# spec" });
  const openui = saveDesignArtifact(root, { title: "Proto", pipeline: "openui", content: "root = Text()" });
  const design = saveDesignArtifact(root, { title: "UI", pipeline: "design", content: "name: ui" });
  assert.ok(spec && openui && design);

  const suites = listDesignSuites(root);
  assert.equal(suites.length, 3, "each legacy artifact becomes its own partial suite");
  assert.equal(suites.filter((suite) => suite.kind === "prototype").length, 2);
  assert.equal(suites.filter((suite) => suite.kind === "ui").length, 1);
  assert.ok(suites.every((suite) => suite.partial === true));
  assert.equal((readDesignSuite(root, spec.id)?.currentContent as PrototypeSuiteContent).spec, "# spec");
  assert.equal((readDesignSuite(root, openui.id)?.currentContent as PrototypeSuiteContent).openui, "root = Text()");
  assert.equal((readDesignSuite(root, design.id)?.currentContent as UiSuiteContent).openui, "name: ui");
  assert.equal(fs.existsSync(path.join(suiteDir(root, spec.id), "versions")), false, "read is migration-free");
});

test("appending a legacy suite upgrades it to schema v2 and keeps legacy lineage", () => {
  const root = tempRoot();
  const legacy = saveDesignArtifact(root, {
    title: "Legacy",
    pipeline: "spec",
    content: "# old",
    requirement: "old req",
  });
  assert.ok(legacy);
  const upgraded = appendDesignSuiteVersion(root, {
    suiteId: legacy.id,
    content: { requirement: "new req", spec: "# new", openui: "root = Text()" },
    note: "upgrade",
    status: "ready",
  });
  assert.ok(upgraded);
  assert.equal(upgraded.partial, undefined);
  assert.equal(upgraded.versions.length, 2);
  assert.equal(upgraded.versions[0].versionId, "legacy");
  assert.equal((readDesignSuiteVersion(root, legacy.id, "legacy")?.content as PrototypeSuiteContent).spec, "# old");
  assert.equal(
    listDesignArtifacts(root).some((artifact) => artifact.id === legacy.id),
    false
  );
  const meta = JSON.parse(fs.readFileSync(path.join(suiteDir(root, legacy.id), "meta.json"), "utf8")) as {
    schemaVersion: number;
  };
  assert.equal(meta.schemaVersion, 2);
});

test("appending identical legacy content upgrades in place without a duplicate version", () => {
  const root = tempRoot();
  const legacy = saveDesignArtifact(root, { title: "Legacy UI", pipeline: "design", content: "name: old" });
  assert.ok(legacy);
  const upgraded = appendDesignSuiteVersion(root, {
    suiteId: legacy.id,
    content: { openui: "name: old" },
    note: "normalized",
    status: "ready",
  });
  assert.ok(upgraded);
  assert.equal(upgraded.versions.length, 1);
  assert.equal(upgraded.currentVersionId, "legacy");
  assert.equal(upgraded.currentVersion.note, "normalized");
  assert.equal(upgraded.currentVersion.status, "ready");
  assert.equal(upgraded.status, "ready");
  assert.equal(upgraded.partial, undefined);
});

test("suite and version traversal ids are rejected and roots remain isolated", () => {
  const rootA = tempRoot();
  const rootB = tempRoot();
  const suite = createDesignSuite(rootA, { title: "A", kind: "prototype", content: { spec: "A" } });
  assert.ok(suite);
  assert.equal(readDesignSuite(rootB, suite.id), null);
  assert.equal(listDesignSuites(rootB).length, 0);

  for (const id of ["../../outside", "..", "/etc", "sub/dir", "a\\b", "."]) {
    assert.equal(readDesignSuite(rootA, id), null, `suite read must reject ${id}`);
    assert.equal(deleteDesignSuite(rootA, id), false, `suite delete must reject ${id}`);
    assert.equal(appendDesignSuiteVersion(rootA, { suiteId: id, content: { spec: "bad" } }), null);
    assert.equal(readDesignSuiteVersion(rootA, suite.id, id), null, `version read must reject ${id}`);
  }
  assert.ok(readDesignSuite(rootA, suite.id));
  assert.equal(deleteDesignSuite(rootA, suite.id), true);
  assert.equal(readDesignSuite(rootA, suite.id), null);
});

test("suite changes notify structured and legacy listeners", () => {
  const root = tempRoot();
  const events: DesignSuiteChangeEvent[] = [];
  const legacyEvents: string[] = [];
  const offSuite = onDesignSuiteChange((event) => events.push(event));
  const offLegacy = onDesignStoreChange((eventRoot) => legacyEvents.push(eventRoot));
  try {
    const suite = createDesignSuite(root, { title: "Events", kind: "ui", content: { openui: "v1" } });
    assert.ok(suite);
    const updated = appendDesignSuiteVersion(root, { suiteId: suite.id, content: { openui: "v2" } });
    assert.ok(updated);
    assert.ok(appendDesignSuiteVersion(root, { suiteId: suite.id, content: { openui: "v2" } }));
    assert.equal(deleteDesignSuite(root, suite.id), true);

    assert.deepEqual(
      events.map((event) => event.change),
      ["create", "update", "delete"]
    );
    assert.equal(events[0].suiteId, suite.id);
    assert.equal(events[0].versionId, suite.currentVersionId);
    assert.equal(events[1].versionId, updated.currentVersionId);
    assert.equal(events[2].versionId, undefined);
    assert.ok(events.every((event) => event.root === root));
    assert.deepEqual(legacyEvents, [root, root, root]);
  } finally {
    offSuite();
    offLegacy();
  }
});
