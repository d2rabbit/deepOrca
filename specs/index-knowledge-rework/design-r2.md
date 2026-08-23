# 索引与知识模块 — 修复二轮设计（index-knowledge-rework R2）

> **日期**：2026-08-23 二轮（T1–T5 落地后的用户复验反馈）
> **本轮五个问题**（含审计实证）：
> 1. **还是生成 session**——构建后磁盘出现 8 个 "Scan the codebase architecture…" 会话（`~/.deepcode/projects/` 索引审计实证），且 `isSilentSubagent` 标记为 0：这批泄漏产生于 **silent 机制合入之前的旧构建**；但设计本身也有缺口（见 §1）。
> 2. **AGENTS 为什么要去编辑器**——应就地展示。
> 3. **构建切行即丢**——构建不是后台进程，绑定在面板 React state 上；切 tab/行后进度与结果丢失。
> 4. **符号索引（内部名 CodeGraph）没有展示位**——上轮"不设子 tab"矫枉过正，构建侧应有其展示模块。
> 5. **会话列表现状**——10 个可见会话中 8 个是 arch-scan 泄漏，仅 2 个真实。

## 一、根因分析与完整设计

### 1.1 会话泄漏的三层根因

审计发现 silent 机制只堵住了 **UI 层**（listSessions 过滤 + 桥接拦截流式），但：

- **R1 磁盘残留**：silent 会话仍**完整持久化**到 `sessions-index.json` + `*.jsonl`（文件级），只是列表过滤——索引越积越脏，且 `MAX_SESSION_ENTRIES=50` 的淘汰池被垃圾占用；
- **R2 历史欠账**：silent 合入前的 8 个泄漏会话无标记，永久可见（除非手动删）；
- **R3 独立会话本身过重**：arch-scan 作为后台构建管线的一环，根本不需要一个完整会话（系统提示词链、会话索引、文件历史 Git 仓）——用会话承载只因 `runSubagent` 是现成的执行通路。

**设计：构建管线与会话彻底解耦**

- **B-1 后台任务通道**（不再经 runSubagent）：`index.build-all` 的 arch 段改为新的 `BackgroundLlmTask` 通道——一个**非会话**的 LLM 回路：直接用 `createChatCompletionStream`（无 session 状态、无索引写入、无 onAssistantMessage），带 prompt（arch-scan 指令 + 索引产物摘要）与 tool 面（仅 update_surface 等所需），循环至完成。产物（surface JSON）落 `.deeporca/prototypes/`。**零会话产生，从根上消灭 R1/R3**。
- **B-2 存量清洗**：启动时一次性迁移——扫描 projects/*/sessions-index.json，删除同时满足「从未有用户消息」且「summary 匹配 subagent prompt 前缀（"Scan the codebase…"）」的条目及其 jsonl；`isSilentSubagent` 条目同样清理。迁移幂等（清单文件记录已执行）。
- **B-3 runSubagent silent 保留**：作为其他后台场景的通用能力，但 index-build 不再用它。

### 1.2 构建为真后台进程（问题 3）

- **B-4 构建注册表**（主进程内存 + 可选持久化）：`Map<root, BuildJob>`——{ root, mode, stage, percent, error, startedAt, promise }。`index.build-all` action 照旧，但**由构建管理器持有**：行内按钮 → IPC `knowledge.build(root)` → 管理器起任务并立即返回 job id；进度经 ActionProgress 广播（带 root）；**切换视图/tab/行不影响任务**；同一 root 重复点击=幂等（返回进行中 job）；不同 root 并行。
- **B-5 面板只读订阅**：左列表行状态从注册表快照渲染（busy/percent/error/lastBuild），组件卸载不杀任务；完成时刷新该行状态与知识 tab 数据。

### 1.3 AGENTS 就地展示（问题 2）

- **B-6 AGENTS 子 tab 内嵌渲染**：主进程读文件返回内容；子 tab 内以只读 Markdown 视图呈现（复用会话消息的 markdown 渲染样式）；右上"在编辑器中编辑"次级按钮保留（要改的人仍可跳编辑器，但默认就地看）。

### 1.4 符号索引展示模块（问题 4）

- **B-7 第四个子 tab「符号」**（Wiki/AGENTS/架构图/符号）：展示该工作区符号索引的状态与产物——索引状态（已建/过期/未建）、符号量、最近同步、以及**符号浏览**：复用 core 现成的 codegraph 查询（`codegraph_explore` 底层的 symbol 列表），呈现为可搜索的符号清单（名称/文件/行号），点击符号 → 编辑器打开对应文件。构建按钮侧（左列表）不变——"符号索引"仍在构建序列内，只是补上展示位。

### 1.5 整体逻辑图（构建全链路）

```
左列表行 [构建] ──IPC knowledge.build(root)──▶ 构建管理器（主进程）
                                              ├─ stage1 符号索引（SDK，无 LLM）
                                              ├─ stage2 Wiki（CLI，LLM 走 wiki 自己的通道）
                                              └─ stage3 架构图（BackgroundLlmTask，非会话）
                                                   └─ 产物 .deeporca/prototypes/*.json
进度 ◀── ActionProgress(root, stage, percent) 广播 ──┤
                                                  知识 tab 四子 tab 订阅刷新
```

## 二、任务清单

### R2-1 后台构建进程
- [ ] R2-1.1 主进程 BuildJobManager：Map<root, job>、幂等、并行、进度广播（root 维度）
- [ ] R2-1.2 IPC `knowledge.build(root)` / `knowledge.buildStatus(): Array<root+job快照>`；行按钮改调新通道
- [ ] R2-1.3 左列表行状态从 buildStatus 订阅渲染（面板卸载不丢）

### R2-2 arch 段去会话化
- [ ] R2-2.1 BackgroundLlmTask：无 session 的 createChatCompletionStream 回路（限定工具面+prompt），产物落 prototypes
- [ ] R2-2.2 index-build stage3 切换到该通道；删除 runSubagent 依赖
- [ ] R2-2.3 存量清洗迁移（B-2）：启动清“Scan the codebase…”无用户消息条目 + isSilentSubagent 条目（幂等清单）

### R2-3 AGENTS 就地展示
- [ ] R2-3.1 IPC 读 AGENTS.md 内容（限 root 内路径）；子 tab 内 Markdown 只读渲染 + 次级“编辑器编辑”按钮

### R2-4 符号子 tab
- [ ] R2-4.1 第四子 tab「符号」：状态卡（已建/过期/未建/量/最近同步）+ 符号清单（codegraph 符号枚举，可搜索）
- [ ] R2-4.2 符号点击 → 编辑器打开对应文件

### 验收
- [ ] 构建全链路跑完：磁盘 sessions-index 零新增条目（审计脚本复核）
- [ ] 存量 8 条泄漏清零；会话列表只剩真实会话
- [ ] 切行/切 tab 构建继续，回来进度还在；同 root 重复点幂等
- [ ] AGENTS 子 tab 直接可读；符号子 tab 可浏览符号并点开
- [ ] check/test 全绿
