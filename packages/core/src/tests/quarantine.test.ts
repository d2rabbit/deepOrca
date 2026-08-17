import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  applyQuarantinePermissionClamp,
  computeToolCallPermissions,
  type PermissionSettings,
} from "../common/permissions";
import { grantOutsideRootsFlags } from "../common/path-boundary";
import { resolveCurrentSettings } from "../settings";
import { readWorkspaceTrustStore, writeWorkspaceTrustStore } from "../common/app-dirs";

// Quarantine trust level tests (specs/sandbox/design.md §10.3, task 22):
// out-of-cwd R/W/D denied outright, bash force-asked without a sandbox
// backend, project-level mcpServers not auto-loaded. Zero new
// infrastructure — every behavior rides existing machinery.

const tempDirs: string[] = [];

function createWorkspace(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-quarantine-")));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

const ALLOW_ALL: Required<PermissionSettings> = { allow: [], deny: [], ask: [], defaultMode: "allowAll" };

test("quarantine clamp denies out-of-cwd scopes even under explicit allow grants", () => {
  const clamped = applyQuarantinePermissionClamp({
    ...ALLOW_ALL,
    allow: ["write-out-cwd", "read-out-cwd"],
  });
  // Out-of-cwd: denied, never asked — no approving your way out.
  assert.equal(
    computeToolCallPermissions({
      sessionId: "q",
      projectRoot: "/tmp/proj",
      toolCalls: [
        {
          id: "1",
          type: "function",
          function: { name: "write", arguments: JSON.stringify({ file_path: "/etc/x", content: "x" }) },
        },
      ],
      settings: clamped,
    }).permissions[0].permission,
    "deny"
  );
  assert.equal(
    computeToolCallPermissions({
      sessionId: "q",
      projectRoot: "/tmp/proj",
      toolCalls: [
        {
          id: "1",
          type: "function",
          function: { name: "read", arguments: JSON.stringify({ file_path: "/etc/passwd" }) },
        },
      ],
      settings: clamped,
    }).permissions[0].permission,
    "deny"
  );
  // In-cwd work continues untouched.
  assert.equal(
    computeToolCallPermissions({
      sessionId: "q",
      projectRoot: "/tmp/proj",
      toolCalls: [
        {
          id: "1",
          type: "function",
          function: { name: "write", arguments: JSON.stringify({ file_path: "/tmp/proj/a.txt", content: "x" }) },
        },
      ],
      settings: clamped,
    }).permissions[0].permission,
    "allow"
  );
  // Clamp fills Required shape and dedupes deny entries.
  assert.deepEqual(clamped.deny, ["read-out-cwd", "write-out-cwd", "delete-out-cwd"]);
});

test("forceAskTools asks every bash call without touching file tools in the same turn", () => {
  const plan = computeToolCallPermissions({
    sessionId: "q",
    projectRoot: "/tmp/proj",
    toolCalls: [
      { id: "bash-1", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "ls" }) } },
      {
        id: "bash-2",
        type: "function",
        function: { name: "Bash", arguments: JSON.stringify({ command: "rm -rf /" }) },
      },
      {
        id: "write-1",
        type: "function",
        function: { name: "write", arguments: JSON.stringify({ file_path: "/tmp/proj/a.txt", content: "x" }) },
      },
    ],
    settings: ALLOW_ALL,
    forceAskTools: ["bash"],
  });
  const byId = new Map(plan.permissions.map((permission) => [permission.toolCallId, permission.permission]));
  assert.equal(byId.get("bash-1"), "ask", "benign bash must still ask (every bash asks)");
  assert.equal(byId.get("bash-2"), "ask");
  assert.equal(byId.get("write-1"), "allow", "file tools in the same turn are unaffected");
  // The ask request carries the call's scopes for the permission card.
  assert.ok(plan.askPermissions.some((ask) => ask.toolCallId === "bash-1"));
});

test("forceAskTools never upgrades a deny (deny precedence preserved)", () => {
  const plan = computeToolCallPermissions({
    sessionId: "q",
    projectRoot: "/tmp/proj",
    toolCalls: [
      {
        id: "b",
        type: "function",
        function: { name: "bash", arguments: JSON.stringify({ command: "curl http://x", sideEffects: ["network"] }) },
      },
    ],
    settings: { ...ALLOW_ALL, deny: ["network"] },
    forceAskTools: ["bash"],
  });
  assert.equal(plan.permissions[0].permission, "deny");
  assert.equal(plan.askPermissions.length, 0, "no ask card for an outright denied call");
});

test("grantOutsideRootsFlags: quarantine clamps both booleans regardless of scopes", () => {
  assert.deepEqual(grantOutsideRootsFlags(["write-out-cwd", "read-out-cwd"], true), {
    allowWriteOutsideRoots: false,
    allowReadOutsideRoots: false,
  });
  assert.deepEqual(grantOutsideRootsFlags(["write-out-cwd", "read-out-cwd"], false), {
    allowWriteOutsideRoots: true,
    allowReadOutsideRoots: true,
  });
  assert.deepEqual(grantOutsideRootsFlags(["write-in-cwd"], false), {
    allowWriteOutsideRoots: false,
    allowReadOutsideRoots: false,
  });
});

test("settings resolution: quarantine skips project mcpServers and is user-store driven", () => {
  const project = createWorkspace();
  const projectSettingsPath = path.join(project, ".deeporca", "settings.json");
  fs.mkdirSync(path.dirname(projectSettingsPath), { recursive: true });
  fs.writeFileSync(
    projectSettingsPath,
    JSON.stringify({ mcpServers: { "repo-tool": { command: "node", args: ["server.js"] } } })
  );

  // Never asked (no user-store entry): trusted, project servers load.
  const unasked = resolveCurrentSettings(project);
  assert.equal(unasked.workspaceTrust, "trusted");
  assert.ok(unasked.mcpServers?.["repo-tool"]);

  // Quarantined via the USER-level store: the project file is attacker
  // content — its servers must not auto-load (design.md §10.3).
  writeWorkspaceTrustStore(project, "quarantine");
  const quarantined = resolveCurrentSettings(project);
  assert.equal(quarantined.workspaceTrust, "quarantine");
  assert.equal(quarantined.mcpServers?.["repo-tool"], undefined, "quarantined project servers must not auto-load");

  // The repo cannot un-quarantine itself: a project-file workspaceTrust
  // field is ignored entirely (review finding — marker must live outside
  // the repo).
  fs.writeFileSync(
    projectSettingsPath,
    JSON.stringify({
      workspaceTrust: "trusted",
      mcpServers: { "repo-tool": { command: "node", args: ["server.js"] } },
    })
  );
  const stillQuarantined = resolveCurrentSettings(project);
  assert.equal(stillQuarantined.workspaceTrust, "quarantine", "project-file trust field is ignored");
  assert.equal(stillQuarantined.mcpServers?.["repo-tool"], undefined);

  // Explicit trust is a first-class state; store shape round-trips.
  writeWorkspaceTrustStore(project, "trusted");
  assert.deepEqual(readWorkspaceTrustStore(project), { level: "trusted", explicit: true });
  assert.ok(resolveCurrentSettings(project).mcpServers?.["repo-tool"]);
});
