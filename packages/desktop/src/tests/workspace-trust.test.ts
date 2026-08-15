import { test } from "node:test";
import assert from "node:assert/strict";
import { readWorkspaceTrustStatus, writeWorkspaceTrust, toSettingsSummary } from "../main/session-bridge";
import { readProjectSettings } from "@deeporca/core";

// Desktop-side trust plumbing (specs/sandbox/tasks.md task 22 UI batch):
// helpers are pure settings I/O so they run without Electron or a bridge.

test("workspace trust helpers round-trip the project settings file", async () => {
  const { mkdtempSync, rmSync, realpathSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "deeporca-trust-ui-")));

  try {
    // No project file yet: default level, never asked.
    assert.deepEqual(readWorkspaceTrustStatus(workspace), { level: "trusted", explicit: false });

    writeWorkspaceTrust("quarantine", workspace);
    assert.deepEqual(readWorkspaceTrustStatus(workspace), { level: "quarantine", explicit: true });
    assert.equal(readProjectSettings(workspace)?.workspaceTrust, "quarantine");

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
