/**
 * Shared download utility for vendor scripts.
 *
 * Strategy per URL kind:
 * - git clone/fetch (`gitCloneUrls`): direct first, then the gitclone.com
 *   mirror (git-protocol acceleration, verified against gitclone.com's
 *   documented usage), then the githubdog proxy prefix.
 * - file downloads (`download`/`fetchText`): direct first, then githubdog.
 *   gitclone.com is deliberately NOT a file-download fallback — it only
 *   proxies git operations and answers HTTP 500 for release assets
 *   (probed 2026-08-27), so adding it would just burn the timeout.
 *
 * Usage:
 *   import { download, GITHUB_PROXY } from "./vendor-download.js";
 *   await download("https://github.com/owner/repo/releases/download/v1.0/asset.tar.gz", dest);
 */

import { execFileSync } from "node:child_process";
import { URL } from "node:url";

export const GITHUB_PROXY = "https://githubdog.com/";
export const GITCLONE_MIRROR = "https://gitclone.com/";

/**
 * SECURITY ( Mimosa constraint): only http/https leaves the machine, and the
 * host must be public — reject localhost, loopback, private and reserved
 * addresses so upstream-controlled strings can never aim a request at the
 * build host or an internal network.
 */
export function assertPublicHttpsUrl(url, label = "url") {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`unsafe ${label}: not a valid URL: ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`unsafe ${label}: only https is allowed: ${parsed.protocol}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error(`unsafe ${label}: non-public host: ${host}`);
  }
  // Literal IPs — v4 dotted and v6 (URL brackets already stripped).
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const reserved =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && Number(v4[3]) === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224;
    if (reserved) throw new Error(`unsafe ${label}: reserved/private address: ${host}`);
  } else if (host.includes(":")) {
    const bare = host.replace(/^\[|\]$/g, "");
    if (bare === "::" || bare === "::1" || /^f[cd]/.test(bare) || /^fe[89ab]/.test(bare)) {
      throw new Error(`unsafe ${label}: reserved/private address: ${host}`);
    }
  }
  return url;
}

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

/** Rewrite a github.com URL to its gitclone.com git-protocol mirror. */
function gitcloneMirror(url) {
  return url.replace(/^https:\/\/github\.com\//i, `${GITCLONE_MIRROR}github.com/`);
}

/**
 * Build candidate URLs: direct first, then proxied fallback for GitHub URLs.
 * (File downloads: gitclone.com intentionally absent — see module header.)
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
  // (security audit 2026-08-12 §4). URLs must be https with a public host.
  assertPublicHttpsUrl(url);
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
  // Windows curl uses schannel, whose certificate-revocation check fails
  // outright when the CRL/OCSP endpoints are unreachable (0x80092013) — that
  // killed otherwise-fine proxied downloads. Skip revocation on win32 only.
  const winNoRevoke = process.platform === "win32" ? ["--ssl-no-revoke"] : [];
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
          ...winNoRevoke,
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
  try {
    assertPublicHttpsUrl(url);
  } catch {
    return null;
  }
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
 * Build a git clone/fetch URL chain for GitHub repos: direct first, then the
 * gitclone.com mirror (git-protocol acceleration), then the githubdog proxy.
 * Returns an array of clone URLs to try in order.
 */
export function gitCloneUrls(githubUrl) {
  assertPublicHttpsUrl(githubUrl, "github url");
  const candidates = [githubUrl];
  if (githubUrl.startsWith("https://github.com/")) {
    candidates.push(gitcloneMirror(githubUrl));
    candidates.push(`${GITHUB_PROXY}${githubUrl}`);
  }
  return candidates;
}
