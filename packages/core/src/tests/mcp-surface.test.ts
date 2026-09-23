// specs/model-vendor-profiles P2.2 — 工具面收窄纯模块（mcp-surface）单测。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asDisclosureProxyCall,
  disclosureProxiesIfOverBudget,
  estimateToolSurfaceTokens,
  MCP_DISCLOSURE_BUDGET_RATIO,
  suppressRedundantModalityTools,
} from "../common/mcp-surface";
import type { ToolDefinition } from "../prompt";

function mcpTool(server: string, tool: string, description: string): ToolDefinition {
  return {
    type: "function",
    function: {
      name: `mcp__${server}__${tool}`,
      description,
      parameters: { type: "object", properties: { a: { type: "string" } } },
    },
  };
}

test("estimateToolSurfaceTokens: chars/4 over the JSON surface", () => {
  const tools = [mcpTool("s", "t", "x".repeat(400))];
  const estimate = estimateToolSurfaceTokens(tools);
  assert.ok(estimate >= 100, `estimate ${estimate} should reflect schema size`);
});

test("modality suppression: natively multimodal models drop the vision proxy server tools", () => {
  const tools = [mcpTool("vision", "vision_chat", "d"), mcpTool("serena", "find_symbol", "d")];
  const kept = suppressRedundantModalityTools(tools, { modelMultimodal: true, visionServerName: "vision" });
  assert.deepEqual(
    kept.map((tool) => tool.function.name),
    ["mcp__serena__find_symbol"]
  );
  // 非多模态模型：vision 工具是能力来源，原样保留。
  const keptForTextModel = suppressRedundantModalityTools(tools, {
    modelMultimodal: false,
    visionServerName: "vision",
  });
  assert.equal(keptForTextModel.length, 2);
});

test("modality suppression never empties the surface (all-vision falls back to full set)", () => {
  const tools = [mcpTool("vision", "vision_chat", "d")];
  const kept = suppressRedundantModalityTools(tools, { modelMultimodal: true, visionServerName: "vision" });
  assert.equal(kept.length, 1);
});

test("disclosure: under budget → null (no change); over budget → per-server proxy tools", () => {
  const tools = [
    mcpTool("serena", "find_symbol", "d"),
    mcpTool("serena", "replace_symbol", "d"),
    mcpTool("openwiki", "search", "d"),
  ];
  const small = { toolTokens: 100, contextWindowTokens: 1_000_000 };
  assert.equal(disclosureProxiesIfOverBudget(tools, small), null);

  const over = { toolTokens: 10 * 1_000_000 * MCP_DISCLOSURE_BUDGET_RATIO, contextWindowTokens: 1_000_000 };
  const proxied = disclosureProxiesIfOverBudget(tools, over);
  assert.ok(proxied, "over budget must produce proxies");
  const names = proxied!.map((tool) => tool.function.name);
  assert.deepEqual(names.sort(), ["mcp__openwiki", "mcp__serena"]);
  const serena = proxied!.find((tool) => tool.function.name === "mcp__serena")!;
  assert.deepEqual(serena.function.parameters.required, ["tool"]);
  const enumValues = ((serena.function.parameters.properties.tool as { enum?: string[] }) ?? {}).enum;
  assert.deepEqual(enumValues, ["find_symbol", "replace_symbol"]);
});

test("disclosure proxy dispatch: two-segment name + tool arg resolves; real names and junk rejected", () => {
  assert.deepEqual(asDisclosureProxyCall("mcp__serena", { tool: "find_symbol", arguments: { q: "x" } }), {
    server: "serena",
    tool: "find_symbol",
    toolArguments: { q: "x" },
  });
  // 三段式 = 真实 MCP 工具名，绝不按代理解析。
  assert.equal(asDisclosureProxyCall("mcp__serena__find_symbol", { tool: "x" }), null);
  assert.equal(asDisclosureProxyCall("mcp__serena", {}), null);
  assert.equal(asDisclosureProxyCall("mcp__", { tool: "x" }), null);
  // arguments 缺失/非对象 → 归一为空对象。
  assert.deepEqual(asDisclosureProxyCall("mcp__serena", { tool: "t" }), {
    server: "serena",
    tool: "t",
    toolArguments: {},
  });
});
