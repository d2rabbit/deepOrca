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

## 三、R3 复验三轮（2026-08-23 晚，用户复验六问题的最终落地）

R2 落地后用户复验仍见六问题，审计定位的根因与修复：

1. **仍有新会话内容**——R2 的 silent 子代理仍 createSession（索引条目/活动会话切换/条目事件广播都在）。本轮真正落地 R2-2 设计的 **BackgroundLlmTask**（`SessionManager.runBackgroundLlmTask`）：非会话 LLM 回路，直接用 createChatCompletionStream + 窄工具面（read/bash + a2ui/codegraph/serena MCP），无索引写入、无活动会话切换、无消息/流式事件（backgroundTaskIds 抑制 emitLlmStreamProgress）。index.build-all stage3 与 arch-scan.run 均切换到该通道（runSubagent 保留为 fallback）。防御层：桥接 onSessionEntryUpdated 过滤 isSilentSubagent；存量清洗去掉一次性 marker，每次启动都跑（20:09 的泄漏会话就是 marker 已写后产生、永远没被清掉的实证）。
2. **wiki/架构图没生成**——双根因：(a) vendored openwiki 的 better-sqlite3 原生绑定从未编译（vendor 脚本 --ignore-scripts），运行即 "Could not locate the bindings file"；(b) 控制器传 `OPENWIKI_MODEL` 而 openwiki 0.3.3 读 `OPENWIKI_MODEL_ID` → 回落默认模型 gpt-5.6-terra 被 DeepSeek 400 拒绝；语言也应走 `--language` CLI 旗标（无 OPENWIKI_LANGUAGE 环境变量）。修复：vendor-openwiki.js 安装后 `npm rebuild better-sqlite3`（npm_config_runtime=electron + pinned Electron 版本，`--build-from-source` 强制按 Electron headers 源码编译、不依赖 prebuild 矩阵，verify 强制绑定存在）；wiki-cli.ts 改 OPENWIKI_MODEL_ID + --language。实跑验证：完整 wiki 树生成（architecture/core/desktop/memory/embedding/workflows 33+ 页）。
3. **主会话 tab**——tab 条此前仅在辅 tab 激活时渲染。现改为：任务/知识 tab 存在即渲染 tab 条，「💬 工作区」永远第一且不可关闭，聊天区挂在主 tab 下（chatContent 提取复用）；配合 P1 的去会话化，构建不再触碰主会话区。
4. **构建后仍「未同步」**——lastSync 只读 SessionManager 内存戳（maybeSync*），index.build-all 从不盖章，且非活动工作区/重启后内存戳为空。修复：knowledgeStatus 用产物 mtime 兜底（.codegraph/codegraph.db、openwiki/*.md 最新 mtime）。同时 BuildJobManager 现在检查 stages[]——index.build-all 把阶段错误吞进返回值正常返回，此前 wiki 崩了也显示 done；现阶段失败透出为 job.error，且成功/失败都 emit buildComplete 让面板刷新。
5. **设计预览乱弹**——render/update_surface 的工具结果经 detectPrototypeArtifact 自动打开右侧设计预览，arch-scan 的 surface 也触发。现 arch-* surfaceId 前缀的 surface 不再触发设计预览（渲染归知识 tab）。
6. **A2UI 绘制异常**——(a) SKILL.md 残留 panel/graph/surface/direction 等 renderer 不存在的概念措辞（模型曾花 15 条消息自行纠偏），已清理并要求 arch- 前缀；(b) 知识面板架构图预览此前用主进程静态 HTML 树（类型名嵌套列表，看起来像坏的），现改走真实 A2UI 渲染器（A2uiSurface 组件 + knowledgeReadArchmap IPC 返回 surface JSON）。

新增回归测试：`background-task.test.ts`（零会话残留：无索引条目/无活动会话切换/无消息/无流式事件/无磁盘文件）；arch-scan.run 偏好 background 通道 + fallback；detect-artifact arch- 前缀过滤。

### R3 复验四轮（2026-08-23 深夜，审查反馈处理 + 用户决策）

对上一轮落地做代码审查后发现的问题与处理（含用户明确的设计决策）：

1. **R3-4（用户决策）架构图构建专属 agent 免权限门**——`runBackgroundLlmTask` 不走会话权限系统是**有意为之**：用户发出构建指令即视为对该 agent 窄工具面（read/bash + a2ui/codegraph/serena MCP）的整体预授权，构建过程不得弹权限打断。风险边界由窄工具面约束；其产物（arch-* surface）只在索引与知识模块展示，绝不进对话视图/设计预览。该决策已写入 `runBackgroundLlmTask` 的 JSDoc 与 `ActionContext.runBackgroundTask` 接口文档。
2. **取消传播**——原实现后台循环的 AbortController 无人触发，构建取消后 arch-scan 仍会跑满 80 轮迭代。现 `BackgroundLlmTaskOptions.signal` 接入 `index.build-all` 的 `ctx.signal`（registry `cancel()` 即中止），abort 在下一迭代边界生效，已产出的 arch surface 仍会 flush。
3. **跨工作区 arch surface 污染**——a2ui surfaces Map 是进程级单例，顺序构建 A、B 两个工作区时，B 的 flush 会把 A 残留的 arch surface 一并写进 B 的 prototypes。现 desktop 侧维护单调 surface 变更 stamp（`surfaceVersionStamp`，create/update/restore 均递增），后台任务开始前快照、结束时 `persistSurfaces(root, "arch-", sinceStamp)` 只落盘本轮产物。
4. **注释纠偏**——vendor-openwiki.js/design-r2 §三-2 的 "prebuild-install 优先" 表述纠正为 `--build-from-source` 强制源码编译；knowledgeStatus 的 newestMtime 注释由"一层子目录"改为实际的全递归。
5. **arch 阶段全链路集成测试**——`background-arch-flush.test.ts`（desktop）：真实 a2ui in-process MCP 服务器 + mock LLM 发出 `mcp__a2ui__render_surface`，验证 后台循环 → MCP → surfaces Map → arch- 前缀/stamp 限定 flush → 目标 root 的 `.deeporca/prototypes/arch-*.json` 落盘，且不污染另一 root、不误删非 arch 产物。
