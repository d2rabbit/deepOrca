/**
 * Designer tool provider — read-only local data access for OpenUI prototypes.
 *
 * These tools are exposed to prototypes via the SDK's `toolProvider` prop.
 * When a prototype contains `Query("design.readWiki", {...})`, the rendered
 * UI calls the matching function directly — zero LLM tokens, instant data.
 *
 * All tools are read-only and scoped to the design domain (`design.*` prefix).
 */

import { api } from "../api";

/** Tool function type matching @openuidev/react-lang's toolProvider contract. */
type ToolFn = (args: Record<string, unknown>) => Promise<unknown>;

/**
 * Create the designer tool provider. Returns a function map suitable for
 * `<Renderer toolProvider={...}>`.
 */
export function createDesignerToolProvider(): Record<string, ToolFn> {
  return {
    "design.projectRoot": async () => {
      return api.getProjectRoot();
    },

    "design.gitStatus": async () => {
      try {
        return await api.gitStatus();
      } catch {
        return { error: "git status unavailable" };
      }
    },

    "design.listCode": async (args) => {
      const dirPath = typeof args.path === "string" ? args.path : "";
      const res = await api.editorListFiles(dirPath);
      return res.entries ?? { error: res.error ?? "list failed" };
    },

    "design.readCode": async (args) => {
      const filePath = typeof args.path === "string" ? args.path : "";
      if (!filePath) return { error: "path required" };
      const res = await api.editorReadFile(filePath);
      return res.content ?? { error: res.error ?? "read failed" };
    },

    "design.readWiki": async (args) => {
      const name = typeof args.name === "string" ? args.name : "";
      if (!name) return { error: "name required" };
      const pages = await api.wikiListPages();
      const page = pages.find((p) => p.title === name || p.path.includes(name));
      if (!page) return { error: `wiki page '${name}' not found`, available: pages.map((p) => p.title) };
      return page;
    },

    "design.listWikiPages": async () => {
      return api.wikiListPages();
    },

    "design.memorySearch": async (args) => {
      const query = typeof args.query === "string" ? args.query : "";
      if (!query) return { error: "query required" };
      return api.memorySearch(query, 5);
    },
  };
}
