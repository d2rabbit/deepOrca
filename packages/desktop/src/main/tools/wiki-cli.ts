/**
 * WikiCliController — desktop Adapter for WikiController.
 *
 * Spawns the vendored `openwiki` CLI (LangChain DeepAgents app). The CLI
 * lives at `packages/desktop/vendor/openwiki/dist/cli.js` with its own
 * isolated node_modules (187MB — kept vendored to avoid pulling @langchain/*
 * into DeepOrca's dependency graph).
 *
 * LLM credentials are passed via env vars (OPENAI_API_KEY / OPENAI_BASE_URL /
 * OPENWIKI_MODEL_ID). Language is derived from the app locale and passed via
 * the `--language` CLI flag so wiki pages are generated in the user's language.
 *
 * The --print flag is used to get structured output (progress + result) on
 * stdout instead of the interactive TUI.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { WikiController, WikiResult, ControllerProgress, SpawnTrackedResult } from "@deeporca/core";
import { getSerenaController, spawnTracked } from "@deeporca/core";
import { readWikiCompletionMarker } from "./wiki-marker";

const CONNECTOR_CONFIG_DIR = path.join(os.homedir(), ".openwiki", "connectors", "custom-mcp");
const CONNECTOR_CONFIG_FILE = path.join(CONNECTOR_CONFIG_DIR, "config.json");
const SERENA_CONNECTOR_DIR = path.join(os.homedir(), ".openwiki", "connectors", "serena-mcp");
const SERENA_CONNECTOR_FILE = path.join(SERENA_CONNECTOR_DIR, "config.json");

/**
 * Hard cap on one wiki run. The CLI's --print mode buffers ALL stdout until
 * exit, so a wedged child is indistinguishable from a slow one for the whole
 * run — without a cap the build spinner can run forever (real-machine report:
 * "half an hour and wiki still not done"). Default 60 min; override with
 * DEEPORCA_WIKI_TIMEOUT_MS (milliseconds).
 */
const WIKI_TIMEOUT_MS = Number(process.env.DEEPORCA_WIKI_TIMEOUT_MS ?? "") || 60 * 60 * 1000;

/**
 * Count .md pages under <root>/openwiki modified since `sinceMs`. openwiki
 * writes pages incrementally while its agent works, so mtimes are the only
 * REAL progress signal available mid-run — the heartbeat surfaces this count
 * ("已生成 N 个页面") instead of a bare elapsed timer. Returns -1 when the
 * tree can't be read (early init, permission error).
 */
function countRecentWikiPages(root: string, sinceMs: number): number {
  const stack: string[] = [path.join(root, "openwiki")];
  let count = 0;
  try {
    // Guard bounds the walk: openwiki trees are tens of dirs, not millions.
    for (let guard = 0; stack.length > 0 && guard < 2000; guard++) {
      const dir = stack.pop();
      if (!dir) break;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name.startsWith(".")) continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) stack.push(p);
        else if (ent.isFile() && ent.name.endsWith(".md")) {
          try {
            if (fs.statSync(p).mtimeMs >= sinceMs) count++;
          } catch {
            // File raced away mid-stat — ignore.
          }
        }
      }
    }
    return count;
  } catch {
    return -1;
  }
}

/** Total wiki topic pages currently on disk (the always-written index.md
 *  excluded) — the "did the run actually produce anything" check. */
function countWikiPages(root: string): number {
  try {
    const dir = path.join(root, "openwiki");
    let count = 0;
    const stack = [dir];
    while (stack.length > 0) {
      const d = stack.pop()!;
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) stack.push(p);
        else if (ent.isFile() && ent.name.endsWith(".md") && ent.name !== "index.md") count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

export class WikiCliController implements WikiController {
  constructor(
    private opts: {
      vendorEntry: string;
      nodeRunner: string;
      electronRunAsNode?: boolean;
      getProjectRoot?: () => string;
      getLlmCreds?: () => { apiKey?: string; baseURL?: string; model?: string };
      /** Auxiliary model creds (settings → 辅助模型). When the primary model's
       *  LLM stream dies mid-generation, the automatic retry switches here —
       *  gateway stream limits are often model/channel specific, so the same
       *  model would hit the same wall. */
      getAuxLlmCreds?: () => { apiKey?: string; baseURL?: string; model?: string } | null;
      getLanguage?: () => string | undefined;
    }
  ) {}

  isAvailable(): boolean {
    try {
      return fs.statSync(this.opts.vendorEntry).isFile();
    } catch {
      return false;
    }
  }

  async init(root: string, onProgress?: (p: ControllerProgress) => void): Promise<WikiResult> {
    this.configureCodegraphConnector(root);
    this.configureSerenaConnector(root);
    return this.run("init", root, onProgress);
  }

  async update(root: string, onProgress?: (p: ControllerProgress) => void): Promise<WikiResult> {
    this.configureCodegraphConnector(root);
    this.configureSerenaConnector(root);
    return this.run("update", root, onProgress);
  }

  /**
   * Write OpenWiki connector config so the wiki agent can consume CodeGraph MCP
   * as a knowledge source during wiki generation. Only writes when:
   *   1. A `.codegraph/` index exists in the project (stage 1 completed).
   *   2. CodeGraph's npm-shim.js is resolvable.
   * Non-fatal — wiki proceeds without CodeGraph context on any failure.
   */
  private configureCodegraphConnector(root: string): void {
    try {
      if (!fs.existsSync(path.join(root, ".codegraph"))) return;
      let shimPath: string;
      try {
        const pkgPath = require.resolve("@colbymchenry/codegraph/package.json");
        shimPath = path.join(path.dirname(pkgPath), "npm-shim.js");
        if (!fs.existsSync(shimPath)) return;
      } catch {
        return;
      }
      const config = {
        enabled: true,
        mode: "mcp-stdio",
        transport: {
          type: "stdio" as const,
          command: this.opts.nodeRunner,
          args: [shimPath, "serve", "--mcp"],
        },
        allowedTools: [
          "codegraph_explore",
          "codegraph_search",
          "codegraph_callers",
          "codegraph_callees",
          "codegraph_impact",
        ],
      };
      fs.mkdirSync(CONNECTOR_CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONNECTOR_CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
    } catch {
      // Non-fatal: wiki generation proceeds without CodeGraph context.
    }
  }

  /**
   * Write OpenWiki connector config for Serena MCP so the wiki agent can consume
   * Serena's symbol-level data (get_symbols_overview, find_symbol, find_referencing_symbols)
   * during wiki generation. Only writes when:
   *   1. A `.serena/` directory exists in the project.
   *   2. The SerenaController is injected and can build a server config.
   * Non-fatal — wiki proceeds without Serena context on any failure.
   */
  private configureSerenaConnector(root: string): void {
    try {
      if (!fs.existsSync(path.join(root, ".serena"))) return;
      const serenaController = getSerenaController();
      if (!serenaController) return;
      const serenaConfig = serenaController.buildMcpServerConfig(root);
      if (!serenaConfig) return;

      const config = {
        enabled: true,
        mode: "mcp-stdio",
        transport: {
          type: "stdio" as const,
          command: serenaConfig.command,
          args: serenaConfig.args,
        },
        env: serenaConfig.env ?? {},
        allowedTools: ["get_symbols_overview", "find_symbol", "find_referencing_symbols", "get_diagnostics_for_file"],
      };
      fs.mkdirSync(SERENA_CONNECTOR_DIR, { recursive: true });
      fs.writeFileSync(SERENA_CONNECTOR_FILE, JSON.stringify(config, null, 2), "utf8");
    } catch {
      // Non-fatal: wiki generation proceeds without Serena context.
    }
  }

  private async run(
    mode: "init" | "update",
    root: string,
    onProgress?: (p: ControllerProgress) => void
  ): Promise<WikiResult> {
    if (!this.isAvailable()) {
      throw new Error("OpenWiki is not bundled (vendor entry missing)");
    }

    const env: Record<string, string> = {};
    if (this.opts.electronRunAsNode) {
      env.ELECTRON_RUN_AS_NODE = "1";
    }

    // Inject LLM creds from project settings if available. NOTE: openwiki
    // reads OPENWIKI_MODEL_ID (not OPENWIKI_MODEL) — the wrong env name used
    // to leave the CLI on its built-in default model, which the configured
    // OpenAI-compatible endpoint (DeepSeek) rejects with a 400.
    const creds = this.opts.getLlmCreds?.();
    // Auxiliary model (settings → 辅助模型) for the stream-death retry below.
    // Usable only when actually configured, resolvable, and NOT the same
    // endpoint+model as the primary — switching to a twin would just hit the
    // same wall again.
    const auxCreds = this.opts.getAuxLlmCreds?.() ?? null;
    const auxUsable = Boolean(
      auxCreds &&
      auxCreds.model &&
      (auxCreds.apiKey || auxCreds.baseURL) &&
      (auxCreds.model !== (creds?.model ?? "") || auxCreds.baseURL !== creds?.baseURL)
    );

    // Use --print for structured non-interactive output (no TUI). Language is
    // a CLI flag (openwiki has no OPENWIKI_LANGUAGE env) so wiki pages are
    // generated in the user's language (BCP-47 from the app locale).
    const flag = mode === "init" ? "--init" : "--update";
    const args = [this.opts.vendorEntry, flag, "--print"];
    const lang = this.opts.getLanguage?.();
    if (lang) {
      args.push("--language", lang);
    }
    onProgress?.({ message: `wiki ${mode} started`, percent: 10 });

    // openwiki --print buffers ALL agent output and writes it at exit — during
    // a long run (10+ minutes on a large repo) stdout is completely silent.
    // The 20s heartbeat counts pages actually written so far from the
    // filesystem ("已生成 N 个页面" is real forward progress, not a ticking
    // timer) and watches openwiki's completion marker: .last-update.json with
    // status "complete" is the CLI's final act and authoritative even if the
    // process then hangs on exit — finishOk force-settles success then
    // (real-machine report: "wiki finished but the status never changed").
    let markerSeenAt = 0;
    let markerModel: string | undefined;

    // "terminated" (undici: connection aborted mid-stream) used to kill a
    // whole multi-minute generation with no recovery — the LLM gateway drops
    // long streams around the 5-minute mark (real-machine 2026-08-28: died
    // at 286s with minutes of work in flight). One automatic rerun: pages
    // are written incrementally, so a rerun either completes or fails with
    // the same localized hint — never worse than failing outright.
    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; ; attempt++) {
      const startedAtMs = Date.now();
      markerSeenAt = 0;
      markerModel = undefined;

      // Attempt 1 runs the primary model; the retry (when the auxiliary
      // model is configured and distinct) switches to it.
      const switching = attempt > 1 && auxUsable;
      const active = switching ? auxCreds! : creds;
      const attemptEnv: Record<string, string> = { ...env };
      if (active?.apiKey) attemptEnv.OPENAI_API_KEY = active.apiKey;
      if (active?.baseURL) attemptEnv.OPENAI_BASE_URL = active.baseURL;
      attemptEnv.OPENWIKI_MODEL_ID = active?.model ?? "deepseek-v4-flash";

      let result: SpawnTrackedResult;
      try {
        result = await spawnTracked({
          label: `wiki ${mode}`,
          command: this.opts.nodeRunner,
          args,
          cwd: root,
          env: attemptEnv,
          timeoutMs: WIKI_TIMEOUT_MS,
          heartbeatMs: 20_000,
          onHeartbeat: ({ elapsedSecs, finishOk }) => {
            const marker = readWikiCompletionMarker(root, startedAtMs - 5000);
            if (marker?.status === "complete") {
              if (markerSeenAt === 0) {
                markerSeenAt = Date.now();
                markerModel = marker.model;
                onProgress?.({ message: `wiki ${mode} 完成标记已收到（status: complete），等待 CLI 退出…` });
              } else if (Date.now() - markerSeenAt > 60_000) {
                // Work is DONE and recorded; only the exit is wedged (typically
                // pipe-inherited MCP connector children). Force-finish success —
                // a hung exit must never mask a completed wiki. Bilingual
                // progress lines (zh · en) — the console shows both, matching
                // the build pipeline's bilingual contract.
                onProgress?.({
                  message: `wiki ${mode} 退出卡住超过 60s，强制结束，构建按完成处理 / exit stuck >60s — force-killed, treated as complete`,
                });
                finishOk("完成标记已确认，强制结束卡住的退出 / completion marker confirmed, stuck exit force-killed");
              }
              return null;
            }
            const pages = countRecentWikiPages(root, startedAtMs - 5000);
            const pageText = pages >= 0 ? ` · 已生成 ${pages} 页 / ${pages} pages written` : "";
            onProgress?.({
              message:
                `wiki ${mode} 运行中 ${elapsedSecs}s / running ${elapsedSecs}s${pageText}` +
                " · 读取符号索引加速生成，LLM 阶段无进度流请耐心等待 / using the symbol index, no LLM progress stream",
            });
            return null;
          },
          onStdoutLine: (line) => onProgress?.({ message: `wiki: ${line.slice(0, 120)}` }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("超时")) {
          // Fix hint rides along as a machine-readable token — the renderer's
          // build-error formatter translates it into the UI locale (main has
          // no i18n runtime; see renderer/lib/build-error.ts).
          throw new Error(`${message} [hint:wiki-timeout]`);
        }
        throw err;
      }

      if (result.forcedOk || result.code === 0 || markerSeenAt > 0) {
        // A clean exit that produced ZERO topic pages is not a success — it is
        // the signature of an agent whose tool calls never landed (LangChain ×
        // /responses dialect mismatch, real-machine 2026-08-28: exit 0 in 6s
        // with an empty skeleton index). Fail loudly instead of reporting a
        // wiki that does not exist.
        if (mode === "init" && countWikiPages(root) === 0) {
          throw new Error("openwiki finished without writing any wiki pages [hint:wiki-empty]");
        }
        const exitNote =
          result.forcedOk || (result.code !== 0 && markerSeenAt > 0)
            ? `（${result.forcedNote ?? "完成标记已确认 / completion marker confirmed"}）`
            : "";
        onProgress?.({ message: `wiki ${mode} complete${exitNote}`, percent: 100 });
        // Try to parse model from stdout output (--print mode).
        const modelMatch = result.stdout.match(/model[:\s]+([^\s,]+)/i);
        return { ok: true, model: markerModel ?? modelMatch?.[1] ?? attemptEnv.OPENWIKI_MODEL_ID };
      }

      // Audit 2026-08-26: a bare "openwiki exited 1: terminated" was
      // unactionable — "terminated" is LangChain's network-error pattern
      // (undici connection aborted). The localized fix hint (model +
      // settings pointers; secrets never printed) is embedded as a
      // structured token the renderer translates — a second-stage
      // translation, because the LLM itself may be what's broken.
      const stderrMsg = result.stderr ? result.stderr.slice(0, 500) : "";
      // "Request timed out." is the OpenAI SDK's request-level timeout
      // (APIConnectionTimeoutError) — as transient as a mid-stream cut, and
      // the pattern the 2026-08-28 failure actually shipped with.
      const netFail =
        /^(terminated|fetch failed|Request timed out|Network request failed|The Internet connection appears to be offline)/i.test(
          result.stderr.trimStart()
        );
      if (netFail && attempt < MAX_ATTEMPTS) {
        onProgress?.({
          message: switching
            ? `wiki ${mode} 网络中断（LLM 流被断开），自动切换辅助模型 ${auxCreds?.model} 重试 / network drop — retrying on auxiliary model`
            : `wiki ${mode} 网络中断（LLM 流被断开），自动重试 / network drop — retrying (${attempt}/${MAX_ATTEMPTS - 1})`,
        });
        continue;
      }
      const modelId = attemptEnv.OPENWIKI_MODEL_ID;
      const hint = netFail ? ` [hint:wiki-network${modelId ? ` model=${modelId}` : ""}]` : "";
      throw new Error(
        `openwiki exited ${result.code}${result.signal ?? ""}${stderrMsg ? `: ${stderrMsg}` : ""}${hint}`
      );
    }
  }
}
