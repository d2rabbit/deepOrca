/**
 * Public-HTTP-URL validation — the shared SSRF gate for every core-side
 * capability that fetches a user/model-supplied URL (WebFetch's rendered and
 * static paths, dembrandt's extraction targets, …).
 *
 * Rules: http/https only; no raw whitespace/control characters (a `new URL()`
 * would silently percent-encode them and smuggle a malformed host past the
 * check); the host must not be localhost/loopback, a private/reserved IPv4
 * range (dotted OR IPv4-mapped-IPv6 form), or an IPv6 ULA/link-local address.
 *
 * Normalization hardening (adversarial review 2026-08-17 round 2): trailing-dot
 * FQDNs ("localhost.", "example.com.") resolve identically to their dotless
 * forms and are stripped before every host check; IPv6-specific checks run
 * only on actual IPv6 literals (hostnames starting with fc/fd are ordinary
 * domains); IPv4-mapped IPv6 addresses are unwrapped to dotted form so
 * "::ffff:127.0.0.1" cannot sidestep the IPv4 ranges. Callers layer their own
 * policy on top (e.g. dembrandt's copyright denylist).
 */

import { lookup as dnsLookup } from "node:dns/promises";

export type DnsLookupFn = (
  hostname: string,
  options: { all: true; verbatim: true }
) => Promise<Array<{ address: string; family: number }>>;

let activeLookup: DnsLookupFn = dnsLookup;

/**
 * Test seam ONLY: swaps the resolver used by {@link assertPublicResolvedHost}
 * so unit tests stay hermetic (no real DNS). Passing null restores the
 * platform resolver.
 */
export function setPublicUrlDnsLookup(lookup: DnsLookupFn | null): void {
  activeLookup = lookup ?? dnsLookup;
}

export type PublicUrlCheck = { ok: true; url: string } | { ok: false; error: string };

export function validatePublicHttpUrl(raw: string): PublicUrlCheck {
  let parsed: URL;
  const trimmed = raw.trim();
  // An input that already carries a scheme must be http/https — otherwise a
  // scheme-less default of https would smuggle "ftp://…" through as host "ftp".
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return { ok: false, error: `only http/https URLs are allowed` };
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  // Reject raw whitespace/control characters up front — `new URL()` silently
  // percent-encodes them, which would smuggle a malformed host past the check.
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(candidate)) {
    return { ok: false, error: `invalid URL: ${raw}` };
  }
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: `invalid URL: ${raw}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: `only http/https URLs are allowed` };
  }
  const host = parsed.hostname.toLowerCase();
  // Trailing-dot FQDN: "localhost." and "foo.localhost." reach this handler
  // verbatim (WHATWG URL keeps the dot) and resolve to the dotless host.
  const bracketless = host.replace(/^\[|\]$/g, "").replace(/\.+$/, "");

  if (
    bracketless === "localhost" ||
    bracketless.endsWith(".localhost") ||
    bracketless === "::1" ||
    bracketless === "0.0.0.0" ||
    bracketless === "0"
  ) {
    return { ok: false, error: `refusing non-public host: ${host}` };
  }

  const ipv4 = bracketless.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4 && isBlockedIpv4(Number(ipv4[1]), Number(ipv4[2]))) {
    return { ok: false, error: `refusing private/loopback/reserved address: ${host}` };
  }

  // IPv6-literal checks ONLY for actual literals — a ":" is unambiguous here
  // because the dotted-IPv4 and name forms were handled above. (Running the
  // ULA prefix test on names would reject ordinary domains like fdroid.org.)
  if (bracketless.includes(":")) {
    if (bracketless === "::") {
      return { ok: false, error: `refusing unspecified address: ${host}` };
    }
    // IPv4-mapped ("::ffff:127.0.0.1", canonicalized by URL to the hex form
    // "::ffff:7f00:1") routes to the embedded IPv4 target — unwrap it.
    const mapped = /^::ffff:([0-9a-f]{1,4})(?::([0-9a-f]{1,4}))?$/i.exec(bracketless);
    if (mapped) {
      // The blocked-range rules are all decided by the first two octets.
      const w1 = parseInt(mapped[1], 16);
      const a = (w1 >> 8) & 0xff;
      const b = w1 & 0xff;
      if (isBlockedIpv4(a, b)) {
        return { ok: false, error: `refusing private/loopback/reserved address: ${host}` };
      }
    } else if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(bracketless)) {
      return { ok: false, error: `refusing IPv6 ULA/link-local address: ${host}` };
    }
  }
  return { ok: true, url: parsed.toString() };
}

/** Private / loopback / reserved / link-local / multicast IPv4 leading-octet rules. */
function isBlockedIpv4(a: number, b: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/**
 * Post-resolution SSRF re-check (P2 hardening 2026-08-27): the lexical gate
 * above never saw DNS, so "attacker.example" resolving straight to
 * 127.0.0.1 / 169.254.169.254 / RFC1918 sailed through. Callers MUST invoke
 * this right before every connect hop (initial URL AND each redirect) with
 * the hop's hostname; it resolves the name and pushes EVERY returned address
 * through the same range rules the literal checks use. A domain whose
 * *persistent* answer is an internal address is now dead; note the residual
 * classic-rebinding race (first query honest, second poisoned between this
 * check and the engine's own connect-time resolution) is only closable with a
 * connection-level pinning dispatcher — documented, accepted for now.
 *
 * Coverage note: wired into WebFetch's static and rendered paths. dembrandt's
 * extraction target (common/dembrandt.ts) still uses only the lexical gate —
 * its CLI renders via the isolated CDP child with no per-hop hook; treat that
 * as a known exception rather than a promise of this helper.
 */
export async function assertPublicResolvedHost(hostname: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  let records: Array<{ address: string; family: number }>;
  try {
    records = await activeLookup(host, { all: true, verbatim: true });
  } catch {
    // NXDOMAIN / unreachable resolver is a CONNECTIVITY problem, not SSRF
    // evidence — the request itself will fail right after. Fail-open here;
    // fail-CLOSED only when a resolution actually names a private address.
    return { ok: true };
  }
  if (records.length === 0) {
    return { ok: true };
  }
  for (const { address, family } of records) {
    if (family === 4) {
      const octets = address.split(".").map(Number);
      if (octets.length !== 4 || isBlockedIpv4(octets[0]!, octets[1]!)) {
        return { ok: false, error: `${host} resolves to private/loopback/reserved address ${address}` };
      }
      continue;
    }
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1" || /^(fc|fd|fe8|fe9|fea|feb)/.test(lower)) {
      return { ok: false, error: `${host} resolves to non-public IPv6 address ${address}` };
    }
    // IPv4-mapped IPv6 answers carry the embedded v4 target. getaddrinfo
    // prints these in dotted form ("::ffff:127.0.0.1", RFC 5952 §5) — handle
    // BOTH that and the hex-word canonical form ("::ffff:7f00:1").
    const dottedMapped = /^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
    if (dottedMapped) {
      if (isBlockedIpv4(Number(dottedMapped[1]), Number(dottedMapped[2]))) {
        return { ok: false, error: `${host} resolves to IPv4-mapped private address ${address}` };
      }
      continue;
    }
    const mapped = /^::ffff:([0-9a-f]{1,4})(?::([0-9a-f]{1,4}))?$/.exec(lower);
    if (mapped) {
      const w1 = parseInt(mapped[1], 16);
      if (isBlockedIpv4((w1 >> 8) & 0xff, w1 & 0xff)) {
        return { ok: false, error: `${host} resolves to IPv4-mapped private address ${address}` };
      }
    }
  }
  return { ok: true };
}
