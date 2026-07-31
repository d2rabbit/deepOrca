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
