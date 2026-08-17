import { test } from "node:test";
import assert from "node:assert/strict";
import { McpManager } from "../mcp/mcp-manager";
import { SYSTEM_PROMPT_SECTION_ORDER } from "../prompt";

/**
 * Prefix-consistency guard (dsh takeaways #13 / pre-production D4).
 *
 * The merged `tools:` array and the system prompt are part of the DeepSeek
 * prefix-cache contract: they must be BYTE-IDENTICAL regardless of the order
 * MCP servers connected/reconnected in. This guard exists so a future change
 * that drops the deterministic ordering (or reshuffles prompt sections) fails
 * here instead of silently invalidating every cached session prefix.
 *
 * Router note: this stabilizes the OUTPUT of routing only — selection itself
 * stays with SkillRouter/ToolRouter/RoutingFacade (frozen per session).
 */

type FakeToolEntry = {
  serverName: string;
  originalName: string;
  namespacedName: string;
  definition: {
    name: string;
    description: string;
    inputSchema: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
  client: null;
};

function fakeEntry(serverName: string, toolName: string): FakeToolEntry {
  return {
    serverName,
    originalName: toolName,
    namespacedName: `mcp__${serverName}__${toolName}`,
    definition: {
      name: toolName,
      description: `Tool ${toolName} on ${serverName}`,
      inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    },
    client: null,
  };
}

test("getMcpToolDefinitions is byte-identical across server discovery orders", () => {
  const entries = [
    fakeEntry("zeta", "query"),
    fakeEntry("alpha", "search"),
    fakeEntry("zeta", "build"),
    fakeEntry("mid", "run"),
    fakeEntry("alpha", "analyze"),
  ];
  const permutations = [
    [...entries],
    [...entries].reverse(),
    [entries[3]!, entries[0]!, entries[4]!, entries[2]!, entries[1]!],
  ];

  const serialized = permutations.map((order) => {
    const manager = new McpManager();
    (manager as unknown as { tools: FakeToolEntry[] }).tools = order;
    return JSON.stringify(manager.getMcpToolDefinitions());
  });

  assert.ok(serialized[0].length > 100, "non-trivial tool list");
  assert.equal(serialized[1], serialized[0], "reversed discovery order → identical bytes");
  assert.equal(serialized[2], serialized[0], "shuffled discovery order → identical bytes");
  // And it is actually name-sorted.
  const manager = new McpManager();
  (manager as unknown as { tools: FakeToolEntry[] }).tools = [...entries];
  const names = manager.getMcpToolDefinitions().map((tool) => tool.function.name);
  assert.deepEqual([...names].sort((a, b) => a.localeCompare(b)), names);
});

test("system prompt section order is declared and stable", () => {
  assert.deepEqual(SYSTEM_PROMPT_SECTION_ORDER, ["base", "toolSelectionGuide", "toolDocsHeader", "toolDocs"]);
});
