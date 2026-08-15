# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### ✨ 新功能

- **任务树 P2 收官：记忆驱动 fork 闭环 + 泳道树图（轨迹计划完毕）**
  - **记忆驱动 fork（六步最小环）**：AskUserQuestion 决策点自动埋点（一次/会话）→ `recallAtDecision` 召回相似历史分叉（token-Jaccard + 世系映射，带 merged/abandoned/open 结局）→ 隐藏 `<task-recall-hints>` 提示 agent 可提议 → `task.recall` Action 供主动查询 → `task.fork(memorySnapshot)` 播种（memory-spawn ✦，快照注入分支 contextSummary）→ merge/abandon 写 `<task-lineage>` 隐藏消息经现有记忆 capture 回收（**memory 包零改动**）
  - **泳道式树图**：面板升级为每分支一列的简化 DAG 画布（世系自上而下、active 高亮、abandoned 灰显）；merge 冲突清单持久化进节点 meta 并以 ⚠ 渲染（报告不裁决）
  - **PM-Design 整合**：design.materialize 在绑定会话中产出 → 分支 step 节点（需求变更 = fork 而非重跑）
  - 真机验收：rail 挂载 + task.create/step/fork/recall 真实 IPC 全链路 + 磁盘/reflog 流水核验
  - artifact 快照切换明确缓期（理由记录于 tasks.md）

- **任务树 P1 + 行为记忆 boot 注入（轨迹计划续执行）**
  - **task.merge**（cherry-pick）：从源分支挑选节点合并到 active 分支（artifact 引用转移、picks 优先）；**冲突只报告不自动裁决**——同名 artifact 返回冲突清单供人确认；merge 节点进树与面板（⇄ 图标）
  - **会话绑定**：SessionEntry 扩展 `taskRef` 反向指针（treeId/branch/nodeId + normalize 防伪）；task.create/fork 在会话内自动绑定；分支头 `sessionRef` 单次绑定防会话抢占
  - **branch 级 resume**：绑定会话激活时恢复其分支为 active（fail-open）
  - **Plan Mode 单向物化**：UpdatePlan 的 checklist 行 → 绑定分支的 step 节点（标题去重、计划内重复折叠、幂等重放零新增；树永不回写 plan——§十一 规则）
  - **行为记忆 boot 注入**：`settings.behaviorContext`（默认关）开启后新会话前置隐藏 `<behavior-context>` 系统消息（BehavioralProfile 紧凑摘要，desktop collectors → core provider seam，fail-open）
  - **memory 谱系规格**：`specs/task-tree/memory-lineage.md`（L2 taskLineage 块、终态写回触发、同源异枝召回过滤——单向馈赠，实现列 P2）
  - 测试 +5：merge 冲突/绑定防抢占/物化幂等/branch resume/boot 注入门控

- **任务轨迹 P0（task-tree，给人类看的 agent 工作视图）**（方案：`specs/task-tree/`，定位：`docs/research/2026-08-15-trajectory-design-exploration.md`）
  - core `TaskTreeService`：git 语义的任务树（create/append/fork/switch/abandon/list + reflog 操作流水）；单写者 + pendingIndex→flush 纪律（吸收 sessions-index 丢数教训）；节点内容寻址 id + 路径防穿越；损坏树 fail-open 降级不阻塞会话
  - **每个节点携带 `why` 叙事字段（fork 强制非空）**——人类视角的产品本体：岔路口永远有故事
  - 6 个 Action：task.create / task.step / task.fork / task.switch / task.abandon / task.list——agent 会话内可直接分叉（"这个方案我先开条分支试"）
  - desktop 任务树面板（rail 🌳 "tasktree"）：树列表 + 缩进节点视图（分支色条、abandoned 灰显、✦ memory-spawn 徽章预留、每节点渲染 why）；只读 IPC tasktree:list/get；6 语言
  - spec 消歧：Plan Mode ↔ 树为**单向只读物化**（plan 是 source of truth，树永不回写 plan）
  - 测试 6 用例：fork 双分支/重启恢复/reflog 顺序/损坏树 fail-open/id 防穿越/分支名净化
- **activity-frames 行为记忆补测试（spec Phase 5 兑现）+ 修复两个移植缺陷**
  - 13 用例（sessionize 分段/闪烁/dwell cap/coverage/appLedger、entities 站点解析、frames 编译 + 输入归因），fake-db 接缝零 SQLite 依赖
  - 修复①：闪烁合并（A→B→A）比较了错误的一侧——Pass 2 死代码，从不合并
  - 修复②：断段判定用"当前帧→下一帧"间隙——breakReason 误标 + 末帧恒被甩成零活跃独立段；现按 spec §5.1 语义（到当前帧的间隙判断段，向后间隙只计 dwell）
  - spec 回写：实现状态对账（双管线/desktop 位置/9 工具/nocta 不 vendor 决策）

### 🔒 安全

- **全域深度代码审查第二轮：三通道审查 + 10 项修复**（报告：`docs/security-audit-2026-08-15-deep-review.md`）
  - **HIGH debug 日志脱敏**：debug.log 此前全量未脱敏落盘（完整 LLM 请求、SDK 错误栈内嵌 Bearer token），0644 且无上限——复用 error-logger 的 redaction 管道（敏感键掩蔽 + content 截断），目录 0700/文件 0600，20MB 容量上限
  - **HIGH bash 分类器扩充**：`find -delete`、`python -c`/`node -e` 等解释器内联代码、`base64 -d | sh` 解码管道、`dd`/`truncate` 块设备工具此前全部推断为空直放过——现一律归 out-of-cwd 破坏性 scope（+5 组回归测试，良性命令无回归）
  - **MED design-store id 包含校验**：`../../` 可致递归删除任意目录（含校验 + 回归测试）
  - **MED MCP 恶意服务器防护**：工具结果 512KB 截断、tools/list 工具数 ≤500/单 schema ≤256KB（传输层无界行为列为已接受风险待上游）
  - **MED read 工具 128MB 前置大小守卫**（此前整读后分页，多 GB 文件全量入内存）
  - **MED isPathInProject realpath 加固**（项目内 symlink 指向 /etc 不再按 in-project 归类）
  - **MED runSubagent 递归上限 4**（互递归技能不再无界嵌套）
  - **MED 会话 JSONL 0600**（明文对话不再随 umask 可读）
  - LOW：WebSearch 默认端点结果截断；machineId 去主机名（不再外发机器名）+0600；git checkout 拒绝前导 `-` 分支名
  - 经核验安全：IPC 三层分级/DOMPurify+CSP/.dd iframe 沙箱/sender 三重验证/bash 无 TOCTOU/sqlite 参数化——详见报告§二

- **2026-08-12 安全审计整改落地 + 全域自查**（跟进报告：`docs/security-audit-2026-08-15-followup.md`）
  - **P0 路径穿越修复**：`profile-sync.ts` 远程 filename 经 `safeBlockFilename` containment（拒绝 `..`/分隔符/绝对路径/重复名，resolve 后校验仍在 tempBlocksDir 内）——此前恶意 store 可把写入逃逸到 live scene_blocks 之外；+2 回归测试
  - **P0 动态 require 修复**：`find-skill.js` 不再从 `process.cwd()` 解析 `gray-matter`（不可信工作区可借恶意 node_modules 执行代码），仅从技能自身目录解析
  - **命令注入面收紧**：git-collector 与 prompt.ts 的 shell helper 全部 argv 化（core 内 `execSync` 清零）；vendor 脚本（openwiki/uv/browser-skill/granite/download）版本号与 tag 过 `assertSafeVersion` 校验、curl/npm/tar/chmod/powershell 全 argv 化、下载强制 https、`HF_ENDPOINT` 仅接受 https origin；`version.js` 移除不必要的 `shell: true`
  - **symlink 防御**：scene-extractor 与 l1-reader 读取目录枚举文件前 `lstat` 拒绝非普通文件（审计 §5.2/§5.3）
  - **ipc-security 测试套件修复（历史首次全绿）**：测试硬编码 Windows 路径 + 手工拼 URL 在 POSIX 上必然失败（安全网形同虚设数月）——改由 `pathToFileURL` 派生 + 跨平台编码不变量用例，26/26 全绿
  - 全仓测试首次全绿：core 412 / desktop 149 / memory 14 / embedding 10

### ✨ 新功能

- **Router 闭环方案 R1-R4：语义路由的能力闭环 × 数据流闭环** (2026-08-15，方案见 `docs/research/2026-08-15-routing-closure-plan.md`)
  - **R1 调用经济性 + 前缀守恒**：`multiIntent` 判定合并进 G1 技能精排的同一 flash 调用（此前每条消息都先付一次 SAD 分解调用，且低置信的纯 embedding 路径可短路有验证的精排路径）；G1 先跑、G3 仅多意图触发且结果过防幻觉白名单；**G2 工具路由会话级冻结**（此前逐迭代重路由导致请求前缀每轮变化，DeepSeek 前缀缓存全灭、工具可能中途消失）；内置服务器（serena/codegraph/a2ui/activity-frames）默认 pin
  - **R2 组合路由能力闭环**：SKILL.md frontmatter 新增可选 `categories/inputs/outputs` 契约（缺失行为与现状逐字节一致），激活 Compose 的 I/O 类型传导与类别兼容度（此前恒零退化为纯相似度）；**DAG 编排提示**以 `<orchestration-plan>` 消息注入（步骤 + 依赖顺序不再丢弃）；skill-writer 模板同步契约
  - **R3 RoutingFacade + lazy connect 机制**：decide-once/invalidate 会话级决策单点；`ensureMcpServersConnected` 按决策拉起掉线服务器（机制就绪——当前清单全部 pinned/用户配置故行为不变，兼任子进程自愈）
  - **R4 卫生与观测**：设置保存即热生效（`invalidateRouting`）；加载失败 60s 退避（此前每条消息重试 import）；G1/G3 索引签名统一（交替不再触发重建）；向量缓存 LRU GC（上限 32 文件）；G2 budget 改用序列化 schema 真实长度；**知识面板新增"语义路由"卡片**（ready/idle/error + 载因，6 语言）——"路由静默失效"结构性不可再现
  - **RoutingTelemetry**：G1/G2/G3/SAD/server 五阶段结构化事件（hit/fallback/skip + 耗时 + 计数），经既有 routingLogger 单点注入
  - 测试 +22：调用计数（单意图 1 次 flash/轮）、工具集冻结字节一致、多意图 SAD 恰一次、防幻觉、元数据解析/Compose 激活/向后兼容、facade 冻结与失效、lazy-connect 机制、退避、缓存 GC、budget 估算

- **Designer 全域计划 Batch 6-10：三层定位落地（A2UI 全域交互层 × PM-Design × UI-Design）** (2026-08-14，方案见 `docs/research/2026-08-14-openui-full-adoption-plan.md`)
  - **组件契约单一事实源**：抽取 React-free 的 `library-schema.ts`；`library.tsx`（渲染）与 `generate-openui-prompt.mjs`（prompt 生成）共用同一 schema，消灭"schema ↔ 手写 SKILL.md ↔ 脚本 stub"三源漂移；`npm run openui:prompt` 一键再生成，desktop 构建内置防漂移钩子（负向验证：篡改 SKILL.md → 构建失败并自动复原）
  - **P0 活 bug 收口**：pm-designer-openui SKILL.md 仍有 3 处教 LLM "只发增量语句"而实现是全量替换——已全部改为全量替换口径，组件表替换为 `library.prompt()` 生成物（真实签名，修正脚本 stub 里不存在的 variant/danger 等枚举）
  - **迭代产物血缘 + 版本快照**：`render_openui` 此前每次新建 artifact、`update_openui` 完全不落盘、`update_design` 每次新建——新增 `saveArtifactWithLineage`（render 建档 / update 复用同 id），内容变更自动快照 `versions[]`（上限 20 FIFO）；`requirement.md` 持久化（render_openui 新增 `requirement` 入参）
  - **formState 持久化与水合**：原型表单状态 2s 节流落盘（`design:saveFormState`/`readFormState` IPC，按 pipeline 解析最新产物），重开会话自动水合
  - **纠错回路**：渲染错误（unknown-component 等）自动组织为修复反馈回喂 agent 一次（800ms 去抖，同 code 同错不二次回喂，防死循环）
  - **inlineMode 灰度**：`settings.openuiInlineMode`（默认关）开启后从 assistant 回复提取完整 ```openui-lang 代码块直接渲染，无需等待工具调用；工具通道始终权威
  - **materialize 路由升级**：新增 `judgeViaLlm` 接缝（ActionContext 可选注入，SessionManager 用 flash 模型 JSON 模式实现、fail-open）——PM-Design vs UI-Design 二选一由 LLM 判定，关键词启发式保留为兜底，用户显式指定优先；`artifactId` 不再从 subagent 末条文本臆测
  - **边界 guard 测试**：三条不变量锁定三层定位（design 插件无 a2ui 技能、`DesignPipeline` 不含 a2ui、materialize 路由不触及交互工具）；a2ui-annotation skill 定位更新为"全域交互层（主动式追问 + 批注式交互）"并写入增量原则（存量交互组件不迁移）
  - **管线检测收敛**：use-preview 的三段 60 行 if/else 收敛为纯函数 `detectPrototypeArtifact`（metadata 存在性判定，includes 仅快路径）；新增 6 个测试文件 30 用例（detect/correction/inline-extract/store/prompt 快照/边界 guard + materialize 路由）
  - 附带基建：build.mjs 新增 `DEEPORCA_SKIP_VENDORS`（离线/快速构建跳过 vendor 网络校验）

- **LLM 稳健性三件套：usage 口径修正 + 溢出自动压缩重试 + 流 idle 看门狗** (2026-08-14, 分支 `fix/stabilize-data-loss-and-test-suite`，dsh 调研 P0 落地)
  - **usage 口径修正**：上下文压力读数 `activeTokens` 从"最近一次请求的 `total_tokens`"切换为 **prompt 侧总量**（`getLastPromptTokens`，cache 命中计入——它们仍占上下文窗口）。旧口径把历史累计输出 token 也算进压缩阈值，长会话会**过早触发压缩**；TopBar/ContextProgress 进度条随之与真实阈值对齐。新增 `getFreshInputTokens()`（prompt − cache 命中，兼容 DeepSeek `prompt_cache_hit_tokens` 与 OpenAI `prompt_tokens_details.cached_tokens` 两种上报，负值钳零）；`compactSession` 完成后 `activeTokens` 归零、由下次真实请求重新计量
  - **LLM 错误分类器 + 溢出自动 compact-and-retry**：`classifyLlmError()` 八类归一化（AUTH / QUOTA / RATE_LIMIT / CONTEXT_WINDOW_EXCEEDED / SERVER / TRANSIENT / TIMEOUT / UNKNOWN，正则族按 DeepSeek 实测文案校准）。上下文溢出不再等于会话死亡——自动插入提示消息 → `compactSession` → 重放一次激活循环；TIMEOUT 同样重试一次；QUOTA 显式不重试；压缩自身失败时上报原始溢出错误；每次激活仅一次重试预算防循环
  - **流 idle 看门狗**：`withStreamIdleTimeout()` 对 SDK 流的**单次读取**计时（timer unref），长思考静默与真断流不再不可区分——超时抛 `LlmStreamIdleTimeoutError`（归 TIMEOUT，可自动重试）而非挂死/静默失败。主会话与压缩请求统一生效；超时可经 `settings.streamIdleTimeoutMs` 或 env `STREAM_IDLE_TIMEOUT_MS` 配置，默认 300 秒
  - 测试：分类器 9 类 fixture、usage 边界（cache_hit > prompt 钳零、OpenAI 嵌套口径）、看门狗静默超时/慢速完成两路径、溢出→压缩→重试恢复、二次溢出仅重试一次、QUOTA 不重试、TIMEOUT 重试（core 386 用例全绿，3 处存量断言随口径更新）
  - 设计吸收自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（纯设计借鉴，零代码依赖），方案与验收详见 `docs/research/2026-08-14-dsh-adoption-plan.md`

- **本地向量嵌入模型 (Granite 97M R2)** (2026-08-06)
  - 新增 `@deeporca/embedding` workspace 包：transformers.js + onnxruntime-node，IBM Granite Embedding 97M multilingual R2（384 维，Apache 2.0，200+ 语言含中文）
  - 构建期 vendor 模型（`scripts/vendor-granite.js`，hf-mirror 兜底），不走运行时下载
  - 接入 memory 包 sqlite-vec 后端（`provider: "local-onnx"`），Fail-open 契约与现有 LocalEmbeddingService 一致
  - 记忆召回测试：20 条中文记忆 × 12 条查询，向量召回命中率 100%（FTS 关键词召回 0%，语义同义改写场景向量完胜）
  - 新增 `scripts/test-embedding.mjs`（模型冒烟）+ `scripts/test-recall.mjs`（召回准确率对比）

- **技能/工具语义路由 (SkillRouter + ToolRouter)** (2026-08-06)
  - 新增 `packages/core/src/routing/` 模块：基于 embedding 的技能/工具召回，减少每轮注入 LLM 的上下文
  - **G1 SkillRouter**：技能数 > 阈值时用 embedding 召回 top-K 短名单，flash LLM 只精排短名单（`identifyMatchingSkillNames` 集成）
  - **G2 ToolRouter**：MCP 工具按服务器级召回，token 超预算时只注入相关服务器工具（`activateSession` getTools 集成）
  - 纯内存余弦索引 + 磁盘缓存（`VectorIndex`），28 个单测全过
  - 配置：`settings.routing`（enabled/skillTopK/skillMinPool/mcpToolGating/mcpTokenBudget/pinnedServers）
  - 全程 fail-open：模型未就绪/加载失败/任何异常 → 回退全量候选，行为与路由前逐字节一致
  - **G3 组合路由（M4，SkillWeaver Decompose-Retrieve-Compose 三阶段管线）**：
    - **SAD（迭代技能感知分解）**：复杂查询 → LLM 拆解原子子任务 + 技能 hint 反馈循环（Jaccard 收敛判断，论文 Algorithm 1）
    - **Retrieve**：bi-encoder top-K 召回（复用 VectorIndex）
    - **Compose（兼容性规划）**：Eq.4 选择目标 `α·sim + (1-α)·compat`，三种兼容性度量（I/O 类型 coercion + category Jaccard + keyword 共现）+ DAG 依赖检测
    - `SkillRouter.composeRoute()` 组合入口；单步查询自动降级为 shortlist()

- **架构扫描技能 (arch-scan) + 工作区索引三步** (2026-08-06)
  - 新增 `arch-scan` skill（`packages/core/templates/plugins/code/skills/arch-scan/`）：采用 oh-my-mermaid（omm）的 12 视角目录 + 递归下钻 + 7 字段元数据方法论，**渲染用 A2UI**（非 Mermaid + CLI），输出 A2UI Surface（可嵌套组件树）
  - 构建索引按钮三步顺序执行：**索引（CodeGraph）→ Wiki（OpenWiki）→ 架构图（arch-scan）**；arch-scan 仅首次索引触发，fire-and-forget（LLM 任务不阻塞面板）
  - 不引入 omm CLI/Mermaid/`.omm/` 文件树；60/60 结构校验通过
  - 调研详见 `docs/research/2026-08-06-oh-my-mermaid-research.md`

- **DeepSeek 前缀缓存优化（cache-first）** (2026-08-06, `6a9b70f`)
  - 系统提示前缀按**稳定度排序**（最稳定→最易变），最大化 DeepSeek prefix cache 命中率
  - 日期 + 模型信息从系统提示前缀**拆出**，改为每轮注入的 transient 尾部消息（不进持久前缀）—— 跨天/切换模型不再破坏缓存
  - MCP 工具定义排列保持缓存友好；`getStableRuntimeContext()` + `getCurrentTurnTail()` 分离稳定/易变上下文
  - 直接降低 DeepSeek API 成本（缓存命中段按缓存价计费）+ 降低首 token 延迟

- **Monaco Editor 集成** (2026-07-26, `35fd032`)
  - 集成 Monaco Editor 代码编辑器模块到桌面客户端
  - 支持代码编辑、语法高亮、智能提示
  - 提升代码编辑体验和开发效率

- **GitMCP 本地模块** (2026-07-26, `5f8c537`)
  - 完整实现本地 GitMCP 模块
  - 独立索引库 + 边缘快捷项 + MCP 权限控制
  - 基于 SQLite FTS5 全文索引，BM25 排序
  - 4 个内置工具：fetch_documentation、search_documentation、search_code、fetch_url_content
  - 提供强大的代码搜索和文档获取能力

- **Open Code Review 集成** (2026-07-25, `99051a3`)
  - 集成 Open Code Review 插件 + 代码审查面板
  - 新增 Glass Prism 主题
  - 提供代码审查和质量分析能力

- **GitHub Pages 官网** (2026-07-24, `809324d`)
  - 创建 GitHub Pages 官网
  - 提供项目文档和介绍

- **DeepOrca 品牌重塑** (2026-07-23, `c89bf67`)
  - 对外文案品牌替换为 DeepOrca
  - 设置面板新增「关于」Tab（包含更新日志）
  - 明确项目定位：DeepOrca 只提供桌面客户端版本

- **聊天渲染改进** (2026-07-23, `622d732`)
  - 新增头像显示
  - 添加入场动画效果
  - 优化响应式边距

- **上下文进度条** (2026-07-23, `144a500`)
  - 添加玩具风格的上下文进度条
  - 支持两位小数读数
  - 实时显示上下文使用情况

- **本地化文档** (2026-07-23, `5bbb089`)
  - 本地化内置插件/技能文档（中文 .zh.md）
  - 提升中文用户体验

- **可折叠工具卡片** (2026-07-23, `8f2912a`)
  - 可折叠 bash/cli 工具卡片
  - 头部显示结果提示
  - 优化工具执行结果展示

- **插件模块重构** (2026-07-23, `b2fb598`)
  - 内置插件分组显示
  - 精简插件列表
  - 重新设计插件详情页

### 🎨 优化改进

- **自迭代性能与稳定性优化** (2026-07-27)
  - 消息 Markdown 渲染结果缓存 + 消息组件 memo 化，长会话与空闲时 CPU 占用显著下降
  - 加载动画心跳仅在任务进行中运行；流式输出期间侧边栏刷新节流至 1.5s/次
  - IPC 错误统一归一化；启动/切换工作区失败不再静默卡死，错误直接展示在输入区
  - 代码审查/Wiki 后台进程随应用退出自动终止；复制反馈计时器卸载时清理
  - runPrompt 尾部 IPC 并行化；Wiki 目录读取改为静态导入
  - 设置面板变更日志新增 v0.5.0 / v0.6.0 条目

- **官网交互优化** (2026-07-26, `015162b`)
  - 添加 CSS 呼吸动画效果（grid-breathe、glow-pulse）
  - 实现导航栏滚动隐藏/显示交互
  - 添加 IntersectionObserver 滚动动画
  - 优化用户体验和视觉效果

- **桌面端 UI 增强** (2026-07-26, `bcba151`)
  - 8 项 UI 增强
  - vendored openwiki & flutter skills
  - 提升整体用户体验

- **桌面端 UI 深化** (2026-07-24, `5d2d0d6`)
  - 深化 UI 组件交互与 core 能力整合 (v12-v22)
  - 优化组件交互逻辑

- **Fusion 主题优化** (2026-07-23, `0231517`)
  - 使 Fusion 玻璃效果为磨砂，而非透明
  - 提升视觉效果

- **索引轨道图标优化** (2026-07-23, `1aa8998`)
  - 使用单色 ☷ 作为索引轨道图标
  - 统一图标风格

- **Fusion 顶栏徽章优化** (2026-07-23, `2d5b56f`)
  - 移除 Fusion 顶栏徽章的强调色背景
  - 简化视觉设计

### 🐛 问题修复

- **桌面客户端启动崩溃：CodeGraph CJS 命名导出在 ESM main 链接期失败** (2026-08-14)
  - `9981f6a` 迁移出的 `codegraph-sdk.ts` 用静态 `import { CodeGraph } from "@colbymchenry/codegraph"`，而该包入口是 `module.exports = require(resolveLibrary())` 动态转发——cjs-module-lexer 无法静态探测命名导出，Electron ESM main 进程在**加载期直接崩溃**（`Named export 'CodeGraph' not found`），窗口无法打开。改为 namespace 导入 + 运行时解构，启动恢复且 codegraph MCP server 正常 ready

- **会话索引数据丢失修复 + 测试套件解卡死 + 语义路由首次真正激活** (2026-08-10, 分支 `fix/stabilize-data-loss-and-test-suite`)
  - **会话索引读写不一致（线上数据丢失）**：`4d5575a` 把索引写入防抖进 `pendingIndex`，但每次读仍走磁盘。`updateSessionEntry` 是 load→mutate→save 且流式时约 17 次/轮 —— 同一 250ms 窗口内两次更新都以旧磁盘态为基准，**前者永久丢失**。这损坏了 `usage`/`usagePerModel` 累计，并完全丢弃了 `permission_denied`。`loadSessionsIndex` 现优先读 `pendingIndex`；`denySessionPermission` 改为立即 flush（与 session 创建/删除一致）。新增回归测试覆盖"丢更新"这一半（验证：禁用修复后 rename 变回旧值）。
  - **测试套件无限挂死**：`APIUserAbortError` 测试的 mock 只在 abort 事件上 settle，而 `ec11350` 在"标记 processing"与"发请求"间插入了 `await getRoutedMcpTools()`，导致 abort 先于监听器注册触发 → promise 永不 resolve。mock 改为先判 `signal.aborted`（对齐真实 SDK 语义）。全部 4 个 runner 加 `--test-timeout` + `--test-force-exit`，ci.yml 加 `timeout-minutes: 45`。套件 **196s + 无限挂死 → 21s 全绿**。
  - **恢复 npx `-y`**：`bed96b0` 迁移到 SDK 时静默删除了 `withNpxYesArg`，导致 npx 启动的 MCP server 卡在安装提示。已恢复。
  - **语义路由从未运行**：模型路径多一个 `packages` 段（`packages/packages/desktop/...`）。根因是架构性的 —— core 自己猜 vendor 路径，而 codegraph/serena 都用 host 注入。新增 `configureRoutingModelDir`（对齐既有模式），desktop 在 boot 注入。端到端验证通过（warmup 完成 384 维、embed 成功、close 正常释放）。
  - **memory 时区 bug**：`capture.test.ts` 用 UTC 算 shard 名、产品用本地时间，东八区**每天 8 小时必败**，CI 跑 UTC 永不暴露。已修。
  - **清理死代码**：删除零调用点的 HTTP memory gateway 客户端（`core/common/memory.ts`，396 行）+ 移除 `memory-tencentdb` 依赖及其打包 stage（lockfile **−1294 行**）。`tcvdb-text` 是不同包，保留。
  - **renderer 测试安全网**：新增 jsdom + @testing-library/react（保留 node:test），App.tsx **首次可渲染测试**。3 个守护测试锁住拆分最易破坏的行为。desktop 测试 37→40。

### 🔧 重构

- **App.tsx 域提取** (2026-08-10, 同分支)：1773 → 1410 行（−20%），11 个 per-domain custom hook（`useTreeRefresh`/`usePanelLayout`/`useAppearance`/`usePreview`/`useSkills`/`useProcessPanel`/`useGit`/`useSettingsData`/`useGlobalShortcuts`/`useComposerDockHeight`/`useDocumentTitle`）。纯提取，props 与渲染行为不变；`useConversation`（HUB，12 注入依赖）与 Context 化未做。详见 `docs/stabilization-2026-08-10.md`。
- **registerIpc 拆分** (同分支)：765 行单函数 → 17 个 per-domain registrar（最大 172 行），85 channel 数与注册顺序不变。
- **SessionBridge 提取** (同分支)：1216 → 1011 行，只读 plugin/MCP 投影移入 `plugin-mcp-view.ts`（沿用 git-service 无状态函数先例）。
- **lint 警告清零** (同分支)：27 → 0。自有代码 8 个实际修复；vendored TDAI fork 19 个改为 eslint ignore（改 vendored 代码会加大上游漂移）。

### 📝 文档更新

- **dsh 调研落地计划 + 状态跟踪** (2026-08-14)：新增 `docs/research/2026-08-14-dsh-adoption-plan.md`（对照 deepseek-harness 十点审计的分层吸收方案：P0 正确性修复 / P1 顺势加固 / P2 择机 / P3 明确暂缓），P0 三项落地后已回写状态（对账表、落地记录、分支顺序）；前置调研 `2026-08-14-dsh-deepseek-optimization-takeaways.md` + `2026-08-14-deepseek-harness-deep-dive.md`。
- **AGENTS.md 校正** (2026-08-10)：2 → 4 包（`memory`/`embedding` 此前缺失，~36% 源码在文档地图外）、补 `routing/` 章节、2 → 13 vendor 脚本、修正 `ipc.ts`"纯类型"说法（实际导出 98 个运行时常量）、删除不存在的 `generated/`、记录 RC1 索引不变量（含 Map 陷阱）。
- **新增 `docs/stabilization-2026-08-10.md`**：本次修复的完整报告（诊断、triage、过程纠正、已做/未做及理由）。

  - 修复 Electron 中 codegraph init 命令拼接错误
  - 解决代码索引功能异常问题

- **桌面端修复** (2026-07-24, `821d97b`)
  - 修复当前工作区始终显示在会话列表中的问题
  - 提升工作区管理体验

- **macOS 修复** (2026-07-23, `7e36b79`)
  - 修复 macOS traffic light buttons 不可点击问题
  - 解决窗口控制按钮失效问题

- **索引重置修复** (2026-07-23, `0bc7713`)
  - 修复索引重置问题
  - 添加可视化管道
  - 使用固定压缩模型

- **IPC 调用加固** (2026-07-23, `dd9cc03`)
  - 加固 BuiltinPluginDetail IPC 调用
  - 提升系统稳定性

- **i18n 修复** (2026-07-23, `a569ac9`)
  - 保持 deepcode-self-refer 名称为 "Deep Code" 以匹配技能文档
  - 解决国际化文本不一致问题

- **索引图标修复** (2026-07-23, `6b2bfaa`)
  - 修复索引图标显示问题
  - 解决当前目录被注入为空工作区的问题

### 📝 文档更新

- **README 重构 + CHANGELOG** (2026-07-27, `e48de0a`)
  - 新增 CHANGELOG.md，记录所有重要变更和提交历史
  - 重构 README.md，以 DeepOrca 项目名重新定位
  - 突出项目现状和发展路线图
  - 将原 README 作为子项引入（README-deepcode-cli.md）

- **Feature 路线图 v2.1** (2026-07-26, `015162b`)
  - 新增 Penpot vs Open Design 对比分析（选择 Open Design）
  - 新增 Obscura 轻量级无头浏览器集成方案
  - 标记已集成项目（flutter/agent-plugins、openwiki、codegraph）

- **GitHub Pages 官网 + CI/CD** (2026-07-26, `18875b2`)
  - 更新 README、GitHub Pages 站点
  - 添加 CI/CD 工作流

- **Feature 路线图 v2** (2026-07-25, `2062418`)
  - 重写 Feature 路线图，8 个项目直接集成方案
  - 包含 CLI-Anything、openwiki、open-design

- **Feature 路线图修正** (2026-07-25, `005bf33`)
  - 修正 Feature 路线图：5 个项目定位为直接集成而非参考

- **Feature 规划路线图** (2026-07-25, `92fc182`)
  - 新增 Feature 规划路线图：5 个开源项目集成调研 + 近期开发计划

- **README 更新** (2026-07-25, `00a3b83`)
  - 更新 README：当前功能全景 + Feature Roadmap（近期开发 + 后期特性）

---

## 提交历史详录

### 2026-07-27

- `e48de0a` - docs: 重构 README + 新增 CHANGELOG

### 2026-07-26

- `015162b` - docs: 更新 Feature 路线图 v2.1 + 官网交互优化
- `35fd032` - feat(desktop): 集成 Monaco Editor 代码编辑器模块
- `18875b2` - docs: update README, GitHub Pages site, and add CI/CD workflows
- `5f8c537` - feat(gitmcp): 本地 GitMCP 模块完整实现 — 独立索引库 + 边缘快捷项 + MCP 权限控制
- `bcba151` - feat(desktop): 8-item UI enhancement round + vendored openwiki & flutter skills

### 2026-07-25

- `2062418` - docs: 重写 Feature 路线图 v2 — 8 个项目直接集成方案（含 CLI-Anything/openwiki/open-design）
- `005bf33` - docs: 修正 Feature 路线图 — 5 个项目定位为直接集成而非参考
- `92fc182` - docs: 新增 Feature 规划路线图 — 5 个开源项目集成调研 + 近期开发计划
- `00a3b83` - docs: 更新 README — 当前功能全景 + Feature Roadmap（近期开发 + 后期特性）
- `99051a3` - feat(desktop): integrate Open Code Review plugin + code review panel; Glass Prism theme; research docs

### 2026-07-24

- `809324d` - feat: GitHub Pages 官网 + 修复 readSkillDoc ENOENT
- `f51d16b` - fix(codegraph): 修复 Electron 中 codegraph init 命令拼接错误
- `821d97b` - fix(desktop): 当前工作区始终显示在会话列表中
- `5d2d0d6` - feat(desktop): 深化 UI 组件交互与 core 能力整合 (v12-v22)

### 2026-07-23

- `7e36b79` - fix(desktop): fix macOS traffic light buttons not clickable
- `92b0d76` - merge: integrate main branch (index reset + visualization + compaction model) into qoder
- `0bc7713` - feat: fix index reset, add visualization pipeline, and use fixed compaction model
- `dd9cc03` - fix(desktop): harden BuiltinPluginDetail IPC calls
- `622d732` - feat(desktop): chat rendering revamp — avatars, entry animation, responsive margins
- `a569ac9` - fix(i18n): keep deepcode-self-refer name as "Deep Code" to match skill doc
- `144a500` - feat(desktop): toylike context-progress bar with two-decimal readout
- `5bbb089` - feat: localized built-in plugin/skill docs (Chinese .zh.md)
- `8f2912a` - feat(desktop): collapsible bash/cli tool cards with result hint in header
- `b2fb598` - feat(desktop): revamp plugin module — built-in grouping, leaner list, detail redesign
- `c89bf67` - feat(desktop): rebrand to DeepOrca + add About/Changelog settings tab
- `1aa8998` - style(desktop): use monochrome ☷ for index rail icon
- `6b2bfaa` - fix(desktop): distinct index icon + don't inject cwd as empty workspace
- `2d5b56f` - style(desktop): drop accent tile backgrounds from Fusion topbar badges
- `0231517` - fix(desktop): make Fusion glass frosted, not see-through

---

## 致谢 / Acknowledgements

### DeepSeek Harness (dsh) — LLM 稳健性设计借鉴

DeepOrca 的 LLM 会话稳健性层（2026-08-14 落地的 P0 三件套）在设计上借鉴了 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（dsh，MIT License）的以下机制——**纯设计吸收，不包含任何 dsh 代码**：

| dsh 机制                                                                                                      | DeepOrca 实现                                                             | 文件                                                                     |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **usage 互斥折算**（`inputTokens = prompt_tokens − cacheRead`，压力读数 = 最近请求的 prompt 大小）            | `getLastPromptTokens()` / `getFreshInputTokens()`，压缩阈值锚定 prompt 侧 | `packages/core/src/session.ts`                                           |
| **错误归一化 + 溢出 compact-and-retry**（`CONTEXT_WINDOW_EXCEEDED` 归一化 → 上压缩 → 单次重试，QUOTA 不重试） | `classifyLlmError()` 八类分类器 + `runActivationLoopWithAutoRecovery()`   | `packages/core/src/common/llm-error.ts` · `packages/core/src/session.ts` |
| **流 idle 看门狗**（超时计在单次读取上，默认 300s）                                                           | `withStreamIdleTimeout()` + `LlmStreamIdleTimeoutError`，时长进 settings  | `packages/core/src/session.ts`                                           |

调研全文见 `docs/research/2026-08-14-deepseek-harness-deep-dive.md` 与 `2026-08-14-dsh-adoption-plan.md`（含明确暂缓项的决策记录）。感谢 DeepSeek 团队开源了这套对 DeepSeek 线上怪癖打磨极深的 harness 设计，其"前缀字节守恒"与 token 经济学哲学持续影响本项目的演进方向。实现层面的任何偏差由 DeepOrca 项目自行负责。

### SkillWeaver — Compositional Skill Routing

DeepOrca 的技能/工具语义路由（`packages/core/src/routing/`，G1-G3）在设计上借鉴了以下论文提出的 **Decompose-Retrieve-Compose** 三阶段组合路由框架：

> **Xueping Gao** (Alibaba Cloud). _"Compositional Skill Routing for LLM Agents: Decompose, Retrieve, and Compose."_ 2026.
> 📄 论文：[arxiv.org/abs/2606.18051](https://arxiv.org/abs/2606.18051) · HTML 全文：[arxiv.org/html/2606.18051v1](https://arxiv.org/html/2606.18051v1)

具体复现/参考的论文组件：

| 论文组件                                                           | DeepOrca 实现                                                                                                           | 文件                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **SAD**（Iterative Skill-Aware Decomposition，§3.1 + Algorithm 1） | `runSad()` —— LLM 拆原子子任务 + 技能 hint 反馈循环 + Jaccard 收敛判断                                                  | `packages/core/src/routing/sad.ts`          |
| **Retrieve**（bi-encoder top-K，§3.2）                             | `VectorIndex.query()` —— 复用 G1/G2 的纯内存余弦索引                                                                    | `packages/core/src/routing/vector-index.ts` |
| **Compose**（compatibility-aware planner，§3.3 + Eq.4）            | `composePlan()` —— `α·sim + (1-α)·compat` 选择目标 + I/O 类型 coercion + category Jaccard + keyword 共现 + DAG 依赖检测 | `packages/core/src/routing/composer.ts`     |
| **CompSkillBench 评测指标**（CatR@k / DA，§4）                     | 召回准确率抽查门槛参考（top-8 命中率 ≥ 90%）                                                                            | `specs/skill-routing/design.md` §5          |

**与论文的差异（适配 DeepOrca 场景）：**

- **Embedding 模型**：论文用 `all-MiniLM-L6-v2`（英文 384 维）；DeepOrca 用 `IBM Granite Embedding 97M multilingual R2`（384 维，200+ 语言含中文）—— 主场景是中文提示 × 中文技能描述。
- **索引**：论文用 FAISS `IndexFlatIP`；DeepOrca 用纯内存暴力点积（规模足够，无原生依赖）。
- **Fail-open**：论文未强调；DeepOrca 全程 fail-open（模型未就绪/异常 → 回退全量候选），保证路由是纯增益、绝不搞挂会话。
- **工具级路由（G2）**：论文只做技能级；DeepOrca 额外实现了 MCP 工具的服务器级路由（避免半个服务器的工具链断裂）。

感谢 SkillWeaver 作者团队（Xueping Gao，Alibaba Cloud）公开了清晰的方法论与实验细节，使本实现得以在工程层面忠实复现。任何实现层面的偏差由 DeepOrca 项目自行负责。
