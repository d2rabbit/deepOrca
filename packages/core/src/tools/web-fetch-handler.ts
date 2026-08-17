/**
 * WebFetch — first-party built-in web page access for the agent.
 *
 * The fetch half of the search+fetch pair (WebSearch finds URLs, WebFetch
 * reads them). Two engines, one contract:
 *
 *   - Rendered mode (preferred): the host injects `fetchWebPage` — in the
 *     desktop app this is the hidden offscreen Electron-Chromium provider
 *     (main/tools/web-fetch-provider.ts), so JS-heavy pages render fully.
 *     Headless-equivalent: offscreen BrowserWindow, never shown.
 *   - Static fallback: plain HTTP fetch + tag-strip, used when no host
 *     fetcher is injected (tests, non-desktop hosts). No rendering — if the
 *     page builds its DOM in JS, the static text may be thin; the caller
 *     (the model) is told which engine ran.
 *
 * Privacy contract (same line as web-search-providers): only the target URL
 * is requested — no machine identifier, no telemetry, no proxy. Every URL
 * passes the shared SSRF gate (common/public-url.ts) before anything is
 * fetched, on BOTH engine paths, and every redirect hop is re-validated too
 * (static: manual redirect loop; rendered: the provider's will-redirect
 * guard).
 */

import { randomUUID } from "crypto";
import type { ToolExecutionContext, ToolExecutionResult } from "./executor";
import type { WebFetchPage } from "../common/tool-types";
import { validatePublicHttpUrl } from "../common/public-url";

export type { WebFetchPage, WebPageFetcher } from "../common/tool-types";

export const MAX_OUTPUT_CHARS = 30000;
export const MAX_LINKS = 20;
export const DEFAULT_TIMEOUT_MS = 15_000;

export async function handleWebFetchTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const url = typeof args.url === "string" ? args.url : "";
  if (!url.trim()) {
    return { ok: false, name: "WebFetch", error: 'Missing required "url" string.' };
  }

  // SSRF gate first — on every path, before anything is fetched.
  const target = validatePublicHttpUrl(url);
  if (!target.ok) {
    return { ok: false, name: "WebFetch", error: target.error };
  }

  const activityId = `web-fetch-${randomUUID()}`;
  context.onProcessStart?.(activityId, `WebFetch: ${target.url}`);
  try {
    const page = context.fetchWebPage
      ? await context.fetchWebPage(target.url, { timeoutMs: DEFAULT_TIMEOUT_MS })
      : await fetchPageStatic(target.url);
    return {
      ok: true,
      name: "WebFetch",
      output: formatWebFetchPage(page),
      metadata: { url: page.url, engine: page.engine, truncated: page.truncated },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, name: "WebFetch", error: `WebFetch failed for ${target.url}: ${message}` };
  } finally {
    context.onProcessExit?.(activityId);
  }
}

/** Static engine: plain HTTP fetch, HTML→text strip. No JS rendering.
 * Redirects are followed MANUALLY (≤ MAX_REDIRECTS hops) so every hop's
 * target passes the SSRF gate — a public URL 302-ing to a loopback/metadata
 * address is refused instead of followed (adversarial review round 2). */
const MAX_REDIRECTS = 5;
/** Only these statuses are followed (mirrors undici's redirect set); a 304
 * or 305 falls through to the final-response path and surfaces as "HTTP 3xx". */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function fetchPageStatic(url: string): Promise<WebFetchPage> {
  const controller = new AbortController();
  // The timer spans the WHOLE operation — headers AND body reads. Clearing it
  // on header arrival (the earlier shape) left `response.text()` unbounded:
  // a headers-then-stall server would hang the tool forever.
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    let current = url;
    let response: Response | undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      response = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`redirect without Location header (HTTP ${response.status})`);
        }
        if (hop === MAX_REDIRECTS) {
          throw new Error(`too many redirects (more than ${MAX_REDIRECTS})`);
        }
        const next = validatePublicHttpUrl(new URL(location, current).toString());
        if (!next.ok) {
          throw new Error(`redirect to non-public target refused: ${next.error}`);
        }
        current = next.url;
        continue;
      }
      break;
    }
    if (!response) {
      throw new Error("no response");
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
      throw new Error(`unsupported content-type "${contentType}" — WebFetch reads HTML/text pages only`);
    }
    const finalUrl = response.url && response.redirected ? response.url : current;
    const raw = await response.text();
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);

    const title = titleMatch ? stripTags(titleMatch[1]).trim() : "";
    const text = stripTags(extractBody(raw)).trim();
    const links = extractLinks(raw);

    const truncated = text.length > MAX_OUTPUT_CHARS;
    return {
      url: finalUrl,
      title,
      text: truncated ? text.slice(0, MAX_OUTPUT_CHARS) : text,
      links,
      engine: "static",
      truncated,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractBody(html: string): string {
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return body ? body[1] : html;
}

/** Tag-strip with block-awareness: block closers become newlines so words don't fuse. */
function stripTags(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote|pre)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function extractLinks(html: string): { title: string; url: string }[] {
  const links: { title: string; url: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    if (!/^https?:\/\//i.test(href)) {
      continue;
    }
    const title = stripTags(m[2]).trim().slice(0, 120);
    if (!title) {
      continue;
    }
    links.push({ title, url: href });
    if (links.length >= MAX_LINKS) {
      break;
    }
  }
  return links;
}

export function formatWebFetchPage(page: WebFetchPage): string {
  const lines: string[] = [`# ${page.title || "(untitled)"}`, `URL: ${page.url}`];
  if (page.engine === "static") {
    lines.push("(fetched without JS rendering — script-built content may be missing)");
  }
  lines.push("", page.text || "(no extractable text)");
  if (page.truncated) {
    lines.push("", `…[truncated at ${MAX_OUTPUT_CHARS} chars]`);
  }
  if (page.links.length > 0) {
    lines.push("", "Links:");
    for (const link of page.links) {
      lines.push(`- [${link.title}](${link.url})`);
    }
  }
  return lines.join("\n");
}
