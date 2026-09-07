import assert from "node:assert/strict";
import { test } from "node:test";
import {
  configureLspBridgeController,
  getLspBridgeController,
  type LspBridgeController,
} from "../actions/lsp-bridge-controller";
import {
  DEFAULT_LSP_DIAGNOSTICS_SETTINGS,
  resolveLspDiagnosticsSettings,
  resolveSettings,
  resolveSettingsSources,
  type LspDiagnosticsSettings,
} from "../settings";

test("lsp-bridge seam: configure/get/null roundtrip", () => {
  const fake: LspBridgeController = {
    buildMcpServerConfig: () => null,
    isAvailable: () => false,
  };
  configureLspBridgeController(fake);
  assert.equal(getLspBridgeController(), fake);
  configureLspBridgeController(null);
  assert.equal(getLspBridgeController(), null);
});

test("lsp-bridge settings: defaults are OFF/manual with the spec budgets", () => {
  assert.deepEqual(resolveLspDiagnosticsSettings(undefined), {
    enabled: false,
    trigger: "manual",
    maxDiagnostics: 10,
    idleTimeoutMs: 30000,
    perTurnMaxRequests: 20,
  });
  assert.equal(DEFAULT_LSP_DIAGNOSTICS_SETTINGS.enabled, false);
});

test("lsp-bridge settings: partial node merges onto defaults; garbage falls back", () => {
  const merged = resolveLspDiagnosticsSettings({
    lspDiagnostics: {
      enabled: true,
      maxDiagnostics: 3,
      idleTimeoutMs: -5,
      trigger: "warp" as LspDiagnosticsSettings["trigger"],
    },
  });
  assert.equal(merged.enabled, true);
  assert.equal(merged.maxDiagnostics, 3);
  assert.equal(merged.idleTimeoutMs, DEFAULT_LSP_DIAGNOSTICS_SETTINGS.idleTimeoutMs);
  assert.equal(merged.trigger, "manual");
  assert.equal(merged.perTurnMaxRequests, DEFAULT_LSP_DIAGNOSTICS_SETTINGS.perTurnMaxRequests);
});

test("lsp-bridge settings: resolved settings carry lspDiagnostics (regression: field was silently dropped by resolveSettingsSources, making the whole bridge unreachable)", () => {
  const defaults = { model: "deepseek-v4", baseURL: "https://example.com" };
  // User settings flow through the real resolution chain, not just the helper.
  const resolved = resolveSettings(
    { model: "deepseek-v4", lspDiagnostics: { enabled: true, trigger: "auto", maxDiagnostics: 5 } },
    defaults
  );
  assert.equal(resolved.lspDiagnostics.enabled, true);
  assert.equal(resolved.lspDiagnostics.trigger, "auto");
  assert.equal(resolved.lspDiagnostics.maxDiagnostics, 5);

  // A committable project file must NOT enable the bridge behind the user's
  // back — the quarantine clamp (untrusted workspace) strips its voice.
  const quarantined = resolveSettingsSources(
    { lspDiagnostics: { enabled: false } },
    { lspDiagnostics: { enabled: true, trigger: "auto" } },
    defaults,
    {},
    "quarantine"
  );
  assert.equal(quarantined.lspDiagnostics.enabled, false);
  assert.equal(quarantined.lspDiagnostics.trigger, "manual");

  // Explicitly trusted project settings override user settings.
  const trusted = resolveSettingsSources(
    { lspDiagnostics: { enabled: false } },
    { lspDiagnostics: { enabled: true, trigger: "auto" } },
    defaults
  );
  assert.equal(trusted.lspDiagnostics.enabled, true);
  assert.equal(trusted.lspDiagnostics.trigger, "auto");
});
