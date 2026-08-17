## WebFetch

Fetch a web page and return its title, readable text content, and links —
the read half of the search+fetch pair (use WebSearch to find URLs, WebFetch
to read them).

JSON schema:

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "The http/https URL of the page to fetch (public hosts only — private/loopback addresses are rejected)."
    }
  },
  "required": ["url"],
  "additionalProperties": false
}
```

Usage:

- Prefer http/https URLs exactly as returned by WebSearch or page links.
- Pages render with a built-in headless browser when available, so
  JavaScript-heavy pages work; the output notes when only a static (no-JS)
  fetch was possible — treat thin content on such pages as "rendering
  unavailable", not as the page's real content.
- Output is capped; long pages are truncated with an explicit marker.

Typical use cases:

- Read a documentation page found via WebSearch
- Check a changelog, migration guide, or issue discussion
- Verify a link's actual content before citing it
