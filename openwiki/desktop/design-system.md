---
type: desktop
title: Design System (DeepDesign / A2UI / OpenUI Lang / dembrandt)
description: 三大设计能力（DeepDesign .dd 文档、A2UI 交互原型、OpenUI Lang 渲染）及其共用的进程内设计 MCP 服务器、design-store 持久化、dembrandt 品牌摄取；A2UI 官方 v0.9.1 协议与 Mermaid 架构图持久化。
tags: [design, a2ui, openui, deepdesign, dembrandt]
---

# Design System

DeepOrca「设计」域的三大能力：**原型设计**（A2UI 协议 + OpenUI Lang）、**UI 设计产物**（DeepDesign `.dd` 格式）与设计审计。它们共用**进程内设计 MCP 服务器**（`main/tools/a2ui/a2ui-mcp.ts`，server name `deeporca-a2ui`）与 `design-store` 持久化。A2UI 面在 R2（`specs/a2ui-integration/design-r2.md`）升级到**官方 v0.9.1 协议**（`@a2ui/web_core/v0_9` + `@a2ui/react/v0_9` 官方渲染器替换自建实现）。

## In-Process Design MCP Server: One Server Hosting Three Tool Families

`a2ui-mcp.ts` 在同一个服务器上注册 **11 个工具**（`registerDesignTools` 追加 .dd 工具；R2 起 `navigate_to` 移除、`save_archmap` 加入）：

| Tool family | Tools | Purpose |
| --- | --- | --- |
| A2UI surface | `render_surface`, `render_prototype`, `list_templates`, `update_surface`, `close_surface`, `a2ui_action` | 声明式交互 UI 的创建/原型模板/全量快照更新/关闭、surface 状态生命周期、用户交互回传 |
| 架构图持久化 | `save_archmap` | 把架构图写成 **Mermaid 文档**（`.deeporca/prototypes/arch-<name>.md`，完整替换）；Knowledge 面板把每个 ```mermaid 围栏渲染成真实图 |
| OpenUI Lang | `render_openui`, `update_openui` | 渲染/更新 ```openui-lang 块（PM-Design 原型） |
| DeepDesign .dd | `render_design`, `update_design` | 渲染/更新 `.dd` 文档（YAML frontmatter 设计 token + HTML body） |

- Core seam：`core/src/mcp/a2ui-seam.ts`（`A2UI_MCP_SERVER_NAME`、`setA2uiDisabled`/`isA2uiDisabled`、`configureA2uiServerBuilder`——builder 在桌面启动时注入）。
- 模板生成：`a2ui-templates.ts`；原型模板随每次构建刷新（与上游 HEAD 变化重编译，如 bento 1.0.17→1.0.18）。
- 设计产物持久化：走 `design-store`（见下）。

## A2UI 协议边界（R2：官方 v0.9.1）

- `renderer/a2ui/processor.ts` 是**全应用单例** facade（`processA2uiMessages`/`extractSurfaceId`/`clearSurfaces` API 不变，调用点无感）：官方 `MessageProcessor` + `basicCatalog` 提供 schema 校验、邻接表 GC、动态值绑定、checks 与 client functions；遗留 pre-v0.9 批次（自建方言）经 `shared/a2ui-legacy.ts` 的 `convertLegacyBatch` 转换容忍。
- **幂等重放不变式**：处理器是单例而调用点自由重挂载（知识面板每次切子 tab、原型窗口每次打开都会重喂同一批次）。官方引擎对重复 `createSurface` 抛异常——组件 effect 内异常会卸载整棵 React 树（黑屏）。因此 `processA2uiMessages` 先对批次要重建的 surfaceId 发 `deleteSurface`（幂等重置），再处理；畸形批次降级为 console 警告而非崩溃。
- **v0.9 形状修复**（`normalizeComponents`，`a2ui-normalize.test.ts` 锁定 2026-08-24 真机 arch-scan 修复）：兄弟 Tabs(title, child) 合并进一个 `tabs[]` 容器；带 children 的 Card 包一层内层 Column、无 child 的 Card 补占位；Row/Column/List 单 child 归一为 `children:[child]`。
- 官方 CSS 只由 `A2uiSurface` 组件引入（processor 模块无 CSS import，供 node 测试加载）。

## Surface 持久化（`.deeporca/prototypes/`）与启动竞态

`persistSurfaces`/`restoreSurfaces` 由会话 dispose/init 与后台任务调用（core seam 签名：`persistSurfaces(root, idPrefix?, sinceStamp?)` + `surfaceStamp()`）：

- **`knownSurfaceIds` 清扫护栏**：dispose 时全量 flush 只能清本进程管理过的 id。无此护栏，restore 尚未填充 Map 时（启动竞态）flush 会扫掉整个 prototypes 目录（真实故障：每次启动几秒内删掉 arch-root.json）。`a2ui-persist-race.test.ts` 锁定该回归。
- **前缀 + 变更戳作用域 flush**：后台任务开始前快照 `surfaceVersionStamp()`，结束 `persistSurfaces(root, "arch-", sinceStamp)` 只落盘本任务产物、只清同前缀陈旧文件——用户的设计原型与顺序构建的另一个工作区产物都不被触碰（`background-arch-flush.test.ts`）。
- 模块级 `surfaces` Map 在重建（session reload）时清空，防跨会话泄漏。

## DeepDesign (`.dd` Format)

- **Parsing/compilation**: `renderer/dd/parser.ts` + `compiler.ts`—pure string logic (no browser APIs), reusable by the main process (`.ddu` export, P4-1).
- `.dd` = YAML frontmatter (metadata + design tokens) + HTML body (with section markers); the compiler injects tokens into CSS `:root` variables and produces self-contained HTML.
- **Sanitization invariant** (asserted by `dd-parser.test.ts`): `sanitizeDdBody` strips scripts/event handlers/`javascript:` URLs/forms/iframes; `tokensToCss` **discards CSS-injectable values** (prevents CSS injection).
- **Delivery packages**: `main/tools/dd-package.ts` builds `.ddp` (PM-Design prototype package) / `.ddu` (UI design document package) specialized archives (commit ed9ae6a9)—`deflateRawSync` + hand-written CRC32/zip (incompressible data falls back to store); `.ddp` = manifest + source.openui.txt + viewer stub; `.ddu` = manifest + source.dd + standalone rendering HTML; the `generator` field marks the artifact's origin.
- **design-store.ts**: design artifact CRUD, form state (saveFormState/readFormState), export manifest—layout `<root>/.deeporca/designs/`, guarded by `isSafeArtifactId` (rejects traversal/absolute paths/separator ids), **version snapshots** with FIFO cap `MAX_VERSIONS = 20` (snapshot only on content change, asserted by `design-store.test.ts`), `requirement.md` persistence, errors swallowed best-effort.
- Design templates: `packages/core/templates/design/` (macrostructures/, references/, systems/, templates/)—macro-structure vocabulary of 10 skeletons, taste three axes made computable, motion-patterns, etc.
- **design.audit rule engine** (`core/src/actions/design-audit.ts`): `computeDesignAxes` (dark/light paper, serif/monospace display, accent color); auto-fail when display fonts are disabled; collisions between the three axes and recent artifacts are judged as high findings; audit targets must be contained within `.deeporca/designs` (traversal/absolute paths rejected, asserted by `design-audit.test.ts`).

## A2UI Rendering Side (renderer)

- `a2ui/processor.ts`: A2UI JSON message handling (surface updates, official v0.9.1 protocol + legacy batch conversion, idempotent replay).
- `A2uiSurface.tsx` / `A2uiMessage.tsx`: surface component tree rendering (official `@a2ui/react` renderer).
- Prototype windows: `PrototypePanel`/`PrototypeWindow` + restricted preload ([preload](preload.md)) + `A2uiRequestPayload` handshake.
- `A2uiSurfaceUpdateEvent` / `A2uiWindowPayloadEvent` ([ipc-contract](ipc-contract.md)).

## Architecture Maps (arch-scan output)

- Current output: **Mermaid document** `.deeporca/prototypes/arch-<name>.md` via `save_archmap` (slug sanitized, `arch-` prefix stripped, full-replacement write). The Knowledge panel renders only the ```mermaid fences as diagrams (see [knowledge-indexing](knowledge-indexing.md)); the A2UI preview path still replays legacy `arch-*.json` surfaces through the real A2UI renderer.
- The old `KnowledgeRenderArchmap` (surface JSON → self-contained HTML tree view) is replaced by `KnowledgeReadArchmap` (`.md` → markdown, `.json` → surface).

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
- `a2ui-processor.test.ts`（v0.9 处理/legacy 转换/幂等重放）、`a2ui-normalize.test.ts`（MCP 边界 v0.9 形状修复）、`a2ui-persist-race.test.ts`（持久化竞态）、`design-a2ui-boundary.test.ts`（design→A2UI 边界）。
- `openui-*.test.ts` (correction/detect/inline-extract/prompt)。
- Core: `design-dembrandt.test.ts` (29.9KB), `design-action.test.ts`, `design-audit.test.ts`。

## Related Pages

- [main-tools](main-tools.md) (dd-package/dembrandt controllers), [main-process](main-process.md) (registerDesignIpc/registerA2uiIpc)
- [core/actions](../core/actions.md) (design.materialize/extract/audit)
- [workflows/design-pipeline](../workflows/design-pipeline.md) (end-to-end)