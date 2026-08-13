/**
 * WikiCliController — desktop Adapter for WikiController.
 *
 * Spawns the vendored `openwiki` CLI (LangChain DeepAgents app). The CLI
 * lives at `packages/desktop/vendor/openwiki/dist/cli.js` with its own
 * isolated node_modules (187MB — kept vendored to avoid pulling @langchain/*
 * into DeepOrca's dependency graph).
 *
 * LLM credentials are passed via env vars (OPENAI_API_KEY / OPENAI_BASE_URL /
 * OPENWIKI_MODEL). Language is derived from the app locale and passed via
 * OPENWIKI_LANGUAGE so wiki pages are generated in the user's language.
 *
 * The --print flag is used to get structured output (progress + result) on
 * stdout instead of the interactive TUI.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { WikiController, WikiResult, ControllerProgress } from "@deeporca/core";
import { getSerenaController } from "@deeporca/core";

const CONNECTOR_CONFIG_DIR = path.join(os.homedir(), ".openwiki", "connectors", "custom-mcp");
const CONNECTOR_CONFIG_FILE = path.join(CONNECTOR_CONFIG_DIR, "config.json");
const SERENA_CONNECTOR_DIR = path.join(os.homedir(), ".openwiki", "connectors", "serena-mcp");
const SERENA_CONNECTOR_FILE = path.join(SERENA_CONNECTOR_DIR, "config.json");

export class WikiCliController implements WikiController {
  constructor(
    private opts: {
      vendorEntry: string;
      nodeRunner: string;
      electronRunAsNode?: boolean;
      getProjectRoot?: () => string;
      getLlmCreds?: () => { apiKey?: string; baseURL?: string; model?: string };
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

    // Inject LLM creds from project settings if available.
    const creds = this.opts.getLlmCreds?.();
    if (creds?.apiKey) env.OPENAI_API_KEY = creds.apiKey;
    if (creds?.baseURL) env.OPENAI_BASE_URL = creds.baseURL;
    env.OPENWIKI_MODEL = creds?.model ?? "deepseek-v4-flash";

    // Language: derive from app locale so wiki pages are generated in the
    // user's language (OpenWiki reads OPENWIKI_LANGUAGE as BCP-47).
    const lang = this.opts.getLanguage?.();
    if (lang) {
      env.OPENWIKI_LANGUAGE = lang;
    }

    // Use --print for structured non-interactive output (no TUI).
    const flag = mode === "init" ? "--init" : "--update";
    const args = [this.opts.vendorEntry, flag, "--print"];
    onProgress?.({ message: `openwiki ${flag}`, percent: 10 });

    return new Promise<WikiResult>((resolve, reject) => {
      const child = spawn(this.opts.nodeRunner, args, {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stderrLines: string[] = [];
      const stdoutLines: string[] = [];

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdoutLines.push(text);
        for (const line of text.split("\n")) {
          if (line.trim()) {
            onProgress?.({ message: `wiki: ${line.slice(0, 120)}` });
          }
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderrLines.push(chunk.toString());
      });

      child.on("error", (err) => {
        reject(new Error(`openwiki spawn failed: ${err.message}`));
      });

      child.on("close", (code) => {
        if (code !== 0) {
          const stderr = stderrLines.join("");
          reject(new Error(`openwiki exited ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`));
          return;
        }
        onProgress?.({ message: `wiki ${mode} complete`, percent: 100 });
        // Try to parse model from stdout output (--print mode).
        const stdout = stdoutLines.join("");
        const modelMatch = stdout.match(/model[:\s]+([^\s,]+)/i);
        resolve({
          ok: true,
          model: modelMatch?.[1] ?? env.OPENWIKI_MODEL,
        });
      });
    });
  }
}
