#!/usr/bin/env node
// test-mcp-server.mjs — 最小 MCP stdio server（M2.3 本地联调桩）。
// 实现 initialize / tools/list / tools/call（echo 工具），newline-delimited JSON-RPC。

import { createInterface } from "node:readline";

const serverInfo = { name: "deeporca-test-server", version: "0.1.0" };

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

const tools = [
  {
    name: "echo",
    description: "Echo back the input text",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to echo" } },
      required: ["text"],
    },
  },
];

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  handle(msg);
});

function handle(msg) {
  const { id, method } = msg;
  switch (method) {
    case "initialize":
      write({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo,
        },
      });
      break;
    case "ping":
      write({ jsonrpc: "2.0", id, result: {} });
      break;
    case "tools/list":
      write({ jsonrpc: "2.0", id, result: { tools } });
      break;
    case "tools/call": {
      const text = msg.params?.arguments?.text ?? "";
      write({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `echo: ${text}` }],
          isError: false,
        },
      });
      break;
    }
    default:
      if (id !== undefined) {
        write({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
      }
  }
}
