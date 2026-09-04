---
name: openwiki
description: "Generate and maintain project-level Wiki knowledge graph using the openwiki CLI (LangChain). Use when a user asks to: 'generate wiki', 'update wiki', 'project documentation', 'knowledge graph', 'openwiki', 'wiki init', or 'wiki update'. Produces the canonical deepwiki/ store in the project root (via the app's staging lifecycle; the CLI's own openwiki/ directory is a run-local stage) with structured, cross-referenced documentation that follows the project."
metadata:
  last_modified: Mon, 21 Jul 2026 08:00:00 GMT
---

# OpenWiki — Project Wiki Knowledge Graph

Generate and maintain a project-level Wiki knowledge graph using the `openwiki` CLI (by LangChain). The wiki lives in the project's `deepwiki/` store and follows the project through version control (the app stages CLI runs in `openwiki/` and promotes validated output into `deepwiki/`).

## Contents

- [What is OpenWiki](#what-is-openwiki)
- [Prerequisites](#prerequisites)
- [Core Commands](#core-commands)
- [Output Structure](#output-structure)
- [Workflow: Generate & Maintain Wiki](#workflow-generate--maintain-wiki)
- [Integration with Agent Context](#integration-with-agent-context)
- [Configuration](#configuration)

---

## What is OpenWiki

OpenWiki is a CLI that writes and maintains agent-facing documentation for your codebase. It:

1. Scans the project structure, source code, and existing docs
2. Generates a structured wiki with cross-referenced pages (architecture, modules, workflows, operations)
3. Stores everything in the `deepwiki/` store at the project root — version-controlled, project-level
4. Supports incremental updates (only regenerates pages affected by git changes)
5. Outputs compatible with Google Open Knowledge Format (OKF) v0.1

The wiki serves both humans and AI agents: an agent reads `deepwiki/` first to understand the project before diving into source code, dramatically reducing token consumption.

---

## Prerequisites

1. `openwiki` on PATH — install via `npm install -g openwiki`
2. An OpenAI-compatible LLM endpoint configured (openwiki uses `OPENAI_API_KEY` + `OPENAI_BASE_URL` env vars, or `--model` flag)
3. A git repository (openwiki uses git history for incremental updates)

---

## Core Commands

### Initialize wiki for a project

```bash
cd /path/to/project
openwiki --init
```

This creates the `deepwiki/` store with initial wiki pages. First run does a full scan.

### Initialize with custom instructions

```bash
openwiki --init "生成仓库文档，要求全部使用中文"
```

### Update wiki (incremental)

```bash
openwiki --update
```

Compares against git HEAD, only regenerates pages affected by changes. Safe to run frequently.

### Update with CI output (for automation)

```bash
openwiki code --update --print
```

Prints diff summary suitable for PR descriptions.

### Query the wiki (agent mode)

```bash
openwiki ask "How does the authentication module work?"
```

Uses the generated wiki as context for RAG-style answers.

---

## Output Structure

After `openwiki --init`, the project will contain:

```
project-root/
├── deepwiki/
│   ├── index.md              # Wiki entry point / table of contents
│   ├── quickstart.md         # Getting started guide
│   ├── architecture.md       # System architecture overview
│   ├── modules/              # Per-module documentation
│   │   ├── auth.md
│   │   ├── database.md
│   │   └── api.md
│   ├── workflows/            # Key workflows and data flows
│   │   ├── deployment.md
│   │   └── testing.md
│   ├── operations.md         # Operational concerns (monitoring, scaling)
│   └── glossary.md           # Domain terminology
├── src/
├── ...
└── .gitignore                # Should NOT ignore deepwiki/
```

**Key principle**: `deepwiki/` is committed to version control. It follows the project.

---

## Workflow: Generate & Maintain Wiki

### Task Progress

- [ ] **Step 1: Verify prerequisites.** Run `openwiki --version` to confirm CLI is available.
- [ ] **Step 2: Initialize.** Run `openwiki --init` in the project root. Review generated pages.
- [ ] **Step 3: Customize.** Edit `deepwiki/INSTRUCTIONS.md` to set project-specific generation rules (language, focus areas, exclusions).
- [ ] **Step 4: Commit.** Add `deepwiki/` to version control: `git add deepwiki/ && git commit -m "docs: initialize project wiki"`.
- [ ] **Step 5: Update after changes.** After significant code changes, run `openwiki --update`.
- [ ] **Step 6: Review & refine.** Check updated pages for accuracy. Edit manually if needed.
- [ ] **Step 7: Automate (optional).** Set up CI to run `openwiki code --update --print` and create doc-update PRs.

### Conditional decisions

- **If the project is large (>1000 files)** → use `openwiki --init --focus src/` to limit initial scan scope.
- **If wiki should be in Chinese** → pass instruction: `openwiki --init "所有文档使用中文"`.
- **If only specific modules need docs** → create `deepwiki/INSTRUCTIONS.md` with focus directives.
- **If updating in CI** → use `openwiki code --update --print` and pipe output to PR body.

---

## Integration with Agent Context

The generated wiki is designed to be consumed by AI agents:

1. **Session start**: Agent reads `deepwiki/index.md` to get project overview
2. **Task planning**: Agent reads relevant `deepwiki/modules/*.md` for module context
3. **Code navigation**: Wiki cross-references guide agent to relevant source files
4. **Reduced token usage**: Agent reads wiki summary instead of scanning entire codebase

### INSTRUCTIONS.md (project-level customization)

Create `deepwiki/INSTRUCTIONS.md` to control generation behavior:

```markdown
# Wiki Generation Instructions

- All documentation must be in Chinese (中文)
- Focus on the packages/ directory structure
- Include API endpoint documentation for all REST routes
- Exclude test files and generated code from analysis
- Emphasize the plugin architecture and extension points
```

---

## Configuration

### Environment variables

| Variable          | Purpose                             | Example                    |
| ----------------- | ----------------------------------- | -------------------------- |
| `OPENAI_API_KEY`  | LLM API key for generation          | `sk-...`                   |
| `OPENAI_BASE_URL` | Custom endpoint (OpenAI-compatible) | `https://api.deepseek.com` |
| `OPENWIKI_MODEL`  | Model to use for generation         | `deepseek-chat`            |

### CLI flags

| Flag                    | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `--init [instructions]` | Initialize wiki (optionally with custom instructions) |
| `--update`              | Incremental update based on git diff                  |
| `--focus <path>`        | Limit scan to specific directory                      |
| `--model <model>`       | Override model for this run                           |
| `--print`               | Print changes instead of writing (for CI)             |
| `--lang <code>`         | Output language (e.g., `zh`, `en`, `ja`)              |

### Reusing Orca's LLM configuration

The desktop wiki agent automatically passes the user's LLM credentials (`OPENAI_API_KEY`, `OPENAI_BASE_URL`) to openwiki. Model strategy:

1. **Primary**: `deepseek-v4-flash` (fast, cheap — ideal for documentation generation)
2. **Fallback**: `deepseek-v4-pro` (used automatically when flash is unavailable)

The agent handles this transparently — no manual model selection needed. When running openwiki manually from CLI:

```bash
OPENAI_BASE_URL="$DEEPSEEK_BASE_URL" OPENAI_API_KEY="$DEEPSEEK_API_KEY" openwiki --update --model deepseek-v4-flash
```
