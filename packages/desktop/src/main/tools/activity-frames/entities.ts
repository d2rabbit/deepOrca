/**
 * URL → PageRef entity typing — port of activity_frames/entities.py.
 *
 * Pure URL string parsing, zero network calls. Resolution order:
 * 1. Exact host lookup in SITE_PARSERS
 * 2. Apex domain lookup
 * 3. Search query detection
 * 4. Subdomain/path heuristics (login/dashboard/mail/calendar)
 * 5. Fallback: kind="page"
 */

import type { PageRef } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Decode a slug: replace -/_ with space, decode URI components. */
function slug(s: string): string {
  try {
    return decodeURIComponent(s.replace(/[-_]/g, " ")).replace(/\s+/g, " ").trim();
  } catch {
    return s.replace(/[-_]/g, " ").trim();
  }
}

/** Create a PageRef. */
function ref(kind: string, domain: string, entity: string, extra = ""): PageRef {
  return { kind, domain, entity, extra };
}

/** Get apex domain (last two labels). */
function apexDomain(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

// ── Site-specific parsers ────────────────────────────────────────────────────
// Each takes (host, pathParts, query) → PageRef | null

type SiteParser = (host: string, parts: string[], query: URLSearchParams) => PageRef | null;

const _github: SiteParser = (_h, parts) => {
  if (parts.length === 0) return null;
  if (parts[0] === "search") {
    return ref("search", "github.com", "GitHub Search");
  }
  if (parts.length >= 1) {
    const repo = parts.slice(0, 2).join("/");
    if (parts.length >= 3 && parts[2] === "pull") {
      return ref("pull_request", "github.com", `${repo}#${parts[3] ?? ""}`);
    }
    if (parts.length >= 3 && parts[2] === "issues") {
      return ref("issue", "github.com", `${repo}#${parts[3] ?? ""}`);
    }
    if (parts.length >= 3 && parts[2] === "tree") {
      return ref("code", "github.com", `${repo}/${parts.slice(3).join("/")}`);
    }
    if (parts.length >= 3 && (parts[2] === "commits" || parts[2] === "commit")) {
      return ref("commit", "github.com", repo);
    }
    if (parts.length === 1) {
      return ref("profile", "github.com", slug(parts[0]));
    }
    return ref("repo", "github.com", repo);
  }
  return null;
};

const _gitlab: SiteParser = (_h, parts) => {
  if (parts.length < 2) return null;
  if (parts.includes("merge_requests")) return ref("pull_request", "gitlab.com", parts.slice(0, 2).join("/"));
  if (parts.includes("issues")) return ref("issue", "gitlab.com", parts.slice(0, 2).join("/"));
  return ref("repo", "gitlab.com", parts.slice(0, 2).join("/"));
};

const _linkedin: SiteParser = (_h, parts) => {
  if (parts[0] === "in" && parts[1]) return ref("profile", "linkedin.com", slug(parts[1]));
  if (parts[0] === "company" && parts[1]) return ref("company", "linkedin.com", slug(parts[1]));
  if (parts[0] === "jobs") return ref("job_search", "linkedin.com", "LinkedIn Jobs");
  return null;
};

const _google: SiteParser = (_h, parts, query) => {
  const q = query.get("q");
  if (q) return ref("search", "google.com", q);
  if (parts[0] === "maps") return ref("maps", "google.com", "Google Maps");
  if (parts[0] === "drive") return ref("drive", "google.com", "Google Drive");
  if (parts[0] === "calendar") return ref("calendar", "google.com", "Google Calendar");
  if (parts[0] === "mail" || parts[0] === "gmail") return ref("mail", "google.com", "Gmail");
  return null;
};

const _youtube: SiteParser = (_h, parts, query) => {
  if (parts[0] === "watch") return ref("video", "youtube.com", query.get("v") ?? "YouTube");
  if (parts[0] === "channel" && parts[1]) return ref("channel", "youtube.com", slug(parts[1]));
  if (parts[0] === "@") return ref("channel", "youtube.com", parts[1] ?? "YouTube");
  if (parts[0] === "results") {
    const sq = query.get("search_query");
    if (sq) return ref("search", "youtube.com", sq);
  }
  return null;
};

const _x: SiteParser = (_h, parts) => {
  if (parts[0] === "home") return ref("feed", "x.com", "X Feed");
  if (parts[0] === "search") return ref("search", "x.com", "X Search");
  if (parts[0] && parts[0] !== "i") return ref("profile", "x.com", slug(parts[0]));
  return null;
};

const _slack: SiteParser = (host, parts) => {
  if (host.startsWith("app.")) {
    if (parts[0] === "client" && parts.length >= 3) {
      return ref("channel", "slack.com", `${parts[1] ?? ""}/${parts[2] ?? ""}`);
    }
  }
  return null;
};

const _linear: SiteParser = (_h, parts) => {
  if (parts[0] === "team" && parts[1]) return ref("team", "linear.app", slug(parts[1]));
  if (parts[0] === "project" && parts[1]) return ref("project", "linear.app", slug(parts[1]));
  // Linear URLs: /team/ENG-123 or /acme/issue/ENG-123
  const issueIdx = parts.indexOf("issue");
  if (issueIdx >= 0 && parts[issueIdx + 1]) return ref("issue", "linear.app", parts[issueIdx + 1]);
  return ref("dashboard", "linear.app", "Linear");
};

const _notion: SiteParser = (_h, parts) => {
  if (parts[0] === "workspace") return ref("workspace", "notion.so", "Notion");
  return parts.length > 0 ? ref("doc", "notion.so", slug(parts[0])) : null;
};

const _figma: SiteParser = (_h, parts) => {
  if (parts[0] === "file" && parts[1]) return ref("design", "figma.com", slug(parts[1]));
  if (parts[0] === "proto" && parts[1]) return ref("prototype", "figma.com", slug(parts[1]));
  return null;
};

const _jira: SiteParser = (host, parts) => {
  if (parts.includes("browse") && parts[parts.indexOf("browse") + 1]) {
    return ref("ticket", host, parts[parts.indexOf("browse") + 1]);
  }
  if (parts.includes("projects") && parts[1]) return ref("project", host, slug(parts[1]));
  return ref("board", host, "Jira");
};

const _discord: SiteParser = (host, parts) => {
  if (parts[0] === "channels") {
    return ref("channel", "discord.com", parts.slice(1).join("/"));
  }
  return null;
};

const _reddit: SiteParser = (_h, parts) => {
  if (parts[0] === "r" && parts[1]) return ref("subreddit", "reddit.com", `r/${parts[1]}`);
  if (parts[0] === "user" && parts[1]) return ref("profile", "reddit.com", `u/${parts[1]}`);
  return null;
};

const _stackoverflow: SiteParser = (_h, parts, query) => {
  if (parts[0] === "questions" && parts[1]) return ref("question", "stackoverflow.com", parts[1]);
  if (parts[0] === "search") {
    const q = query.get("q");
    if (q) return ref("search", "stackoverflow.com", q);
  }
  return null;
};

const _gmail: SiteParser = (_h, parts) => {
  if (parts[0] === "mail") return ref("mail", "gmail.com", "Gmail");
  return null;
};

const _calendar: SiteParser = (_h) => ref("calendar", "calendar.google.com", "Google Calendar");

const _zoom: SiteParser = (_h, parts) => {
  if (parts[0] === "s" && parts[1]) return ref("meeting", "zoom.us", "Zoom Meeting");
  return null;
};

const _meet: SiteParser = (_h, parts) => {
  if (parts[0] === "meeting" || (parts[0] && parts[0].length > 10)) {
    return ref("meeting", "meet.google.com", "Google Meet");
  }
  return null;
};

const _telegram: SiteParser = (host, parts) => {
  if (parts[0]) return ref("chat", host, slug(parts[0]));
  return null;
};

const _whatsapp: SiteParser = (host) => ref("chat", host, "WhatsApp");

const _medium: SiteParser = (_h, parts) => {
  if (parts[0] === "@") return ref("article", "medium.com", `@${parts[1] ?? ""}`);
  if (parts[0]) return ref("article", "medium.com", slug(parts[0]));
  return null;
};

const _hackernews: SiteParser = (_h, parts) => {
  if (parts[0] === "item") return ref("post", "news.ycombinator.com", "HN Post");
  return ref("feed", "news.ycombinator.com", "Hacker News");
};

const _wikipedia: SiteParser = (_h, parts) => {
  if (parts[0] === "wiki" && parts[1]) return ref("article", "wikipedia.org", slug(parts[1]));
  return null;
};

const _chatgpt: SiteParser = (_h) => ref("chat", "chatgpt.com", "ChatGPT");

const _claude: SiteParser = (_h) => ref("chat", "claude.ai", "Claude");

const _vercel: SiteParser = (_h, parts) => {
  if (parts[0] === "dashboard") return ref("dashboard", "vercel.com", "Vercel Dashboard");
  return null;
};

const _netlify: SiteParser = (_h) => ref("dashboard", "app.netlify.com", "Netlify Dashboard");

const _devto: SiteParser = (_h, parts) => {
  if (parts[0] && parts[0] !== "search") return ref("article", "dev.to", slug(parts[0]));
  return null;
};

const _arxiv: SiteParser = (_h, parts) => {
  if (parts[0] === "abs" && parts[1]) return ref("paper", "arxiv.org", parts[1]);
  if (parts[0] === "pdf" && parts[1]) return ref("paper", "arxiv.org", parts[1].replace(".pdf", ""));
  return null;
};

const _confluence: SiteParser = (host, parts) => {
  if (parts[0] === "wiki" && parts[2]) return ref("doc", host, slug(parts[2]));
  return null;
};

const _bitbucket: SiteParser = (_h, parts) => {
  if (parts.length >= 2) return ref("repo", "bitbucket.org", parts.slice(0, 2).join("/"));
  return null;
};

// ── Parser registry ──────────────────────────────────────────────────────────

/** Exact host → parser. */
const HOST_PARSERS: Record<string, SiteParser> = {
  "github.com": _github,
  "gist.github.com": _github,
  "gitlab.com": _gitlab,
  "www.linkedin.com": _linkedin,
  "linkedin.com": _linkedin,
  "www.google.com": _google,
  "google.com": _google,
  "www.youtube.com": _youtube,
  "youtube.com": _youtube,
  "x.com": _x,
  "twitter.com": _x,
  "app.slack.com": _slack,
  "linear.app": _linear,
  "www.notion.so": _notion,
  "notion.so": _notion,
  "www.figma.com": _figma,
  "figma.com": _figma,
  "discord.com": _discord,
  "discordapp.com": _discord,
  "www.reddit.com": _reddit,
  "reddit.com": _reddit,
  "stackoverflow.com": _stackoverflow,
  "mail.google.com": _gmail,
  "calendar.google.com": _calendar,
  "zoom.us": _zoom,
  "meet.google.com": _meet,
  "web.telegram.org": _telegram,
  "web.whatsapp.com": _whatsapp,
  "medium.com": _medium,
  "news.ycombinator.com": _hackernews,
  "en.wikipedia.org": _wikipedia,
  "chatgpt.com": _chatgpt,
  "chat.openai.com": _chatgpt,
  "claude.ai": _claude,
  "vercel.com": _vercel,
  "app.netlify.com": _netlify,
  "dev.to": _devto,
  "arxiv.org": _arxiv,
  "bitbucket.org": _bitbucket,
};

/** Apex domain → parser. */
const APEX_PARSERS: Record<string, SiteParser> = {
  "github.com": _github,
  "gitlab.com": _gitlab,
  "linkedin.com": _linkedin,
  "google.com": _google,
  "youtube.com": _youtube,
  "x.com": _x,
  "twitter.com": _x,
  "linear.app": _linear,
  "notion.so": _notion,
  "figma.com": _figma,
  "discord.com": _discord,
  "reddit.com": _reddit,
  "stackoverflow.com": _stackoverflow,
  "zoom.us": _zoom,
  "medium.com": _medium,
  "wikipedia.org": _wikipedia,
  "arxiv.org": _arxiv,
  "bitbucket.org": _bitbucket,
  "atlassian.net": _confluence,
  "atlassian.com": _jira,
  "dev.to": _devto,
};

// ── Search detection ─────────────────────────────────────────────────────────

const SEARCH_PARAMS = ["q", "query", "search_query", "search"];

function detectSearch(query: URLSearchParams): string | null {
  for (const p of SEARCH_PARAMS) {
    const v = query.get(p);
    if (v) return v;
  }
  return null;
}

// ── Heuristics ───────────────────────────────────────────────────────────────

const SIGNIN_PATHS = new Set(["login", "signin", "auth", "oauth", "sso", "logout"]);
const SIGNIN_SUBS = ["accounts.", "login.", "auth.", "signin."];
const DASH_SUBS = ["dashboard.", "app.", "console.", "admin.", "portal."];
const MAIL_SUBS = ["mail.", "inbox."];
const CAL_SUBS = ["calendar.", "cal."];
const MEET_SUBS = ["meet.", "zoom.", "calls."];

function heuristic(host: string, parts: string[]): PageRef | null {
  const lowerHost = host.toLowerCase();
  const firstPath = parts[0]?.toLowerCase() ?? "";

  // Sign-in pages.
  if (SIGNIN_SUBS.some((s) => lowerHost.startsWith(s)) || SIGNIN_PATHS.has(firstPath)) {
    return ref("sign_in", host, "Sign In");
  }
  // Dashboards.
  if (DASH_SUBS.some((s) => lowerHost.startsWith(s))) {
    return ref("dashboard", host, "Dashboard");
  }
  // Mail.
  if (MAIL_SUBS.some((s) => lowerHost.startsWith(s))) {
    return ref("mail", host, "Email");
  }
  // Calendar.
  if (CAL_SUBS.some((s) => lowerHost.startsWith(s))) {
    return ref("calendar", host, "Calendar");
  }
  // Meeting.
  if (MEET_SUBS.some((s) => lowerHost.startsWith(s))) {
    return ref("meeting", host, "Meeting");
  }
  return null;
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Parse a URL into a PageRef. Never throws, never returns null.
 * Falls back to kind="page" if nothing matches.
 */
export function parseUrl(url: string): PageRef {
  if (!url) return ref("page", "", "Unknown");

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return ref("page", "", url.slice(0, 50));
  }

  let host = parsed.hostname;
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host) return ref("page", "", "Unknown");

  const parts = parsed.pathname.split("/").filter(Boolean);
  const query = parsed.searchParams;

  // 1. Exact host lookup.
  const hostParser = HOST_PARSERS[host];
  if (hostParser) {
    const result = hostParser(host, parts, query);
    if (result) return result;
  }

  // 2. Apex domain lookup.
  const apex = apexDomain(host);
  const apexParser = APEX_PARSERS[apex];
  if (apexParser) {
    const result = apexParser(host, parts, query);
    if (result) return result;
  }

  // 3. Search detection.
  const searchQuery = detectSearch(query);
  if (searchQuery) {
    return ref("search", host, searchQuery);
  }

  // 4. Heuristics.
  const heur = heuristic(host, parts);
  if (heur) return heur;

  // 5. Fallback.
  return ref("page", host, parts[0] ? slug(parts[0]) : host);
}
