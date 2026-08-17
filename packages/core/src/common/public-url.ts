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
