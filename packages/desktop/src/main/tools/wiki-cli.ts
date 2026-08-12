/**
 * WikiCliController — desktop Adapter for WikiController.
 *
 * Spawns the vendored `openwiki` CLI (LangChain DeepAgents app). The CLI
 * lives at `packages/desktop/vendor/openwiki/dist/cli.js` with its own
 * isolated node_modules (187MB — kept vendored to avoid pulling @langchain/*
 * into DeepOrca's dependency graph).
 *
 * LLM credentials are passed via env vars (OPENAI_API_KEY / OPENAI_BASE_URL /
 * OPENWIKI_MODEL) — the controller reads them from the current project settings.
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

    const flag = mode === "init" ? "--init" : "--update";
    onProgress?.({ message: `openwiki ${flag}`, percent: 10 });

    return new Promise<WikiResult>((resolve, reject) => {
      const child = spawn(this.opts.nodeRunner, [this.opts.vendorEntry, flag], {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stderrLines: string[] = [];

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
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
        resolve({ ok: true, model: env.OPENWIKI_MODEL });
      });
    });
  }
}
