// Slash-command detection for the conversation flow (parseSlashCommand in
// renderer/components/message/UserMessage.tsx, user ask 2026-09-03 强化) —
// regression pins: a leading absolute path is NOT a command; "/word args"
// splits cleanly; plain prose never matches. Pure function — no DOM needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSlashCommand } from "../renderer/components/message/UserMessage";

test("plain slash command with no args", () => {
  assert.deepEqual(parseSlashCommand("/init"), { name: "init", args: "" });
});

test("slash command with args keeps them verbatim", () => {
  assert.deepEqual(parseSlashCommand("/model deepseek-v4-flash high"), {
    name: "model",
    args: "deepseek-v4-flash high",
  });
});

test("leading absolute path is NOT a command (second slash in first token)", () => {
  assert.equal(parseSlashCommand("/Volumes/data/dev look at this"), null);
});

test("windows absolute path is NOT a command", () => {
  assert.equal(parseSlashCommand("D:\\repo\\file.txt"), null);
  assert.equal(parseSlashCommand("/repo/sub"), null);
});

test("plain prose without a leading slash never matches", () => {
  assert.equal(parseSlashCommand("run /init later"), null);
  assert.equal(parseSlashCommand("hello world"), null);
});

test("command names may contain digits and dashes", () => {
  assert.deepEqual(parseSlashCommand("/compact-v2"), { name: "compact-v2", args: "" });
});
