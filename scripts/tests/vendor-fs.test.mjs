/**
 * Tests for scripts/vendor-fs.js withAtomicSwap.
 *
 * These verify the core guarantee: a failed build/verify must leave the live
 * targetDir byte-for-byte untouched, while a successful build swaps in.
 * Run with: node --test scripts/tests/vendor-fs.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const helperUrl = pathToFileURL(path.resolve("scripts/vendor-fs.js")).href;
const { withAtomicSwap } = await import(helperUrl);

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vendor-fs-test-"));
}

test("successful build swaps the new contents into place", async () => {
  const parent = tmp();
  const target = path.join(parent, "vendor-thing");
  // Seed an existing live target with old content.
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "binary"), "OLD");
  fs.writeFileSync(path.join(target, ".version"), "1.0.0");

  try {
    await withAtomicSwap(target, {
      log: () => {},
      tag: "thing",
      build: async (staging) => {
        fs.writeFileSync(path.join(staging, "binary"), "NEW");
        fs.writeFileSync(path.join(staging, ".version"), "2.0.0");
      },
      verify: (staging) => fs.existsSync(path.join(staging, "binary")),
    });

    assert.equal(fs.readFileSync(path.join(target, "binary"), "utf8"), "NEW");
    assert.equal(fs.readFileSync(path.join(target, ".version"), "utf8"), "2.0.0");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("build failure leaves the live target untouched", async () => {
  const parent = tmp();
  const target = path.join(parent, "vendor-thing");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "binary"), "OLD");
  const before = fs.statSync(path.join(target, "binary")).mtimeMs;

  try {
    await assert.rejects(
      withAtomicSwap(target, {
        log: () => {},
        tag: "thing",
        build: async () => {
          throw new Error("network down");
        },
      }),
      /network down/
    );
    // Live target must be unchanged: old content, no staging/old leftovers.
    assert.equal(fs.readFileSync(path.join(target, "binary"), "utf8"), "OLD");
    const entries = fs.readdirSync(parent);
    assert.equal(entries.length, 1, "only the live target should remain in parent");
    assert.equal(entries[0], "vendor-thing");
    // mtime untouched (file wasn't rewritten).
    const after = fs.statSync(path.join(target, "binary")).mtimeMs;
    assert.equal(after, before);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("verify-false leaves the live target untouched and throws", async () => {
  const parent = tmp();
  const target = path.join(parent, "vendor-thing");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "binary"), "OLD");

  try {
    await assert.rejects(
      withAtomicSwap(target, {
        log: () => {},
        tag: "thing",
        build: async (staging) => {
          // Build produces nothing useful.
          fs.writeFileSync(path.join(staging, "junk"), "x");
        },
        verify: (staging) => fs.existsSync(path.join(staging, "binary")),
      }),
      /verify failed/
    );
    assert.equal(fs.readFileSync(path.join(target, "binary"), "utf8"), "OLD");
    const entries = fs.readdirSync(parent);
    assert.equal(entries.length, 1);
    assert.equal(entries[0], "vendor-thing");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("preserve copies specified files from the live target into staging", async () => {
  const parent = tmp();
  const target = path.join(parent, "vendor-thing");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "binary"), "OLD");
  // A marker we want to keep across swaps.
  fs.mkdirSync(path.join(target, ".cache"), { recursive: true });
  fs.writeFileSync(path.join(target, ".cache", "state"), "preserved");

  try {
    await withAtomicSwap(target, {
      log: () => {},
      tag: "thing",
      preserve: [".cache"],
      build: async (staging) => {
        fs.writeFileSync(path.join(staging, "binary"), "NEW");
      },
      verify: (staging) => fs.existsSync(path.join(staging, "binary")),
    });
    assert.equal(fs.readFileSync(path.join(target, "binary"), "utf8"), "NEW");
    // Preserved marker survived into the new target.
    assert.equal(fs.readFileSync(path.join(target, ".cache", "state"), "utf8"), "preserved");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("swap works when the live target does not yet exist (first install)", async () => {
  const parent = tmp();
  const target = path.join(parent, "vendor-thing");
  try {
    await withAtomicSwap(target, {
      log: () => {},
      tag: "thing",
      build: async (staging) => {
        fs.writeFileSync(path.join(staging, "binary"), "FIRST");
      },
      verify: (staging) => fs.existsSync(path.join(staging, "binary")),
    });
    assert.equal(fs.readFileSync(path.join(target, "binary"), "utf8"), "FIRST");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
