// Canonical LSP URI convergence (2026-09-06): one implementation now backs
// the relay, the bridge's routing and the renderer's buildFileUri — these
// tests pin the shapes all three callers depend on (incl. the Windows /
// UNC cases that previously diverged between the three copies).

import { test } from "node:test";
import assert from "node:assert/strict";

type U = typeof import("../shared/lsp-uri");
let U: U | undefined;

test.before(async () => {
  U = await import("../shared/lsp-uri");
});

test("lspPathToUri: POSIX / drive-letter / UNC shapes", () => {
  const u = U!;
  assert.equal(u.lspPathToUri("/a/b/c.ts"), "file:///a/b/c.ts");
  assert.equal(u.lspPathToUri("C:/a/b.ts"), "file:///C:/a/b.ts");
  assert.equal(u.lspPathToUri("C:\\a\\b.ts"), "file:///C:/a/b.ts");
  assert.equal(u.lspPathToUri("\\\\srv\\share\\x.ts"), "file://srv/share/x.ts");
  assert.equal(u.lspPathToUri("//srv/share/x.ts"), "file://srv/share/x.ts");
});

test("lspPathToUri: percent-encoding discipline", () => {
  const u = U!;
  assert.equal(u.lspPathToUri("/a/b c.ts"), "file:///a/b%20c.ts");
  assert.equal(u.lspPathToUri("/a/b#c.ts"), "file:///a/b%23c.ts");
  assert.equal(u.lspPathToUri("/a/b?c.ts"), "file:///a/b%3Fc.ts");
  // CJK survives encoded; a literal % that is NOT already an escape gets one.
  assert.equal(u.lspPathToUri("/文档/深.ts"), "file:///%E6%96%87%E6%A1%A3/%E6%B7%B1.ts");
  // Inputs are FILESYSTEM paths, never pre-escaped URIs — a literal "%20" in
  // a filename must encode as %2520 so the server's decode returns "%20".
  assert.equal(u.lspPathToUri("/a/b%20c.ts"), "file:///a/b%2520c.ts");
  assert.equal(u.lspPathToUri("/a/b%.ts"), "file:///a/b%25.ts", "lone % becomes %25");
});
