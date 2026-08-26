---
type: desktop
title: 主进程工具控制器（main/tools/）
description: host 注入的外部能力控制器清单：OCR/Wiki/Serena/CRG/SkillSpector/CodeGraph/Vision/WebFetch/GitMCP/Dembrandt/DdPackage/Editor/A2UI 及安全降级红线。
tags: [desktop, main-process, tools, controllers]
---

# Main Process Tool Controllers

`packages/desktop/src/main/tools/` hosts all **host-injected external capabilities**: each controller implements the seam interfaces defined by core (`configure*Controller`/`get*Controller`), managing child processes/connections within the main process.

## Controller List

| Controller | File | Capability |
| --- | --- | --- |
| `OcrCliController` | `ocr-cli.ts` | Alibaba Open Code Review (OCR): `review.run`/`review.checkAvailable`; `ReviewProgressEvent` streaming output; runs via core `spawnTracked` (15 min hard timeout, `DEEPORCA_OCR_TIMEOUT_MS` override) |
| `WikiCliController` | `wiki-cli.ts` | OpenWiki documentation generation (vendored CLI, see [knowledge-indexing](knowledge-indexing.md)); writes CodeGraph/Serena connector configuration; runs via core `spawnTracked` (60 min timeout `DEEPORCA_WIKI_TIMEOUT_MS`, 20s heartbeat, `.last-update.json` completion marker via `wiki-marker.ts` with 60s force-finish) |
| `SerenaCliController` | `serena-cli.ts` | Serena semantic search/edit (SolidLSP 40+ languages); uv detection argv-ization + path validation (security remediation); Electron handshake fix (stdout block buffering) |
| `CrgCliController` | `crg-cli.ts` | CRG build/visualization (`.code-review-graph/`); queries route through core `CrgGraphQuery`; runs via core `spawnTracked` (20 min timeout `DEEPORCA_CRG_TIMEOUT_MS`, heartbeat "图谱构建无进度流") |
| `SkillSpectorCliController` | `skill-spector-cli.ts` | Skill/MCP security scanning (68 vulnerability patterns); git+SHA installation (PyPI packages are malicious) |
| `SdkCodegraphController` | `codegraph-sdk.ts` | CodeGraph indexing/sync (SDK) |
| `VisionServerBuilder` | `vision-mcp.ts` | Built-in Vision MCP server (`settings.visionModel` configuration; empty = disabled) |
| `WebFetchProvider` | `web-fetch-provider.ts` | **Offscreen Chromium rendering provider for the built-in WebFetch** (hidden-window rendering + static fallback) |
| `GitmcpTools` | `gitmcp/` | GitMCP 8 tools (zread research's four enhancements filed separately, commit bdc6227a) |
| `DembrandtBrowser` | `dembrandt-browser.ts` | Brand ingestion via CDP (see [design-system](design-system.md)) |
| `DdPackage` | `dd-package.ts` | `.ddp`/`.ddu` delivery package builds |
| `EditorHandlers` | `editor-handlers.ts` | Monaco editor read/write/list (containment validation) |
| `A2uiServerBuilder` | `tools/a2ui/a2ui-mcp.ts` | In-process A2UI MCP server (12 tools incl. `save_archmap` md/html + `render_spec`); scoped persistence (`persistSurfaces` idPrefix/stamp + `knownSurfaceIds` sweep guard, see [design-system](design-system.md)) |

## Security and Degradation Red Lines

- All CLI controllers were remediated per "command argv-ization + path containment + version/wheel path validation" (Mimosa gate, commit f0b7cf90).
- **Long-running CLI runs share one hardened runner** (core `common/spawn-tracked.ts`): `exit`-authoritative settlement + 2s stdout-flush grace, hard timeout (SIGKILL + reject; per-CLI env override), heartbeat with `finishOk()` force-success escape (wiki completion marker), single-settle guard, stderr immediately surfaced to the host log — the index-knowledge "stuck on running" failure class has a single implementation in core, never duplicated in desktop adapters.
- Controller availability failure = graceful degradation (`checkAvailable` returns false, UI hides entry points), **no silent failures** (same applies to sandbox degradation: it must always be reported).
- Long-running child processes are tracked in `activeHelperProcesses`; on app exit, `killHelperProcesses` cleans them up.

## Focused Tests

- `gitmcp-tools.test.ts` (22.7KB): 8 tool contracts.
- `safe-path.test.ts` (9.8KB → 13KB): path containment + `safeArchmapPath` guards (archmap arbitrary-read fix, commit e061e062).
- `wiki-marker.test.ts`: openwiki completion-marker semantics (mtime window, half-written tolerance).
- `workspace-trust.test.ts`: trust tiers.
- `dd-package.test.ts`: delivery package builds.
- A2UI side: `a2ui-normalize.test.ts`（v0.9 形状修复）、`a2ui-persist-race.test.ts`（持久化竞态）、`a2ui-processor.test.ts`（renderer）。
- Core side: `spawn-tracked.test.ts`（管道持有/超时/forcedOk）、`codegraph.test.ts`, `mcp-client.test.ts`.

## Related Pages

- [knowledge-indexing](knowledge-indexing.md), [design-system](design-system.md), [activity-frames](activity-frames.md)
- [main-process](main-process.md) (injection points)