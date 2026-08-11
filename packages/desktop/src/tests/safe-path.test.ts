/**
 * Unit tests for the shared filesystem containment helpers.
 *
 * These guards are the boundary that prevents a renderer-supplied path from
 * reading or writing outside its allowed root. Editor handlers contain to the
 * project root; Wiki handlers contain to `<project>/openwiki` and restrict to
 * .md files. Both must reject:
 *   - `..` traversals (lexical guard)
 *   - absolute paths, Windows drive letters, UNC paths
 *   - symlinks/junctions inside the root that point outside
 *   - non-.md files (Wiki only)
 *
 * The tests build a temp tree and exercise both the happy path and each escape.
 * They run on the host platform; symlink/junction tests are POSIX-only on
 * non-Windows because junctions require elevated perms on Windows CI.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { safePathWithinRoot, safeWikiPath, isStrictlyRelative } from "../main/safe-path.js";

async function withTempTree(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "safe-path-"));
  try {
    // Build a small tree:
    //   <root>/notes/page.md
    //   <root>/notes/sub/nested.md
    //   <root>/secret.txt
    //   <root>/notes/.hidden.md
    await fs.mkdir(path.join(dir, "notes", "sub"), { recursive: true });
    await fs.writeFile(path.join(dir, "notes", "page.md"), "page");
    await fs.writeFile(path.join(dir, "notes", "sub", "nested.md"), "nested");
    await fs.writeFile(path.join(dir, "secret.txt"), "secret");
    await fs.writeFile(path.join(dir, "notes", ".hidden.md"), "hidden");
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ── isStrictlyRelative ─────────────────────────────────────────────────────

test("isStrictlyRelative accepts plain relative paths", () => {
  assert.equal(isStrictlyRelative("page.md"), true);
  assert.equal(isStrictlyRelative("notes/page.md"), true);
  assert.equal(isStrictlyRelative("a/b/c.md"), true);
  assert.equal(isStrictlyRelative("./page.md"), true);
});

test("isStrictlyRelative rejects empty", () => {
  assert.equal(isStrictlyRelative(""), false);
});

test("isStrictlyRelative rejects POSIX absolute paths", () => {
  assert.equal(isStrictlyRelative("/etc/passwd"), false);
  assert.equal(isStrictlyRelative("/page.md"), false);
});

test("isStrictlyRelative rejects Windows drive letters", () => {
  assert.equal(isStrictlyRelative("C:\\"), false);
  assert.equal(isStrictlyRelative("C:\\page.md"), false);
  assert.equal(isStrictlyRelative("C:/page.md"), false);
  assert.equal(isStrictlyRelative("D:"), false);
  assert.equal(isStrictlyRelative("D:page.md"), true); // drive-relative, not absolute — acceptable as relative
});

test("isStrictlyRelative rejects UNC paths", () => {
  assert.equal(isStrictlyRelative("\\\\host\\share\\page.md"), false);
  assert.equal(isStrictlyRelative("//host/share/page.md"), false);
});

// ── safePathWithinRoot ─────────────────────────────────────────────────────

test("safePathWithinRoot: existing file inside root resolves", async () => {
  await withTempTree(async (dir) => {
    const result = safePathWithinRoot(dir, "notes/page.md");
    assert.notEqual(result, null);
    assert.equal(result, path.resolve(dir, "notes/page.md"));
  });
});

test("safePathWithinRoot: nested existing file resolves", async () => {
  await withTempTree(async (dir) => {
    const result = safePathWithinRoot(dir, "notes/sub/nested.md");
    assert.notEqual(result, null);
  });
});

test("safePathWithinRoot: parent traversal escapes root", async () => {
  await withTempTree(async (dir) => {
    const outside = path.dirname(dir);
    const target = path.relative(dir, path.join(outside, "secret.md"));
    assert.equal(safePathWithinRoot(dir, target), null);
  });
});

test("safePathWithinRoot: ../ in the middle escapes root", async () => {
  await withTempTree(async (dir) => {
    assert.equal(safePathWithinRoot(dir, "notes/../secret.txt"), path.resolve(dir, "secret.txt"));
    // secret.txt is inside root, so this is fine. But:
    assert.equal(safePathWithinRoot(dir, "notes/../../secret.txt"), null);
  });
});

test("safePathWithinRoot: not-yet-existing write path inside root resolves", async () => {
  await withTempTree(async (dir) => {
    const result = safePathWithinRoot(dir, "notes/newfile.md");
    assert.notEqual(result, null);
  });
});

test("safePathWithinRoot: not-yet-existing write path that escapes is rejected", async () => {
  await withTempTree(async (dir) => {
    assert.equal(safePathWithinRoot(dir, "notes/sub/../../../escape.md"), null);
  });
});

test("safePathWithinRoot: POSIX symlink pointing outside is rejected", async () => {
  await withTempTree(async (dir) => {
    if (process.platform === "win32") {
      // Creating symlinks on Windows often requires elevated privileges;
      // skip the assertion but keep the test green.
      return;
    }
    const outsideTarget = path.join(os.tmpdir(), `outside-${Date.now()}.md`);
    await fs.writeFile(outsideTarget, "stolen");
    try {
      await fs.symlink(outsideTarget, path.join(dir, "notes", "escape.md"));
      // The symlink exists inside notes/ but realpath points outside the root.
      assert.equal(safePathWithinRoot(dir, "notes/escape.md"), null);
    } finally {
      await fs.rm(outsideTarget, { force: true });
    }
  });
});

test("safePathWithinRoot: legitimate symlink inside the root is allowed", async () => {
  await withTempTree(async (dir) => {
    if (process.platform === "win32") {
      return;
    }
    // Symlink notes/link.md -> notes/page.md (both inside root).
    await fs.symlink(path.join(dir, "notes", "page.md"), path.join(dir, "notes", "link.md"));
    const result = safePathWithinRoot(dir, "notes/link.md");
    assert.notEqual(result, null);
  });
});

// ── safeWikiPath ───────────────────────────────────────────────────────────

test("safeWikiPath: legitimate .md page under wiki root resolves", async () => {
  await withTempTree(async (dir) => {
    const wikiRoot = path.join(dir, "notes");
    const result = safeWikiPath(wikiRoot, "page.md");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.absPath, path.resolve(wikiRoot, "page.md"));
    }
  });
});

test("safeWikiPath: nested .md page resolves", async () => {
  await withTempTree(async (dir) => {
    const wikiRoot = path.join(dir, "notes");
    const result = safeWikiPath(wikiRoot, "sub/nested.md");
    assert.equal(result.ok, true);
  });
});

test("safeWikiPath: non-.md file is rejected (non-markdown)", async () => {
  await withTempTree(async (dir) => {
    const wikiRoot = dir; // secret.txt lives here
    const result = safeWikiPath(wikiRoot, "secret.txt");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "non-markdown");
  });
});

test("safeWikiPath: absolute path is rejected (non-relative)", async () => {
  await withTempTree(async (dir) => {
    const wikiRoot = path.join(dir, "notes");
    const result = safeWikiPath(wikiRoot, "/etc/passwd");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "non-relative");
  });
});

test("safeWikiPath: Windows drive-letter path is rejected (non-relative)", async () => {
  await withTempTree(async (dir) => {
    const wikiRoot = path.join(dir, "notes");
    const result = safeWikiPath(wikiRoot, "C:\\\\evil.md");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "non-relative");
  });
});

test("safeWikiPath: parent traversal is rejected (escapes-root)", async () => {
  await withTempTree(async (dir) => {
    const wikiRoot = path.join(dir, "notes");
    // ../secret.txt — but secret.txt isn't .md so this hits non-markdown first.
    // Use ../secret.md trick: a .md outside the wiki root.
    await fs.writeFile(path.join(dir, "secret.md"), "stolen");
    const result = safeWikiPath(wikiRoot, "../secret.md");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "escapes-root");
  });
});

test("safeWikiPath: hidden .md file under root resolves (containment does not filter hidden)", async () => {
  await withTempTree(async (dir) => {
    const wikiRoot = path.join(dir, "notes");
    // .hidden.md exists under notes/; containment allows it. Whether to serve
    // hidden pages is a product decision, not a security boundary.
    const result = safeWikiPath(wikiRoot, ".hidden.md");
    assert.equal(result.ok, true);
  });
});

test("safeWikiPath: symlink inside wiki root pointing outside is rejected", async () => {
  await withTempTree(async (dir) => {
    if (process.platform === "win32") {
      return;
    }
    const wikiRoot = path.join(dir, "notes");
    const outside = path.join(dir, "secret.md");
    await fs.writeFile(outside, "stolen");
    await fs.symlink(outside, path.join(wikiRoot, "escape.md"));
    const result = safeWikiPath(wikiRoot, "escape.md");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "escapes-root");
  });
});

test("safeWikiPath: empty string is rejected (non-markdown, since it doesn't end in .md)", async () => {
  await withTempTree(async (dir) => {
    const wikiRoot = path.join(dir, "notes");
    const result = safeWikiPath(wikiRoot, "");
    assert.equal(result.ok, false);
  });
});
