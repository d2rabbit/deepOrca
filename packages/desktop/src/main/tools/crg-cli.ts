/**
 * CrgCliController — desktop Adapter for CrgController.
 *
 * Spawns `uv tool run --from <wheel> code-review-graph build/update` for
 * graph construction. Uses @manzt/uv for the uv binary + vendored CRG wheel
 * for offline operation.
 *
 * Query operations (detectChanges, impactRadius, etc.) are handled by
 * CrgGraphQuery (Node.js direct SQLite read) — not by this controller.
 *
 * Runs through spawnTracked (hardened: exit-authoritative settlement, hard
 * timeout, heartbeat) — the code-review module must not repeat the
 * index-knowledge failure class where a pipe-holding grandchild or a wedged
 * child left the UI spinning forever with no completion signal.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnTracked, type CrgController, type ControllerProgress } from "@deeporca/core";

/** Hard cap on one graph build/update; override with DEEPORCA_CRG_TIMEOUT_MS. */
const CRG_TIMEOUT_MS = Number(process.env.DEEPORCA_CRG_TIMEOUT_MS ?? "") || 20 * 60 * 1000;

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

  private async spawnCrg(root: string, crgArgs: string[], onProgress?: (p: ControllerProgress) => void): Promise<void> {
    const result = await spawnTracked({
      label: `CRG ${crgArgs[0] ?? ""}`.trim(),
      command: this.opts.uvBinary,
      args: ["tool", "run", "--from", this.opts.crgWheel, "code-review-graph", ...crgArgs],
      cwd: root,
      timeoutMs: CRG_TIMEOUT_MS,
      heartbeatMs: 20_000,
      onHeartbeat: ({ elapsedSecs }) => {
        onProgress?.({ message: `CRG: 运行中 ${elapsedSecs}s（图谱构建无进度流，请耐心等待）` });
        return null;
      },
      onStdoutLine: (line) => onProgress?.({ message: `CRG: ${line.slice(0, 120)}` }),
    });
    if (result.forcedOk || result.code === 0) return;
    throw new Error(
      `CRG exited ${result.code}${result.signal ?? ""}${result.stderr ? `: ${result.stderr.slice(0, 500)}` : ""}`
    );
  }
}
