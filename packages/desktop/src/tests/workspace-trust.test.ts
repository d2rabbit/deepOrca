import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPermissionSettings,
  readWorkspaceTrustStatus,
  writeWorkspaceTrust,
  toSettingsSummary,
} from "../main/session-bridge";
import { readProjectSettings } from "@deeporca/core";

// Desktop-side trust plumbing (specs/sandbox/tasks.md task 22 UI batch):
// helpers are pure settings I/O so they run without Electron or a bridge.

test("workspace trust helpers round-trip the project settings file", async () => {
  const { mkdtempSync, rmSync, realpathSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "deeporca-trust-ui-")));

  try {
    // No project file yet: default level, never asked.
    assert.deepEqual(readWorkspaceTrustStatus(workspace), { level: "trusted", explicit: false });

    writeWorkspaceTrust("quarantine", workspace);
    assert.deepEqual(readWorkspaceTrustStatus(workspace), { level: "quarantine", explicit: true });
    // The trust marker lives OUTSIDE the repo: the project settings file is
    // never touched (attacker-controlled content, review finding 2026-08-16).
    assert.equal(readProjectSettings(workspace), null);
    assert.equal(existsSync(join(workspace, ".deeporca", "settings.json")), false);

    // Explicit trust is a first-class state, not just an absent flag.
    writeWorkspaceTrust("trusted", workspace);
    assert.deepEqual(readWorkspaceTrustStatus(workspace), { level: "trusted", explicit: true });

    // The settings summary surfaces the resolved level for UI badges.
    assert.equal(toSettingsSummary(workspace).workspaceTrust, "trusted");
    writeWorkspaceTrust("quarantine", workspace);
    assert.equal(toSettingsSummary(workspace).workspaceTrust, "quarantine");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("settings-panel permission rebuild never wipes path-level grants (review R1)", () => {
  const preserve = {
    allowedWritePaths: ["/etc/app.conf"],
    allowedReadPaths: ["/var/log/x.log"],
  };
  const rebuilt = buildPermissionSettings("askAll", { network: "allow" }, preserve);
  assert.deepEqual(rebuilt.allowedWritePaths, ["/etc/app.conf"]);
  assert.deepEqual(rebuilt.allowedReadPaths, ["/var/log/x.log"]);
  assert.deepEqual(rebuilt.allow, ["network"]);
  assert.equal(rebuilt.defaultMode, "askAll");

  // Without prior path grants, nothing extra is emitted.
  const clean = buildPermissionSettings("allowAll", {});
  assert.equal("allowedWritePaths" in clean, false);
  assert.equal("allowedReadPaths" in clean, false);
});
