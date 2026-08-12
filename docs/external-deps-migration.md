# 外部依赖迁移状态

> 更新日期：2026-08-13
> 基线分支：`fix/stabilize-data-loss-and-test-suite`

## 迁移原则

所有外部工具的 spawn/SDK 代码从 `@deeporca/core` 迁出，core 只保留 Interface（Controller seam）+ configure* 注入点 + ActionRegistry。工具实现放在 desktop。

模式：
```
core/actions/xxx-controller.ts   ← Interface + configure/get seam
core/actions/xxx.ts              ← action defs,run 调 controller
desktop/main/tools/xxx.ts        ← Adapter 实现
desktop/main/index.ts            ← boot: configure*Controller(new XxxController())
```

## 已迁移（3/6）

| 工具 | core Interface | desktop Adapter | spawn 方式 | 状态 |
|---|---|---|---|---|
| **CodeGraph** | `CodegraphController` | `SdkCodegraphController` | SDK import (`@colbymchenry/codegraph`) | ✅ 索引 via SDK;MCP via npm-shim subprocess |
| **OCR** | `ReviewController` | `OcrCliController` | CLI spawn (`@alibaba-group/open-code-review` binary) | ✅ 正确 JSON 字段 + `--audience agent` |
| **OpenWiki** | `WikiController` | `WikiCliController` | CLI spawn (vendored `openwiki/dist/cli.js`) | ✅ LLM creds 注入 + flash model |

## 未迁移（3/6 — 仍用旧模式在 core 里）

| 工具 | 当前位置 | 迁移目标 | 阻塞 | 优先级 |
|---|---|---|---|---|
| **CRG** | `core/common/crg.ts` | `core/actions/crg-controller.ts` + `desktop/tools/crg-cli.ts` | Python via uv(subprocess)，模式同 OCR | P2 |
| **Serena** | `core/common/serena-mcp.ts` | `core/actions/serena-controller.ts` + `desktop/tools/serena-cli.ts` | Python via uv(subprocess) | P2 |
| **SkillSpector** | `core/common/skill-spector.ts` | `core/actions/skill-spector-controller.ts` + `desktop/tools/skill-spector-cli.ts` | Python via uv(subprocess) | P3 |

## 需要嵌入（vendored）的外部组件

| 组件 | 嵌入方式 | 位置 | 大小 | 离线可用 |
|---|---|---|---|---|
| **CodeGraph** | npm dep (`@colbymchenry/codegraph`) | desktop node_modules | ~30MB | ✅ |
| **OCR** | npm dep (`@alibaba-group/open-code-review`) | desktop node_modules | ~50MB | ✅ |
| **OpenWiki** | vendored npm install | `desktop/vendor/openwiki/` | ~187MB | ✅ |
| **uv** | GitHub Release 二进制 | `desktop/vendor/uv/` | ~15MB | ✅ |
| **Serena** | marker-only，首次用 `uv tool run` 下载 | — | — | ❌ 首次联网 |
| **CRG** | marker-only，首次用 `uv tool run` 下载 | — | — | ❌ 首次联网 |
| **SkillSpector** | marker-only，首次用 `uv tool run` 下载 | — | — | ❌ 首次联网 |
| **Granite Embedding** | HF 模型文件 | `desktop/vendor/granite-embedding/` | ~118MB | ✅ |
| **Tailwind JIT** | unpkg/jsDelivr 单文件 | `desktop/vendor/tailwind/` | ~300KB | ✅ |
| **Bento Slides** | GitHub Release 单文件 | `core/templates/plugins/work/` | ~200KB | ✅ |
| **BrowserSkill** | GitHub Release 二进制 | `desktop/vendor/browser-skill/` | ~15MB | ✅ |

## core 包中剩余的工具特定代码

迁移后 core 中仅保留以下工具无关的通用代码：

| 文件 | 内容 | 是否工具特定 |
|---|---|---|
| `common/codegraph.ts` | MCP config builder + 纯谓词(118行) | ⚠️ CodeGraph MCP config(暂留——SDK 的 MCPServer 不支持 connect(transport)) |
| `common/sqlite-runtime.ts` | Node/sqlite 运行时解析 | ❌ 通用(gitmcp + openwiki 共用) |
| `common/crg.ts` | CRG MCP config + spawn + predicates | ⚠️ 待迁移(P2) |
| `common/serena-mcp.ts` | Serena MCP config + spawn | ⚠️ 待迁移(P2) |
| `common/skill-spector.ts` | SkillSpector MCP config + spawn | ⚠️ 待迁移(P3) |

## 迁移后的调用链路验证

agent 在对话中触发工具的三条路径全部畅通：

1. **LLM 工具**: agent → `review_run` / `codegraph_reindex` / `wiki_init` tool_call → ToolExecutor → actionRegistry → `getReviewController()` / `getCodegraphController()` / `getWikiController()` → desktop 注入的 controller
2. **MCP 工具**: agent → `mcp__codegraph__explore` → mcpManager → stdio subprocess（独立于 controller）
3. **Skill**: skill 教 agent 调 LLM action 工具或 MCP 工具（prompt 指令，无代码依赖）
