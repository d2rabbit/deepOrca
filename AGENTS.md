# AGENTS.md

This file provides guidance to Qoder (qoder.com) when working with code in this repository.

## What this repo is

`deeporca` — an npm **workspaces monorepo** for "DeepOrca", a coding-agent
harness tuned for DeepSeek models. Ships as an Electron desktop client driven by
a shared core engine.

Packages (under `packages/`):

| Package | Scope npm name | Role |
|---|---|---|
| `core/` | `@deeporca/core` | Engine: LLM session loop, 7 built-in tools, MCP client, permissions, settings. No UI deps. |
| `desktop/` | `@deeporca/desktop` | Electron GUI built on the core engine. Depends on core. |

`docs/` = user-facing docs. `scripts/` = build/release/packaging JS. `.deeporca/` =
the product's own config dir (settings, plugins, skills, in-repo AGENTS.md).

## Layer rules (important)

- **`core` must stay UI-free.** It must not import `react`, `electron`, or
  anything terminal/GUI-specific. The UI layer (`desktop`) depends on core, never
  the reverse.
- **Built-in tools are deliberately minimal:** `bash`, `read`, `write`, `edit`,
  `AskUserQuestion`, `UpdatePlan`, `WebSearch`. External capabilities come via MCP —
  do not add new built-in tools lightly.
- **Snippet editing contract:** the `read` tool returns a `snippet_id`; the `edit`
  tool *requires* that `snippet_id` and only searches within the snippet. Preserve
  this when touching `packages/core/src/tools/read-handler.ts` / `edit-handler.ts`.
- **Desktop IPC:** the contract lives in `packages/desktop/src/shared/ipc.ts`
  (type-only, dependency-free so both sides can bundle it). `main/` owns the engine,
  `preload/` runs under contextIsolation and exposes a typed `window.deeporca`,
  `renderer/` is a browser bundle with no Node/Electron access. Edit the contract in
  `shared/ipc.ts` and wire both ends; do not ad-hoc `ipcRenderer` calls in the renderer.
- **bash tool needs a POSIX shell.** On Windows, `setShellIfWindows()` (core) points
  it at Git Bash. Keep this working — don't assume `cmd`/PowerShell will do.

## Commands (run from repo root)

| Command | Purpose |
|---|---|
| `npm run typecheck` | `tsc --noEmit` across all workspaces |
| `npm run lint` / `npm run lint:fix` | ESLint on `packages/*/src/**/*.{ts,tsx}` + `scripts/*.js` |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run check` | typecheck + lint + format:check (run before pushing) |
| `npm run build` | core tsc → rewrite ESM imports |
| `npm test` | run every workspace's tests |
| `npm run desktop:build` / `desktop:dev` / `desktop:start` | Electron app build / dev / build+run |
| `npm run release:version` | bump version across all packages |
| `npm run clean` | remove generated files and `dist/` |

Single test file: `node packages/<pkg>/src/tests/run-tests.mjs packages/<pkg>/src/tests/<file>.test.ts`
(tests use Node's native runner `node:test` + `node:assert/strict`, executed via `tsx`).

## Toolchain & conventions

- **Node ≥ 22** (`.nvmrc` = 22), **npm 10.9.4** (`packageManager`). ESM only
  (`"type": "module"`). Target ES2022, module ESNext, `moduleResolution: "bundler"`.
- **TypeScript is strict** and `verbatimModuleSyntax: true` → always use
  `import type` for type-only imports (a runtime import will fail the build).
- **Prettier:** 2 spaces, double quotes, semicolons, trailing commas `es5`,
  width 120, LF endings. **File names:** `kebab-case.ts(.tsx)`; tests `*.test.ts`.
- **Core ESM gotcha:** `tsc` emits extensionless relative imports; Node ESM needs
  `.js`. `scripts/rewrite-esm-imports.js` fixes this in `core/dist/` after build.
  When adding files to core, write source imports *without* extensions (the script
  adds them) — match existing core files.
- **Lint:** `no-console` is off. Unused vars/params may be `_`-prefixed.
  `@typescript-eslint/consistent-type-imports` is on (warn) — reinforces `import type`.
- **Pre-commit:** Husky runs `lint-staged` (eslint --fix + prettier --write on
  staged `*.{ts,tsx,js,mjs,cjs,jsx}` and `*.json`). Format before building to avoid
  surprises.

## Generated / gitignored (do not edit by hand)

- `packages/core/src/generated/` — build-time output
  (e.g. git-commit info via `scripts/generate-git-commit-info.js`).
- `dist/`, `out/`, `*.tsbuildinfo` — build artifacts.
- `.deeporca/settings.json`, `.env`, `.env.local` — local secrets/config.

## Commits

Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `style:`, `test:`,
`docs:`, `perf:`, `build:`), scope optional e.g. `fix(mcp): …`. PRs should pass
`npm run check && npm test`; justify any `package-lock.json` churn.

## Architecture: Key Flows

### Session lifecycle (`packages/core/src/session.ts`)

1. **`SessionManager.handleUserPrompt()`** routes to `createSession()` or `replySession()`.
2. **`createSession()`** builds the system prompt chain (via `prompt.ts` templates):
   system prompt → default skills → runtime context → AGENTS.md → plan mode → user message,
   then calls `activateSession()` which enters the LLM tool-call loop.
3. **The LLM loop** (in `activateSession()`) sends messages + tool definitions to the LLM,
   receives streaming responses (content + tool_calls + reasoning), appends assistant messages,
   executes tool calls via `ToolExecutor`, then loops until no tool calls remain or
   `waiting_for_user` / `ask_permission` statuses are hit.
4. **Compaction**: when active tokens exceed a threshold (512K for DeepSeek V4, 128K for others),
   the middle 2/3 of non-system messages are summarized by the LLM and replaced with a compact summary.
5. **Persistence**: sessions are stored as `~/.deeporca/projects/<projectCode>/sessions-index.json`
   and individual session messages as `*.jsonl` files. Each session has a file history (lightweight
   Git repo under `file-history/.git`) for undo support.

### Tool routing (`packages/core/src/tools/executor.ts`)

1. `ToolExecutor` holds a `Map<string, ToolHandler>` with all 7 built-in handlers.
2. When a tool call arrives, it checks the handler map first. Bash tool calls also get
   alias resolution (`Bash` → `bash`, etc.).
3. If no built-in handler matches, it falls through to `mcpManager.isMcpTool()` — MCP tools
   are checked by name and executed via `mcpManager.executeMcpTool()`.
4. Tool arguments are parsed from JSON strings; parse errors return structured error responses
   with `InputParseError:` prefix.
5. Tool results are serialized to JSON with `{ ok, name, output?, error?, metadata? }` format.
   `AskUserQuestion` sets `awaitUserResponse: true` to pause the loop.

### Message conversion (`packages/core/src/common/openai-message-converter.ts`)

- `OpenAIMessageConverter` converts `SessionMessage[]` → `ChatCompletionMessageParam[]`
- Pairs tool results with their corresponding tool calls by matching `tool_call_id`.
- Handles interrupted tool calls, image content (multimodal), thinking mode messages.
- The `buildMessages()` method renders the init command prompt template at the correct position.

### Permission system (`packages/core/src/common/permissions.ts`)

- Each bash command declares side effects (`sideEffects` array in the tool schema):
  `read-in-cwd`, `write-in-cwd`, `delete-in-cwd`, `network`, `mutate-git-log`, etc.
- File tools (read/write/edit) get permissions inferred from file path vs project root.
- `computeToolCallPermissions()` analyzes all tool calls in one assistant turn and returns
  either "allowed" or a list of `AskPermissionRequest` objects requiring user approval.
- In Plan Mode, write/delete/git-mutate scopes are force-set to "ask" regardless of settings.

### Prompt system (`packages/core/src/prompt.ts`)

- System prompt is built from EJS templates in `packages/core/templates/tools/` (one `.md.ejs`
  per tool). Tool docs are read, rendered, and concatenated after the base system prompt.
- Runtime context includes OS info, shell path, node/python versions, installed tools (rg, jq).
- Skills are loaded as XML-tagged blocks via `buildSkillDocumentsPrompt()` — each skill becomes
  `<skill-name path="...">content</skill-name>` in the system messages.
- Plan Mode prompt comes from `templates/prompts/plan.md`.

### MCP lifecycle (`packages/core/src/mcp/`)

- `McpManager` owns server configurations and a map of `McpClient` instances.
- `McpClient` manages a child process per server, communicating via JSON-RPC over stdio.
- Tools are discovered through `tools/list` and cached. On `tools/list` changed notifications,
  `mcpToolDefinitions` are refreshed in the session manager.
- `getMcpToolDefinitions()` returns `ToolDefinition[]` that gets merged into the LLM's tool list.

### Skills discovery (`packages/core/src/session.ts`)

- Skills are scanned from these locations (in priority order):
  `./.deeporca/skills/` (or legacy `./.deepcode/skills/`) → `./.agents/skills/` →
  `~/.deeporca/skills/` (or legacy `~/.deepcode/skills/`) → `~/.agents/skills/` → bundled.
- Each skill directory must contain a `SKILL.md` with YAML frontmatter (`name`, `description`).
- Automatic skill matching uses the LLM itself: candidate skill names+descriptions are sent to
  the model, which returns matching names in JSON format.
- Three bundled skills ship with the product: `deeporca-self-refer`, `skill-digester`, `skill-writer`.
  `karpathy-guidelines` is injected as a default skill template.

## Areas that need extra care

Before changing these, read the corresponding doc first:
- Session/compaction, prompt layout, cache ordering → `docs/architecture.md` +
  `docs/session-persistence.md`.
- Tool permission scopes → `docs/permission.md` + `packages/core/src/common/permissions.ts`.
- MCP lifecycle → `docs/mcp.md` + `packages/core/src/mcp/`.
- Plan Mode (read-only first turn, `<proposed_plan>` approval) → `docs/plan-mode.md`.
- Skills discovery/loading → `docs/agent-skills.md`.
