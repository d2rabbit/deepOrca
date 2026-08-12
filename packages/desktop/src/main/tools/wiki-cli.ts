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
import type { WikiController, WikiResult, ControllerProgress } from "@deeporca/core";

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
    return this.run("init", root, onProgress);
  }

  async update(root: string, onProgress?: (p: ControllerProgress) => void): Promise<WikiResult> {
    return this.run("update", root, onProgress);
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
