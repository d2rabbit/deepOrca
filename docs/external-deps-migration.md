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

### npm 依赖（随 `npm install` 自动获取）

| 组件 | npm 包 | 版本 | vendor 脚本 | 随应用打包 | 离线可用 |
|---|---|---|---|---|---|
| **CodeGraph** | `@colbymchenry/codegraph` | `^1.5.0` | `scripts/vendor-codegraph.js`（旧路径，npm 为主） | ✅ platform optional deps | ✅ |
| **OCR** | `@alibaba-group/open-code-review` | `^1.8.0` | 不需要 | ✅ | ✅ |
| **OpenUI Lang** | `@openuidev/lang-core` + `@openuidev/react-lang` | `^0.2.10` / `^0.2.9` | 不需要 | ✅ | ✅ |

### Vendor 目录下载（`desktop:build` 时刷新）

| 组件 | 来源 | 当前 marker 版本 | vendor 脚本 | 随应用打包 | 离线可用 |
|---|---|---|---|---|---|
| **OpenWiki** | npm install 到 vendor | `0.3.1` | `scripts/vendor-openwiki.js` | ✅ extraResources | ✅ |
| **uv** | astral-sh/uv GitHub Release | `0.12.3` | `scripts/vendor-uv.js` | ✅ | ✅（Serena/CRG/SkillSpector 共用） |
| **BrowserSkill / `bsk`** | GitHub Release 二进制 | `0.1.10` | `scripts/vendor-browser-skill.js` | ⚠️ 计划随包，runtime PATH wiring 不完整 | ⚠️ |
| **Granite Embedding 97M** | HuggingFace / hf-mirror | `main#v1` | `scripts/vendor-granite.js` | ✅ ~118MB | ✅（若下载成功） |
| **Tailwind JIT** | unpkg / jsDelivr 单文件 | build 时刷新 | `scripts/vendor-tailwind.js` | ✅ 内联到 renderer | ✅ |
| **Bento Slides** | GitHub Release 单文件 | `1.0.16` | `scripts/vendor-bento.js` | ✅ 随 core templates | ✅ |

### Marker-only（首次使用时经 uv 联网安装）

| 组件 | Python 包 | 当前 marker 版本 | vendor 脚本 | 随应用打包 | 离线可用 |
|---|---|---|---|---|---|
| **Serena** | `serena-agent` | `1.6.1` | `scripts/vendor-serena.js`（仅写 marker） | ❌ 仅 marker | ❌ 首次联网 |
| **CRG** | `code-review-graph` | `2.3.7` | `scripts/vendor-crg.js`（仅写 marker） | ❌ 仅 marker | ❌ 首次联网 |
| **SkillSpector** | `skillspector[mcp]` | `2.5.1` | `scripts/vendor-skillspector.js`（仅写 marker） | ❌ 仅 marker | ❌ 首次联网 |

### 原生 TS（无需 vendor，代码在 desktop）

| 组件 | 代码位置 | 外部依赖 | 离线可用 |
|---|---|---|---|
| **Vision MCP** | `desktop/tools/vision-mcp.ts` | 仅 `@modelcontextprotocol/sdk` + OpenAI client | ✅（需配置视觉模型 API key） |
| **A2UI** | `desktop/tools/a2ui/`（781 + 427 行） | 仅 SDK + zod | ✅ |
| **Activity-Frames** | `desktop/tools/activity-frames/`（13 文件） | `node:sqlite` 或 `better-sqlite3` | ✅ |
| **GitMCP** | `desktop/tools/gitmcp/`（5 文件） | `node:sqlite` + GitHub API（联网） | ⚠️ 索引时联网，查询时离线 |

### 已知问题（2026-08-13 实地验证）

| # | 严重度 | 组件 | 问题 | 现状 |
|---|---|---|---|---|
| 1 | **高** | **BrowserSkill** | `vendor/browser-skill/bsk` 二进制已下载（8.4MB），但**无代码将 vendor 目录加入 PATH**。Plugin 文档要求 `bsk on PATH`，但 desktop 不自动注入。用户需自行安装 `bsk` 到系统 PATH | ⚠️ 未修复 |
| 2 | **高** | **CodeGraph** | **双机制冲突**：`build.mjs` 注释说 "npm dep, no vendor script needed"，不调用 `vendor-codegraph.js`；但 `vendor/codegraph/darwin-arm64/` 有完整二进制（~150MB），且 `package-desktop.js` release 门控**要求**该目录存在。全新 checkout 跑 `desktop:build` 不会填充 vendor/codegraph/，但 release 会失败 | ⚠️ 未修复 |
| 3 | **中** | **Release 门控覆盖不全** | `package-desktop.js` 只验证 4/10 个 vendor 组件（codegraph/openwiki/uv/skillspector）。browser-skill/tailwind/granite/bento 有真实 payload 但**不被 release 门控**——降级打包会静默缺件 | ⚠️ 未修复 |
| 4 | **中** | **Granite** | 默认 tag 是可变 `main`（非 immutable revision），无 SHA256 checksum。vendor-notice.js MANIFEST 遗漏 Granite | ⚠️ 未修复 |
| 5 | **中** | **ThirdPartyNotices.txt** | 文件**不存在**。`vendor-notice.js` 可按需生成（9 组件 MANIFEST），但从未运行过（或输出被 gitignore） | ⚠️ 未生成 |
| 6 | **低** | **Tailwind** | 只固定 major 4，无 patch 或 digest；marker 是时间戳（30 天刷新） | 可接受 |
| 7 | **低** | **CRG** | `vendor-crg.js` 头部引用 `github.com/tirth8205/code-review-graph`，但 `vendor-notice.js` MANIFEST 引用 `github.com/colbymchenry/code-review-graph`——上游 URL 不一致 | 文档错误 |
| 8 | **低** | **Bento** | marker `1.0.16`，脚本 fallback `1.0.15`；`build.mjs` existence check 路径指向 desktop vendor 但实际写入 core templates | 路径不匹配 |
| 9 | — | **Serena/CRG/SkillSpector** | marker-only 设计（首次联网安装 Python 工具环境）——这是**设计意图**，不是问题 | ✅ 正常 |

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
