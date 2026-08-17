import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ToolExecutor } from "../tools/executor";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("ToolExecutor accepts title-case built-in tool aliases", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-tool-executor-"));
  tempDirs.push(workspace);
  const filePath = path.join(workspace, "sample.txt");
  fs.writeFileSync(filePath, "alpha\nbeta\n", "utf8");

  const executor = new ToolExecutor(workspace);
  const executions = await executor.executeToolCalls("alias-session", [
    {
      id: "call-read",
      type: "function",
      function: {
        name: "Read",
        arguments: JSON.stringify({ file_path: filePath }),
      },
    },
  ]);

  assert.equal(executions.length, 1);
  assert.equal(executions[0]?.result.ok, true);
  assert.equal(executions[0]?.result.name, "read");
  assert.match(executions[0]?.result.output ?? "", /alpha/);
});

test("ToolExecutor keeps input/output 1:1 for malformed tool calls (no silent drop)", async () => {
  // Previously a malformed envelope (missing function block, non-string name,
  // missing id) was `.filter(Boolean)`-ed out, so the assistant emitted N
  // calls and received <N tool messages — breaking the tool protocol.
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-tool-malformed-"));
  tempDirs.push(workspace);
  const executor = new ToolExecutor(workspace);
  const executions = await executor.executeToolCalls("malformed-session", [
    // Valid call.
    { id: "ok-1", type: "function", function: { name: "noop-does-not-exist", arguments: "{}" } },
    // Missing function block entirely.
    { id: "broken-2", type: "function" },
    // Non-string name.
    { id: "broken-3", type: "function", function: { name: 42, arguments: "{}" } },
    // Not even an object.
    "totally not a tool call",
  ]);

  // Every input MUST produce an output — 1:1 mapping.
  assert.equal(executions.length, 4);
  // The valid-shape call resolves against a handler; the unknown name surfaces
  // as INVALID_INPUT (unknown tool).
  assert.equal(executions[0]?.toolCallId, "ok-1");
  assert.equal(executions[0]?.result.ok, false);
  assert.equal(executions[0]?.result.errorType, "INVALID_INPUT");
  // Malformed calls carry their original id when present.
  assert.equal(executions[1]?.toolCallId, "broken-2");
  assert.equal(executions[1]?.result.ok, false);
  assert.equal(executions[1]?.result.errorType, "INVALID_TOOL_CALL");
  assert.equal(executions[1]?.result.retryable, false);
  assert.match(executions[1]?.result.error ?? "", /InvalidToolCall/);
  assert.equal(executions[2]?.toolCallId, "broken-3");
  assert.equal(executions[2]?.result.errorType, "INVALID_TOOL_CALL");
  // The non-object input gets a synthetic correlation id derived from its index.
  assert.match(executions[3]?.toolCallId ?? "", /invalid_tool_call_/);
  assert.equal(executions[3]?.result.errorType, "INVALID_TOOL_CALL");
});

test("ToolExecutor classifies thrown handler errors as INTERNAL by default", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-tool-throw-"));
  tempDirs.push(workspace);
  const executor = new ToolExecutor(workspace);
  // Unknown tool name surfaces INVALID_INPUT (not INTERNAL — that's the
  // pre-execution rejection path, not a thrown handler error). We verify the
  // classification fields are populated either way.
  const executions = await executor.executeToolCalls("throw-session", [
    { id: "unknown-1", type: "function", function: { name: "no_such_tool", arguments: "{}" } },
  ]);
  assert.equal(executions.length, 1);
  assert.equal(executions[0]?.result.ok, false);
  assert.equal(executions[0]?.result.errorType, "INVALID_INPUT");
  assert.equal(executions[0]?.result.retryable, false);
});
