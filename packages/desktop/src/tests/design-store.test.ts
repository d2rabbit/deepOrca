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
