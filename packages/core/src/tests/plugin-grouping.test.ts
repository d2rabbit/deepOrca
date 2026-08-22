import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionManager } from "../session";
import type { McpServerConfigEntry } from "../session";

/**
 * specs/ui-domain-regroup T2 follow-up (2026-08-23): CRG (code-review-graph)
 * is retired from the MCP surface — queries go through the in-process
 * CrgGraphQuery SQLite reader, and the plugin center no longer lists it. The
 * code plugin group still claims its real MCP servers (codegraph, serena).
 */
test("code plugin group claims codegraph/serena; retired CRG MCP is never grouped", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-plugin-grouping-"));
  try {
    const manager = new SessionManager({
      projectRoot: workspace,
      createOpenAIClient: () => ({ client: null, model: "test-model", thinkingEnabled: false }),
      getResolvedSettings: () => ({ model: "test-model" }),
      renderMarkdown: (text) => text,
      onAssistantMessage: () => {},
    });

    const entries: McpServerConfigEntry[] = [
      { name: "codegraph", config: { command: "node", args: [] }, builtin: true, enabled: true },
      { name: "serena", config: { command: "uv", args: [] }, builtin: true, enabled: true },
    ];
    const groups = manager.listBuiltinPluginGroups([], entries, []);

    const codeGroup = groups.find((g) => g.id === "code");
    assert.ok(codeGroup, "code plugin group exists");
    const names = codeGroup.mcpServers.map((e) => e.name);
    assert.ok(names.includes("codegraph") && names.includes("serena"), `grouped: ${names}`);

    const other = groups.find((g) => g.id === "other");
    assert.ok(!other || other.mcpServers.length === 0, "other bucket stays empty");

    // The retired CRG name is absent from every group — it is filtered at the
    // desktop projection layer (isRetiredMcpName) before grouping ever sees it.
    for (const g of groups) {
      assert.ok(
        !g.mcpServers.some((e) => e.name === "code-review-graph"),
        `retired CRG must not appear in group "${g.id}"`
      );
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
