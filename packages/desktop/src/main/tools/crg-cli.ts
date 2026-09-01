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
import {
  spawnTracked,
  migrateLegacyCrgDir,
  CRG_DIR_NAME,
  CRG_LEGACY_DIR_NAME,
  type ControllerProgress,
  type ControllerSyncResult,
  type CrgController,
} from "@deeporca/core";

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
    // Canonical `.deeporca/crg/` OR the pre-centralization location (still
    // counted so sync adopts it on the next update instead of rebuilding).
    for (const dir of [CRG_DIR_NAME, CRG_LEGACY_DIR_NAME]) {
      if (fs.existsSync(path.join(root, dir))) return true;
    }
    return false;
  }

  async reindex(root: string, onProgress?: (p: ControllerProgress) => void): Promise<void> {
    // Delete existing graph (both locations — a legacy dir must not survive
    // as a resurrection source), then full build into the canonical dir.
    for (const dir of [CRG_DIR_NAME, CRG_LEGACY_DIR_NAME]) {
      const graphDir = path.join(root, dir);
      if (fs.existsSync(graphDir)) {
        fs.rmSync(graphDir, { recursive: true, force: true });
      }
    }
    onProgress?.({ message: "CRG: starting full build", percent: 5 });
    await this.spawnCrg(root, ["build"], onProgress);
    onProgress?.({ message: "CRG: build complete", percent: 100 });
  }

  async sync(root: string, onProgress?: (p: ControllerProgress) => void): Promise<ControllerSyncResult | void> {
    if (!this.hasProject(root)) return; // No graph → nothing to sync.
    // Adopt the legacy location first so the incremental update lands in the
    // canonical `.deeporca/` tree instead of forking a second graph.
    migrateLegacyCrgDir(root);
    // CRG's CLI has no machine-readable change counts — stream stdout as
    // progress lines and let the caller settle for "completed" semantics.
    await this.spawnCrg(root, ["update"], onProgress);
  }

  private async spawnCrg(root: string, crgArgs: string[], onProgress?: (p: ControllerProgress) => void): Promise<void> {
    const result = await spawnTracked({
      label: `CRG ${crgArgs[0] ?? ""}`.trim(),
      command: this.opts.uvBinary,
      // --data-dir pins the graph into <root>/.deeporca/crg (generated-content
      // centralization) — supported by the vendored 2.3.7/2.3.8 wheels.
      args: [
        "tool",
        "run",
        "--from",
        this.opts.crgWheel,
        "code-review-graph",
        ...crgArgs,
        "--data-dir",
        path.join(root, CRG_DIR_NAME),
      ],
      cwd: root,
      timeoutMs: CRG_TIMEOUT_MS,
      heartbeatMs: 20_000,
      onHeartbeat: ({ elapsedSecs }) => {
        onProgress?.({ message: `CRG: still building ${elapsedSecs}s (no progress stream during graph build)` });
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
