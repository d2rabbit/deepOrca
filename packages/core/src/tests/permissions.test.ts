import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  appendProjectPermissionAllows,
  computeToolCallPermissions,
  evaluatePermissionScopes,
  getPermissionScopesRequiringAsk,
  hasUserPermissionReplies,
  inferBashSideEffects,
  isPathInAnyDirectory,
  parseBashSideEffects,
  unionBashScopes,
} from "../common/permissions";
import { getProjectConfigRoot } from "../common/app-dirs";
import type { PermissionScope, PermissionSettings } from "../settings";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("parseBashSideEffects accepts valid scopes and normalizes unsafe values to unknown", () => {
  assert.deepEqual(parseBashSideEffects(["read-in-cwd", "network", "read-in-cwd"]), ["read-in-cwd", "network"]);
  assert.deepEqual(parseBashSideEffects(undefined), ["unknown"]);
  assert.deepEqual(parseBashSideEffects(["read-in-cwd", "unknown"]), ["unknown"]);
  assert.deepEqual(parseBashSideEffects(["mcp"]), ["unknown"]);
});

test("parseBashSideEffects returns an empty array for an empty declared array (the union step handles safety)", () => {
  // An empty declared array is NOT normalised to ["unknown"] here — doing so
  // would discard the concrete scopes inferred from the command text. Instead,
  // unionBashScopes([], inferred) preserves the inferred scopes, and if both
  // sides are empty the union returns ["unknown"]. This lets a `rm -rf` with
  // `sideEffects: []` still pick up the inferred delete scopes.
  assert.deepEqual(parseBashSideEffects([]), []);
  // Missing/non-array values are still treated as unclassifiable.
  assert.deepEqual(parseBashSideEffects(undefined), ["unknown"]);
  assert.deepEqual(parseBashSideEffects(null), ["unknown"]);
  assert.deepEqual(parseBashSideEffects("not-an-array"), ["unknown"]);
});

test("unionBashScopes returns unknown when both sides are empty (bash is never provably safe)", () => {
  assert.deepEqual(unionBashScopes([], []), ["unknown"]);
});

test("inferBashSideEffects flags deletion commands as both in-cwd and out-cwd", () => {
  // rm has no inherent path bound — it can delete anywhere. Declaring only
  // delete-out-cwd must not bypass a delete-in-cwd deny.
  const rm = inferBashSideEffects("rm -rf node_modules");
  assert.ok(rm.includes("delete-in-cwd"), "rm should infer delete-in-cwd");
  assert.ok(rm.includes("delete-out-cwd"), "rm should infer delete-out-cwd");
  // rmdir/del/shred behave the same way.
  assert.ok(inferBashSideEffects("del foo.txt").includes("delete-in-cwd"));
  assert.ok(inferBashSideEffects("shred secret.key").includes("delete-in-cwd"));
});

test("inferBashSideEffects flags git history mutation", () => {
  assert.ok(inferBashSideEffects("git commit --allow-empty -m x").includes("mutate-git-log"));
  assert.ok(inferBashSideEffects("git commit --amend --no-edit").includes("mutate-git-log"));
  assert.ok(inferBashSideEffects("git rebase main").includes("mutate-git-log"));
  assert.ok(inferBashSideEffects("git reset --hard HEAD~1").includes("mutate-git-log"));
  // query-only git commands are NOT flagged as mutation.
  const log = inferBashSideEffects("git log --oneline");
  assert.ok(!log.includes("mutate-git-log"), "git log should not be flagged as mutation");
});

test("inferBashSideEffects flags output redirection as write", () => {
  assert.ok(inferBashSideEffects("echo x > file.txt").includes("write-in-cwd"));
  assert.ok(inferBashSideEffects("echo x >> file.txt").includes("write-in-cwd"));
  assert.ok(inferBashSideEffects("echo x | tee out.txt").includes("write-in-cwd"));
});

test("inferBashSideEffects flags network tools", () => {
  assert.ok(inferBashSideEffects("curl https://example.com").includes("network"));
  assert.ok(inferBashSideEffects("wget http://example.com/file.zip").includes("network"));
  assert.ok(inferBashSideEffects("/usr/bin/curl localhost:8080").includes("network"));
  assert.ok(inferBashSideEffects("ssh user@host").includes("network"));
});

test("inferBashSideEffects flags package managers (write + network)", () => {
  const npm = inferBashSideEffects("npm install left-pad");
  assert.ok(npm.includes("network"), "npm should infer network");
  assert.ok(npm.includes("write-in-cwd"), "npm should infer write-in-cwd");
  assert.ok(inferBashSideEffects("pip install requests").includes("network"));
  assert.ok(inferBashSideEffects("uv pip install pkg").includes("network"));
});

test("inferBashSideEffects flags subshells and command substitution as unknown", () => {
  // The inner command is opaque to a tokeniser; the whole thing is
  // unclassifiable.
  assert.ok(inferBashSideEffects("echo $(cat /etc/passwd)").includes("unknown"));
  assert.ok(inferBashSideEffects("`whoami`").includes("unknown"));
  assert.ok(inferBashSideEffects("(cd /tmp && rm x)").includes("unknown"));
});

test("inferBashSideEffects flags empty/whitespace commands as unknown", () => {
  assert.deepEqual(inferBashSideEffects(""), ["unknown"]);
  assert.deepEqual(inferBashSideEffects("   "), ["unknown"]);
});

test("inferBashSideEffects flags pipe chains with no concrete signal as unknown", () => {
  // cat foo | grep bar | wc -l — no high-confidence pattern matched, but the
  // downstream commands are opaque in isolation.
  assert.ok(inferBashSideEffects("cat foo | grep bar | wc -l").includes("unknown"));
});

test("inferBashSideEffects: a benign read-only command returns [] (no additional inferred risk)", () => {
  // A benign-looking command with no danger pattern and no opacity construct
  // returns [] so the model's declared scopes stand. The empty-array attack
  // vector (model declares [] to skip the permission ask) is caught at the
  // union step: unionBashScopes([], []) -> ["unknown"].
  assert.deepEqual(inferBashSideEffects("ls -la"), []);
  assert.deepEqual(inferBashSideEffects("rg TODO src"), []);
});

test("unionBashScopes: inference can only add risk, never remove it", () => {
  // Declared network + inferred network → still just network.
  assert.deepEqual(unionBashScopes(["network"], ["network"]), ["network"]);
  // Declared read + inferred network → both.
  const merged = unionBashScopes(["read-in-cwd"], ["network"]);
  assert.ok(merged.includes("read-in-cwd"));
  assert.ok(merged.includes("network"));
  // Either side unknown → unknown dominates.
  assert.deepEqual(unionBashScopes(["unknown"], ["network"]), ["unknown"]);
  assert.deepEqual(unionBashScopes(["network"], ["unknown"]), ["unknown"]);
});

test("unionBashScopes: rm with declared delete-out-cwd cannot bypass delete-in-cwd deny", () => {
  // This is the regression the inference is meant to catch: the model declares
  // only delete-out-cwd, but rm infers delete-in-cwd too. The union includes
  // both, so a delete-in-cwd deny will fire.
  const merged = unionBashScopes(["delete-out-cwd"], ["delete-in-cwd", "delete-out-cwd"]);
  assert.ok(merged.includes("delete-in-cwd"), "merged scopes must include inferred delete-in-cwd");
  assert.ok(merged.includes("delete-out-cwd"));
});

test("computeToolCallPermissions: bash with empty declared sideEffects still infers concrete scopes", () => {
  // The model declared sideEffects: [] on `rm -rf`. Previously this
  // short-circuited the scope computation to "no scopes" (→ allow under
  // allowAll). Now the inferred delete scopes are unioned in even when the
  // declared array is empty, so a permission policy that asks on delete scopes
  // will fire. This test uses an askAll policy to prove the inferred scopes
  // survive; under allowAll the inferred scopes still get recorded in the
  // askPermissions list (they just don't trigger ask because allowAll allows
  // everything by design).
  const projectRoot = createTempDir("deepcode-permissions-empty-declared-");
  const plan = computeToolCallPermissions({
    sessionId: "session-1",
    projectRoot,
    settings: {
      allow: [] as PermissionScope[],
      deny: [] as PermissionScope[],
      ask: ["delete-in-cwd", "delete-out-cwd"] as PermissionScope[],
      defaultMode: "allowAll" as const,
    },
    toolCalls: [
      {
        id: "call-rm-empty-declared",
        type: "function",
        function: {
          name: "bash",
          arguments: JSON.stringify({ command: "rm -rf node_modules", sideEffects: [] }),
        },
      },
    ],
  });
  // rm infers delete-in-cwd/delete-out-cwd even with an empty declared array,
  // and those scopes are in the ask list → ask.
  assert.deepEqual(plan.permissions, [{ toolCallId: "call-rm-empty-declared", permission: "ask" }]);
  const scopes = plan.askPermissions[0]?.scopes ?? [];
  assert.ok(scopes.includes("delete-in-cwd"), "inferred delete-in-cwd must be present");
  assert.ok(scopes.includes("delete-out-cwd"), "inferred delete-out-cwd must be present");
});

test("computeToolCallPermissions: model under-reporting network is caught by inference", () => {
  // The model declares only read-in-cwd on a curl command, hoping to avoid the
  // network ask. Inference adds network, so an ask-on-network policy fires.
  const projectRoot = createTempDir("deepcode-permissions-under-report-");
  const plan = computeToolCallPermissions({
    sessionId: "session-1",
    projectRoot,
    settings: {
      allow: ["read-in-cwd"] as PermissionScope[],
      deny: [] as PermissionScope[],
      ask: ["network"] as PermissionScope[],
      defaultMode: "allowAll" as const,
    },
    toolCalls: [
      {
        id: "call-curl-under-report",
        type: "function",
        function: {
          name: "bash",
          arguments: JSON.stringify({
            command: "curl https://example.com/api > out.json",
            sideEffects: ["read-in-cwd"],
          }),
        },
      },
    ],
  });
  assert.deepEqual(plan.permissions, [{ toolCallId: "call-curl-under-report", permission: "ask" }]);
  const scopes = plan.askPermissions[0]?.scopes ?? [];
  assert.ok(scopes.includes("network"), "inferred network must be present despite under-reporting");
});

test("evaluatePermissionScopes applies deny, ask, allow, and default mode precedence", () => {
  const settings: Required<PermissionSettings> = {
    allow: ["read-in-cwd"] as PermissionScope[],
    deny: ["write-out-cwd"] as PermissionScope[],
    ask: ["network"] as PermissionScope[],
    defaultMode: "askAll",
  };

  assert.equal(evaluatePermissionScopes(["write-out-cwd"], settings), "deny");
  assert.equal(evaluatePermissionScopes(["network"], settings), "ask");
  assert.equal(evaluatePermissionScopes(["read-in-cwd"], settings), "allow");
  assert.equal(evaluatePermissionScopes(["write-in-cwd"], settings), "ask");
  assert.equal(evaluatePermissionScopes([], settings), "allow");
  assert.equal(evaluatePermissionScopes(["unknown"], settings), "ask");
});

test("evaluatePermissionScopes allows unknown when defaultMode is allowAll", () => {
  const allowAllSettings: Required<PermissionSettings> = {
    allow: [] as PermissionScope[],
    deny: [] as PermissionScope[],
    ask: [] as PermissionScope[],
    defaultMode: "allowAll",
  };
  assert.equal(evaluatePermissionScopes(["unknown"], allowAllSettings), "allow");

  // unknown + other scopes that would otherwise trigger ask should still ask for those scopes
  const askNetworkSettings: Required<PermissionSettings> = {
    allow: [] as PermissionScope[],
    deny: [] as PermissionScope[],
    ask: ["network"] as PermissionScope[],
    defaultMode: "allowAll",
  };
  assert.equal(evaluatePermissionScopes(["unknown", "network"], askNetworkSettings), "ask");
});

test("getPermissionScopesRequiringAsk excludes unknown when defaultMode is allowAll", () => {
  const allowAllSettings: Required<PermissionSettings> = {
    allow: [] as PermissionScope[],
    deny: [] as PermissionScope[],
    ask: ["network"] as PermissionScope[],
    defaultMode: "allowAll",
  };
  const result = getPermissionScopesRequiringAsk(["unknown", "network"], allowAllSettings);
  assert.deepEqual(result, ["network"]);
});

test("getPermissionScopesRequiringAsk includes unknown when defaultMode is askAll", () => {
  const askAllSettings: Required<PermissionSettings> = {
    allow: [] as PermissionScope[],
    deny: [] as PermissionScope[],
    ask: ["network"] as PermissionScope[],
    defaultMode: "askAll",
  };
  const result = getPermissionScopesRequiringAsk(["unknown", "network"], askAllSettings);
  assert.deepEqual(result, ["unknown", "network"]);
});

test("computeToolCallPermissions maps tool calls to permission requests", () => {
  const projectRoot = createTempDir("deepcode-permissions-workspace-");
  const plan = computeToolCallPermissions({
    sessionId: "session-1",
    projectRoot,
    settings: {
      allow: [] as PermissionScope[],
      deny: [] as PermissionScope[],
      ask: ["write-out-cwd", "network"] as PermissionScope[],
      defaultMode: "allowAll" as const,
    },
    resolveSnippetPath: () => path.join(projectRoot, "src", "file.ts"),
    toolCalls: [
      {
        id: "call-write",
        type: "function",
        function: { name: "write", arguments: JSON.stringify({ file_path: "/tmp/out.txt", content: "x" }) },
      },
      {
        id: "call-bash",
        type: "function",
        function: {
          name: "bash",
          arguments: JSON.stringify({ command: "curl https://example.com", sideEffects: ["network"] }),
        },
      },
      {
        id: "call-edit",
        type: "function",
        function: { name: "edit", arguments: JSON.stringify({ snippet_id: "snippet_1" }) },
      },
    ],
  });

  assert.deepEqual(plan.permissions, [
    { toolCallId: "call-write", permission: "ask" },
    { toolCallId: "call-bash", permission: "ask" },
    { toolCallId: "call-edit", permission: "allow" },
  ]);
  assert.deepEqual(
    plan.askPermissions.map((item) => ({ id: item.toolCallId, scopes: item.scopes })),
    [
      { id: "call-write", scopes: ["write-out-cwd"] },
      { id: "call-bash", scopes: ["network"] },
    ]
  );
});

test("computeToolCallPermissions only asks for scopes not already allowed", () => {
  const projectRoot = createTempDir("deepcode-permissions-filter-workspace-");
  const plan = computeToolCallPermissions({
    sessionId: "session-1",
    projectRoot,
    settings: {
      allow: ["read-in-cwd"] as PermissionScope[],
      deny: [] as PermissionScope[],
      ask: [] as PermissionScope[],
      defaultMode: "askAll" as const,
    },
    toolCalls: [
      {
        id: "call-bash",
        type: "function",
        function: {
          name: "bash",
          arguments: JSON.stringify({
            command: "curl -s http://localhost:8899/ && ls index.html",
            sideEffects: ["network", "read-in-cwd"],
          }),
        },
      },
    ],
  });

  assert.deepEqual(plan.permissions, [{ toolCallId: "call-bash", permission: "ask" }]);
  assert.deepEqual(
    plan.askPermissions.map((item) => ({ id: item.toolCallId, scopes: item.scopes })),
    [{ id: "call-bash", scopes: ["network"] }]
  );
});

test("computeToolCallPermissions temporarily upgrades allowed forced scopes to ask", () => {
  const projectRoot = createTempDir("deepcode-permissions-force-ask-workspace-");
  const forcedScopes: PermissionScope[] = [
    "write-in-cwd",
    "write-out-cwd",
    "delete-in-cwd",
    "delete-out-cwd",
    "mutate-git-log",
  ];
  const plan = computeToolCallPermissions({
    sessionId: "session-1",
    projectRoot,
    forceAskScopes: forcedScopes,
    settings: {
      allow: ["write-in-cwd", "write-out-cwd", "delete-out-cwd", "mutate-git-log"] as PermissionScope[],
      deny: ["delete-in-cwd"] as PermissionScope[],
      ask: [] as PermissionScope[],
      defaultMode: "allowAll" as const,
    },
    toolCalls: [
      {
        id: "call-write-in",
        type: "function",
        function: { name: "write", arguments: JSON.stringify({ file_path: path.join(projectRoot, "file.txt") }) },
      },
      {
        id: "call-write-out",
        type: "function",
        function: { name: "write", arguments: JSON.stringify({ file_path: "/tmp/file.txt" }) },
      },
      // `rm` is inferred as BOTH delete-in-cwd and delete-out-cwd (the command
      // has no inherent path bound), so a declared delete-out-cwd no longer
      // bypasses a delete-in-cwd deny. This is the intended fail-closed
      // behaviour — see "inferBashSideEffects" tests below.
      {
        id: "call-delete-out",
        type: "function",
        function: {
          name: "bash",
          arguments: JSON.stringify({
            command: "rm /tmp/file.txt",
            sideEffects: ["delete-out-cwd"],
          }),
        },
      },
      {
        id: "call-mutate-git",
        type: "function",
        function: {
          name: "bash",
          arguments: JSON.stringify({ command: "git commit --allow-empty -m test", sideEffects: ["mutate-git-log"] }),
        },
      },
      {
        id: "call-delete-in",
        type: "function",
        function: {
          name: "bash",
          arguments: JSON.stringify({ command: "rm file.txt", sideEffects: ["delete-in-cwd"] }),
        },
      },
    ],
  });

  assert.deepEqual(plan.permissions, [
    { toolCallId: "call-write-in", permission: "ask" },
    { toolCallId: "call-write-out", permission: "ask" },
    // rm now infers delete-in-cwd too, which is denied → deny (not ask).
    { toolCallId: "call-delete-out", permission: "deny" },
    { toolCallId: "call-mutate-git", permission: "ask" },
    { toolCallId: "call-delete-in", permission: "deny" },
  ]);
  assert.deepEqual(
    plan.askPermissions.map((item) => ({ id: item.toolCallId, scopes: item.scopes })),
    [
      { id: "call-write-in", scopes: ["write-in-cwd"] },
      { id: "call-write-out", scopes: ["write-out-cwd"] },
      { id: "call-mutate-git", scopes: ["mutate-git-log"] },
    ]
  );

  const defaultPlan = computeToolCallPermissions({
    sessionId: "session-1",
    projectRoot,
    settings: {
      allow: ["write-in-cwd"] as PermissionScope[],
      deny: [] as PermissionScope[],
      ask: [] as PermissionScope[],
      defaultMode: "allowAll" as const,
    },
    toolCalls: [
      {
        id: "call-default",
        type: "function",
        function: { name: "write", arguments: JSON.stringify({ file_path: path.join(projectRoot, "file.txt") }) },
      },
    ],
  });
  assert.deepEqual(defaultPlan.permissions, [{ toolCallId: "call-default", permission: "allow" }]);
});

test("computeToolCallPermissions allows read tool calls under skill scan paths", () => {
  const projectRoot = createTempDir("deepcode-permissions-skill-read-workspace-");
  const home = createTempDir("deepcode-permissions-skill-read-home-");
  const skillRoot = path.join(home, ".agents", "skills");
  const skillResourcePath = path.join(skillRoot, "pdf", "scripts", "extract.py");
  const outsidePath = path.join(home, "notes.txt");
  const plan = computeToolCallPermissions({
    sessionId: "session-1",
    projectRoot,
    readPermissionExemptPaths: [skillRoot],
    settings: {
      allow: [] as PermissionScope[],
      deny: [] as PermissionScope[],
      ask: [] as PermissionScope[],
      defaultMode: "askAll" as const,
    },
    toolCalls: [
      {
        id: "call-skill-read",
        type: "function",
        function: { name: "read", arguments: JSON.stringify({ file_path: skillResourcePath }) },
      },
      {
        id: "call-outside-read",
        type: "function",
        function: { name: "read", arguments: JSON.stringify({ file_path: outsidePath }) },
      },
    ],
  });

  assert.deepEqual(plan.permissions, [
    { toolCallId: "call-skill-read", permission: "allow" },
    { toolCallId: "call-outside-read", permission: "ask" },
  ]);
  assert.deepEqual(
    plan.askPermissions.map((item) => ({ id: item.toolCallId, scopes: item.scopes })),
    [{ id: "call-outside-read", scopes: ["read-out-cwd"] }]
  );
});

test("isPathInAnyDirectory matches absolute and project-relative directories without sibling leaks", () => {
  const projectRoot = createTempDir("deepcode-permissions-directory-match-workspace-");
  const home = createTempDir("deepcode-permissions-directory-match-home-");
  const absoluteSkillRoot = path.join(home, ".agents", "skills");
  const relativeSkillRoot = path.join(".deepcode", "skills");

  assert.equal(
    isPathInAnyDirectory(projectRoot, path.join(absoluteSkillRoot, "pdf", "scripts", "extract.py"), [
      absoluteSkillRoot,
    ]),
    true
  );
  assert.equal(
    isPathInAnyDirectory(projectRoot, path.join(projectRoot, relativeSkillRoot, "local", "SKILL.md"), [
      relativeSkillRoot,
    ]),
    true
  );
  assert.equal(
    isPathInAnyDirectory(projectRoot, path.join(`${absoluteSkillRoot}-backup`, "extract.py"), [absoluteSkillRoot]),
    false
  );
  assert.equal(
    isPathInAnyDirectory(projectRoot, path.join(projectRoot, ".deepcode", "skills-extra", "file.md"), [
      relativeSkillRoot,
    ]),
    false
  );
  assert.equal(isPathInAnyDirectory(projectRoot, path.join(home, "notes.txt"), undefined), false);
});

test("appendProjectPermissionAllows writes unique project-level allow scopes", () => {
  const projectRoot = createTempDir("deepcode-permission-settings-");
  const settingsPath = path.join(projectRoot, ".deepcode", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({ permissions: { allow: ["read-in-cwd"] } }), "utf8");

  appendProjectPermissionAllows(projectRoot, ["read-in-cwd", "write-in-cwd"]);
  appendProjectPermissionAllows(projectRoot, ["write-in-cwd"]);

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.permissions.allow, ["read-in-cwd", "write-in-cwd"]);
});

test("appendProjectPermissionAllows seeds inherited permissions before adding allow scopes", () => {
  const projectRoot = createTempDir("deepcode-permission-settings-default-");

  appendProjectPermissionAllows(projectRoot, ["query-git-log"], {
    inheritedPermissions: {
      allow: ["read-in-cwd"],
      deny: ["write-out-cwd"],
      ask: ["network"],
      defaultMode: "askAll",
    },
  });

  const settingsPath = path.join(getProjectConfigRoot(projectRoot), "settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.permissions, {
    allow: ["read-in-cwd", "query-git-log"],
    deny: ["write-out-cwd"],
    ask: ["network"],
    defaultMode: "askAll",
  });
});

test("appendProjectPermissionAllows moves inherited ask and deny scopes into allow", () => {
  const projectRoot = createTempDir("deepcode-permission-settings-move-inherited-");

  appendProjectPermissionAllows(projectRoot, ["network", "write-out-cwd"], {
    inheritedPermissions: {
      allow: ["read-in-cwd"],
      deny: ["write-out-cwd"],
      ask: ["network", "mcp"],
      defaultMode: "askAll",
    },
  });

  const settingsPath = path.join(getProjectConfigRoot(projectRoot), "settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.permissions, {
    allow: ["read-in-cwd", "network", "write-out-cwd"],
    deny: [],
    ask: ["mcp"],
    defaultMode: "askAll",
  });
});

test("appendProjectPermissionAllows writes inherited permissions even when scope is already allowed", () => {
  const projectRoot = createTempDir("deepcode-permission-settings-inherited-existing-");

  appendProjectPermissionAllows(projectRoot, ["read-in-cwd"], {
    inheritedPermissions: {
      allow: ["read-in-cwd"],
      deny: [],
      ask: ["network"],
      defaultMode: "askAll",
    },
  });

  const settingsPath = path.join(getProjectConfigRoot(projectRoot), "settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.permissions, {
    allow: ["read-in-cwd"],
    deny: [],
    ask: ["network"],
    defaultMode: "askAll",
  });
});

test("appendProjectPermissionAllows preserves existing project permissions", () => {
  const projectRoot = createTempDir("deepcode-permission-settings-explicit-default-");
  const settingsPath = path.join(projectRoot, ".deepcode", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ permissions: { allow: ["read-in-cwd"], defaultMode: "allowAll" } }),
    "utf8"
  );

  appendProjectPermissionAllows(projectRoot, ["query-git-log"], {
    inheritedPermissions: {
      allow: ["write-in-cwd"],
      deny: ["write-out-cwd"],
      ask: ["network"],
      defaultMode: "askAll",
    },
  });

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.permissions, {
    allow: ["read-in-cwd", "query-git-log"],
    defaultMode: "allowAll",
  });
});

test("appendProjectPermissionAllows removes existing ask and deny conflicts", () => {
  const projectRoot = createTempDir("deepcode-permission-settings-existing-conflict-");
  const settingsPath = path.join(projectRoot, ".deepcode", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      permissions: {
        allow: ["read-in-cwd"],
        deny: ["network", "write-out-cwd"],
        ask: ["network", "mcp"],
        defaultMode: "askAll",
      },
    }),
    "utf8"
  );

  appendProjectPermissionAllows(projectRoot, ["network"]);

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.permissions, {
    allow: ["read-in-cwd", "network"],
    deny: ["write-out-cwd"],
    ask: ["mcp"],
    defaultMode: "askAll",
  });
});

test("hasUserPermissionReplies detects permission reply payloads", () => {
  assert.equal(hasUserPermissionReplies({}), false);
  assert.equal(hasUserPermissionReplies({ permissions: [] }), false);
  assert.equal(hasUserPermissionReplies({ permissions: [{ toolCallId: "call-1", permission: "allow" }] }), true);
  assert.equal(hasUserPermissionReplies({ alwaysAllows: ["network"] }), true);
});

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
