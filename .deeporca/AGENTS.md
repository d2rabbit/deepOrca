# Repository Guidelines

## Project Structure & Module Organization

This is an **npm workspaces monorepo** for **Orca** (forked from DeepOrca). Packages live under `packages/`.

```
packages/
├── core/src/               # LLM session, 7 built-in tools, MCP client, plugin system, permissions
│   ├── common/             # File I/O, OpenAI client, codegraph, shell utils, error handling, etc.
│   ├── tools/              # bash, read, write, edit, ask-user-question, update-plan, web-search
│   ├── mcp/                # MCP client & manager (JSON-RPC over stdio)
│   ├── session.ts          # SessionManager — LLM loop, compaction, tool orchestration
│   ├── prompt.ts           # System prompt builder, tool definitions, skill/plugin injection
│   └── settings.ts         # Settings resolution from ~/.deeporca/settings.json
├── cli/src/                # Terminal UI (Ink/React)
├── desktop/                # Electron GUI — React renderer, Metro theme, IPC bridge, plugin manager
│   ├── src/main/           # Main process (session bridge, file scanner, git-service, mcp-store, etc.)
│   ├── src/renderer/       # React renderer (components, UI primitives, i18n with 6 locales)
│   ├── src/preload/        # Context-isolated preload with typed window.deeporca API
│   └── src/shared/         # Type-only IPC contract (dependency-free)
└── vscode-ide-companion/   # VSCode extension
docs/                       # Configuration, MCP, permissions, plan-mode, etc.
docs/superpowers/           # Design specs and implementation plans
scripts/                    # Build, release, and packaging scripts
```

Templates live in `packages/core/templates/` — tools, prompts, skills, and **plugins** (e.g. `browser-skill` as the first built-in plugin). Bundled output: `packages/cli/dist/cli.js`. Root `AGENTS.md` contains detailed architecture flows.

## Extension Mechanisms

Orca provides three parallel extension systems, all auto-injected into sessions:

| System | Location | Examples |
|--------|----------|----------|
| **Skills** (user-defined) | `~/.agents/skills/`, `./.agents/skills/` | Guided workflows via SKILL.md |
| **MCP servers** (external) | `settings.json → mcpServers` | GitHub, Playwright, Filesystem |
| **Built-in plugins** (core) | `packages/core/templates/plugins/` | `browser-skill` (non-removable) |

## Build, Test, and Development Commands

Run from repo root.

| Command | What it does |
|---|---|
| `npm run check` | Typecheck + lint + format check (run before pushing) |
| `npm run build` | Builds core (tsc), rewrites ESM imports, bundles CLI (esbuild) |
| `npm test` | Runs all workspace tests (node:test + tsx) |
| `npm run start` | Runs the locally built CLI |
| `npm run desktop:build / :dev / :start` | Build / dev / run the Electron desktop app |
| `npm run generate` | Generates build-time git commit info |

Single test: `node packages/<name>/src/tests/run-tests.mjs packages/<name>/src/tests/<file>.test.ts`

## Coding Style & Naming Conventions

- **Indentation**: 2 spaces, no tabs. **Quotes**: Double. **Semicolons**: Required.
- **Trailing commas**: `es5`. **Line width**: 120. **Line endings**: LF.
- **TypeScript**: Strict (`strict: true`), `verbatimModuleSyntax: true` → always `import type`. Target ES2022, module ESNext with bundler resolution.
- **File naming**: `kebab-case.ts` / `kebab-case.tsx`. Tests: `*.test.ts`.
- **Formatting**: Prettier + ESLint (typescript-eslint, react-hooks). Husky + lint-staged on commit.

## Testing Guidelines

- **Framework**: Node.js native `node:test` with `tsx` + `node:assert/strict`.
- **Coverage**: Unit tests for session management, tool handlers, permissions, MCP client, settings, codegraph.
- **Naming**: `describe`/`test` blocks with descriptive names. Each package has its own `run-tests.mjs` runner.

## Commit & Pull Request Guidelines

**Commit messages** follow [conventional commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `refactor:`, `style:`, `test:`, `docs:`, `perf:`, `build:`. Scope optional, e.g. `fix(mcp): ...`.

**PRs** should include: clear description of what changed and why, link to related issues, screenshots for UI changes, all checks passing (`npm run check && npm test`), and justification for `package-lock.json` changes.

## Architecture Overview

`SessionManager` (in `@deeporca/core`) drives the LLM loop: builds system prompts (with skills + plugins + MCP tools injected as context), streams responses, executes tools via `ToolExecutor`, and compacts context on token threshold exceedance.

**Plan Mode** (`/plan` or `Shift+Tab`): First turn is read-only; agent must produce `<proposed_plan>` for user approval before writes, deletions, or git mutations.

**Slash commands**: `/skills`, `/model`, `/plan`, `/new`, `/init`, `/resume`, `/continue`, `/undo`, `/mcp`, `/raw`, `/exit`.

**CLI flags**: `-p <prompt>` / `--prompt`, `-r [sessionId]` / `--resume`, `-v`, `-h`.
