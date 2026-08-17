/**
 * Public-HTTP-URL validation — the shared SSRF gate for every core-side
 * capability that fetches a user/model-supplied URL (WebFetch's rendered and
 * static paths, dembrandt's extraction targets, …).
 *
 * Rules: http/https only; no raw whitespace/control characters (a `new URL()`
 * would silently percent-encode them and smuggle a malformed host past the
 * check); the host must not be localhost, loopback, a private/reserved IPv4
 * range, or an IPv6 ULA/link-local address. Callers layer their own policy on
 * top (e.g. dembrandt's copyright denylist).
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
  const bracketless = host.replace(/^\[|\]$/g, "");
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
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    const blocked =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224;
    if (blocked) {
      return { ok: false, error: `refusing private/loopback/reserved address: ${host}` };
    }
  }
  if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(bracketless)) {
    return { ok: false, error: `refusing IPv6 ULA/link-local address: ${host}` };
  }
  return { ok: true, url: parsed.toString() };
}
