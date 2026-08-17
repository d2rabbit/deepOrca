import { test } from "node:test";
import assert from "node:assert/strict";
import { SandboxPolicyEngine, buildPolicyMatrix, resolveScopeVerdict } from "../sandbox/policy";
import { ALL_SANDBOX_SCOPES } from "../sandbox/types";
import type { PermissionSettings, PermissionScope } from "../settings";

// P2 policy engine tests (specs/sandbox/design.md §4.4, tasks 12-13): pure
// logic, zero I/O. The real 10 scopes × allow/deny/ask combinations, plus
// the 3-state lifecycle and generation fencing.

test("the scope set is exactly the real 10 permission scopes", () => {
  assert.equal(ALL_SANDBOX_SCOPES.length, 10);
  assert.deepEqual(
    [...ALL_SANDBOX_SCOPES],
    [
      "read-in-cwd",
      "read-out-cwd",
      "write-in-cwd",
      "write-out-cwd",
      "delete-in-cwd",
      "delete-out-cwd",
      "query-git-log",
      "mutate-git-log",
      "network",
      "mcp",
    ]
  );
});

test("every scope resolves correctly under every settings combination", () => {
  for (const scope of ALL_SANDBOX_SCOPES) {
    assert.equal(resolveScopeVerdict(scope, { deny: [scope] }), "deny", `${scope} deny list`);
    assert.equal(resolveScopeVerdict(scope, { ask: [scope] }), "ask", `${scope} ask list`);
    assert.equal(resolveScopeVerdict(scope, { allow: [scope] }), "allow", `${scope} allow list`);
    assert.equal(
      resolveScopeVerdict(scope, { allow: [scope], ask: [scope], deny: [scope] }),
      "deny",
      `${scope} deny beats ask+allow`
    );
    assert.equal(resolveScopeVerdict(scope, { allow: [scope], ask: [scope] }), "ask", `${scope} ask beats allow`);
    assert.equal(resolveScopeVerdict(scope, {}), "allow", `${scope} defaultMode allowAll fallback`);
    assert.equal(resolveScopeVerdict(scope, { defaultMode: "askAll" }), "ask", `${scope} defaultMode askAll fallback`);
  }
});

test("buildPolicyMatrix resolves all 10 scopes in one call", () => {
  const matrix = buildPolicyMatrix({
    allow: ["read-in-cwd", "write-in-cwd"],
    ask: ["network"],
    deny: ["write-out-cwd", "delete-out-cwd"],
    defaultMode: "askAll",
  });
  assert.equal(matrix["read-in-cwd"], "allow");
  assert.equal(matrix["write-in-cwd"], "allow");
  assert.equal(matrix["network"], "ask");
  assert.equal(matrix["write-out-cwd"], "deny");
  assert.equal(matrix["delete-out-cwd"], "deny");
  // Everything unlisted falls back to askAll.
  for (const scope of ALL_SANDBOX_SCOPES) {
    if (["read-in-cwd", "write-in-cwd", "network", "write-out-cwd", "delete-out-cwd"].includes(scope)) {
      continue;
    }
    assert.equal(matrix[scope as PermissionScope], "ask", `${scope} falls back to askAll`);
  }
});

test("lifecycle: creating denies, active follows the matrix, dead denies forever", () => {
  const engine = new SandboxPolicyEngine({ allow: ALL_SANDBOX_SCOPES as PermissionScope[] });
  const lease = engine.beginGeneration();

  assert.equal(engine.lifecycleState, "creating");
  for (const scope of ALL_SANDBOX_SCOPES) {
    assert.equal(engine.decide(lease, scope), "deny", `creating must deny ${scope}`);
  }

  engine.activate();
  assert.equal(engine.lifecycleState, "active");
  for (const scope of ALL_SANDBOX_SCOPES) {
    assert.equal(engine.decide(lease, scope), "allow", `active must follow matrix for ${scope}`);
  }

  engine.kill();
  assert.equal(engine.lifecycleState, "dead");
  for (const scope of ALL_SANDBOX_SCOPES) {
    assert.equal(engine.decide(lease, scope), "deny", `dead must deny ${scope}`);
  }
  // Dead is terminal: activate/kill/updateSettings cannot revive it.
  engine.activate();
  engine.updateSettings({ allow: ALL_SANDBOX_SCOPES as PermissionScope[] });
  assert.equal(engine.lifecycleState, "dead");
  assert.equal(engine.decide(lease, "read-in-cwd"), "deny");
});

test("generation fencing: a superseded lease can never act again", () => {
  const engine = new SandboxPolicyEngine({ allow: ALL_SANDBOX_SCOPES as PermissionScope[] });
  engine.activate();

  const staleLease = engine.beginGeneration();
  assert.equal(engine.decide(staleLease, "write-in-cwd"), "allow");

  const freshLease = engine.beginGeneration();
  assert.equal(engine.decide(freshLease, "write-in-cwd"), "allow");
  // The dangling handle from the previous generation is fenced out.
  assert.equal(engine.isActionable(staleLease), false);
  assert.equal(engine.decide(staleLease, "write-in-cwd"), "deny");
  assert.equal(engine.decide(staleLease, "read-in-cwd"), "deny");
});

test("updateSettings only affects future decisions of the current generation", () => {
  const engine = new SandboxPolicyEngine({ defaultMode: "askAll" });
  engine.activate();
  const lease = engine.beginGeneration();
  assert.equal(engine.decide(lease, "network"), "ask");

  engine.updateSettings({ deny: ["network"] });
  assert.equal(engine.decide(lease, "network"), "deny");
  assert.equal(engine.decide(lease, "read-in-cwd"), "allow");
});
