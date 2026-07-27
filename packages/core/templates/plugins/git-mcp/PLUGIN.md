# git-mcp

Ground your answers about **external GitHub repositories** in their real documentation via the built-in **local GitMCP server** — each registered repository runs as a local stdio MCP server backed by a shared on-disk index (`~/.deeporca/gitmcp/index.db`). Documentation is fetched once from GitHub, chunked and indexed locally (FTS5/BM25), so searches work offline and nothing is sent to third-party services. It eliminates hallucinated APIs for niche, new, or fast-moving libraries.

## When to use

- The user works with an external library/framework and you are unsure about its current API
- The user pastes a GitHub URL and asks how to use / integrate that project
- The user reports that your suggested API does not exist (likely hallucination — verify against live docs)
- The user wants a persistent docs source for a dependency they use often → have them register the repo

## When NOT to use

- Questions about the current workspace's own code (use local tools instead)
- Private repositories (documentation is fetched from public raw.githubusercontent.com)
- Well-known stable APIs you are certain about

## Server naming rule

Each repository gets its own MCP server entry named after the repo:

| Repository | MCP server name |
|------------|-----------------|
| `github.com/{owner}/{repo}` | `gitmcp:{owner}/{repo}` |

After a server connects, its tools appear as `mcp__gitmcp_{owner}_{repo}__*` (`:` and `/` in the server name are sanitized to `_`).

## Registering a repository

**Desktop:** open the **GitMCP** module in the left rail (next to Code Review), paste `owner/repo` or any GitHub URL, and press Add. The module builds the local index right away, and the server can be toggled or removed there. The Plugin Center → MCP tab may enable/disable these servers but never remove them.

**CLI:** add a placeholder entry to `~/.deeporca/settings.json` — the engine rewrites it to the actual local server command at startup:

```json
{
  "mcpServers": {
    "gitmcp:{owner}/{repo}": {
      "command": "gitmcp",
      "args": ["{owner}/{repo}"]
    }
  }
}
```

## Tools exposed per repository

Tool names are fixed (the repository is bound at server start):

| Tool | Purpose |
|------|---------|
| `fetch_documentation` | Fetch the repo's primary docs (`llms.txt` → `llms-full.txt` → README); falls back to the cached copy when offline |
| `search_documentation` | BM25 search within the locally indexed docs — prefer this over fetching everything; indexes automatically on first use |
| `search_code` | Search actual code via the GitHub code search API for implementation examples |
| `fetch_url_content` | Resolve links referenced inside the docs (HTML is stripped to text) |

## Workflow

1. Identify the external repo the user depends on (from their question, imports, or package manifest).
2. If its `gitmcp:{owner}/{repo}` server is already connected, call `search_documentation` first (cheaper than full fetch); fetch full docs only for broad "what is this project" questions.
3. If not connected, point desktop users to the GitMCP module, or offer the ready-to-paste `mcpServers` placeholder config — never edit the user's settings without asking.
4. Base your API usage and code examples on the retrieved docs; cite which doc section grounded the answer.

## Tips

- Searches hit the local index, so repeated lookups are fast and work offline once indexed.
- Rebuild the index from the desktop GitMCP module when the upstream docs have moved on.
- `search_code` calls the GitHub API directly; set `GITHUB_TOKEN` in the environment to raise its rate limit.
