---
type: desktop
title: Main Process Tool Controllers
description: External capability controllers under main/tools/: OCR review, OpenWiki, Serena, CRG, SkillSpector, Vision MCP, WebFetch provider, GitMCP tools, and editor handling.
tags: [main-process, controllers, cli, mcp]
---

# Main Process Tool Controllers

`packages/desktop/src/main/tools/` hosts all **host-injected external capabilities**: each controller implements the seam interfaces defined by core (`configure*Controller`/`get*Controller`), managing child processes/connections within the main process.

## Controller List

| Controller | File | Capability |
| --- | --- | --- |
| `OcrCliController` | `ocr-cli.ts` | Alibaba Open Code Review (OCR): `review.run`/`review.checkAvailable`; `ReviewProgressEvent` streaming output |
| `WikiCliController` | `wiki-cli.ts` | OpenWiki documentation generation (vendored CLI, see [knowledge-indexing](knowledge-indexing.md)); writes CodeGraph/Serena connector configuration |
| `SerenaCliController` | `serena-cli.ts` | Serena semantic search/edit (SolidLSP 40+ languages); uv detection argv-ization + path validation (security remediation); Electron handshake fix (stdout block buffering) |
| `CrgCliController` | `crg-cli.ts` | CRG build/visualization (`.code-review-graph/`); queries route through core `CrgGraphQuery` |
| `SkillSpectorCliController` | `skill-spector-cli.ts` | Skill/MCP security scanning (68 vulnerability patterns); git+SHA installation (PyPI packages are malicious) |
| `SdkCodegraphController` | `codegraph-sdk.ts` | CodeGraph indexing/sync (SDK) |
| `VisionServerBuilder` | `vision-mcp.ts` | Built-in Vision MCP server (`settings.visionModel` configuration; empty = disabled) |
| `WebFetchProvider` | `web-fetch-provider.ts` | **Offscreen Chromium rendering provider for the built-in WebFetch** (hidden-window rendering + static fallback) |
| `GitmcpTools` | `gitmcp/` | GitMCP 8 tools (zread research's four enhancements filed separately, commit bdc6227a) |
| `DembrandtBrowser` | `dembrandt-browser.ts` | Brand ingestion via CDP (see [design-system](design-system.md)) |
| `DdPackage` | `dd-package.ts` | `.ddp`/`.ddu` delivery package builds |
| `EditorHandlers` | `editor-handlers.ts` | Monaco editor read/write/list (containment validation) |

## Security and Degradation Red Lines

- All CLI controllers were remediated per "command argv-ization + path containment + version/wheel path validation" (Mimosa gate, commit f0b7cf90).
- Controller availability failure = graceful degradation (`checkAvailable` returns false, UI hides entry points), **no silent failures** (same applies to sandbox degradation: it must always be reported).
- Long-running child processes are tracked in `activeHelperProcesses`; on app exit, `killHelperProcesses` cleans them up.

## Focused Tests

- `gitmcp-tools.test.ts` (22.7KB): 8 tool contracts.
- `safe-path.test.ts` (9.8KB): path containment.
- `workspace-trust.test.ts`: trust tiers.
- `dd-package.test.ts`: delivery package builds.
- Core side: `codegraph.test.ts`, `mcp-client.test.ts`.

## Related Pages

- [knowledge-indexing](knowledge-indexing.md), [design-system](design-system.md), [activity-frames](activity-frames.md)
- [main-process](main-process.md) (injection points)