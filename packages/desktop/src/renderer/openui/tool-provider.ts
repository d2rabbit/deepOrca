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

    /**
     * WP2.6 / 引擎补丁 A-1(design.md §4.4):计时源——原型里的真实倒计时。
     * 用法:`remaining = Query("design.clock", {startAt: $startAt, total: 1500}, {remaining: 1500}, 1)`
     * 工具持有起始时间戳,每次刷新按墙钟计算剩余秒,绑定表达式渲染;
     * Query 第 4 参 1 = 每秒重取。无 lang-core 新原语,零上游依赖。
     */
    "design.clock": async (args) => {
      const startAt = typeof args.startAt === "number" ? args.startAt : null;
      const total = typeof args.total === "number" ? args.total : null;
      if (startAt === null || total === null) return { error: "startAt (epoch ms) and total (seconds) required" };
      const elapsedSec = Math.max(0, Math.floor((Date.now() - startAt) / 1000));
      return {
        elapsed: elapsedSec,
        remaining: Math.max(0, total - elapsedSec),
        total,
        finished: elapsedSec >= total,
        // MM:SS 便捷字段,绑定表达式直接渲染。
        clock: (() => {
          const rem = Math.max(0, total - elapsedSec);
          return `${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, "0")}`;
        })(),
      };
    },
  };
}
