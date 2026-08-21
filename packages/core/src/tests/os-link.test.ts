import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getOsLinkEntry,
  listOsLinkEntries,
  renderOsLinkDictionary,
  renderOsLinkPromptSection,
  OS_LINK_SHELLS,
} from "../common/os-link";
import { getStableRuntimeContext } from "../prompt";

test("dictionary entries are complete and uniquely keyed", () => {
  const ids = new Set<string>();
  for (const entry of listOsLinkEntries()) {
    assert.ok(entry.id.includes("."), `id ${entry.id} should be namespaced`);
    assert.ok(entry.title.length > 0, `${entry.id} needs a title`);
    assert.ok(!ids.has(entry.id), `duplicate id ${entry.id}`);
    ids.add(entry.id);
    for (const shell of OS_LINK_SHELLS) {
      const command = entry.commands[shell];
      assert.ok(command === null || command.length > 0, `${entry.id}.${shell} must be a command or null`);
    }
    // every entry must cover at least the bash column — it is the default execution shell
    assert.notEqual(entry.commands.bash, null, `${entry.id} must have a bash incantation`);
  }
});

test("lookup by semantic id", () => {
  const entry = getOsLinkEntry("proc.kill-port");
  assert.ok(entry);
  assert.match(entry.commands.cmd!, /taskkill/);
  assert.match(entry.commands.pwsh!, /Stop-Process/);
  assert.equal(getOsLinkEntry("no.such-op"), undefined);
});

test("rendered table marks the current shell and escapes pipes", () => {
  const table = renderOsLinkDictionary("bash");
  assert.match(table, /\| bash \(current\) \| cmd \| pwsh \|/);
  assert.match(table, /proc\.kill-port/);
  // cmd for-loops contain pipes — they must not break the markdown table
  const killPortRow = table.split("\n").find((line) => line.includes("proc.kill-port"));
  assert.ok(killPortRow?.includes("\\|"), "pipes inside commands must be escaped");
});

test("prompt section states the bash-default rule", () => {
  const section = renderOsLinkPromptSection();
  assert.match(section, /OS Command Dictionary \(os-link\)/);
  assert.match(section, /ALWAYS executes through bash/);
  assert.match(section, /Never emit cmd\.exe or PowerShell syntax into a bash tool call/);
});

test("stable runtime context embeds the dictionary and stays deterministic", () => {
  const first = getStableRuntimeContext("D:\\some\\project");
  const second = getStableRuntimeContext("D:\\some\\project");
  assert.equal(first, second, "byte-stable across calls (prefix-cache safety)");
  assert.match(first, /# OS Command Dictionary \(os-link\)/);
  assert.match(first, /\| fs\.mkdir /);
});
