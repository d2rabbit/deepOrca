---
type: desktop
title: Build and Vendoring
description: Desktop build (three esbuild bundles), the vendoring mechanism for the 13 vendor scripts, and the electron-builder packaging and release flow.
tags: [build, vendoring, esbuild, packaging]
---

# Build and Vendoring

## Workspace Build (`scripts/build.js`, `npm run build`)

- The build order **is automatically derived from each package.json's `@deeporca/*` dependencies** (Kahn topological sort, not hardcoded): core → embedding/memory → …; `@deeporca/desktop` **is excluded** (it uses its own esbuild pipeline, `desktop:build`); if a cycle is detected, exit 1.
- Finally, `scripts/rewrite-esm-imports.js` runs: it appends `.js` to extensionless relative imports in `core/dist/` (required by tsc's ESM output; core source keeps the extensionless style, and the script is responsible for filling in the suffix).

## Desktop Build (`packages/desktop/build.mjs`)

esbuild produces three bundles into `packages/desktop/dist/`:

| Bundle | Format | Description |
| --- | --- | --- |
| `main.js` | ESM | Main process; node dependencies + core kept external (resolved from node_modules at runtime); target node24; `packages: "external"` |
| `preload.cjs` | CJS | Sandboxed preload requires CJS; electron external |
| `prototype.cjs` | CJS | Restricted preload for the A2UI prototype window |
| `dembrandt-provider.cjs` | CJS | **dembrandt CDP 隔离子进程入口**（2026-08-27 e9da728f 新增）：独立 Electron 子进程运行唯一带 remote-debugging 的 Chromium，随机端口 + 私有 userData（见 [main-process](main-process.md)） |
| `renderer/` | Browser | React GUI + index.html + styles.css |

- Conditional compilation: `process.env.DEEPORCA_DEBUG` (dev=1/prod=0, production tree-shakes out debug code).
- Production: minify + drop debugger + `pure: ["console.debug"]`.
- `--dev`: sourcemap, no minification, `NODE_ENV=development` (opens DevTools).
- Monaco lazy loading (on the renderer App side, ~5MB deferred).

## Vendoring (`scripts/vendor-*.js`, 13 files)

| Category | Scripts |
| --- | --- |
| Tools (10) | `vendor-bento.js`, `vendor-browser-skill.js`, `vendor-crg.js`, `vendor-dembrandt.js`, `vendor-granite.js`, `vendor-openwiki.js`, `vendor-serena.js`, `vendor-skillspector.js`, `vendor-tailwind.js`, `vendor-uv.js` |
| Shared helpers (3) | `vendor-download.js`, `vendor-fs.js`, `vendor-notice.js` |

> Note: **there is no vendor-codegraph.js** — CodeGraph is brought in via the npm dependency `@colbymchenry/codegraph` (desktop package.json).

Mechanism:

- **Git-based**: persistent clone in `vendor-src/` (gitignored) → when upstream HEAD changes (`.vendored-head` marker) → recompile into `packages/desktop/vendor/<name>`; `--force` forces a rebuild.
- **Download-based**: **version marker files** (`.vendored-*-version`, with content like `repo@tag#rev`) — if the marker is hit, re-downloading is skipped (e.g., skill-up v0.9.0, Granite model ~118MB).
- **Atomic replacement**: `withAtomicSwap` in `vendor-fs.ts` — writes a temp file first, then renames; crash-safe (no half-written files left behind).
- **Download fallback chain**: with `vendor-granite.js` as the example — huggingface.co → hf-mirror.com fallback; env overrides (such as `GRANITE_MODEL_TAG`) are accepted only after regex validation.
- **Offline-first**: vendored models/binaries are **never downloaded at runtime** ("never npx"); `configureRoutingModelDir`/`configureDembrandtVendorRoot`/`configureUvVendorRoot` consume vendored paths (a dev checkout with no configured vendor root reports unavailable rather than npx — asserted in `design-dembrandt.test.ts`; vendor roots containing `..` segments are rejected).
- **Best-effort**: on network/git failure, the existing vendored copy is kept; otherwise runtime falls back to `npx`.
- Vendoring runs on every desktop build.
- **下载链路加固**（2026-08-27）：`vendor-download.js`/`vendor-openwiki.js` 下载失败自愈 + 重试；`vendor-browser-skill.js` 版本钉死 0.1.9（不再跟 latest 浮动）+ release asset **sha256 digest 校验**（e9da728f）；HF 下载（granite）走**内容寻址校验**（dc5afce5）。

## Packaging (`electron-builder.yml` + `scripts/package-desktop.js`)

- `electron-builder.yml`: `extraResources` copies the entire `vendor/` tree to `Resources/app/vendor` — **anything new added under `vendor/` goes into the installer**.
- `scripts/package-desktop.js` (15.6KB): stage + electron-builder packaging.
- `npm run desktop:startMac/startWin/startLx` → `scripts/desktop-start.js` (per-OS pre-launch handling).

## Release and Quality Gates

- `scripts/version.js`: cross-package version bump (`release:version`).
- `scripts/check-licenses.js`: license compliance gate for the dependency tree (wired into `npm run check`).
- `.github/workflows/`: ci.yml (typecheck+lint+format+test), release.yml, pages.yml (docs-site static site), openwiki-update.yml (scheduled wiki refresh), skill-evals.yml.
- Full check: `npm run check` = build + typecheck + lint + format:check + license:check; `npm test` runs all workspaces.

## Other scripts/

- `scripts/clean.js` (`npm run clean`: cleans generated files and dist/), `scripts/rewrite-esm-imports.js` (fixes the ESM suffix in core/dist), `scripts/generate-openui-prompt.mjs`.
- Manual verification scripts (not run via package.json/CI, for humans): `scripts/test-arch-scan.mjs`, `test-composition.mjs`, `test-embedding.mjs`, `test-recall.mjs` — corresponding respectively to smoke verification of the [arch-scan](../core/actions.md), [semantic routing](../core/routing.md), [embedding](../embedding/overview.md), and [memory](../memory/overview.md) subsystems.

## Related Pages

- [desktop/overview](overview.md), [main-process](main-process.md)
- [skill-evals](skill-evals.md) (same-family pin policy)