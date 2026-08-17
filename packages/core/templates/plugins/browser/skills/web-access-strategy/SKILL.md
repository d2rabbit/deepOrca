---
name: web-access-strategy
description: >-
  Choose the right web-access tool for the job. A three-layer dispatch
  strategy: Layer 1 general search → WebSearch; Layer 2 static page content →
  WebFetch / curl / Jina Reader (r.jina.ai); Layer 3 login-state interaction →
  browser-skill (bsk) driving the user's real Chrome. Includes per-domain
  experience accumulation so the agent remembers which sites need login, which
  expose an API, and which block scrapers. Use whenever the agent must read,
  search, or interact with web content and is unsure which tool to pick.
---

# Web Access Strategy — Choosing the Right Tool

There are three distinct ways to reach the web, each with a different
cost/fidelity trade-off. The mistake to avoid is **jumping straight to a full
browser** when a 200ms fetch would have answered the question — or, conversely,
**hammering `curl`** against a site that requires the user's login cookies.

Pick the **lowest layer that can succeed**.

```
Layer 1  WebSearch        — "what is out there?"      (discovery)
Layer 2  WebFetch / curl  — "read this page"          (static content)
Layer 3  browser-skill    — "do this as the user"     (login-state interaction)
```

## Layer 1 — General search → WebSearch

**Use when:** you don't have a specific URL. You need to discover pages,
compare options, get a quick factual answer, or find the canonical docs for a
topic.

**Tool:** the `WebSearch` tool (or `mcp__web-search__web_search` /
`mcp__web-search-prime__web_search_prime` when available).

**Characteristics:**

- Cheapest and fastest.
- Returns titles, URLs, and short summaries — not full page content.
- No login state, no JavaScript execution.
- Good enough for "find the docs for X", "what's the latest version of Y",
  "does library Z support feature W".

**Do NOT use for:** reading the actual body of a specific page, anything behind
a login, or content that requires interacting with the page.

**Example:** user asks "how do I configure Vite proxy?" → `WebSearch` to find
the Vite docs URL, then drop to Layer 2 to actually read the page.

## Layer 2 — Static page content → WebFetch / curl / Jina Reader

**Use when:** you already have a URL and you need the page's text/markdown
content. The page is public and does not require login.

**Tools (pick any one):**

| Tool | When to prefer |
| --- | --- |
| `WebFetch` (built-in) | Good default. Fetches the page with the internal headless Chromium (JS-heavy pages render) or a static HTTP fetch, returns title/text/links. SSRF-guarded: public http/https only. |
| `curl` via `Bash` | Full control over headers; useful for JSON APIs or when `WebFetch` is blocked. Pipe through a parser. |
| `mcp__web-reader__webReader` / `mcp__web_reader__webReader` | "Reader-mode" extraction — best signal-to-noise for articles and docs. |
| Jina Reader (`https://r.jina.ai/<url>`) | Excellent fallback when a site blocks default fetchers. Returns clean markdown. `curl https://r.jina.ai/https://example.com`. |

**Characteristics:**

- No cookies, no login state. The request looks like an anonymous bot.
- Fast (hundreds of ms to a few seconds).
- Works for: docs sites, public APIs, blog posts, GitHub raw files, npm/pyPI
  package pages, Wikipedia, MDN, Stack Overflow question pages.
- Fails on: pages that require login (GitHub private repos, Jira, Notion
  workspaces), pages that render content purely via JS with no server HTML
  (sometimes), pages behind aggressive anti-scraping (Cloudflare challenge,
  LinkedIn, some news paywalls).

**Escalation rule:** if Layer 2 returns a login page, a CAPTCHA, a 403, or an
empty/JS-only shell, **escalate to Layer 3** rather than retrying with a
different anonymous fetcher.

**Jina Reader tip:** `r.jina.ai` is the single most reliable anonymous reader.
When `WebFetch` or `curl` get blocked, try `curl https://r.jina.ai/<full-url>`
before giving up on Layer 2.

## Layer 3 — Login-state interaction → browser-skill (bsk)

**Use when:** the task requires the user's identity — reading a private repo,
checking "what does my dashboard show", submitting a form, clicking through a
flow, scraping a site that blocks anonymous bots, or anything where "act as the
logged-in user" is the actual goal.

**Tool:** the `browser-skill` plugin (`bsk` CLI). It drives the user's **real
Chromium** with their existing logins and cookies, in an isolated Agent Window.

**Characteristics:**

- Highest fidelity: real browser, real session, real JS execution.
- Highest cost: slowest, and it consumes the user's attention (a window opens).
- Mandatory session lifecycle: `bsk session start` → work with `--session` →
  `bsk session stop`. See the browser-skill PLUGIN.md for the full rules.
- Stop the moment the bounded goal is met; never leave a session idle.

**Do NOT use for:** public docs you could have fetched anonymously, or anything
that doesn't need the user's identity. It is wasteful and slow.

**Safety:** never run `bsk evaluate` on banking, SSO, or password-manager pages
to extract tokens/cookies. See browser-skill PLUGIN.md "When NOT to use".

## Decision flow

```
Do I have a specific URL?
├─ No  → Layer 1 (WebSearch) to find one, then re-enter.
└─ Yes → Is the content public & static?
         ├─ Yes → Layer 2 (WebFetch / curl / r.jina.ai).
         │        If it returns login/403/CAPTCHA/empty → escalate to Layer 3.
         └─ No  → Layer 3 (bsk).
```

Ask yourself one question before every web action: **"Do I need the user's
cookies for this?"** If no → Layer 1 or 2. If yes → Layer 3.

## Per-domain experience accumulation

Keep a lightweight, evolving mental model (or a short note in your session
context) of the domains you touch. The goal is to skip the trial-and-error next
time. For each domain worth remembering, note one of:

- **public** — Layer 2 works directly (e.g. `developer.mozilla.org`,
  `react.dev`, `docs.python.org`, `en.wikipedia.org`, raw GitHub files).
- **api** — there is a clean JSON/REST endpoint; use `curl` against the API
  rather than scraping HTML (e.g. `api.github.com`, registry APIs, npm
  registry `registry.npmjs.org`).
- **login-required** — always needs Layer 3 / the user's session (e.g. private
  GitHub repos, Jira, Linear, Notion workspaces, internal dashboards).
- **anti-scraping** — blocks anonymous fetchers; try `r.jina.ai` first, then
  escalate to Layer 3 (e.g. LinkedIn, some news sites, some e-commerce).
- **js-only** — server returns an empty shell; Layer 2 `WebFetch` may fail even
  though the page is public → escalate to Layer 3 or use a reader that renders.

When you discover a domain's behaviour, record it. When you revisit a domain,
check the record first and skip the layer that already failed. This turns
random retries into a converging strategy.

## Quick rules of thumb

- Default to **Layer 1** for "find me…" and **Layer 2** for "read this URL".
- Only reach **Layer 3** when identity or interaction is genuinely required.
- `r.jina.ai/<url>` is the best Layer-2 fallback before escalating.
- Prefer a documented **API endpoint** over scraping HTML when one exists.
- Never retry a blocked anonymous fetch more than once before escalating.
- Record what you learn about each domain; don't re-discover it every turn.
