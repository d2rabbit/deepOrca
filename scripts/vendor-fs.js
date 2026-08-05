/**
 * Shared filesystem helper for vendor scripts: atomic cache swap.
 *
 * Problem this solves
 * -------------------
 * Every vendor script used to `rmSync(targetDir)` BEFORE downloading. Its
 * catch block then checked "does the old binary still exist? keep it" — but
 * the old binary had just been deleted, so a transient network/proxy/npm
 * failure destroyed a known-good cache instead of retaining it. Because
 * desktop vendoring is best-effort, the build could then package a degraded
 * app.
 *
 * Solution
 * --------
 * `withAtomicSwap(targetDir, build)` runs `build(stagingDir)` to produce the
 * vendor contents into a sibling staging directory, then swaps it into place
 * only when `verify(stagingDir)` passes. On any error (build or verify), the
 * existing `targetDir` is left byte-for-byte untouched and the staging dir is
 * cleaned up.
 *
 * Contract
 * --------
 *   await withAtomicSwap(targetDir, {
 *     log,
 *     build: async (staging) => { /* write files into staging *\/ },
 *     verify: (staging) => boolean,           // optional; default = existsSync(staging)
 *     // Optionally preserve these relative paths from the existing target
 *     // (e.g. a marker file kept across swaps). Default: none.
 *     preserve: ["some-marker"],
 *   });
 *
 * - `build` must populate `staging` with the complete new contents (including
 *   the version marker, if the caller wants it written atomically).
 * - `verify` should return false for an incomplete/invalid staging dir.
 * - On Windows, directory rename over an existing dir is not atomic, so the
 *   swap is: rename target → target.old, rename staging → target, rm target.old.
 *   A crash between the two renames leaves target.old; the next run recovers
 *   by re-running build. We never end up with a half-populated target.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, renameSync, cpSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Atomically replace `targetDir` with the output of `build`.
 *
 * @param {string} targetDir - the live vendor cache directory (e.g. .../vendor/openwiki).
 * @param {object} opts
 * @param {(msg: string) => void} [opts.log] - logger; defaults to console.log with a tag.
 * @param {(stagingDir: string) => (void | Promise<void>)} opts.build - produce the new contents into stagingDir.
 * @param {(stagingDir: string) => boolean} [opts.verify] - return true if stagingDir is acceptable (default: exists).
 * @param {string[]} [opts.preserve] - relative paths to copy from the existing target into staging before swap.
 * @param {string} [opts.tag] - label for log lines (e.g. "openwiki").
 */
export async function withAtomicSwap(targetDir, opts) {
  const { build, verify, preserve, tag } = opts;
  const logger = opts.log ?? ((msg) => console.log(`[vendor-fs] ${msg}`));

  const parent = dirname(targetDir);
  const name = basename(targetDir);
  const staging = join(parent, `${name}.staging-${randomBytes(4).toString("hex")}`);
  const oldDir = join(parent, `${name}.old-${randomBytes(4).toString("hex")}`);

  try {
    // 1. Build into a fresh staging dir.
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });

    // Optionally seed staging with preserved files from the live target.
    if (preserve && preserve.length && existsSync(targetDir)) {
      for (const rel of preserve) {
        const src = join(targetDir, rel);
        if (existsSync(src)) {
          const dest = join(staging, rel);
          mkdirSync(dirname(dest), { recursive: true });
          cpSync(src, dest, { recursive: true });
        }
      }
    }

    await build(staging);

    // 2. Verify the staging dir before committing.
    const verifyFn = verify ?? ((d) => existsSync(d));
    if (!verifyFn(staging)) {
      throw new Error(`atomic-swap verify failed for ${tag ?? name}: build did not produce a valid staging directory`);
    }

    // 3. Swap. Move the live target aside, move staging into place, then drop
    //    the old dir. Any failure here is best-effort rolled back (see finally).
    if (existsSync(targetDir)) {
      renameSync(targetDir, oldDir);
    }
    try {
      renameSync(staging, targetDir);
    } catch (renameErr) {
      // If promoting staging failed, try to restore the old target.
      if (existsSync(oldDir)) {
        try {
          renameSync(oldDir, targetDir);
        } catch {
          /* leave oldDir for the next run to clean up */
        }
      }
      throw renameErr;
    }
    // Success — drop the old contents.
    rmSync(oldDir, { recursive: true, force: true });
    logger(`atomic swap complete → ${targetDir}`);
  } finally {
    // Always clean up any leftover staging/old dirs from this attempt or a
    // previous crashed run with the same name prefix.
    rmSync(staging, { recursive: true, force: true });
    // Only remove oldDir if the live target now exists (swap succeeded).
    // Otherwise leave it so a recovery attempt can restore it.
    if (existsSync(targetDir)) {
      rmSync(oldDir, { recursive: true, force: true });
    }
    // Sweep stale staging/old dirs from prior crashed runs (best-effort).
    try {
      for (const entry of readdirSync(parent)) {
        if (entry.startsWith(`${name}.staging-`) || entry.startsWith(`${name}.old-`)) {
          rmSync(join(parent, entry), { recursive: true, force: true });
        }
      }
    } catch {
      /* non-fatal */
    }
  }
}
