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
