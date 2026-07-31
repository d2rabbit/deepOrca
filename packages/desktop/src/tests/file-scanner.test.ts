import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scanFiles } from "../main/file-scanner";

const tempRoots: string[] = [];

/** Create a throwaway workspace with a small file tree. */
function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-scan-test-"));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "# readme");
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export {};");
  fs.writeFileSync(path.join(root, "src", "components", "button.tsx"), "export {};");
  fs.writeFileSync(path.join(root, "node_modules", "pkg", "index.ts"), "export {};");
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("empty or whitespace query returns no results", () => {
  const root = makeWorkspace();
  assert.deepEqual(scanFiles(root, ""), []);
  assert.deepEqual(scanFiles(root, "   "), []);
});

test("matches files by case-insensitive substring with relative paths", () => {
  const root = makeWorkspace();
  const results = scanFiles(root, "BUTTON");
  assert.equal(results.length, 1);
  assert.equal(results[0].path, path.join("src", "components", "button.tsx"));
  assert.equal(results[0].type, "file");
});

test("reports directories with type directory", () => {
  const root = makeWorkspace();
  const results = scanFiles(root, "components");
  const dir = results.find((r) => r.type === "directory");
  assert.ok(dir, "expected the components directory to match");
  assert.equal(dir.path, path.join("src", "components"));
});

test("skips noisy directories like node_modules", () => {
  const root = makeWorkspace();
  const results = scanFiles(root, "index.ts");
  assert.deepEqual(
    results.map((r) => r.path),
    [path.join("src", "index.ts")]
  );
});

test("nonexistent root yields no results instead of throwing", () => {
  const missing = path.join(os.tmpdir(), "deeporca-scan-test-missing", String(Date.now()));
  assert.deepEqual(scanFiles(missing, "anything"), []);
});
