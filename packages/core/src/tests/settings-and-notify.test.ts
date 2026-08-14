import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildNotifyEnv,
  formatDurationSeconds,
  launchNotifyScript,
  type NotifyContext,
  type NotifySpawn,
} from "../common/notify";
import {
  applyModelConfigSelection,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  failClosedPermissionDefault,
  getLastSettingsReadError,
  getProjectSettingsPath,
  normalizeEndpoints,
  readSettingsFile,
  readSettingsFileWithStatus,
  resetLastSettingsReadError,
  resolveSettings,
  resolveSettingsSources,
  writeProjectSettings,
} from "../settings";

const TEST_PROCESS_ENV = {};

test("writeProjectSettings atomically replaces settings without temp artifacts", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-settings-"));
  try {
    const settingsPath = getProjectSettingsPath(projectRoot);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, '{"model":"old"}\n', "utf8");

    const settings = { model: "deepseek-v4", env: { API_KEY: "sk-private" } };
    writeProjectSettings(settings, projectRoot);

    assert.deepEqual(readSettingsFile(settingsPath), settings);
    assert.equal(fs.readFileSync(settingsPath, "utf8").endsWith("\n"), true);
    assert.deepEqual(fs.readdirSync(path.dirname(settingsPath)), ["settings.json"]);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test(
  "writeProjectSettings creates and replaces settings with mode 0600",
  { skip: process.platform === "win32" },
  () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-settings-mode-"));
    try {
      const settingsPath = getProjectSettingsPath(projectRoot);
      writeProjectSettings({ model: "first" }, projectRoot);
      assert.equal(fs.statSync(settingsPath).mode & 0o777, 0o600);

      fs.chmodSync(settingsPath, 0o644);
      writeProjectSettings({ model: "second" }, projectRoot);
      assert.equal(fs.statSync(settingsPath).mode & 0o777, 0o600);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  }
);

test("resolveSettings reads top-level thinkingEnabled, notify, and webSearchTool", () => {
  const resolved = resolveSettings(
    {
      env: {
        MODEL: "deepseek-v3.2",
        BASE_URL: "https://example.com/v1",
        API_KEY: "sk-test",
      },
      temperature: 0.3,
      thinkingEnabled: true,
      reasoningEffort: "high",
      debugLogEnabled: true,
      notify: "  /tmp/notify.sh  ",
      webSearchTool: "  /tmp/web-search.sh  ",
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.model, "deepseek-v3.2");
  assert.equal(resolved.baseURL, "https://example.com/v1");
  assert.equal(resolved.apiKey, "sk-test");
  assert.equal(resolved.temperature, 0.3);
  assert.equal(resolved.thinkingEnabled, true);
  assert.equal(resolved.reasoningEffort, "high");
  assert.equal(resolved.debugLogEnabled, true);
  assert.equal(resolved.notify, "/tmp/notify.sh");
  assert.equal(resolved.webSearchTool, "/tmp/web-search.sh");
});

test("resolveSettings gives top-level model priority over env MODEL", () => {
  const resolved = resolveSettings(
    {
      model: "deepseek-v4-flash",
      env: {
        MODEL: "deepseek-v4-pro",
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.model, "deepseek-v4-flash");
});

test("resolveSettings reads TEMPERATURE, THINKING_ENABLED, REASONING_EFFORT, and DEBUG_LOG_ENABLED from env", () => {
  const resolved = resolveSettings(
    {
      env: {
        TEMPERATURE: "0.7",
        THINKING_ENABLED: "true",
        REASONING_EFFORT: "high",
        DEBUG_LOG_ENABLED: "true",
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.thinkingEnabled, true);
  assert.equal(resolved.temperature, 0.7);
  assert.equal(resolved.reasoningEffort, "high");
  assert.equal(resolved.debugLogEnabled, true);
  assert.equal(resolved.model, "default-model");
  assert.equal(resolved.baseURL, "https://default.example.com");
});

test("resolveSettings defaults telemetryEnabled to true", () => {
  const resolved = resolveSettings(
    {},
    { model: "default-model", baseURL: "https://default.example.com" },
    TEST_PROCESS_ENV
  );
  assert.equal(resolved.telemetryEnabled, true);
});

test("resolveSettings reads TELEMETRY_ENABLED from env", () => {
  const resolved = resolveSettings(
    { env: { TELEMETRY_ENABLED: "0" } },
    { model: "default-model", baseURL: "https://default.example.com" },
    TEST_PROCESS_ENV
  );
  assert.equal(resolved.telemetryEnabled, false);
});

test("resolveSettings gives top-level telemetryEnabled priority over env TELEMETRY_ENABLED", () => {
  const resolved = resolveSettings(
    {
      telemetryEnabled: false,
      env: { TELEMETRY_ENABLED: "true" },
    },
    { model: "default-model", baseURL: "https://default.example.com" },
    TEST_PROCESS_ENV
  );
  assert.equal(resolved.telemetryEnabled, false);
});

test("resolveSettings ignores removed legacy env.THINKING", () => {
  const resolved = resolveSettings(
    {
      env: {
        THINKING: "enabled",
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    {}
  );

  assert.equal(resolved.thinkingEnabled, false);
});

test("resolveSettingsSources applies user, project, and DEEPCODE environment precedence", () => {
  const resolved = resolveSettingsSources(
    {
      env: {
        API_KEY: "user-key",
        MODEL: "user-env-model",
        THINKING_ENABLED: "false",
        REASONING_EFFORT: "high",
        TEMPERATURE: "0.2",
        DEBUG_LOG_ENABLED: "false",
        WEBHOOK: "user-webhook",
      },
      model: "user-top-model",
      thinkingEnabled: true,
      reasoningEffort: "max",
      temperature: 0.4,
      debugLogEnabled: true,
      telemetryEnabled: false,
    },
    {
      env: {
        API_KEY: "project-key",
        MODEL: "project-env-model",
        THINKING_ENABLED: "false",
        DEBUG_LOG_ENABLED: "false",
        TEMPERATURE: "0.6",
      },
      model: "project-top-model",
      thinkingEnabled: true,
      temperature: 0.8,
      telemetryEnabled: true,
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    {
      DEEPCODE_MODEL: "system-model",
      DEEPCODE_THINKING_ENABLED: "false",
      DEEPCODE_REASONING_EFFORT: "high",
      DEEPCODE_TEMPERATURE: "1.2",
      DEEPCODE_DEBUG_LOG_ENABLED: "true",
      DEEPCODE_TELEMETRY_ENABLED: "false",
      DEEPCODE_WEBHOOK: "system-webhook",
    }
  );

  assert.equal(resolved.model, "system-model");
  assert.equal(resolved.apiKey, "project-key");
  assert.equal(resolved.thinkingEnabled, false);
  assert.equal(resolved.reasoningEffort, "high");
  assert.equal(resolved.temperature, 1.2);
  assert.equal(resolved.debugLogEnabled, true);
  assert.equal(resolved.telemetryEnabled, false);
  assert.equal(resolved.env.WEBHOOK, "system-webhook");
});

test("resolveSettingsSources merges permission settings", () => {
  const resolved = resolveSettingsSources(
    {
      permissions: {
        allow: ["read-in-cwd", "network"],
        ask: ["write-out-cwd"],
        defaultMode: "askAll",
      },
    },
    {
      permissions: {
        allow: ["write-in-cwd", "read-in-cwd"],
        deny: ["delete-out-cwd"],
        defaultMode: "allowAll",
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.deepEqual(resolved.permissions.allow, ["read-in-cwd", "network", "write-in-cwd"]);
  assert.deepEqual(resolved.permissions.ask, ["write-out-cwd"]);
  assert.deepEqual(resolved.permissions.deny, ["delete-out-cwd"]);
  assert.equal(resolved.permissions.defaultMode, "allowAll");
});

test("readSettingsFileWithStatus distinguishes missing / valid / invalid", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-settings-status-"));
  try {
    const settingsPath = getProjectSettingsPath(projectRoot);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

    // Missing — no file written yet.
    resetLastSettingsReadError();
    assert.equal(readSettingsFileWithStatus(settingsPath).kind, "missing");
    assert.equal(getLastSettingsReadError(), null);

    // Valid JSON object.
    fs.writeFileSync(settingsPath, '{"model":"x"}\n', "utf8");
    const valid = readSettingsFileWithStatus(settingsPath);
    assert.equal(valid.kind, "valid");
    if (valid.kind === "valid") assert.equal(valid.value.model, "x");

    // Corrupt JSON.
    fs.writeFileSync(settingsPath, "{not valid json\n", "utf8");
    const invalid = readSettingsFileWithStatus(settingsPath);
    assert.equal(invalid.kind, "invalid");
    if (invalid.kind === "invalid") assert.ok(invalid.error.length > 0);

    // JSON but not an object (an array).
    fs.writeFileSync(settingsPath, "[1,2,3]\n", "utf8");
    const invalidArr = readSettingsFileWithStatus(settingsPath);
    assert.equal(invalidArr.kind, "invalid");
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    resetLastSettingsReadError();
  }
});

test("readSettingsFile records a diagnostic for corrupt settings (getLastSettingsReadError)", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-settings-diag-"));
  try {
    const settingsPath = getProjectSettingsPath(projectRoot);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    resetLastSettingsReadError();

    // Missing file → no diagnostic.
    readSettingsFile(settingsPath);
    assert.equal(getLastSettingsReadError(), null);

    // Corrupt → diagnostic recorded, readSettingsFile still returns null.
    fs.writeFileSync(settingsPath, "{broken\n", "utf8");
    const result = readSettingsFile(settingsPath);
    assert.equal(result, null);
    const diag = getLastSettingsReadError();
    assert.ok(diag, "expected a diagnostic for corrupt settings");
    assert.equal(diag?.kind, "invalid");
    assert.ok(diag?.error.length > 0);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    resetLastSettingsReadError();
  }
});

test("failClosedPermissionDefault upgrades to askAll after a corrupt read", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-settings-fc-"));
  try {
    const settingsPath = getProjectSettingsPath(projectRoot);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    resetLastSettingsReadError();

    // No error yet → preferred default passes through.
    assert.equal(failClosedPermissionDefault("allowAll"), "allowAll");

    // Trigger a corrupt read, then the guard MUST upgrade to askAll.
    fs.writeFileSync(settingsPath, "{broken\n", "utf8");
    readSettingsFile(settingsPath);
    assert.equal(failClosedPermissionDefault("allowAll"), "askAll");
    assert.equal(failClosedPermissionDefault("askAll"), "askAll");
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    resetLastSettingsReadError();
  }
});

test("resolveSettingsSources merges enabledSkills with project precedence", () => {
  const resolved = resolveSettingsSources(
    {
      enabledSkills: {
        inherited: false,
        "project-enabled": false,
        "project-disabled": true,
        invalid: "false" as never,
      },
    },
    {
      enabledSkills: {
        "project-enabled": true,
        "project-disabled": false,
        projectOnly: true,
        ignored: null as never,
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.deepEqual(resolved.enabledSkills, {
    inherited: false,
    "project-enabled": true,
    "project-disabled": false,
    projectOnly: true,
  });
});

// ── Multi-endpoint normalization & merge ──────────────────────────────────

test("normalizeEndpoints rejects non-arrays, malformed entries, and duplicate ids", () => {
  // Non-array → empty.
  assert.deepEqual(normalizeEndpoints({}), []);
  assert.deepEqual(normalizeEndpoints(null), []);
  assert.deepEqual(normalizeEndpoints("deepseek"), []);

  // Array with malformed entries: null, missing fields, non-object all dropped.
  const malformed = normalizeEndpoints([
    null,
    42,
    "string",
    { id: "ok", name: "OK", baseURL: "https://ok.example.com", apiKey: "k" },
    { id: "", name: "Empty", baseURL: "https://e.example.com" }, // empty id dropped
    { id: "no-baseurl", name: "NoBase" }, // missing baseURL dropped
    { id: "no-name", baseURL: "https://nn.example.com" }, // missing name dropped
    { id: "ok", name: "Dup", baseURL: "https://dup.example.com" }, // duplicate id dropped
  ]);
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0]?.id, "ok");
  assert.equal(malformed[0]?.apiKey, "k");

  // Missing apiKey defaults to empty string (not undefined).
  const noKey = normalizeEndpoints([{ id: "a", name: "A", baseURL: "https://a.example.com" }]);
  assert.equal(noKey[0]?.apiKey, "");

  // Non-string apiKey coerced to "".
  const badKey = normalizeEndpoints([{ id: "b", name: "B", baseURL: "https://b.example.com", apiKey: 12345 }]);
  assert.equal(badKey[0]?.apiKey, "");
});

test("resolveSettingsSources merges endpoints with project overriding user by id", () => {
  const resolved = resolveSettingsSources(
    {
      endpoints: [
        { id: "deepseek", name: "User DS", baseURL: "https://user.deepseek.com", apiKey: "user-key" },
        { id: "extra", name: "Extra", baseURL: "https://extra.example.com", apiKey: "extra-key" },
      ],
    },
    {
      endpoints: [
        // Project overrides user's "deepseek" id.
        { id: "deepseek", name: "Project DS", baseURL: "https://project.deepseek.com", apiKey: "project-key" },
      ],
      primaryEndpointId: "deepseek",
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  // Both endpoints present (no user leak into project, no duplication).
  assert.equal(resolved.endpoints.length, 2);
  const ds = resolved.endpoints.find((e) => e.id === "deepseek");
  assert.equal(ds?.name, "Project DS");
  assert.equal(ds?.baseURL, "https://project.deepseek.com");
  assert.equal(ds?.apiKey, "project-key");
  // "extra" (user-only) still present.
  assert.ok(resolved.endpoints.find((e) => e.id === "extra"));
  // Primary resolves to the project-overridden entry.
  assert.equal(resolved.primaryEndpointId, "deepseek");
  assert.equal(resolved.baseURL, "https://project.deepseek.com");
});

test("resolveSettingsSources: env API_KEY has highest priority over endpoint apiKey", () => {
  const resolved = resolveSettingsSources(
    {
      endpoints: [{ id: "deepseek", name: "DS", baseURL: "https://api.deepseek.com", apiKey: "file-key" }],
      primaryEndpointId: "deepseek",
    },
    null,
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    { DEEPORCA_API_KEY: "env-key" }
  );

  // Env key wins — CI/credential rotation can override the file-stored key.
  assert.equal(resolved.apiKey, "env-key");
  assert.equal(resolved.baseURL, "https://api.deepseek.com");
});

test("resolveSettingsSources: env BASE_URL overrides a configured endpoint baseURL (parity with API_KEY)", () => {
  // Regression: previously env API_KEY won via `??` but env BASE_URL only
  // applied as a `||` fallback, so a configured endpoint baseURL silently
  // ignored DEEPORCA_BASE_URL — sending the env credential to the wrong host.
  // Both env values must now have the same top priority.
  const resolved = resolveSettingsSources(
    {
      endpoints: [{ id: "deepseek", name: "DS", baseURL: "https://api.deepseek.com", apiKey: "file-key" }],
      primaryEndpointId: "deepseek",
    },
    null,
    { model: "default-model", baseURL: "https://default.example.com" },
    { DEEPORCA_API_KEY: "env-key", DEEPORCA_BASE_URL: "https://gateway.example.com/v1" }
  );

  assert.equal(resolved.apiKey, "env-key");
  assert.equal(resolved.baseURL, "https://gateway.example.com/v1");
});

test("resolveSettingsSources: env BASE_URL absent keeps the configured endpoint baseURL", () => {
  const resolved = resolveSettingsSources(
    {
      endpoints: [{ id: "deepseek", name: "DS", baseURL: "https://api.deepseek.com", apiKey: "file-key" }],
      primaryEndpointId: "deepseek",
    },
    null,
    { model: "default-model", baseURL: "https://default.example.com" },
    { DEEPORCA_API_KEY: "env-key" }
  );
  assert.equal(resolved.baseURL, "https://api.deepseek.com");
});

test("applyModelConfigSelection writes primaryEndpointId when endpointId is supplied", () => {
  // Selecting model "m-b" on endpoint "provider-b" must persist primaryEndpointId
  // atomically so runtime routes to provider-b (not the previously-primary provider-a).
  const result = applyModelConfigSelection(
    {
      endpoints: [
        { id: "provider-a", name: "A", baseURL: "https://a", apiKey: "ka", models: [{ id: "m-a", thinking: true }] },
        { id: "provider-b", name: "B", baseURL: "https://b", apiKey: "kb", models: [{ id: "m-b", thinking: false }] },
      ],
      primaryEndpointId: "provider-a",
      model: "m-a",
    },
    { model: "m-a", thinkingEnabled: true, reasoningEffort: "max" },
    { model: "m-b", endpointId: "provider-b", thinkingEnabled: false, reasoningEffort: "max" }
  );
  assert.equal(result.changed, true);
  assert.equal(result.settings.model, "m-b");
  assert.equal(result.settings.primaryEndpointId, "provider-b");
});

test("applyModelConfigSelection forces thinking off when the selected model declares it unsupported", () => {
  // Switching from a thinking-capable model to a non-thinking one must clear
  // thinkingEnabled — otherwise activateSession sends thinking options to a
  // model that rejects them.
  const result = applyModelConfigSelection(
    {
      endpoints: [
        {
          id: "ep",
          name: "E",
          baseURL: "https://e",
          apiKey: "k",
          models: [
            { id: "m-think", thinking: true },
            { id: "m-plain", thinking: false },
          ],
        },
      ],
      primaryEndpointId: "ep",
      model: "m-think",
    },
    { model: "m-think", thinkingEnabled: true, reasoningEffort: "max" },
    // Renderer (incorrectly) carries over thinkingEnabled=true:
    { model: "m-plain", endpointId: "ep", thinkingEnabled: true, reasoningEffort: "max" }
  );
  assert.equal(result.settings.model, "m-plain");
  assert.equal(result.settings.thinkingEnabled, false);
});

test("resolveSettingsSources synthesizes default endpoint from env but apiKey stays top-level only", () => {
  // No endpoints configured at all → synthetic default. The endpoint carries the
  // env key for runtime, but this is NOT surfaced by getEditableSettings (which
  // reads raw files). Here we verify the resolved shape is consistent.
  const resolved = resolveSettingsSources(
    null,
    null,
    { model: "default-model", baseURL: "https://default.example.com" },
    { DEEPORCA_API_KEY: "env-key" }
  );

  assert.equal(resolved.endpoints.length, 1);
  assert.equal(resolved.endpoints[0]?.id, "deepseek");
  assert.equal(resolved.endpoints[0]?.apiKey, "env-key");
  assert.equal(resolved.apiKey, "env-key");
});

test("resolveSettingsSources merges MCP env with documented priority", () => {
  const resolved = resolveSettingsSources(
    {
      env: {
        MCP_GITHUB_PERSONAL_ACCESS_TOKEN: "user-global",
      },
      mcpServers: {
        github: {
          command: "node",
          args: ["user-server.js"],
          env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: "user-local",
            USER_ONLY: "1",
          },
        },
      },
    },
    {
      env: {
        MCP_GITHUB_PERSONAL_ACCESS_TOKEN: "project-global",
      },
      mcpServers: {
        github: {
          command: "python",
          env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: "project-local",
            PROJECT_ONLY: "1",
          },
        },
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    {
      DEEPCODE_MCP_GITHUB_PERSONAL_ACCESS_TOKEN: "system-global",
    }
  );

  assert.equal(resolved.mcpServers?.github?.command, "python");
  assert.deepEqual(resolved.mcpServers?.github?.args, ["user-server.js"]);
  assert.deepEqual(resolved.mcpServers?.github?.env, {
    MCP_GITHUB_PERSONAL_ACCESS_TOKEN: "system-global",
    GITHUB_PERSONAL_ACCESS_TOKEN: "system-global",
    USER_ONLY: "1",
    PROJECT_ONLY: "1",
  });
});

test("resolveSettings defaults DeepSeek v4 models to thinking mode", () => {
  const resolved = resolveSettings(
    {
      env: {
        MODEL: "deepseek-v4-flash",
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.thinkingEnabled, true);
});

test("resolveSettings applies thinking defaults to the fallback model", () => {
  const resolved = resolveSettings(
    {},
    {
      model: "deepseek-v4-pro",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.model, "deepseek-v4-pro");
  assert.equal(resolved.thinkingEnabled, true);
});

test("resolveSettings keeps thinking mode off by default for other models", () => {
  const resolved = resolveSettings(
    {
      env: {
        MODEL: "deepseek-v3.2",
      },
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.thinkingEnabled, false);
});

test("resolveSettings allows explicit thinkingEnabled to override model defaults", () => {
  const resolved = resolveSettings(
    {
      env: {
        MODEL: "deepseek-v4-pro",
      },
      thinkingEnabled: false,
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.thinkingEnabled, false);
});

test("resolveSettings defaults invalid reasoning effort to max", () => {
  const resolved = resolveSettings(
    {
      reasoningEffort: "medium" as never,
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.reasoningEffort, "max");
});

test("resolveSettings ignores invalid temperature values", () => {
  const resolved = resolveSettings(
    {
      env: {
        TEMPERATURE: "hot",
      },
      temperature: 3,
    },
    {
      model: "default-model",
      baseURL: "https://default.example.com",
    },
    TEST_PROCESS_ENV
  );

  assert.equal(resolved.temperature, undefined);
});

test("applyModelConfigSelection writes model only when the effective model changes or already exists", () => {
  const result = applyModelConfigSelection(
    {
      env: {
        MODEL: "deepseek-v4-pro",
      },
      thinkingEnabled: false,
    },
    {
      model: "deepseek-v4-pro",
      thinkingEnabled: false,
      reasoningEffort: "max",
    },
    {
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "high",
    }
  );

  assert.equal(result.changed, true);
  assert.equal(result.settings.model, undefined);
  assert.equal(result.settings.thinkingEnabled, true);
  assert.equal(result.settings.reasoningEffort, "high");
});

test("applyModelConfigSelection persists a new selected model and thinking option", () => {
  const result = applyModelConfigSelection(
    {
      env: {
        MODEL: "deepseek-v4-pro",
        BASE_URL: "https://api.deepseek.com",
        API_KEY: "sk-test",
      },
      thinkingEnabled: false,
    },
    {
      model: "deepseek-v4-pro",
      thinkingEnabled: false,
      reasoningEffort: "max",
    },
    {
      model: "deepseek-v4-flash",
      thinkingEnabled: true,
      reasoningEffort: "high",
    }
  );

  assert.equal(result.changed, true);
  assert.equal(result.settings.env?.MODEL, "deepseek-v4-pro");
  assert.equal(result.settings.model, "deepseek-v4-flash");
  assert.equal(result.settings.thinkingEnabled, true);
  assert.equal(result.settings.reasoningEffort, "high");
});

test("applyModelConfigSelection leaves settings untouched when the effective selection is unchanged", () => {
  const result = applyModelConfigSelection(
    {
      env: {
        MODEL: "deepseek-v4-pro",
      },
      thinkingEnabled: true,
      reasoningEffort: "max",
    },
    {
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
    },
    {
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
    }
  );

  assert.equal(result.changed, false);
  assert.equal(result.settings.model, undefined);
});

test("formatDurationSeconds preserves sub-second precision and trims trailing zeros", () => {
  assert.equal(formatDurationSeconds(0), "0");
  assert.equal(formatDurationSeconds(1250), "1");
  assert.equal(formatDurationSeconds(4000), "4");
});

test("buildNotifyEnv injects DURATION without context", () => {
  const env = buildNotifyEnv(2750, { HOME: "/tmp/home" });
  assert.equal(env.HOME, "/tmp/home");
  assert.equal(env.DURATION, "2");
  assert.equal(env.STATUS, undefined);
  assert.equal(env.FAIL_REASON, undefined);
  assert.equal(env.BODY, undefined);
  assert.equal(env.TITLE, undefined);
});

test("buildNotifyEnv injects STATUS, FAIL_REASON, BODY, and TITLE from context", () => {
  const context: NotifyContext = {
    status: "failed",
    failReason: "API key not found",
    body: "Hello, this is the last assistant message.",
    title: "Fix login bug",
  };
  const env = buildNotifyEnv(5000, { HOME: "/tmp/home" }, context);
  assert.equal(env.HOME, "/tmp/home");
  assert.equal(env.DURATION, "5");
  assert.equal(env.STATUS, "failed");
  assert.equal(env.FAIL_REASON, "API key not found");
  assert.equal(env.BODY, "Hello, this is the last assistant message.");
  assert.equal(env.TITLE, "Fix login bug");
});

test("buildNotifyEnv omits optional context fields when not provided", () => {
  const env = buildNotifyEnv(
    1000,
    {
      HOME: "/tmp/home",
      STATUS: "stale-status",
      FAIL_REASON: "stale-failure",
      BODY: "stale-body",
      TITLE: "stale-title",
    },
    { status: "completed" }
  );
  assert.equal(env.STATUS, "completed");
  assert.equal(env.FAIL_REASON, undefined);
  assert.equal(env.BODY, undefined);
  assert.equal(env.TITLE, undefined);
});

test("buildNotifyEnv ignores empty strings in context", () => {
  const env = buildNotifyEnv(
    1000,
    { HOME: "/tmp/home" },
    {
      status: "",
      failReason: "",
      body: "",
      title: "",
    }
  );
  assert.equal(env.STATUS, undefined);
  assert.equal(env.FAIL_REASON, undefined);
  assert.equal(env.BODY, undefined);
  assert.equal(env.TITLE, undefined);
});

test("buildNotifyEnv preserves special characters in body and title", () => {
  const context: NotifyContext = {
    body: 'Line 1\nLine 2\tindented "quoted"',
    title: "Fix: login & signup (urgent)",
  };
  const env = buildNotifyEnv(1000, {}, context);
  assert.equal(env.BODY, 'Line 1\nLine 2\tindented "quoted"');
  assert.equal(env.TITLE, "Fix: login & signup (urgent)");
});

test(
  "launchNotifyScript passes DURATION, context vars, and falls back to /bin/sh for non-executable scripts",
  { skip: process.platform === "win32" },
  () => {
    const calls: Array<{
      command: string;
      args: string[];
      options: { cwd?: string | URL; env?: NodeJS.ProcessEnv };
    }> = [];

    const spawnProcess: NotifySpawn = (command, args, options) => {
      calls.push({ command, args, options: { cwd: options.cwd, env: options.env } });

      return {
        once(event, listener) {
          if (event === "error" && calls.length === 1) {
            listener({ code: "EACCES" } as NodeJS.ErrnoException);
          }
          return this;
        },
        unref() {
          return undefined;
        },
      };
    };

    const context: NotifyContext = {
      status: "completed",
      body: "Task finished successfully.",
      title: "Fix login bug",
    };

    launchNotifyScript("/tmp/notify.sh", 2750, "/tmp/project", spawnProcess, { WEBHOOK: "configured" }, context);

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.command, "/tmp/notify.sh");
    assert.deepEqual(calls[0]?.args, []);
    assert.equal(calls[0]?.options.cwd, "/tmp/project");
    assert.equal(calls[0]?.options.env?.DURATION, "2");
    assert.equal(calls[0]?.options.env?.WEBHOOK, "configured");
    assert.equal(calls[0]?.options.env?.STATUS, "completed");
    assert.equal(calls[0]?.options.env?.FAIL_REASON, undefined);
    assert.equal(calls[0]?.options.env?.BODY, "Task finished successfully.");
    assert.equal(calls[0]?.options.env?.TITLE, "Fix login bug");
    assert.equal(calls[1]?.command, "/bin/sh");
    assert.deepEqual(calls[1]?.args, ["/tmp/notify.sh"]);
    assert.equal(calls[1]?.options.cwd, "/tmp/project");
    assert.equal(calls[1]?.options.env?.DURATION, "2");
    assert.equal(calls[1]?.options.env?.STATUS, "completed");
    assert.equal(calls[1]?.options.env?.BODY, "Task finished successfully.");
    assert.equal(calls[1]?.options.env?.TITLE, "Fix login bug");
  }
);

test("resolveSettings reads streamIdleTimeoutMs from settings and env with a 5-minute default", () => {
  const defaults = { model: "default-model", baseURL: "https://default.example.com" };

  assert.equal(resolveSettings({}, defaults, TEST_PROCESS_ENV).streamIdleTimeoutMs, DEFAULT_STREAM_IDLE_TIMEOUT_MS);
  assert.equal(DEFAULT_STREAM_IDLE_TIMEOUT_MS, 300_000);
  assert.equal(resolveSettings({ streamIdleTimeoutMs: 1500 }, defaults, TEST_PROCESS_ENV).streamIdleTimeoutMs, 1500);
  assert.equal(
    resolveSettings({ env: { STREAM_IDLE_TIMEOUT_MS: "2000" } }, defaults, TEST_PROCESS_ENV).streamIdleTimeoutMs,
    2000
  );
  assert.equal(
    resolveSettings({ streamIdleTimeoutMs: -5 }, defaults, TEST_PROCESS_ENV).streamIdleTimeoutMs,
    DEFAULT_STREAM_IDLE_TIMEOUT_MS
  );
  assert.equal(
    resolveSettings({ streamIdleTimeoutMs: "not-a-number" }, defaults, TEST_PROCESS_ENV).streamIdleTimeoutMs,
    DEFAULT_STREAM_IDLE_TIMEOUT_MS
  );
});
