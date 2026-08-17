---
name: wiki-qa
description: >-
  Answer questions about the project's architecture, modules, and workflows by
  querying the OpenWiki knowledge base. Use when the user asks "how does X
  work", "explain the architecture", "what does module Y do", or wants to
  understand the codebase structure without reading source files. Also use when
  onboarding new team members or when a non-developer needs to understand the
  project. Triggers: wiki, 文档, 架构, how does, 工作原理, explain, 知识库,
  openwiki ask, module overview, 数据流, data flow.
---

# Wiki QA — Query the Project Knowledge Base

Answer questions about the project using the OpenWiki knowledge base. The wiki
contains structured, cross-referenced documentation generated from the codebase —
architecture overviews, module guides, workflows, and API references.

This is faster and more token-efficient than reading source files: the wiki has
already been analyzed, summarized, and cross-referenced by an LLM.

## When to Use

- User asks "how does X work?" or "explain the architecture"
- User wants to understand module relationships or data flow
- Onboarding: new team member needs a project overview
- Non-developer (PM, designer) wants to understand the project
- You need context before making changes to an unfamiliar area

## Workflow

### Step 1: Check if wiki exists

Use the `wiki_list-pages` tool (or run `wiki.list-pages` action) to check if
the project has an `openwiki/` directory with generated pages.

If no wiki exists (empty result), tell the user:
> The project knowledge base hasn't been generated yet. Run "Build Index" in
> the Index & Knowledge panel (or use the `index.build-all` action) to create it.

### Step 2: Query the wiki

If the wiki exists, you have two approaches:

**Approach A — Direct page lookup** (for specific topics):

1. Use `wiki_list-pages` to see available pages (with titles and types).
2. Use `wiki_read-page` to read the relevant page(s). The response includes
   structured OKF frontmatter (`type`, `title`, `description`, `tags`) plus
   the markdown body.
3. Summarize the answer for the user.

**Approach B — OpenWiki RAG query** (for complex questions):

Run the OpenWiki CLI in QA mode for RAG-based answers:

```bash
cd /path/to/project
openwiki "How does the authentication flow work?" --print code
```

The `--print code` flag outputs a structured response to stdout without the
interactive TUI. OpenWiki uses its DeepAgents pipeline + OKF index to find
relevant pages and synthesize an answer.

> **Note**: This requires the vendored OpenWiki CLI to be available. If the
> command fails, fall back to Approach A (direct page lookup).

### Step 3: Supplement with source code

If the wiki answer is incomplete or outdated, use `read` or `bash` tools to
check the actual source code. The wiki may lag behind recent changes.

### Step 4: Answer the user

Present the answer in clear, structured markdown. For architecture questions,
include:
- A high-level summary
- Key components and their responsibilities
- Data flow / call paths (if relevant)
- Links to specific wiki pages or source files for deeper reading

## Tips

- The wiki's OKF frontmatter (`type` field) categorizes pages: `Reference`,
  `Guide`, `Architecture`, etc. Use this to find the right page quickly.
- `wiki_read-page` returns `frontmatter`, `body`, and `raw` — use `body` for
  the markdown content without frontmatter noise.
- For multi-part questions, query multiple pages in parallel.
- The wiki is version-controlled in `openwiki/` — it follows the project
  through git. If it's stale, suggest running `wiki.update`.
