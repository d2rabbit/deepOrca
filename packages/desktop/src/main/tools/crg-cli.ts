/**
 * CrgCliController — desktop Adapter for CrgController.
 *
 * Spawns `uv tool run --from <wheel> code-review-graph build/update` for
 * graph construction. Uses @manzt/uv for the uv binary + vendored CRG wheel
 * for offline operation.
 *
 * Query operations (detectChanges, impactRadius, etc.) are handled by
 * CrgGraphQuery (Node.js direct SQLite read) — not by this controller.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CrgController, ControllerProgress } from "@deeporca/core";

export class CrgCliController implements CrgController {
  constructor(
    private opts: {
      uvBinary: string;
      crgWheel: string; // path to vendored .whl, or PyPI spec like "code-review-graph==2.3.7"
    }
  ) {}

  hasProject(root: string): boolean {
    return fs.existsSync(path.join(root, ".code-review-graph"));
  }

  async reindex(root: string, onProgress?: (p: ControllerProgress) => void): Promise<void> {
    // Delete existing graph, then full build.
    const graphDir = path.join(root, ".code-review-graph");
    if (fs.existsSync(graphDir)) {
      fs.rmSync(graphDir, { recursive: true, force: true });
    }
    onProgress?.({ message: "CRG: starting full build", percent: 5 });
    await this.spawnCrg(root, ["build"], onProgress);
    onProgress?.({ message: "CRG: build complete", percent: 100 });
  }

  async sync(root: string): Promise<void> {
    if (!this.hasProject(root)) return; // No graph → nothing to sync.
    await this.spawnCrg(root, ["update"], undefined);
  }

  private spawnCrg(root: string, crgArgs: string[], onProgress?: (p: ControllerProgress) => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = ["tool", "run", "--from", this.opts.crgWheel, "code-review-graph", ...crgArgs];
      const child = spawn(this.opts.uvBinary, args, {
        cwd: root,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stderrLines: string[] = [];

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        for (const line of text.split("\n")) {
          if (line.trim() && onProgress) {
            onProgress({ message: `CRG: ${line.slice(0, 120)}` });
          }
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderrLines.push(chunk.toString());
      });

      child.on("error", (err) => {
        reject(new Error(`CRG spawn failed: ${err.message}`));
      });

      child.on("close", (code) => {
        if (code !== 0) {
          const stderr = stderrLines.join("");
          reject(new Error(`CRG exited ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`));
          return;
        }
        resolve();
      });
    });
  }
}
