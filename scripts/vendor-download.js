/**
 * Shared download utility for vendor scripts.
 *
 * Strategy: try direct download first (short timeout, fail fast). On failure,
 * retry with the githubdog proxy prefix (longer timeout for large files).
 * This mirrors the local git config approach but is scoped to vendor scripts.
 *
 * Usage:
 *   import { download, GITHUB_PROXY } from "./vendor-download.js";
 *   await download("https://github.com/owner/repo/releases/download/v1.0/asset.tar.gz", dest);
 */

import { execFileSync } from "node:child_process";

export const GITHUB_PROXY = "https://githubdog.com/";

/**
 * SECURITY: validate a version/tag before it flows into file paths or child
 * process arguments (security audit 2026-08-12 §4). Env vars and upstream
 * release metadata are externally influenceable; reject anything that is not
 * a plain semver-ish tag.
 */
export function assertSafeVersion(version, label = "version") {
  if (typeof version !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(version)) {
    throw new Error(`unsafe ${label}: ${JSON.stringify(version)}`);
  }
  return version;
}

/**
 * Build candidate URLs: direct first, then proxied fallback for GitHub URLs.
 */
export function withProxyFallback(url) {
  const candidates = [url];
  if (url.startsWith("https://github.com/")) {
    candidates.push(`${GITHUB_PROXY}${url}`);
  }
  return candidates;
}

/**
 * Download a URL to a file path using curl.
 * Tries direct first (60s max), then proxy fallback (600s max for large files).
 */
export async function download(url, dest, log = console.log) {
  // SECURITY: argv form, never a shell string — URL/dest are interpolated
  // values (env vars, upstream release metadata) and must not be shell-parsed
  // (security audit 2026-08-12 §4). URLs must be https.
  const candidates = withProxyFallback(url).filter((candidate) => {
    if (!/^https:\/\//i.test(candidate)) {
      log(`refusing non-https download URL: ${candidate}`);
      return false;
    }
    return true;
  });
  if (candidates.length === 0) {
    throw new Error(`no acceptable https download URL for ${url}`);
  }
  let lastError = null;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const isProxy = i > 0;
    const maxTime = isProxy ? 600 : 60;
    log(`downloading ${candidate}`);
    try {
      execFileSync(
        "curl",
        [
          "-L",
          "--fail",
          "--retry",
          "2",
          "--connect-timeout",
          "15",
          "--max-time",
          String(maxTime),
          "-o",
          dest,
          candidate,
        ],
        { stdio: "inherit" }
      );
      return; // success
    } catch (error) {
      lastError = error;
      if (i < candidates.length - 1) {
        log(`direct download failed, trying proxy …`);
      }
    }
  }
  throw lastError ?? new Error("download failed");
}

/**
 * Fetch a text resource (e.g. version API, SHA256SUMS) with proxy fallback.
 * Returns the text content, or null if all candidates fail.
 */
export async function fetchText(url, _log = console.log) {
  const candidates = withProxyFallback(url);
  for (const candidate of candidates) {
    try {
      const resp = await fetch(candidate, {
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
      });
      if (resp.ok) {
        return await resp.text();
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Build a git clone URL with proxy fallback for GitHub repos.
 * Returns an array of clone URLs to try in order.
 */
export function gitCloneUrls(githubUrl) {
  const candidates = [githubUrl];
  if (githubUrl.startsWith("https://github.com/")) {
    candidates.push(`${GITHUB_PROXY}${githubUrl}`);
  }
  return candidates;
}
