import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMcpSpawnSpec } from "../mcp/spawn-spec";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("createMcpSpawnSpec keeps non-Windows MCP launches shell-free", () => {
  assert.deepEqual(createMcpSpawnSpec("npx", ["-y", "@playwright/mcp@latest"], "darwin"), {
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    shell: false,
    windowsHide: true,
  });
});

test("createMcpSpawnSpec joins args without quoting when spaces are absent (Windows)", () => {
  assert.deepEqual(createMcpSpawnSpec("npx", ["-y", "@playwright/mcp@latest"], "win32"), {
    command: "npx -y @playwright/mcp@latest",
    args: [],
    shell: true,
    windowsHide: true,
  });
});

test("createMcpSpawnSpec spawns absolute-path executables without a shell on Windows", () => {
  // An absolute path (process.execPath, a vendored binary, a require.resolve'd
  // entry) can be spawned directly — no cmd.exe needed. This avoids relying on
  // ComSpec, which Electron's environment may not expose (spawn cmd.exe ENOENT).
  const spec = createMcpSpawnSpec(
    String.raw`C:\Program Files\nodejs\node.exe`,
    [String.raw`C:\tmp\mcp server.cjs`, 'a "quoted" value'],
    "win32"
  );

  assert.equal(spec.shell, false);
  assert.equal(spec.command, String.raw`C:\Program Files\nodejs\node.exe`);
  assert.deepEqual(spec.args, [String.raw`C:\tmp\mcp server.cjs`, 'a "quoted" value']);
});

test("createMcpSpawnSpec quotes Windows command paths and arguments for bare commands", () => {
  // Only bare command names (npx, …) need shell:true so cmd.exe can resolve them
  // via PATHEXT. Args are folded into the command string with cmd-safe quoting.
  const spec = createMcpSpawnSpec("npx", [String.raw`C:\tmp\mcp server.cjs`, 'a "quoted" value'], "win32");

  assert.equal(spec.command, String.raw`npx "C:\tmp\mcp server.cjs" "a \"quoted\" value"`);
  assert.deepEqual(spec.args, []);
});

test("createMcpSpawnSpec quotes Windows args with cmd metacharacters", () => {
  const spec = createMcpSpawnSpec(
    "npx",
    [
      "-y",
      "some-mcp",
      "--url=https://example.test?a=1&b=2",
      "--pipe=a|b",
      "--redirect=<in>out",
      "--caret=^value",
      "--group=(value)",
    ],
    "win32"
  );

  assert.equal(
    spec.command,
    [
      "npx",
      "-y",
      "some-mcp",
      '"--url=https://example.test?a=1&b=2"',
      '"--pipe=a|b"',
      '"--redirect=<in>out"',
      '"--caret=^value"',
      '"--group=(value)"',
    ].join(" ")
  );
  assert.deepEqual(spec.args, []);
});

test(
  "SDK Client starts a PATH-resolved cmd MCP server on Windows",
  { skip: process.platform !== "win32" },
  async () => {
    const serverDir = mkdtempSync(path.join(tmpdir(), "deepcode-mcp-probe-"));
    const originalPath = process.env.PATH;

    writeFileSync(path.join(serverDir, "mcp-probe.cmd"), '@echo off\r\nnode "%~dp0mcp-probe-server.cjs"\r\n');
    writeFileSync(
      path.join(serverDir, "mcp-probe-server.cjs"),
      [
        'const readline = require("node:readline");',
        "const rl = readline.createInterface({ input: process.stdin });",
        "function send(message) { process.stdout.write(`${JSON.stringify(message)}\\n`); }",
        'rl.on("line", (line) => {',
        "  const request = JSON.parse(line);",
        '  if (request.method === "initialize") {',
        '    send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "probe", version: "1.0.0" } } });',
        "    return;",
        "  }",
        '  if (request.method === "notifications/initialized") {',
        "    return;",
        "  }",
        '  if (request.method === "tools/list") {',
        '    send({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "probe_tool", inputSchema: { type: "object", properties: {} } }] } });',
        "    return;",
        "  }",
        "});",
      ].join("\n")
    );

    process.env.PATH = `${serverDir}${path.delimiter}${originalPath ?? ""}`;
    // Pass the bare command + args directly: cross-spawn (used by
    // StdioClientTransport) resolves PATHEXT on Windows itself.
    const transport = new StdioClientTransport({ command: "mcp-probe", args: [] });
    const client = new Client({ name: "test", version: "1.0" }, { capabilities: {} });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      assert.deepEqual(
        tools.map((tool) => tool.name),
        ["probe_tool"]
      );
    } finally {
      await client.close();
      process.env.PATH = originalPath;
      rmSync(serverDir, { recursive: true, force: true });
    }
  }
);
