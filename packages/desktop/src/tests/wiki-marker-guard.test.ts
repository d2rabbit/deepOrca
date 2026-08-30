/**
 * Wiki completion-marker self-healing (ensureSaneWikiMarker).
 *
 * The no-git-init era recorded git's ERROR TEXT into the marker's gitHead
 * field ("HEAD\nfatal: ambiguous argument…"). Every later update then ran
 * `git log <garbage>..HEAD` inside the agent loop, failed, and no-opped —
 * the wiki silently went stale while builds kept succeeding. The guard
 * deletes a marker whose gitHead is not a commit SHA so the update prompt
 * falls back to its documented "no prior gitHead" selective pass.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureSaneWikiMarker } from "../main/tools/wiki-cli";

function withWikiDir(fn: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-marker-guard-"));
  try {
    fs.mkdirSync(path.join(root, "openwiki"), { recursive: true });
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const markerPath = (root: string): string => path.join(root, "openwiki", ".last-update.json");

test("a valid 40-hex gitHead marker is kept untouched", () => {
  withWikiDir((root) => {
    const body = JSON.stringify({
      updatedAt: "2026-08-29T00:00:00.000Z",
      command: "init",
      gitHead: "de4e8f887850440df71f47fb999cb1162ad98e80",
      status: "complete",
    });
    fs.writeFileSync(markerPath(root), body, "utf8");
    assert.equal(ensureSaneWikiMarker(root), false, "sane marker needs no healing");
    assert.equal(fs.readFileSync(markerPath(root), "utf8"), body, "file untouched");
  });
});

test("an error-text gitHead marker is deleted (healed)", () => {
  withWikiDir((root) => {
    fs.writeFileSync(
      markerPath(root),
      JSON.stringify({
        command: "init",
        gitHead: "HEAD\nfatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.",
        status: "complete",
      }),
      "utf8"
    );
    assert.equal(ensureSaneWikiMarker(root), true, "garbage head is healed");
    assert.equal(fs.existsSync(markerPath(root)), false, "marker removed");
  });
});

test("missing or unparsable marker is a no-op, never a throw", () => {
  withWikiDir((root) => {
    assert.equal(ensureSaneWikiMarker(root), false, "absent marker: nothing to heal");
    fs.writeFileSync(markerPath(root), "{not json", "utf8");
    assert.equal(ensureSaneWikiMarker(root), false, "unparsable marker: sane-by-absence path");
  });
});

test("short/garbage heads are healed too (not just git error text)", () => {
  withWikiDir((root) => {
    fs.writeFileSync(markerPath(root), JSON.stringify({ gitHead: "HEAD", status: "complete" }), "utf8");
    assert.equal(ensureSaneWikiMarker(root), true);
    fs.writeFileSync(markerPath(root), JSON.stringify({ gitHead: 42, status: "complete" }), "utf8");
    assert.equal(ensureSaneWikiMarker(root), true, "non-string head heals");
  });
});
