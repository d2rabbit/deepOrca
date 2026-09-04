---
type: workflow
title: 设计工作流（DesignPanel → 设计 action → A2UI/.dd → 交付包）
description: 设计面板驱动 design materialize/extract/audit action，产出 A2UI surface 或 .dd 文档，经 design-store 打包 .ddp/.ddu 并可在原型窗口运行。
tags: [workflow, design, a2ui, deepdesign]
---

# 设计工作流

从设计面板到可交付设计产物的端到端路径。三大能力（原型/UI 设计稿/审计）共用设计 MCP 服务器与 design-store。

```mermaid
flowchart LR
    A["DesignPanel（renderer）"] -->|DesignSaveFormState / DesignRead| B["design-store"]
    A -->|"design.materialize / design.extract（LLM action）"| C["core actions/design.ts"]
    C -->|"render_openui / render_design（deeporca-a2ui MCP）"| D["a2ui-mcp.ts 服务器"]
    D --> E["A2uiSurface（对话内）/ PrototypeWindow（弹窗）"]
    D --> F[".dd 文档"]
    F -->|"dd-package.ts"| G[".ddp / .ddu 交付包"]
    A -->|"design.audit（三轴机检）"| H["design-audit.ts"]
    H --> I["DESIGN.md Provenance 块 + 品牌 drift 闸门"]
    F --> J["DesignPreview（HTML 导出 + Tailwind JIT）"]
```

## 阶段

1. **设计输入**：DesignPanel 保存表单状态（`DesignSaveFormState`）；设计文档经 `design.materialize`（LLM 生成宏结构骨架）或 `design.extract`（从现有页面抽取令牌，dembrandt 品牌摄取）。
2. **渲染**：进程内设计 MCP 服务器（`deeporca-a2ui`，11 工具三族）的 `render_openui`/`render_design`/`render_surface` 产出对话内 surface 或原型窗口；原型窗口用受限 preload + `A2uiRequestPayload` 握手。
3. **审计闸门**：`design.audit`（三轴机检：宏结构/taste/门禁 12-19）+ dembrandt 版权拒绝清单 → DESIGN.md Provenance 块；**品牌 drift 闸门**（specs/ui-domain-regroup 后迁入设计面板）。
4. **交付**：`.dd` 文档 → `dd-package.ts` 构建 `.ddp`（原型包）/`.ddu`（UI 文档包）；HTML 导出（standalone，含 vendored Tailwind JIT）。
5. **持久化**：design-store（`<root>/.deeporca/designs/` 之类，经 DesignList/Read/Delete IPC）。

## 入口与 Action

- IPC：`DesignList/Read/Delete/SaveFormState/ReadFormState/ExportPackage`、`A2uiAction/A2uiOpenWindow/A2uiRequestPayload`（[ipc-contract](../desktop/ipc-contract.md)）。
- core actions：`design.materialize`、`design.extract`、`design.audit`、`bento.create`、`browser.*`（[core/actions](../core/actions.md)）。

## 相关页面与验证

- [desktop/design-system](../desktop/design-system.md)、[desktop/main-tools](../desktop/main-tools.md)
- 聚焦测试：`design-action.test.ts`、`design-audit.test.ts`、`dd-parser.test.ts`、`dd-package.test.ts`、`design-store.test.ts`、`a2ui-processor.test.ts`、`design-a2ui-boundary.test.ts`、core `design-dembrandt.test.ts`。
- 窄验证：`node packages/desktop/src/tests/run-tests.mjs packages/desktop/src/tests/dd-package.test.ts`
