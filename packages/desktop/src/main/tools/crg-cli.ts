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
  hasCrgProject,
  CRG_DIR_NAME,
  CRG_LEGACY_DIR_NAME,
  type ControllerProgress,
  type ControllerSyncResult,
  type CrgController,
} from "@deeporca/core";

/** Hard cap on one graph build/update; override with DEEPORCA_CRG_TIMEOUT_MS. */
const CRG_TIMEOUT_MS = Number(process.env.DEEPORCA_CRG_TIMEOUT_MS ?? "") || 20 * 60 * 1000;

/**
 * Fallback package index for the CRG wheel's DEPENDENCY resolution (user
 * report 2026-09-01): the wheel itself is vendored, but `uv tool run` still
 * installs its dependencies (watchdog, tree-sitter-language-pack, …) from
 * the package index — and on some networks pypi.org is unreachable, so every
 * build failed ("Request failed … pypi.org/simple/watchdog/") and the review
 * tab degraded to "no CRG graph". When the first attempt fails on a
 * network-ish error, retry once through the Aliyun mirror.
 */
const PYPI_FALLBACK_INDEX = "https://mirrors.aliyun.com/pypi/simple/";

function looksLikeIndexFailure(result: { code: number | null; stderr: string; stdout: string }): boolean {
  const combined = `${result.stderr}\n${result.stdout}`;
  return /Request failed|Failed to fetch|timed out|getaddrinfo|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|error sending request/i.test(
    combined
  );
}

export class CrgCliController implements CrgController {
  constructor(
    private opts: {
      uvBinary: string;
      crgWheel: string; // path to vendored .whl, or PyPI spec like "code-review-graph==2.3.7"
    }
  ) {}

  hasProject(root: string): boolean {
    // graph.db existence, NOT the directory (aligned with core's
    // hasCrgProject): a build that failed midway leaves a bare directory, and
    // a directory-only check would then SKIP every rebuild — the review tab
    // would show "no CRG graph" forever (user report 2026-09-01).
    return hasCrgProject(root);
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
    let result = await this.spawnOnce(root, crgArgs, onProgress, undefined);
    if (!(result.forcedOk || result.code === 0) && looksLikeIndexFailure(result)) {
      onProgress?.({ message: "CRG: package index unreachable — retrying via mirrors.aliyun.com" });
      result = await this.spawnOnce(root, crgArgs, onProgress, PYPI_FALLBACK_INDEX);
    }
    if (result.forcedOk || result.code === 0) return;
    throw new Error(`CRG exited ${result.code}${result.signal ?? ""}: ${result.stderr.slice(0, 500)}`);
  }

  /**
   * The wheel spec WITH the `communities` extra — igraph-backed Leiden
   * community detection. Without it the build logs "igraph not available,
   * using file-based community detection" and the communities table stays
   * EMPTY: the review tab's 按社区 grouping had no data at all (user report
   * 2026-09-01). PEP 508 extras work on both local-wheel paths and PyPI specs.
   */
  private get wheelSpec(): string {
    const base = this.opts.crgWheel;
    return base.includes("[") ? base : `${base}[communities]`;
  }

  private async spawnOnce(
    root: string,
    crgArgs: string[],
    onProgress?: (p: ControllerProgress) => void,
    packageIndex?: string
  ) {
    return spawnTracked({
      label: `CRG ${crgArgs[0] ?? ""}`.trim(),
      command: this.opts.uvBinary,
      // --data-dir pins the graph into <root>/.deeporca/crg (generated-content
      // centralization) — supported by the vendored 2.3.7/2.3.8 wheels.
      args: [
        "tool",
        "run",
        "--from",
        this.wheelSpec,
        "code-review-graph",
        ...crgArgs,
        "--data-dir",
        path.join(root, CRG_DIR_NAME),
      ],
      cwd: root,
      timeoutMs: CRG_TIMEOUT_MS,
      heartbeatMs: 20_000,
      ...(packageIndex ? { env: { UV_DEFAULT_INDEX: packageIndex, UV_INDEX_URL: packageIndex } } : {}),
      onHeartbeat: ({ elapsedSecs }) => {
        onProgress?.({ message: `CRG: still building ${elapsedSecs}s (no progress stream during graph build)` });
        return null;
      },
      onStdoutLine: (line) => onProgress?.({ message: `CRG: ${line.slice(0, 120)}` }),
    });
  }
}
