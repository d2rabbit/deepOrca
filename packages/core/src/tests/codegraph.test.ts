/**
 * Tests for the surviving codegraph.ts functions (MCP config + predicates).
 *
 * All subprocess spawn code has been deleted — index/sync operations now go
 * through SdkCodegraphController. These tests cover only:
 *   - hasCodegraphProject (pure fs check)
 *   - setCodegraphDisabled / isCodegraphDisabled (in-memory state)
 *   - buildCodegraphMcpServerConfig (returns McpServerConfig shape)
 *   - resolveCodegraphExecutable (npm-shim or npx fallback)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

import {
  CODEGRAPH_MCP_SERVER_NAME,
  CODEGRAPH_DIR_NAME,
  hasCodegraphProject,
  setCodegraphDisabled,
  isCodegraphDisabled,
  buildCodegraphMcpServerConfig,
  resolveCodegraphExecutable,
} from "../common/codegraph";

describe("constants", () => {
  test("server name is 'codegraph'", () => {
    assert.equal(CODEGRAPH_MCP_SERVER_NAME, "codegraph");
  });

  test("dir name is '.codegraph'", () => {
    assert.equal(CODEGRAPH_DIR_NAME, ".codegraph");
  });
});

describe("hasCodegraphProject", () => {
  test("returns false when .codegraph/ does not exist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-test-"));
    assert.equal(hasCodegraphProject(tmp), false);
  });

  test("returns true when .codegraph/ exists", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-test-"));
    fs.mkdirSync(path.join(tmp, CODEGRAPH_DIR_NAME));
    assert.equal(hasCodegraphProject(tmp), true);
  });
});

describe("setCodegraphDisabled / isCodegraphDisabled", () => {
  test("disable then re-enable", () => {
    const root = "/tmp/test-disable-root";
    setCodegraphDisabled(root, true);
    assert.equal(isCodegraphDisabled(root), true);
    setCodegraphDisabled(root, false);
    assert.equal(isCodegraphDisabled(root), false);
  });
});

describe("resolveCodegraphExecutable", () => {
  test("returns an object with command and prefixArgs", () => {
    const exe = resolveCodegraphExecutable();
    assert.ok(typeof exe.command === "string" && exe.command.length > 0);
    assert.ok(Array.isArray(exe.prefixArgs) && exe.prefixArgs.length > 0);
  });
});

describe("buildCodegraphMcpServerConfig", () => {
  test("returns a McpServerConfig with serve --mcp args", () => {
    const config = buildCodegraphMcpServerConfig("/tmp/test-project");
    assert.equal(typeof config.command, "string");
    assert.ok(config.args.includes("serve"));
    assert.ok(config.args.includes("--mcp"));
    assert.equal(config.cwd, "/tmp/test-project");
  });
});
