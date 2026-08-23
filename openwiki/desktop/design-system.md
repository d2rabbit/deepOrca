---
type: desktop
title: Design System (DeepDesign / A2UI / OpenUI Lang / dembrandt)
description: The three design capabilities—DeepDesign .dd documents, A2UI interactive prototypes, OpenUI Lang rendering—and their shared in-process design MCP server, design-store, and dembrandt brand ingestion.
tags: [design, a2ui, openui, deepdesign, dembrandt]
---

# Design System

The three capabilities of DeepOrca's "Design" domain: **prototype design** (A2UI protocol + OpenUI Lang), **UI design artifacts** (DeepDesign `.dd` format), and design audit. They share an **in-process design MCP server** (`main/tools/a2ui/a2ui-mcp.ts`, server name `deeporca-a2ui`, 903 lines) and `design-store` persistence.

## In-Process Design MCP Server: One Server Hosting Three Tool Families

`a2ui-mcp.ts` registers **11 tools** on the same server (`registerDesignTools` appends the .dd tools):

| Tool family | Tools | Purpose |
| --- | --- | --- |
| A2UI surface | `render_surface`, `update_surface`, `close_surface`, `a2ui_action`, `render_prototype`, `list_templates`, `navigate_to` | Creation/update/close of declarative interactive UI, surface state lifecycle, template listing, prototype rendering, navigation |
| OpenUI Lang | `render_openui`, `update_openui` | Render/update ```openui-lang blocks (PM-Design prototypes) |
| DeepDesign .dd | `render_design`, `update_design` | Render/update `.dd` documents (YAML frontmatter design tokens + HTML body) |

- Core seam: `core/src/mcp/a2ui-seam.ts` (`A2UI_MCP_SERVER_NAME`, `setA2uiDisabled`/`isA2uiDisabled`, `configureA2uiServerBuilder`—the builder is injected at desktop startup).
- Template generation: `a2ui-templates.ts` (14.6KB); prototype templates refresh with each build (recompiled with upstream HEAD changes like bento 1.0.17→1.0.18).
- Design artifact persistence: via `design-store` (see below).

## DeepDesign (`.dd` Format)

- **Parsing/compilation**: `renderer/dd/parser.ts` + `compiler.ts`—pure string logic (no browser APIs), reusable by the main process (`.ddu` export, P4-1).
- `.dd` = YAML frontmatter (metadata + design tokens) + HTML body (with section markers); the compiler injects tokens into CSS `:root` variables and produces self-contained HTML.
- **Sanitization invariant** (asserted by `dd-parser.test.ts`): `sanitizeDdBody` strips scripts/event handlers/`javascript:` URLs/forms/iframes; `tokensToCss` **discards CSS-injectable values** (prevents CSS injection).
- **Delivery packages**: `main/tools/dd-package.ts` builds `.ddp` (PM-Design prototype package) / `.ddu` (UI design document package) specialized archives (commit ed9ae6a9)—`deflateRawSync` + hand-written CRC32/zip (incompressible data falls back to store); `.ddp` = manifest + source.openui.txt + viewer stub; `.ddu` = manifest + source.dd + standalone rendering HTML; the `generator` field marks the artifact's origin.
- **design-store.ts**: design artifact CRUD, form state (saveFormState/readFormState), export manifest—layout `<root>/.deeporca/designs/`, guarded by `isSafeArtifactId` (rejects traversal/absolute paths/separator ids), **version snapshots** with FIFO cap `MAX_VERSIONS = 20` (snapshot only on content change, asserted by `design-store.test.ts`), `requirement.md` persistence, errors swallowed best-effort.
- Design templates: `packages/core/templates/design/` (macrostructures/, references/, systems/, templates/)—macro-structure vocabulary of 10 skeletons, taste three axes made computable, motion-patterns, etc.
- **design.audit rule engine** (`core/src/actions/design-audit.ts`): `computeDesignAxes` (dark/light paper, serif/monospace display, accent color); auto-fail when display fonts are disabled; collisions between the three axes and recent artifacts are judged as high findings; audit targets must be contained within `.deeporca/designs` (traversal/absolute paths rejected, asserted by `design-audit.test.ts`).

## A2UI Rendering Side (renderer)

- `a2ui/processor.ts`: A2UI JSON message handling (surface updates).
- `A2uiSurface.tsx` / `A2uiMessage.tsx`: surface component tree rendering.
- Prototype windows: `PrototypePanel`/`PrototypeWindow` + restricted preload ([preload](preload.md)) + `A2uiRequestPayload` handshake.
- `A2uiSurfaceUpdateEvent` / `A2uiWindowPayloadEvent` ([ipc-contract](ipc-contract.md)).

## OpenUI Lang Integration (renderer/openui/)

- `library.tsx` / `library-schema.ts`: OpenUI component library.
- `OpenuiRenderer.tsx` / `tool-provider.ts`: rendering and tool provisioning.
- `correction.ts`, `detect-artifact.ts`, `inline-extract.ts`: ```openui-lang block extraction/correction/artifact detection (`openuiInlineMode` gray-release flag).
- `@openuidev/lang-core` + `@openuidev/react-lang` dependencies.

## dembrandt Brand Ingestion (`main/tools/dembrandt-browser.ts`)

- Fully offline: built-in Chromium via CDP scrapes design tokens from the target URL (W3C DTCG / Tailwind @theme / DESIGN.md).
- SSRF defense (`validateDembrandtTargetUrl`) + copyright denylist and DESIGN.md Provenance block (produced by the design.audit action).
- Core seam: `configureDembrandtCdpEndpointGetter`/`configureDembrandtVendorRoot`; the MCP surface is exposed via `buildDembrandtMcpServerConfig` (enabled when the project contains `designs/` or `.deeporca/DESIGN.md`).

## Focused Tests

- `dd-parser.test.ts`, `dd-package.test.ts`, `design-store.test.ts`.
- `a2ui-processor.test.ts`, `design-a2ui-boundary.test.ts` (design→A2UI boundary).
- `openui-*.test.ts` (correction/detect/inline-extract/prompt).
- Core: `design-dembrandt.test.ts` (29.9KB), `design-action.test.ts`, `design-audit.test.ts`.

## Related Pages

- [main-tools](main-tools.md) (dd-package/dembrandt controllers), [main-process](main-process.md) (registerDesignIpc/registerA2uiIpc)
- [core/actions](../core/actions.md) (design.materialize/extract/audit)
- [workflows/design-pipeline](../workflows/design-pipeline.md) (end-to-end)