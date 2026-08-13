/**
 * Shared uv binary resolver — used by CRG, Serena, and SkillSpector.
 *
 * Extracted from common/crg.ts so all three Python-backed subsystems share a
 * single resolution path without coupling through the CRG module.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

let configuredUvVendorRoot: string | null = null;

/** Point the resolver at the vendored uv directory (desktop boot calls this). */
export function configureUvVendorRoot(root: string | null): void {
  configuredUvVendorRoot = root ? path.resolve(root) : null;
}

/**
 * Resolve the uv binary for the current platform. Prefers the vendored binary;
 * falls back to `uv`/`uvx` on PATH; last resort `uvx` bare.
 */
export function resolveUvBinary(): string | null {
  // 1. Vendored uv binary.
  if (configuredUvVendorRoot) {
    const uvPath = resolveVendoredUvPath(configuredUvVendorRoot);
    if (uvPath) {
      return uvPath;
    }
  }
  // 2. System uv on PATH.
  try {
    const found = execSync(process.platform === "win32" ? "where uv" : "which uv", {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (found) {
      return found.split("\n")[0].trim();
    }
  } catch {
    // uv not on PATH.
  }
  return null;
}

/** Locate the vendored uv binary inside the vendor root for the current platform. */
function resolveVendoredUvPath(vendorRoot: string): string | null {
  const { platform, arch } = process;
  let target: string;
  if (platform === "darwin") {
    target = arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  } else if (platform === "linux") {
    target = arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  } else if (platform === "win32") {
    target = arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  } else {
    return null;
  }

  const binaryName = platform === "win32" ? "uv.exe" : "uv";

  const candidates = [
    path.join(vendorRoot, target, `uv-${target}`, binaryName),
    path.join(vendorRoot, target, "uv", binaryName),
    path.join(vendorRoot, target, binaryName),
    path.join(vendorRoot, `uv-${target}`, binaryName),
    path.join(vendorRoot, binaryName),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}
