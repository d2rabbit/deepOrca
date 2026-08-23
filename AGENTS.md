# AGENTS.md

This file provides guidance to Qoder (qoder.com) when working with code in this repository.

## What this repo is

`deeporca` — an npm **workspaces monorepo** for "DeepOrca", a coding-agent
harness tuned for DeepSeek models. Ships as an Electron desktop client driven by
a shared core engine.

Packages (under `packages/`):

| Package      | Scope npm name        | Role                                                                                                                  |
| ------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `core/`      | `@deeporca/core`      | Engine: LLM session loop, 8 built-in tools, MCP client, permissions, settings, semantic routing. No UI deps.          |
| `desktop/`   | `@deeporca/desktop`   | Electron GUI built on the core engine. Depends on core + memory.                                                      |
| `memory/`    | `@deeporca/memory`    | In-process L0–L3 memory pipeline (vendored TDAI Core). Consumed by desktop, injected into core as a `MemoryProvider`. |
| `embedding/` | `@deeporca/embedding` | Local embeddings (transformers.js + ONNX, IBM Granite 97M R2). Lazily `import()`ed by core's routing.                 |

`memory/src/tdai/` is a **complete self-contained fork** of TDAI Core (~17k LOC,
MIT — see `memory/src/NOTICE.md`); it does not import the upstream npm package.
`@tencentdb-agent-memory/tcvdb-text` is a _different_ package and is a live
runtime dependency (BM25, statically imported and on by default) — don't remove it.

`docs/` = user-facing docs. `scripts/` = build/release/packaging JS. `.deeporca/` =
the product's own config dir (settings, plugins, skills, in-repo AGENTS.md).
`specs/` = feature specs (requirements/design/tasks). `docs-site/` = static GitHub Pages site.

**Branch policy: `master` is the mainline; `dev` is the integration line; `test` is the
frozen pre-production test line.** Feature work happens on `feat/*` branches, merges into
`dev` (no-ff), and `test` is derived from `dev` for pre-production testing — **frozen for
new features** (only fix/perf/docs/test/chore land there); new features go on `next/*`
branches for the next version. Older branches (`main`, legacy `feat/*`) predate the
DeepOrca desktop-only refactor — a leftover untracked `packages/cli/` directory may exist
on disk from them; `master` does not track it, don't edit or commit it.

## Layer rules (important)

- **`core` must stay UI-free.** It must not import `react`, `electron`, or
  anything terminal/GUI-specific, and must not call `console.*` directly — the host
  injects loggers (`configureSkillSpectorLogger`, `configureRoutingLogger`). The UI
  layer (`desktop`) depends on core, never the reverse.
- **Vendored tool paths are host-injected, never derived in core.** Only the host
  knows whether it runs from a repo checkout or a packaged app
  (`Resources/app/vendor`), so `main/index.ts` calls
  `configureCodegraphVendorRoot` / `configureCrgVendorRoot` /
  `configureSerenaUvResolver` / `configureSkillSpectorVendorRoot` /
  `configureRoutingModelDir` at boot. Deriving a vendor path from `__dirname`
  inside core is how semantic routing silently pointed at a nonexistent
  `packages/packages/desktop/...` and never ran.
- **Built-in tools are deliberately minimal:** `bash`, `read`, `write`, `edit`,
  `AskUserQuestion`, `UpdatePlan`, `WebSearch`, `WebFetch` (first-party search +
  rendered/static page fetch — see `tools/web-search-providers.ts` /
  `tools/web-fetch-handler.ts` and the hidden offscreen Chromium provider in
  desktop `main/tools/web-fetch-provider.ts`). External capabilities come via
  MCP — do not add new built-in tools lightly.
- **Snippet editing contract:** the `read` tool returns a `snippet_id`; the `edit`
  tool _requires_ that `snippet_id` and only searches within the snippet. Preserve
  this when touching `packages/core/src/tools/read-handler.ts` / `edit-handler.ts`.
- **Desktop IPC:** the contract lives in `packages/desktop/src/shared/ipc.ts`
  (dependency-free so both sides can bundle it — mostly types, plus the
  `IpcRequest`/`IpcEvent` channel-name constants, which are real runtime exports).
  `main/` owns the engine, `preload/` runs under contextIsolation and exposes a
  typed `window.deeporca`, `renderer/` is a browser bundle with no Node/Electron
  access. Edit the contract in `shared/ipc.ts` and wire both ends; do not ad-hoc
  `ipcRenderer` calls in the renderer.
- **bash tool needs a POSIX shell.** On Windows, `setShellIfWindows()` (core) points
  it at Git Bash. Keep this working — don't assume `cmd`/PowerShell will do.

## Commands (run from repo root)

| Command                                                   | Purpose                                                                                                                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                       | `tsc --noEmit` across all workspaces                                                                                                                     |
| `npm run lint` / `npm run lint:fix`                       | ESLint on `packages/*/src/**/*.{ts,tsx}` + `scripts/*.js`                                                                                                |
| `npm run format` / `npm run format:check`                 | Prettier                                                                                                                                                 |
| `npm run check`                                           | typecheck + lint + format:check (run before pushing)                                                                                                     |
| `npm run build`                                           | all `@deeporca/*` tsc packages in dependency-topological order → rewrite ESM imports (core/dist). `desktop` is excluded — it builds via `desktop:build`. |
| `npm test`                                                | run every workspace's tests                                                                                                                              |
| `npm run desktop:build` / `desktop:dev` / `desktop:start` | Electron app build / dev / build+run                                                                                                                     |
| `npm run desktop:startMac` / `startWin` / `startLx`       | build+run with per-OS setup via `scripts/desktop-start.js`                                                                                               |
| `npm run release:version`                                 | bump version across all packages                                                                                                                         |
| `npm run clean`                                           | remove generated files and `dist/`                                                                                                                       |

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
  When adding files to core, write source imports _without_ extensions (the script
  adds them) — match existing core files.
- **Lint:** `no-console` is off. Unused vars/params may be `_`-prefixed.
  `@typescript-eslint/consistent-type-imports` is on (warn) — reinforces `import type`.
- **Pre-commit:** Husky runs `lint-staged` (eslint --fix + prettier --write on
  staged `*.{ts,tsx,js,mjs,cjs,jsx}` and `*.json`). Format before building to avoid
  surprises.

## Generated / gitignored (do not edit by hand)

- `dist/`, `out/`, `*.tsbuildinfo` — build artifacts.
- `vendor-src/`, `packages/desktop/vendor/` — vendored third-party clones,
  downloaded binaries and compiled builds (CodeGraph, OpenWiki, uv, Serena,
  SkillSpector, CRG, Granite embedding model, …).
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
6. **Session-index invariant (read this before touching `loadSessionsIndex` /
   `saveSessionsIndex`)**: index writes are debounced (250ms) into `pendingIndex`,
   so **reads must prefer `pendingIndex` over the file**. `updateSessionEntry` is
   load→mutate→save, and it runs ~17× per streaming turn — if the read goes to the
   now-stale file, two updates in one window each rebase on the old state and the
   first is _permanently lost_ (this corrupted `usage`/`usagePerModel` accounting and
   dropped `permission_denied`). Terminal, user-visible decisions
   (create/delete/deny) call `flushSessionsIndex()` to bypass the debounce.
   Note `pendingIndex` holds the _in-memory_ shape (`processes` is a `Map`), so it
   must **not** be passed through `normalizeSessionEntry` — that expects the on-disk
   shape and its `Object.entries()` would silently drop every tracked process.

### Tool routing (`packages/core/src/tools/executor.ts`)

1. `ToolExecutor` holds a `Map<string, ToolHandler>` with all 8 built-in handlers.
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

### Desktop build & vendored tools (`packages/desktop/build.mjs`)

- `desktop:build` runs esbuild to produce three bundles under `packages/desktop/dist/`:
  `main.js` (ESM, main process, node deps + core kept external), `preload.cjs`
  (CJS — required for sandboxed preload), and `renderer/` (browser bundle + html/css).
- Every desktop build also **vendors its third-party tools** via the
  `scripts/vendor-*.js` family (13 of them: codegraph, openwiki, uv, serena, crg,
  skillspector, granite, browser-skill, bento, tailwind, plus the shared
  `vendor-download.js` / `vendor-fs.js` / `vendor-notice.js` helpers). Git-based
  ones keep persistent clones in `vendor-src/` (gitignored), fetch upstream, and
  recompile into `packages/desktop/vendor/<name>` only when HEAD changed
  (`.vendored-head` marker; `--force` to rebuild); download-based ones use a
  pinned-version marker file. Vendoring is best-effort: on network/git failure the
  existing vendored copy keeps working, otherwise runtime falls back to `npx`.
- `electron-builder.yml` copies the whole `vendor/` tree to `Resources/app/vendor`
  via `extraResources` — so anything added under `vendor/` ships in the installer
  (the Granite model alone is ~118MB).
- CodeGraph needs Node 22.5+ at runtime (`node:sqlite`); the desktop client runs the
  vendored entry through a system Node 22+ binary (see `packages/core/src/common/codegraph.ts`).

### Semantic routing (`packages/core/src/routing/`)

- Embedding-based recall that shrinks what reaches the LLM: `SkillRouter.shortlist`
  / `ToolRouter.select` (single routing) and `SkillRouter.composeRoute`
  (compositional, SkillWeaver-style). `enabled: true` by default
  (`DEFAULT_ROUTING_CONFIG`).
- Embeddings come from `@deeporca/embedding`, loaded through a **dynamic import**
  (`routing/embedding-loader.ts`) so core's module load stays fast and a missing or
  broken model degrades gracefully. Routers are **fail-open**: on any failure they
  are `null` and callers use the full candidate set.
- The model dir is resolved as: `DEEPORCA_ROUTING_MODEL_DIR` env →
  `configureRoutingModelDir()` (host injection) → repo-relative fallback. Warmup is
  fire-and-forget, so a bad path only surfaces asynchronously — which is why the
  host logger (`configureRoutingLogger`) must stay wired.
- The embedding service is a **process-wide singleton** holding onnxruntime native
  handles. `SessionManager.dispose()` only drops its router bundle; the host calls
  `closeEmbeddingService()` on app teardown.

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

<!-- OPENWIKI:START -->

## OpenWiki

This repository has a generated `openwiki/` evidence index. It is optional just-in-time context, not required startup reading.

- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Preserve complete failure output.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
