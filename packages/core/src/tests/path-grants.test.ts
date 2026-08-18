import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  appendProjectAllowedPaths,
  normalizeAskPermissions,
  applyQuarantinePermissionClamp,
  computeToolCallPermissions,
  describeToolPermissionRequest,
  hasUserPermissionReplies,
  type PermissionSettings,
} from "../common/permissions";
import { gateWrite } from "../common/path-boundary";
import { SessionManager } from "../session";
import { readProjectSettings } from "../settings";

// Path-level "always allow" (specs/sandbox/design.md §4.2(d) residual risk,
// task 14): persisting the PATH instead of the out-cwd SCOPE means one click
// authorizes exactly one directory tree — never the whole disk.

const tempDirs: string[] = [];

function createWorkspace(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-path-grants-")));
  tempDirs.push(dir);
  return dir;
}

/**
 * Cross-platform link fixture, capability-probed — see path-boundary.test.ts:
 * native symlink first, EPERM on unprivileged Windows falls back to junction
 * (directory targets only — the sole fixture shape used in this file).
 */
function createLink(target: string, dest: string): void {
  try {
    fs.symlinkSync(target, dest);
    return;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    let targetIsDir = false;
    try {
      targetIsDir = fs.statSync(target).isDirectory();
    } catch {
      // Dangling target — not a directory.
    }
    if (process.platform === "win32" && e.code === "EPERM" && path.isAbsolute(target) && targetIsDir) {
      fs.symlinkSync(target, dest, "junction");
      return;
    }
    throw err;
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

const ALLOW_ALL: Required<PermissionSettings> = {
  allow: [],
  deny: [],
  ask: [],
  defaultMode: "allowAll",
  allowedWritePaths: [],
  allowedReadPaths: [],
};

function writeCall(filePath: string): unknown {
  return {
    id: "w1",
    type: "function",
    function: { name: "write", arguments: JSON.stringify({ file_path: filePath, content: "x" }) },
  };
}

test("appendProjectAllowedPaths persists, dedupes, and keeps scopes untouched", () => {
  const project = createWorkspace();
  const target = createWorkspace();

  appendProjectAllowedPaths(project, { write: [target], read: [target] });
  appendProjectAllowedPaths(project, { write: [target] });

  const stored = readProjectSettings(project)?.permissions;
  assert.deepEqual(stored?.allowedWritePaths, [target], "path grant persisted once (dedupe)");
  assert.deepEqual(stored?.allowedReadPaths, [target]);
  assert.deepEqual(stored?.allow, undefined, "no scope-level grant was created");

  // Empty input is a no-op that never creates the settings file.
  const untouched = createWorkspace();
  appendProjectAllowedPaths(untouched, {});
  assert.equal(fs.existsSync(path.join(untouched, ".deeporca", "settings.json")), false);
});

test("a granted path needs no ask under the P0.5 baseline; other paths still ask", () => {
  const project = createWorkspace();
  const granted = createWorkspace();
  const other = createWorkspace();
  const settings = { ...ALLOW_ALL, allowedWritePaths: [granted], allowedReadPaths: [granted] };

  const plan = computeToolCallPermissions({
    sessionId: "pg",
    projectRoot: project,
    toolCalls: [writeCall(path.join(granted, "file.txt")), writeCall(path.join(other, "file.txt"))],
    settings,
    forceAskDefaultedScopes: ["write-out-cwd", "delete-out-cwd"],
    writePermissionExemptPaths: settings.allowedWritePaths,
    readPermissionExemptPaths: settings.allowedReadPaths,
  });
  const byOrder = plan.permissions.map((permission) => permission.permission);
  assert.deepEqual(byOrder, ["allow", "ask"], "granted path flows, ungranted path still asks");
  // The granted-path ask never happens, so no ask card for it either.
  assert.equal(
    plan.askPermissions.some((ask) => ask.filePath === path.join(granted, "file.txt")),
    false
  );
  assert.ok(plan.askPermissions.some((ask) => ask.filePath === path.join(other, "file.txt")));
});

test("describeToolPermissionRequest carries filePath for file tools", () => {
  const project = createWorkspace();
  const request = describeToolPermissionRequest({
    sessionId: "pg",
    projectRoot: project,
    toolCall: writeCall(path.join(project, "a.txt")) as never,
  });
  assert.equal(request.filePath, path.join(project, "a.txt"));
});

test("quarantine zeroes path grants — an attacker-authored settings file cannot self-authorize", () => {
  const project = createWorkspace();
  const granted = createWorkspace();
  // A quarantined repo pre-ships path grants in its own settings file.
  // The clamp (and the session's exempt wiring, which uses the clamped
  // shape) must treat them as absent: §10.3 out-of-cwd is fail-closed deny.
  const clamped = applyQuarantinePermissionClamp({
    ...ALLOW_ALL,
    allowedWritePaths: [granted],
    allowedReadPaths: [granted],
  });
  assert.deepEqual(clamped.allowedWritePaths, [], "path grants are zeroed under quarantine");
  assert.deepEqual(clamped.allowedReadPaths, []);
  const plan = computeToolCallPermissions({
    sessionId: "pg",
    projectRoot: project,
    toolCalls: [writeCall(path.join(granted, "file.txt"))],
    settings: clamped,
    writePermissionExemptPaths: clamped.allowedWritePaths,
    readPermissionExemptPaths: clamped.allowedReadPaths,
  });
  assert.equal(plan.permissions[0]?.permission, "deny", "pre-shipped grants buy nothing in quarantine");
});

test("session derivation: granted paths become write roots and the gate admits exactly them", () => {
  const project = createWorkspace();
  const granted = createWorkspace();
  const manager = new SessionManager({
    projectRoot: project,
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({
      model: "test-model",
      permissions: { ...ALLOW_ALL, allowedWritePaths: [granted] },
    }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const seam = manager as unknown as {
    derivePathGrantForToolCall(
      sessionId: string,
      toolCall: never
    ): {
      writeRoots: string[];
      allowWriteOutsideRoots: boolean;
    };
  };
  const grant = seam.derivePathGrantForToolCall("pg", writeCall(path.join(granted, "file.txt")) as never);
  assert.equal(grant.allowWriteOutsideRoots, false, "booleans stay clamped — roots are the only widening");
  assert.ok(
    grant.writeRoots.some((root) => root === fs.realpathSync(granted)),
    "granted path realpath is a write root"
  );
  // The gate admits a file inside the granted tree, rejects its sibling directory.
  assert.equal(gateWrite(grant, path.join(granted, "file.txt")).ok, true);
  assert.equal(gateWrite(grant, path.join(createWorkspace(), "evil.txt")).ok, false);
});

test("hasUserPermissionReplies treats alwaysAllowPaths as a reply", () => {
  assert.equal(hasUserPermissionReplies({ alwaysAllowPaths: { write: ["/tmp/x"] } }), true);
  assert.equal(hasUserPermissionReplies({ alwaysAllowPaths: { read: ["/tmp/y"] } }), true);
  assert.equal(hasUserPermissionReplies({ alwaysAllowPaths: {} }), false);
  assert.equal(hasUserPermissionReplies({}), false);
});

test("normalizeAskPermissions preserves the filePath binding across session restore (review R2)", () => {
  const restored = normalizeAskPermissions([
    {
      toolCallId: "t1",
      name: "write",
      command: "write /etc/app.conf",
      scopes: ["write-out-cwd"],
      filePath: "/etc/app.conf",
    },
    { toolCallId: "t2", name: "bash", command: "bash", scopes: ["network"] },
    { toolCallId: "t3", name: "write", command: "write /bad", scopes: ["write-out-cwd"], filePath: 42 },
  ]);
  assert.ok(restored);
  assert.equal(restored[0]?.filePath, "/etc/app.conf", "path binding must survive restore");
  assert.equal(restored[1]?.filePath, undefined);
  assert.equal(restored[2]?.filePath, undefined, "non-string filePath is dropped, not coerced");
});

test("grant through a symlinked directory admits the not-yet-existing target (review 75: first-write)", () => {
  const project = createWorkspace();
  const realTargetDir = createWorkspace();
  const linkDir = path.join(project, "granted-link");
  createLink(realTargetDir, linkDir);
  // The user granted the lexical path (as PermissionCard persists it) to a
  // file that does not exist yet — the exact first-write-after-always-allow
  // flow. Before the shared canonicalizer, the stored root stayed lexical
  // while the gate candidate resolved through the symlink -> denied forever.
  const grantedLexical = path.join(linkDir, "new-file.txt");

  const manager = new SessionManager({
    projectRoot: project,
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({
      model: "test-model",
      permissions: { ...ALLOW_ALL, allowedWritePaths: [grantedLexical] },
    }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const seam = manager as unknown as {
    derivePathGrantForToolCall(sessionId: string, toolCall: never): { writeRoots: string[] };
  };
  const grant = seam.derivePathGrantForToolCall("pg-symlink", writeCall(grantedLexical) as never);
  const verdict = gateWrite(grant, grantedLexical);
  assert.equal(verdict.ok, true, "symlinked-dir grant must admit its not-yet-existing target");
  // And the real location behind the link matches the same grant.
  assert.equal(gateWrite(grant, path.join(realTargetDir, "new-file.txt")).ok, true);
  // Sibling trees are still denied.
  assert.equal(gateWrite(grant, path.join(createWorkspace(), "evil.txt")).ok, false);
});
