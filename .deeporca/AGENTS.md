# Repository Guidelines

## Project Structure & Module Organization

This is an **npm workspaces monorepo** for **DeepOrca**. Packages live under `packages/` — only `core` and `desktop`.

```
packages/
├── core/src/               # LLM session, 7 built-in tools, MCP client, plugin system, permissions
│   ├── common/             # File I/O, OpenAI client, codegraph, shell utils, error handling, etc.
│   ├── tools/              # bash, read, write, edit, ask-user-question, update-plan, web-search
│   ├── mcp/                # MCP client & manager (JSON-RPC over stdio)
│   ├── session.ts          # SessionManager — LLM loop, compaction, tool orchestration
│   ├── prompt.ts           # System prompt builder, tool definitions, skill/plugin injection
│   └── settings.ts         # Settings resolution from ~/.deeporca/settings.json
└── desktop/                # Electron GUI — React renderer, IPC bridge, plugin manager
    ├── src/main/           # Main process (session bridge, file scanner, git-service, mcp-store, etc.)
    ├── src/renderer/       # React renderer (components, UI primitives, i18n)
    ├── src/preload/        # Context-isolated preload with typed window.deeporca API
    └── src/shared/         # Type-only IPC contract (dependency-free)
docs/                       # Configuration, MCP, permissions, plan-mode, etc.
docs/superpowers/           # Design specs and implementation plans
scripts/                    # Build, release, and packaging scripts
```

Templates live in `packages/core/templates/` — tools, prompts, skills, and **plugins** (e.g. `browser-skill` as the first built-in plugin). Root `AGENTS.md` contains detailed architecture flows.

**Branch policy**: `master` is the mainline; base new work on it. Untracked leftover package directories from pre-refactor branches may exist on disk — `master` does not track them; don't edit or commit them.

## Extension Mechanisms

DeepOrca provides three parallel extension systems, all auto-injected into sessions:

| System | Location | Examples |
|--------|----------|----------|
| **Skills** (user-defined) | `./.deeporca/skills/`, `./.agents/skills/`, `~/.deeporca/skills/`, `~/.agents/skills/` | Guided workflows via SKILL.md |
| **MCP servers** (external) | `settings.json → mcpServers` | GitHub, Playwright, Filesystem |
| **Built-in plugins** (core) | `packages/core/templates/plugins/` | `browser-skill` (non-removable) |

## Build, Test, and Development Commands

Run from repo root.

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` across all workspaces |
| `npm run lint` / `npm run lint:fix` | ESLint on `packages/*/src/**/*.{ts,tsx}` + `scripts/*.js` |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run check` | Typecheck + lint + format check (run before pushing) |
| `npm run build` | Builds core (tsc), rewrites ESM imports |
| `npm test` | Runs all workspace tests (node:test + tsx) |
| `npm run desktop:build / :dev / :start` | Build / dev / build+run the Electron desktop app |
| `npm run desktop:startMac / :startWin / :startLx` | Build+run with per-OS setup via `scripts/desktop-start.js` |
| `npm run release:version` | Bump version across all packages |
| `npm run clean` | Remove generated files and `dist/` |

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

**Plan Mode**: First turn is read-only; agent must produce `<proposed_plan>` for user approval before writes, deletions, or git mutations. See `docs/plan-mode.md`.
