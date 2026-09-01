---
type: desktop
title: SessionBridge
description: desktop 与 core 的边界对象：按项目根包装 SessionManager、转发引擎事件、委托桌面服务（git/gitmcp/mcp-store/插件/归档/activity-frames）、权限中继与序列化。
tags: [session-bridge, desktop-core-boundary]
---

# SessionBridge

`packages/desktop/src/main/session-bridge.ts`（约 1136 行）是 desktop↔core 的**边界对象**：每个项目根一个 `SessionManager` 包装（`createManager`），把引擎回调转发为渲染层事件，并委托桌面侧服务。

## 职责清单

### 引擎包装

- `createManager(projectRoot)`：构造 `SessionManager`（注入 client 工厂、`getResolvedSettings`、全部 IpcEvent 回调、`memoryProvider`、actionRegistry、taskTrees）。
- `reload()`：设置变化/项目切换时重建管理器。
- `rebindMemoryProvider()`：记忆流水线启停后重绑 `MemoryProvider`。

### 回调转发（→ `IpcEvent`）

`onAssistantMessage` → `event:assistantMessage`、`onSessionEntryUpdated` → `event:sessionEntryUpdated`、`onLlmStreamProgress` → `event:llmStreamProgress`、`onMcpStatusChanged` → `event:mcpStatusChanged`、`onSandboxStatusChanged` → `event:sandboxStatusChanged`、`onProcessStdout` → `event:processStdout`。

**静默子代理过滤（双侧）**：`onAssistantMessage`/`onSessionEntryUpdated` 都丢弃 `isSilentSubagent` 条目——只过滤消息流时，未过滤的 entry 事件会把流水线会话插进侧边栏列表（尽管 `listSessions` 会过滤它）；R2-2 起索引构建走无会话后台任务，该过滤兜底 legacy 路径。

### 桌面服务委托

| 服务 | 委托内容 |
| --- | --- |
| `git-service.ts` | status/stage/commit/branch/diff/log（`IpcRequest.Git*` 后端） |
| `mcp-store.ts` | MCP 服务器配置持久化 + **禁用侧车**（`readDisabledMcp`/`setMcpDisabled`，见下） |
| `plugin-mcp-view.ts` | 插件中心 MCP 视图 |
| `archive-store.ts` | 会话归档侧车存储 |
| `gitmcp` store/indexer | GitMCP 模块的仓库级知识索引 |
| `activity-frames` collectors | `collectProfile` 行为采集 |
| `workspace-registry.ts` | 跨工作区会话枚举（main 直接读） |

### 权限与信任

- `buildPermissionDecisions` / `buildPermissionSettings`：权限答复解析（tool_call_id → allow/deny，alwaysAllows/alwaysAllowPaths）。
- `readWorkspaceTrustStatus` / `writeWorkspaceTrust`：工作区信任分级读写。
- `undo restore`：`UndoRestoreMode`（conversation / code-and-conversation）。

### 记忆与模型

- 记忆启停/搜索/统计/清空（`MemorySetEnabled`/`MemorySearch`/`MemoryStats`/`MemoryClear` IPC 后端）。
- 模型选择持久化（`ModelSet`/`ThinkingModeSet`）与会话 locale（`SessionLocaleSet`）。

### MCP 禁用侧车（`initMcp` / `effectiveMcpServers`）

- `readDisabledMcp(projectRoot)`（`mcp-store.ts`）读取桌面禁用列表，`initMcp` 先推入 core：`setCodegraphDisabled`/`setCrgDisabled`/`setSerenaDisabled`/`setSkillSpectorDisabled`/`setA2uiDisabled`（各内置服务器的 core 禁用旗标，决定 `augmentMcpServersWithBuiltins` 是否自动注册）。
- `effectiveMcpServers`：从 `resolveCurrentSettings().mcpServers` 过滤掉禁用项后交 `manager.initMcpServers(...)`。
- 这是「插件 UI 禁用某内置服务器 → 重载后不再重连」的闭环（A2UI 曾漏推 `setA2uiDisabled` 导致禁用失效，见 main/index.ts 注释）。

### 序列化

- `toSerializableEntry`：`SessionEntry` → `SerializableSessionEntry`（`processes` Map → 数组，`flattenProcesses`；desktop 追加 `archived`/`workspaceRoot`）。**`assistantThinking` 截断 2048 字符**（2026-08-27，commit 5da928f3）——流式回合每迭代 2-3 次的结构化克隆不再复制数十 KB 无人消费的推理全文。
- `toSettingsSummary`：渲染层可编辑设置摘要。

## 关键不变式

- SessionBridge 是**唯一**持有 SessionManager 的 desktop 对象；所有会话类 IPC 经它路由。
- 项目切换 = 旧 manager dispose + 新 manager create（`reload`）；记忆流水线跨项目重建（数据目录按 `getProjectCode` 隔离，防跨项目泄露）。

## 聚焦测试

- `app-boot.test.ts`：bridge 初始化/重载路径。
- `ipc-contract.test.ts`：IPC 通道与桥接方法一致性。
- `permissions-lib.test.ts`（renderer）：权限答复解析的 UI 侧。

## 相关页面

- [main-process](main-process.md)（组合根接线）、[ipc-contract](ipc-contract.md)
- [架构/会话生命周期](../architecture/session-lifecycle.md)（SessionManager 本体）
- [workflows/llm-tool-loop](../workflows/llm-tool-loop.md)（端到端）
