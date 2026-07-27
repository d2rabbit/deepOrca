import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Central resolution for DeepOrca config locations, with backward
 * compatibility for legacy Deep Code installs:
 *
 * - If a legacy `.deepcode` directory exists at the given base, keep using it
 *   (structure is fully shared, so nothing needs migrating).
 * - Otherwise resolve to the new `.deeporca` directory (created lazily by
 *   whichever writer needs it).
 */

export const CONFIG_DIR_NAME = ".deeporca";
export const LEGACY_CONFIG_DIR_NAME = ".deepcode";

function resolveConfigRoot(base: string): string {
  const legacy = path.join(base, LEGACY_CONFIG_DIR_NAME);
  if (fs.existsSync(legacy)) {
    return legacy;
  }
  return path.join(base, CONFIG_DIR_NAME);
}

/** User-level config root: `~/.deepcode` when present, else `~/.deeporca`. */
export function getUserConfigRoot(): string {
  return resolveConfigRoot(os.homedir());
}

/** Project-level config root: `<root>/.deepcode` when present, else `<root>/.deeporca`. */
export function getProjectConfigRoot(projectRoot: string): string {
  return resolveConfigRoot(projectRoot);
}

/**
 * Reads an app environment variable with dual-prefix support:
 * `DEEPORCA_<suffix>` wins, `DEEPCODE_<suffix>` is the legacy fallback.
 */
export function getEnvVar(suffix: string): string | undefined {
  return process.env[`DEEPORCA_${suffix}`] ?? process.env[`DEEPCODE_${suffix}`];
}
