/**
 * Shared uv binary resolver — used by CRG, Serena, and SkillSpector.
 *
 * Extracted from common/crg.ts so all three Python-backed subsystems share a
 * single resolution path without coupling through the CRG module.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

let configuredUvVendorRoot: string | null = null;

/** Point the resolver at the vendored uv directory (desktop boot calls this). */
export function configureUvVendorRoot(root: string | null): void {
  configuredUvVendorRoot = root ? path.resolve(root) : null;
}

/**
 * SECURITY (scan fix, CWE-78): a uv candidate may come from a PATH lookup
 * (external output). Before it can be returned to callers that spawn it, it
 * must be an existing absolute `uv`/`uv.exe` binary with no traversal
 * segments.
 */
function isSafeUvBinary(bin: string): boolean {
  if (!bin || !path.isAbsolute(bin)) return false;
  if (bin.split(/[\\/]/).includes("..")) return false;
  const base = path.basename(bin).toLowerCase();
  if (base !== "uv" && base !== "uv.exe") return false;
  try {
    return fs.statSync(bin).isFile();
  } catch {
    return false;
  }
}

/** True when `candidate` resolves to a path lexically inside `root`. */
function isWithinRoot(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Resolve the uv binary for the current platform. Prefers the vendored binary;
 * falls back to `uv`/`uvx` on PATH; last resort `uvx` bare.
 */
export function resolveUvBinary(): string | null {
  // 1. Vendored uv binary (containment-checked inside resolveVendoredUvPath).
  if (configuredUvVendorRoot) {
    const uvPath = resolveVendoredUvPath(configuredUvVendorRoot);
    if (uvPath) {
      return uvPath;
    }
  }
  // 2. System uv on PATH — argv-form lookup, then validate before returning.
  try {
    const found = (
      process.platform === "win32"
        ? execFileSync("where", ["uv"], {
            encoding: "utf8",
            timeout: 3000,
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true,
          })
        : execFileSync("which", ["uv"], {
            encoding: "utf8",
            timeout: 3000,
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true,
          })
    ).trim();
    const first = found.split("\n")[0].trim();
    // SECURITY (scan fix): PATH output is externally influenced — only a
    // validated absolute uv binary is returned to the spawn sites.
    if (first && isSafeUvBinary(first)) {
      return first;
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
      // SECURITY (scan fix): containment check — the resolved binary must be a
      // validated uv executable that still lives inside the vendored root.
      if (fs.statSync(candidate).isFile() && isWithinRoot(vendorRoot, candidate) && isSafeUvBinary(candidate)) {
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}
