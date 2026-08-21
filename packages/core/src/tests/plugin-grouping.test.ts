import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionManager } from "../session";
import type { McpServerConfigEntry } from "../session";

/**
 * specs/ui-domain-regroup T2: the CRG (code-review-graph) MCP server must be
 * claimed by the code plugin group via the manifest `mcp:` declaration, so the
 * "other" catch-all bucket never receives it.
 */
test("code plugin group claims the CRG MCP server, the other bucket does not", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-plugin-grouping-"));
  try {
    const manager = new SessionManager({
      projectRoot: workspace,
      createOpenAIClient: () => ({ client: null, model: "test-model", thinkingEnabled: false }),
      getResolvedSettings: () => ({ model: "test-model" }),
      renderMarkdown: (text) => text,
      onAssistantMessage: () => {},
    });

    // Synthesized CRG entry exactly as plugin-mcp-view builds it.
    const crgEntry: McpServerConfigEntry = {
      name: "code-review-graph",
      config: { command: "node", args: ["crg-server.js"] },
      builtin: true,
      enabled: true,
    };
    const groups = manager.listBuiltinPluginGroups([], [crgEntry], []);

    const codeGroup = groups.find((g) => g.id === "code");
    assert.ok(codeGroup, "code plugin group exists");
    assert.ok(
      codeGroup.mcpServers.some((e) => e.name === "code-review-graph"),
      "CRG is claimed by the code plugin group (manifest mcp: declaration)"
    );

    const other = groups.find((g) => g.id === "other");
    assert.ok(
      !other || !other.mcpServers.some((e) => e.name === "code-review-graph"),
      "the other catch-all bucket never receives CRG"
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
