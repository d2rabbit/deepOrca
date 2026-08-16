import { test } from "node:test";
import assert from "node:assert/strict";
import { buildResult, pathGrantFor } from "../renderer/lib/permissions";
import type { AskPermissionRequest } from "../shared/ipc";

// Renderer-side path-level always-allow (task 14): binding the grant to the
// ask's filePath instead of the whole-disk scope.

test("pathGrantFor binds out-cwd scopes to the ask's file path only", () => {
  assert.deepEqual(pathGrantFor("write-out-cwd", "/etc/app.conf"), { kind: "write", path: "/etc/app.conf" });
  assert.deepEqual(pathGrantFor("read-out-cwd", "/var/log/x.log"), { kind: "read", path: "/var/log/x.log" });
  // No path to bind: bash / network asks stay scope-level.
  assert.equal(pathGrantFor("write-out-cwd", undefined), null);
  assert.equal(pathGrantFor("network", "/some/path"), null);
  assert.equal(pathGrantFor("write-in-cwd", "/proj/a.txt"), null);
});

test("buildResult aggregates path grants alongside scope grants", () => {
  const requests: AskPermissionRequest[] = [
    {
      toolCallId: "t1",
      scopes: ["write-out-cwd"],
      name: "write",
      command: "write /etc/app.conf",
      filePath: "/etc/app.conf",
    },
    { toolCallId: "t2", scopes: ["network"], name: "bash", command: "bash" },
  ];
  const result = buildResult(requests, { t1: "allow", t2: "allow" }, ["network"], {
    write: ["/etc/app.conf"],
    read: [],
  });
  assert.deepEqual(result.alwaysAllows, ["network"]);
  assert.deepEqual(result.alwaysAllowPaths, { write: ["/etc/app.conf"], read: [] });
  assert.equal(result.hasDeny, false);
});
