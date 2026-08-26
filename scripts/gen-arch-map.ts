/**
 * Generate the workspace architecture map by running the REAL arch-scan
 * background LLM task (specs/index-knowledge-rework R2-2 channel) against
 * this repo — same path the desktop build pipeline uses. Surfaces flush to
 * .deeporca/prototypes/arch-*.json.
 *
 * Usage: npx tsx scripts/gen-arch-map.ts [projectRoot]
 */
import { SessionManager, configureA2uiServerBuilder, createOpenAIClient, resolveCurrentSettings } from "@deeporca/core";
import { a2uiServerBuilder } from "../packages/desktop/src/main/tools/a2ui/index.js";

const root = process.argv[2] ? await import("node:path").then((p) => p.resolve(process.argv[2])) : process.cwd();

configureA2uiServerBuilder(a2uiServerBuilder);

const manager = new SessionManager({
  projectRoot: root,
  createOpenAIClient: (r?: string) => createOpenAIClient(r ?? root),
  getResolvedSettings: () => resolveCurrentSettings(root),
  renderMarkdown: (t: string) => t,
  onAssistantMessage: () => {},
});

await manager.initMcpServers();
console.log(`[gen-arch-map] running arch-scan over ${root} …`);
const result = await manager.runBackgroundLlmTask({
  skill: "arch-scan",
  root,
  onProgress: (m) => console.log(`[gen-arch-map] ${m}`),
});
console.log(`[gen-arch-map] done — iterations: ${result.iterations}`);
console.log(`[gen-arch-map] final: ${(result.content ?? "").slice(0, 400)}`);
manager.dispose();
