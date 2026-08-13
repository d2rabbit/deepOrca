# 外部依赖迁移状态

> 更新日期：2026-08-13
> 基线分支：`fix/stabilize-data-loss-and-test-suite`

## 迁移原则

所有外部工具和 MCP server 的实现代码从 `@deeporca/core` 迁出，core 只保留 Interface（Controller seam）+ configure* 注入点 + MCP 管理器。工具实现放在 desktop。

模式：
```
core/mcp/xxx-seam.ts              ← Interface + configure/get seam (纯接口)
core/actions/xxx-controller.ts     ← Interface + configure/get seam (action 工具)
core/session.ts                    ← 通过 get*ServerBuilder() / get*Controller() 获取注入的实现
desktop/main/tools/xxx.ts          ← Adapter 实现
desktop/main/index.ts              ← boot: configure*ServerBuilder(new XxxController())
```

## 已迁移（8/8 — 全部完成）

### 外部工具（controller-seam 模式）

| 工具 | core Interface | desktop Adapter | spawn 方式 | 状态 |
|---|---|---|---|---|
| **CodeGraph** | `actions/codegraph-controller.ts` | `tools/codegraph-sdk.ts` | SDK import (`@colbymchenry/codegraph`) | ✅ 索引 via SDK；MCP via npm-shim subprocess |
| **OCR** | `actions/review-controller.ts` | `tools/ocr-cli.ts` | CLI spawn (`@alibaba-group/open-code-review`) | ✅ 正确 JSON 字段 + `--audience agent` |
| **OpenWiki** | `actions/wiki-controller.ts` | `tools/wiki-cli.ts` | CLI spawn (vendored `openwiki/dist/cli.js`) | ✅ LLM creds 注入 + Serena/CodeGraph connector |
| **CRG** | `actions/crg-controller.ts` | `tools/crg-cli.ts` | CLI spawn (uv → `code-review-graph`) | ✅ build via controller；query via Node.js SQLite (`crg-query.ts`) |
| **Serena** | `actions/serena-controller.ts` | `tools/serena-cli.ts` | CLI spawn (uv → `serena-agent`) | ✅ SERENA_HOME 管理 + 版本 pin |

### In-process MCP server（builder-seam 模式）

| MCP server | core seam | desktop 实现 | 连接方式 | 状态 |
|---|---|---|---|---|
| **Vision** | `mcp/vision-seam.ts` | `tools/vision-mcp.ts` | `connectInProcessServer` | ✅ vision_chat + vision_ocr 工具 |
| **A2UI** | `mcp/a2ui-seam.ts` | `tools/a2ui/` (a2ui-mcp.ts + a2ui-templates.ts) | `connectInProcessServer` | ✅ surface 生命周期 (restore→connect→persist) via A2uiLifecycle |
| **Activity-Frames** | `mcp/activity-frames-seam.ts` | `tools/activity-frames/` (13 文件) | `connectInProcessServer` | ✅ 行为记忆 DB 查询 |

### Subprocess MCP（config-builder-seam 模式）

| MCP server | core seam | desktop 实现 | 连接方式 | 状态 |
|---|---|---|---|---|
| **GitMCP** | `mcp/gitmcp-seam.ts` | `tools/gitmcp/` (server/store/indexer/tools/github) | `augmentMcpServersWithBuiltins` (subprocess) | ✅ resolve.ts 保留在 core (slug 解析 + 路径解析) |

## 未迁移（1 — 低优先级）

| 工具 | 当前位置 | 迁移目标 | 说明 | 优先级 |
|---|---|---|---|---|
| **SkillSpector** | `core/common/skill-spector.ts` (366 行) | `core/actions/skill-spector-controller.ts` + `desktop/tools/skill-spector-cli.ts` | Python via uv(subprocess)，模式同 Serena | P3 |

## 需要嵌入（vendored）的外部组件

| 组件 | 嵌入方式 | 位置 | 大小 | 离线可用 |
|---|---|---|---|---|
| **CodeGraph** | npm dep (`@colbymchenry/codegraph`) | desktop node_modules | ~30MB | ✅ |
| **OCR** | npm dep (`@alibaba-group/open-code-review`) | desktop node_modules | ~50MB | ✅ |
| **OpenUI Lang** | npm dep (`@openuidev/lang-core` + `react-lang`) | desktop node_modules | ~5MB | ✅ |
| **OpenWiki** | vendored npm install | `desktop/vendor/openwiki/` | ~187MB | ✅ |
| **uv** | GitHub Release 二进制 | `desktop/vendor/uv/` | ~15MB | ✅ |
| **BrowserSkill / `bsk`** | GitHub Release 二进制 | `desktop/vendor/browser-skill/` | ~15MB | ⚠️ 计划随包，runtime wiring 不完整 |
| **Granite Embedding 97M** | HF 模型文件 | `desktop/vendor/granite-embedding/` | ~118MB | ✅ |
| **Tailwind JIT** | unpkg/jsDelivr 单文件 | `desktop/vendor/tailwind/` | ~300KB | ✅ |
| **Bento Slides** | GitHub Release 单文件 | `core/templates/plugins/work/` | ~200KB | ✅ |
| **Serena** | marker-only，首次用 `uv tool run` 下载 | `desktop/vendor/serena/.vendored-serena-version` | — | ❌ 首次联网 |
| **CRG** | marker-only，首次用 `uv tool run` 下载 | `desktop/vendor/crg/.vendored-crg-version` | — | ❌ 首次联网 |
| **SkillSpector** | marker-only，GitHub wheel 经 uv 安装 | `desktop/vendor/skillspector/.vendored-skillspector-version` | — | ❌ 首次联网 |

## core 包中的工具相关代码（迁移后状态）

迁移后 core 中仅保留以下与工具相关的代码（均为纯接口/谓词/路径解析）：

| 文件 | 内容 | 行数 | 说明 |
|---|---|---|---|
| `common/crg.ts` | CRG 谓词 + 版本配置 + vestigial MCP config | ~311 | 死代码已清理；保留 `hasCrgProject`/`isCrgDisabled`/`buildCrgMcpServerConfig`/`runCrgResetWithOutput`/`runCrgVisualize` |
| `common/uv.ts` | 共享 uv 二进制解析器 | ~70 | CRG + Serena + SkillSpector 共用 |
| `common/skill-spector.ts` | SkillSpector spawn/config（**未迁移**） | ~366 | 唯一剩余的完整工具 spawn 代码 |
| `common/codegraph.ts` | CodeGraph MCP config builder + 谓词 | ~120 | SDK MCPServer 不支持 connect(transport)，npm-shim 仍需要 |
| `common/serena-mcp.ts` | Serena disable gate + 服务名常量 | ~34 | 纯状态 |
| `gitmcp/resolve.ts` | GitMCP slug 解析 + spawn config | ~168 | 与 CodeGraph 共享 sqlite-runtime |
| `mcp/a2ui-seam.ts` | A2UI seam | ~50 | 纯接口 |
| `mcp/activity-frames-seam.ts` | Activity-Frames seam | ~20 | 纯接口 |
| `mcp/vision-seam.ts` | Vision seam | ~30 | 纯接口 |
| `mcp/gitmcp-seam.ts` | GitMCP seam | ~15 | 纯接口 |

## 迁移后的调用链路验证

agent 在对话中触发工具的路径全部畅通：

1. **LLM 工具**: agent → `review_run` / `codegraph_reindex` / `wiki_init` tool_call → ToolExecutor → actionRegistry → `getReviewController()` / `getCodegraphController()` / `getWikiController()` → desktop 注入的 controller
2. **MCP 工具 (subprocess)**: agent → `mcp__codegraph__explore` / `mcp__gitmcp__search` → mcpManager → stdio subprocess
3. **MCP 工具 (in-process)**: agent → `mcp__a2ui__render_surface` / `mcp__vision__vision_chat` → mcpManager → InMemoryTransport → desktop 注入的 server builder
4. **Skill**: skill 教 agent 调 LLM action 工具或 MCP 工具（prompt 指令，无代码依赖）

## 迁移历史

| 日期 | 内容 | commit |
|---|---|---|
| 2026-08-13 | CodeGraph/OCR/OpenWiki 迁移 | `9981f6a` |
| 2026-08-13 | CRG 迁移 (controller + Node.js SQLite query) | (CRG 三层架构) |
| 2026-08-13 | Serena 迁移 (controller-seam) | `4ba92c2` |
| 2026-08-13 | Vision 内置 MCP 插件 (seam + adapter) | `233d0c8` |
| 2026-08-13 | CRG 死代码清理 + resolveUvBinary 提取 | `93787d0` |
| 2026-08-13 | A2UI + Activity-Frames 迁移 (seam + move) | (A2UI/AF commit) |
| 2026-08-13 | GitMCP 迁移 (seam + move, resolve.ts 保留) | `7436ef1` |
