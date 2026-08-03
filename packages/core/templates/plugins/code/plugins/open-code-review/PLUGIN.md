# open-code-review

AI-powered code review through the `ocr` CLI (Alibaba Open Code Review). It reads Git diffs, sends changed files to a configurable LLM via an agent with tool-use capabilities, and generates structured review comments with line-level precision.

## When to use

- Review uncommitted workspace changes before committing
- Compare branches (`--from main --to feature`) before opening a PR
- Audit a specific commit (`--commit <hash>`)
- Scan an entire file or directory for potential issues (no diff required)
- Get a second opinion on code quality, security, and correctness

## When NOT to use

- Non-code files (images, binaries, lock files)
- Trivial formatting-only changes
- When the user only wants an explanation, not a formal review

## Prerequisites

1. **Built-in** — `ocr` is bundled with DeepOrca and runs via Electron's Node. No manual installation needed.
2. An LLM endpoint configured (uses DeepOrca's model settings automatically)
3. A Git repository (ocr reads diffs from the working tree)

## Commands

| Command                                | Purpose                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| `ocr review`                           | Review all uncommitted changes (staged + unstaged + untracked) |
| `ocr review --from <base> --to <head>` | Review diff between two refs                                   |
| `ocr review --commit <hash>`           | Review a single commit                                         |
| `ocr review --format json`             | Machine-readable JSON output                                   |
| `ocr review --audience agent`          | Compact summary for CI/agent consumption                       |
| `ocr scan <path>`                      | Full-file audit (no diff needed)                               |
| `ocr config set llm.url <url>`         | Configure LLM endpoint                                         |
| `ocr llm test`                         | Verify LLM connectivity                                        |

## Workflow

1. Ensure the workspace is a Git repo with pending changes (or specify refs).
2. Run `ocr review --format json` to get structured results.
3. Parse the JSON output: each comment has `file`, `line`, `severity`, `message`.
4. Present findings grouped by severity (critical → warning → info).
5. Offer to fix high-confidence issues if the user agrees.

## Output format (JSON)

```json
{
  "comments": [
    {
      "file": "src/auth.ts",
      "line": 42,
      "severity": "warning",
      "message": "Potential null dereference on user.token",
      "suggestion": "Add a null check before accessing token"
    }
  ],
  "summary": "2 warnings, 1 info across 3 files"
}
```

## Tips

- OCR auto-reads `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL` env vars.
- Use `--concurrency 4` to limit parallel sub-agent tasks on large diffs.
- Use `--timeout 600` (seconds) for very large changesets.
- The `--audience agent` flag reduces token output for programmatic use.
