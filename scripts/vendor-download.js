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
 * Integrity (2026-08-27 hardening): `download` accepts an expected sha256
 * (GitHub asset digest / PyPI digests.sha256 / HF LFS oid) and refuses to
 * keep bytes that do not match — proxies and mirrors are third parties, the
 * artifact hash is the only end-to-end attestation. Redirects are pinned to
 * https so a malicious hop cannot downgrade the fetch.
 *
 * Usage:
 *   import { download, GITHUB_PROXY } from "./vendor-download.js";
 *   await download("https://github.com/owner/repo/releases/download/v1.0/asset.tar.gz", dest);
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, rmSync } from "node:fs";
import { basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { URL } from "node:url";

export const GITHUB_PROXY = "https://githubdog.com/";
export const GITCLONE_MIRROR = "https://gitclone.com/";

/**
 * Reserved/private IPv4 test on a dotted-quad host string.
 * `192.0.0.0/24` only — do NOT match every `192.*.0.x`, those are public
 * IANA unicast space a legit download host could live on.
 */
function isReservedIpv4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

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
  // Trailing-dot FQDNs ("localhost.", "foo.localhost.") resolve identically
  // to their dotless forms and WHATWG URL keeps the dot — strip it before
  // every host check or the dot smuggles the host past them (core's
  // public-url.ts learned this in the 2026-08-17 adversarial review).
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error(`unsafe ${label}: non-public host: ${host}`);
  }
  // Literal IPs — v4 dotted and v6 (URL brackets already stripped).
  if (isReservedIpv4(host)) {
    throw new Error(`unsafe ${label}: reserved/private address: ${host}`);
  } else if (host.includes(":")) {
    const bare = host.replace(/^\[|\]$/g, "");
    // IPv4-mapped (::ffff:…) and NAT64 (64:ff9b::…) addresses embed a v4 —
    // route it through the same reserved-range rules so mapped loopback or
    // private cannot slip past the native-v6 checks below. Node's URL
    // re-renders dotted input in hex form (::ffff:7f00:1), so accept both
    // spellings and decode the hex words back to dotted octets.
    const embedded = bare.match(/^(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3}|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i);
    if (embedded) {
      const quad = embedded[1].includes(".")
        ? embedded[1]
        : `${(parseInt(embedded[2], 16) >> 8) & 0xff}.${parseInt(embedded[2], 16) & 0xff}.${(parseInt(embedded[3], 16) >> 8) & 0xff}.${parseInt(embedded[3], 16) & 0xff}`;
      if (isReservedIpv4(quad)) {
        throw new Error(`unsafe ${label}: reserved/private address: ${host}`);
      }
    } else if (bare === "::" || bare === "::1" || /^f[cd]/.test(bare) || /^fe[89ab]/.test(bare)) {
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
 * SHA-256 of a file, streamed (vendor artifacts run to ~118MB).
 * Companion to download(url, dest, log, expectedSha256) below.
 */
export async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/** Accept "sha256:<hex>", "<hex>", either case; return bare lowercase hex. */
function normalizeSha256(value) {
  const hex = value
    .replace(/^sha256:/i, "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`not a valid sha256 digest: ${JSON.stringify(value)}`);
  }
  return hex;
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
 *
 * SECURITY (M1 hardening): pass expectedSha256 (hex or "sha256:<hex>", e.g.
 * GitHub release-asset digest or PyPI digests.sha256) to verify the artifact
 * after download. On mismatch the partial file is DELETED and the download
 * fails — a tampered proxy/mirror must not survive into the vendor tree.
 * Callers that cannot obtain a digest may omit it (logged, unverified).
 */
export async function download(url, dest, log = console.log, expectedSha256 = null) {
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
  const expected = expectedSha256 ? normalizeSha256(expectedSha256) : null;
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
          // SECURITY (M2): the URL guard only sees the FIRST hop; pin redirects
          // to https so a malicious proxy cannot 302 the fetch down to plain
          // http (or an internal address scheme). Separate-argument form —
          // Windows System32 curl (7.83) rejects the "--proto-redir=https"
          // spelling.
          "--proto-redir",
          "https",
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
      if (expected) {
        const actual = await sha256File(dest);
        if (actual !== expected) {
          rmSync(dest, { force: true });
          throw new Error(`sha256 mismatch for ${candidate}: expected ${expected}, got ${actual}`);
        }
        log(`sha256 verified: ${basename(dest)}`);
      } else {
        log(`no sha256 digest available — downloaded unverified`);
      }
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
