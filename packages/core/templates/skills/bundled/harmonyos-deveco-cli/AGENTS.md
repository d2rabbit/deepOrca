# Agents.md

Guidance for AI coding assistants working in this repo.

## What this repo is

`deveco-cli` wraps the DevEco Studio toolchain (`ohpm`, `hvigor`, `hdc`, `emulator`, `hilog`, bundled `node` + JBR + SDK) plus a HarmonyOS skills installer and a project-scaffolding template engine — all behind a single `devecocli` binary. Distribution is one minified ESM bundle `dist/cli.js` (bin: `devecocli`).

Commands shipped: `build`, `run`, `update`, `device`, `emulator`, `skills`, `log`, `create`, `init`, `serve`, `docs`, `ui`, `check`, `auth`, `signature`.

User-facing invocation guide for AI agents lives in `SKILL.md` — update it whenever a command or flag changes.

## Commands

```bash
npm run build      # tsup → dist/cli.js (prepublishOnly runs lint → license → build)
npm run dev        # tsx watch mode
npm start          # tsx one-shot, no build
npm run lint       # eslint src
npm run lint:fix   # eslint --fix
npm run format     # prettier --write src
npm run license    # regenerate THIRD-PARTY-LICENSES
npm run build:index # regenerate index.zip for `devecocli docs` search
```

There is **no test framework** (no vitest/jest, no `*.test.ts`). Verification = `npm run lint` + manual smoke. `prepublishOnly` is the closest thing to CI locally.

## Conventions that bite

- **Modules**: ESM, `"type": "module"`. Internal imports **must** use `.js` even when the source is `.ts`.
- **Output bundle**: edits to `src/` are not visible until `npm run build` (or `npm run dev` / `npm start`).
- **Husky**: pre-commit runs `npm run lint`; `prepare-commit-msg` auto-appends `Signed-off-by:` (DCO).

## Env vars

- `DEVECO_CLI_DEBUG=1` — log raw `node` / `ohpm` / `hvigor` / `hdc` / `emulator` invocations via `utils/logger.ts → debugLog`. Also prints stack traces on error from `cli.ts`.
- `DEVECO_CLI_SKIP_VERSION_CHECK=1` — bypass the DevEco Studio 6.1.0+ version check on startup. (`update` is the only command exempt by default; see `TOOLCHAIN_FREE_COMMANDS` in `src/cli.ts`.)
- `DEVECO_CLI_DATA_DIR` — override user data root (default `~/.local/share/deveco-cli`). Derives `docs/.index/search.db`, `logs/doc-init.log`, etc.
- `HTTP_PROXY` / `HTTPS_PROXY` — honoured by `global-agent` bootstrapped in `src/cli.ts`.

## Architecture

```
src/
├── cli.ts                    # Commander entry; global-agent bootstrap; preAction version check
├── commands/                 # One file per subcommand. Keep it thin: CLI shape + spinner + render.
├── compat/                   # compat command: SDK API compatibility scanning (single-file module — see "Compat module" below)
├── auth/                     # auth command: login, logout, status, team (login flow + encrypted token storage)
├── skills/                   # HarmonyOS skills marketplace client (api + installer + agents + mcp-installer)
├── service/                  # Domain helpers (device, emulator, doc)
├── utils/                    # Adapters (hdc, hilog, ohpm, hvigor) + shared validators
├── config/                   # constants, network, skills, mcp
├── data/                     # Bundled data files (e.g. emulator-privacy-bundled.ts)
├── types/                    # Shared type defs
├── toolchain/                # DevEco Studio toolchain resolution (ToolProvider: node/ohpm/hvigor/java/hdc/emulator/sdk)
└── internal/                 # Internal entry points (e.g. doc-init-background.ts, also a tsup entry)

mcp/src-server/               # Bundled stdio MCP server (ArkTS/C++ syntax checking via LSP)
templates/application/        # Project scaffold copied by `devecocli create`
scripts/                      # postinstall + docs index bootstrap
index/                        # Source for `npm run build:index` (regenerates index.zip)
```

**Real entrypoints**: `src/cli.ts` is the user-facing bin. `src/internal/doc-init-background.ts` is a second tsup entry spawned after install to populate the docs search index. `mcp/src-server/index.ts → createMcpServer` is the MCP orchestrator started by `devecocli serve mcp`.
**Toolchain resolution**: `toolchain/tool-provider.ts` finds DevEco Studio (Win: registry → `C:\Program Files\Huawei\DevEco Studio`; macOS: `~/Applications` + `/Applications` for `*DevEco*.app`; **Linux unsupported**). It resolves `nodePath` / `ohpmJsPath` / `hvigorJsPath` / `javaPath` / `hdcPath` / `emulatorPath` / `sdkPath`. hilog is not a separate binary — it runs through `hdc shell hilog`.
**Build pipeline**: `commands/build.ts` runs `ohpm install --all → hvigor --sync → hvigor assemble*`. The artifact path resolver lives in `utils/project.ts → findArtifactPath`.
**Apply**: `commands/run.ts --apply <fileName>` fast-incremental-deploys changed files — writes the list to `.hvigor/<fileName>`, drives hvigor `assembleDevHqf` to produce signed hqf, installs via `bm quickfix -a -f -o`, then restarts. Modules auto-detected from file paths. Requires DevEco Studio ≥6.1.1 (hvigor `assembleDevHqf`); below is rejected with an upgrade hint. Prereq: `devecocli run` once first (generates `buildConfig.json` cache); on failure falls back to a full `devecocli run`.
**Device selection**: `service/device-manager.ts` is the single source for "what's connected". Commands that accept a device use a shared resolver that maps a user-supplied name or serial to a concrete serial.
**Skills / MCP init**: `commands/init.ts` and `commands/skills.ts` share `src/skills/agents.ts` helpers (`parseAgentList` / `getAllExistingAgents` / `summarizeOperationResults`). `--skill` and `--mcp` are mutually exclusive; default is `--skill`.
**Docs index**: `commands/doc.ts` triggers `awaitDocReady()` (spinner while postinstall installs the index in background). The postinstall script extracts the prebuilt `index.zip` only — `docs.zip` is read on demand. To refresh the index: `npm run build:index` then republish.
**Compat module**: `src/compat/compat.ts` (registered as `check compat` in `src/commands/check.ts`) drives DevEco Studio's bundled `apkanalyzer-apiscan` plugin via Node — `hvigor compileNative` for native side, then `node api-change-scan.js --startVersion/--endVersion/...` to produce a CSV report. Format values are `default | csv | json`; `default` writes csv to a file but renders text to console, `csv` requires `--output-path`, file extension must match `--format`. Directory output (`--output-path` is a directory, no extension) is format-aware: `--format json` writes `apiChange-res{N}.json`, `--format default`/`csv` writes `apiChange-res{N}.csv` (via `persistReportToDir`). Spinner uses `execa` (async) so the animation runs during the scan — do not switch back to `execFileSync` (sync blocks the event loop and the spinner freezes). `HvigorAdapter` is instantiated with `silent: true` for this command so hvigor's own output is suppressed.

## Standard paradigm: how to add a new domain module

When adding a new cross-command capability (UI inspection, screenshots, simulators, etc.), extract the domain logic out of `commands/` into a dedicated domain module under `src/`. Don't invent a new shape — use this structure:

```
src/<domain>/
├── index.ts                 # Single barrel — re-export adapters + types only
├── <capability-a>/
│   ├── types.ts             # Domain types
│   ├── <verb-or-noun>.ts    # One or more pure modules named for what they do
│   └── <adapter>.ts         # Adapter class wrapping external IO + the pure modules
└── <capability-b>/
    ├── types.ts
    └── <adapter>.ts
```

**Naming — name files after what they contain, not after a generic role:**

- Pick names that describe the content (e.g. `parsers.ts`, `collapse.ts`). **Never** use `helpers.ts`, `utils.ts`, `common.ts` — these are a smell.
- A capability **does not need a pure module** if the logic fits in `types.ts` or the adapter. Don't add files for symmetry.
- The adapter is usually the only file doing IO; the `-adapter` suffix is optional — use it only when it disambiguates.

## Rules

### Domain module rules

Rules (enforced by convention; not lint):

1. **One barrel per domain.** `src/<domain>/index.ts` is the only thing `src/commands/*` imports from. **Never** import from `src/<domain>/<capability>/*` directly.
2. **Three-layer split inside each capability**: `types.ts` → pure helpers (parsers, fold/collapse, normalizers) → adapter class that composes the helpers with external IO (hdc, http, fs). The pure layer is the only thing that should be unit-testable in isolation.
3. **Cross-capability coupling goes through the adapter**, not through shared types. If capability A needs data from capability B, A's adapter instantiates B's adapter and calls it — don't duplicate B's types into A's `types.ts`.
4. **Adapter methods are case-shaped**, not verb-shaped. Expose specific methods like `getFullTree(serial, depth, windowId)` and `getCollapsedTree(...)`, not one generic `get(options)`. Keep the IO orchestration (`buildRemoteX → recv → parse → cleanup`) as private methods on the adapter.
5. **Commands stay thin**: `Options` interface + commander option chain + `handle*` async function that does spinner → call adapter → format output. Renderers (`renderTree`, `renderTable`, JSON shape) live in the command file or a small util, not in the domain.
6. **No business logic in commands.** If `commands/<x>.ts` grows past ~200 lines and is mostly orchestration, you're missing a `<domain>/<capability>/<adapter>.ts`. Follow the standard paradigm above instead.
7. **Adding the command**: put `import { ... } from '../<domain>/index.js'` at the top of the new `commands/<x>.ts`, register it in `src/cli.ts` alongside the other `program.addCommand(...)` calls. Don't touch the barrel beyond adding the new export.

### General rules

8. **No `process.exit` in business logic.** All code must throw or return a failure result. The single termination point is `src/cli.ts`. `utils/ora-fail.ts` is a legacy exception — **new or modified code must not call it**.
9. **Log every spawned command line.** Before spawning any external CLI (`hdc`, `hvigor`, `ohpm`, `emulator`, bundled `node`, etc.), emit `debugLog(`Executing: ${cmd} ${args.join(' ')}`)` from `utils/logger.ts`.
10. **Comments**: keep comments brief — state purpose only, no verbose explanations. Existing `Copyright (c) 2026 Huawei Device Co., Ltd.` SPDX headers are mandatory — preserve them.
11. **CLI flags**: kebab-case. `--device <name|serial>` accepts either. Multi-device hosts must list available devices and exit non-zero rather than pick a default.
12. **Format per file, not globally.** Use `npx prettier --write <file>` and `npx eslint --fix <file>` on changed files only. Never run `npm run format` or `npm run lint:fix` on the whole tree.
13. **Adding a flag or command?** Update the matching prose in **both** `SKILL.md` and `README.md`.

### How to migrate existing code to this shape (gradual)

The seven rules above are the **destination**, not a one-shot rewrite mandate. Most `commands/*` files today predate the paradigm and still hold orchestration that belongs in a `<domain>/<capability>/<adapter>.ts`. We migrate **opportunistically, one touch at a time** — every change to a legacy file should leave it a little closer to the shape, without growing the diff beyond what the change actually requires.

When you touch an existing `commands/<x>.ts` (or any module that doesn't follow the shape), apply this judgement in order. **Stop at the first step that already passes**; don't refactor past the line you're already crossing:

1. **Am I adding a new capability?** → Create `src/<domain>/<capability>/{types,pure-helpers,adapter}.ts` and the barrel export **first**; then write the thin `commands/<x>.ts`. (Rules 1–7 apply in full — this is the easy case.)
2. **Am I editing a file that already follows the shape?** → Respect the layer you're in. Don't reach across layers (helper from adapter is fine; adapter logic from pure helpers is not). No structural change needed.
3. **Am I editing a legacy `commands/<x>.ts`?** → Keep the change minimal, but if the touched block is clearly orchestration that belongs in an adapter (e.g. building a remote command, parsing device output, talking to `hdc`/`hvigor`/`ohpm`/`emulator`/bundled `node`), **move that block into a new or existing `<domain>/<capability>/<adapter>.ts`** and call it from the command. Don't move unrelated code in the same PR.
4. **Am I adding new logic to a legacy file for a brand-new capability that has no domain yet?** → Same as step 1, but it's OK to do it from inside the legacy command first **only if** the legacy command is being deleted/rewritten anyway. Otherwise, create the domain module and route through the barrel from the start.
5. **Am I doing a pure refactor with no behaviour change?** → Use a dedicated commit. The migration is the _point_ of the commit, not a side effect.

**What "closer to the shape" looks like, concretely:**

- A `commands/<x>.ts` block that does `hdc shell ... → parse stdout → return result` becomes one adapter call from the command.
- A duplicated type in two places gets removed; the second place imports it from the owning domain's barrel.
- A `commands/<x>.ts` that grows past ~200 lines and is mostly orchestration is the next migration target — but only migrate it when something in that file genuinely needs to change, or in a dedicated refactor commit.

**The bar is "each commit leaves the codebase a bit closer to the paradigm, never further."** New code follows the seven rules strictly. Old code converges one block at a time.

## Misc operational gotchas

- **JSON5 everywhere** for HarmonyOS configs (`build-profile.json5`, `module.json5`, `oh-package.json5`, `app.json5`) — use `json5` to parse, not native `JSON.parse`.
