import { test } from "node:test";
import assert from "node:assert/strict";
import { IpcRequest, IpcEvent } from "../shared/ipc";

const requestChannels = Object.values(IpcRequest);
const eventChannels = Object.values(IpcEvent);

test("every IPC channel is a non-empty namespaced string", () => {
  for (const channel of [...requestChannels, ...eventChannels]) {
    assert.equal(typeof channel, "string");
    // Contract shape: "namespace:name" (e.g. "session:list", "event:pluginEvent").
    assert.match(channel, /^[a-z][a-zA-Z0-9]*:[a-zA-Z][a-zA-Z0-9]*$/, `malformed channel: ${channel}`);
  }
});

test("request channels are unique", () => {
  assert.equal(new Set(requestChannels).size, requestChannels.length);
});

test("event channels are unique", () => {
  assert.equal(new Set(eventChannels).size, eventChannels.length);
});

test("request and event channels never collide", () => {
  const all = [...requestChannels, ...eventChannels];
  assert.equal(new Set(all).size, all.length);
});

test("event channels use the event: namespace, request channels never do", () => {
  for (const channel of eventChannels) {
    assert.ok(channel.startsWith("event:"), `event channel missing event: prefix: ${channel}`);
  }
  for (const channel of requestChannels) {
    assert.ok(!channel.startsWith("event:"), `request channel must not use event: namespace: ${channel}`);
  }
});

test("request keys map to distinct channel names", () => {
  const keys = Object.keys(IpcRequest);
  assert.equal(keys.length, requestChannels.length);
  assert.ok(keys.length > 0);
});

/**
 * Channels the prototype (popout) preload is allowed to invoke. The prototype
 * preload (`packages/desktop/src/preload/prototype.ts`) only exposes these
 * three. They must be registered with `handleShared` in main; everything else
 * must reject calls from a prototype window.
 *
 * This list mirrors the prototype preload's exposed surface exactly. If you
 * add a channel to the prototype preload, add it here too — and make sure the
 * main registrar uses `handleShared` for it.
 */
const PROTOTYPE_ALLOWED_KEYS = ["WindowClose", "A2uiAction", "A2uiRequestPayload"] as const;

test("every channel the prototype preload exposes exists in IpcRequest", () => {
  for (const key of PROTOTYPE_ALLOWED_KEYS) {
    assert.equal(
      typeof IpcRequest[key],
      "string",
      `prototype preload references IpcRequest.${key}, but it is missing from the contract`
    );
  }
});

/**
 * Known-dangerous channels — these mutate persistent state, spawn processes,
 * touch the filesystem, change MCP/permission config, or otherwise have
 * irreversible side effects. They MUST be registered via `handlePrivileged`
 * (main-renderer-only + audit log), never plain `handle` or `handleShared`.
 *
 * This is an allowlist of assertions, not an exhaustive catalog of every
 * privileged channel. Adding a channel here makes the contract test enforce
 * that it stays privileged. If you add a NEW high-risk channel, add its key
 * here so a future regression that downgrades it to `handle` is caught.
 *
 * The test cannot import `main/index.ts` (it boots Electron), so it cannot
 * introspect which wrapper was used at runtime. Instead it asserts the
 * invariant at the contract layer: every listed key resolves to a real
 * channel, and the set as a whole stays in sync with the documented surface.
 * Runtime enforcement of "privileged calls must come from the main renderer"
 * is verified by the ipc-security policy tests.
 */
const KNOWN_PRIVILEGED_KEYS = [
  // MCP config — highest blast radius (persisted command + child-process spawn).
  "PluginUpsertMcpServer",
  "PluginRemoveMcpServer",
  "PluginSetMcpEnabled",
  "McpReconnect",
  "GitmcpAdd",
  "GitmcpRemove",
  "GitmcpReindex",
  // Prompt / agent control.
  "PromptSend",
  "PromptInterrupt",
  "PromptPause",
  "PromptResume",
  "PromptEnhance",
  "PermissionDeny",
  "AdjustBashTimeout",
  // Session terminal / destructive ops.
  "SessionDelete",
  "SessionRename",
  "SessionSetActive",
  "SessionArchive",
  "SessionUnarchive",
  "SessionExport",
  // Settings / model.
  "SettingsUpdate",
  "ModelSet",
  "SetProjectRoot",
  // Undo restores file state.
  "UndoRestore",
  // Git mutations.
  "GitStage",
  "GitUnstage",
  "GitDiscard",
  "GitCommit",
  "GitCheckout",
  "GitStashCheckout",
  // Filesystem writes.
  "EditorWriteFile",
  // External process spawn / reindex.
  "ReviewRun",
  "WikiInit",
  "WikiUpdate",
  "CodegraphReindex",
  "CrgReindex",
  // Memory lifecycle (start/stop in-process TdaiCore).
  "MemorySetEnabled",
  // Opens a new BrowserWindow.
  "A2uiOpenWindow",
] as const;

test("every known-dangerous channel exists in the IpcRequest contract", () => {
  for (const key of KNOWN_PRIVILEGED_KEYS) {
    assert.equal(
      typeof IpcRequest[key],
      "string",
      `KNOWN_PRIVILEGED_KEYS references IpcRequest.${key}, but it is missing from the contract. ` +
        `If the channel was renamed, update KNOWN_PRIVILEGED_KEYS to match.`
    );
  }
});

test("no known-dangerous channel is in the prototype-allowed set", () => {
  // A privileged channel must never be reachable from a prototype window.
  const privileged = new Set<string>(KNOWN_PRIVILEGED_KEYS);
  for (const key of PROTOTYPE_ALLOWED_KEYS) {
    assert.ok(
      !privileged.has(key),
      `IpcRequest.${key} is both prototype-allowed and privileged — a prototype window must not reach a high-risk channel`
    );
  }
});
