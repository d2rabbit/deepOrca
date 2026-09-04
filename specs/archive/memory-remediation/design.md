# 记忆管线修复与上游策略（memory-remediation）

> **日期**：2026-08-21
> **状态**：**已实施（2026-08-21 四阶段修复随 `fix(memory)` 提交落地，tasks 20/20 全勾；2026-09-02 归档 specs/archive/）**。上游同步策略为活文档——按季度复核 release、择优移植核心管线修复。
> **背景**：对 `@deeporca/memory`（TDAI Core fork）的深度诊断 + 上游增量盘点，两个产出合并为本 spec。

---

## 一、Fork 基线事实（先钉死，后续所有同步决策的锚点）

| 事实 | 值 |
|---|---|
| 上游仓库 | `github.com/TencentCloud/TencentDB-Agent-Memory`（MIT） |
| fork 基准 | **`0aff21a` = v2.0.0（2026-08-03）**，2026-08-05 导入（commit `3bfd990`） |
| 上游活跃分支 | `feat/server_team`（仓库默认分支；`main` 只收 README 更新） |
| 上游基准后增量 | v2.0.1-beta.1（08-14）：多租户 prompt 策略 + 生成溯源日志 + 服务化分布式锁，无核心管线修复 |
| 同步策略 | **硬 fork + 按需择优移植**。我们本地已改 20 个文件（安全加固/query-variants/嵌入接线/L1 校验器），与上游在 7 个文件重叠，整体 re-sync 不可行；上游转向多租户团队服务，与进程内单机嵌入场景持续分叉。按季度复核 release，仅择优移植核心管线修复 |

**NOTICE 账目补记（Phase 0 落实）**：`tdai/NOTICE.md` 排除清单需补两条——① fork 基准 commit `0aff21a`；② `core/skill/` 子系统于 fork 时未纳入（当时无决策记录），2026-08-21 拍板不移植、后续自研（见 §五）。

## 二、缺陷清单（诊断结论，含代码位置）

| # | 级别 | 缺陷 | 位置 |
|---|---|---|---|
| D1 | **P0** | L2/L3 结构性失效且持续空烧：`DeepOrcaLLMRunner` 忽略 `enableTools`，无工具回路；L2 场景抽取与 L3 画像生成依赖 LLM 经文件工具写 `scene_blocks/*.md` / `persona.md`，当前 LLM 文本被丢弃、L3 必失败且冷启动条件持续重触发 | `adapter.ts:108-110`（仅透传 modelRef）、`scene-extractor.ts:209-225`、`persona-generator.ts:158-188` |
| D2 | P1 | 同一对话被三套子系统独立摘要：compaction / L1 抽取（读未压缩 L0 全量）/ L2 场景，无共享游标 | `session.ts:3839`、`pipeline-factory.ts:487-525` |
| D3 | P1 | 每回合技能匹配 LLM 调用；权限批复路径对同一 prompt 重跑；子代理各自全套 | `session.ts:3333/3413/5313` |
| D4 | P1 | 嵌入服务双实例：core 路由与 memory 管线各载一份 Granite ONNX，首回合同一 query 嵌入两次 | `routing/embedding-loader.ts`、`tdai/core/store/factory.ts:99-123` |
| D5 | P1 | memory 的 flash 调用走独立 fetch，不进 session usage 统计，用量面板不可见 | `adapter.ts:75` |
| D6 | P1 | `MEMORY_TOOLS_GUIDE` 每轮注入但指向未注册工具 `tdai_memory_search`/`tdai_conversation_search`（全仓无注册点）——纯 token 浪费 + 误导模型 | `auto-recall.ts:34-47` |
| D7 | P2 | 无衰减/清理：`LocalMemoryCleaner` 从未实例化，`memoryCleanup.enabled=false`，L0/L1 无限增长 | `memory-manager.ts:52`、`memory-cleaner.ts` |
| D8 | P2 | lineage 污染：`<task-lineage>`/`<task-recall-hints>` 隐藏 system 消息伪装成 assistant 文本进 L0，被 L1 当对话事实抽取 | `session.ts:4499-4526` |
| D9 | P2 | 无截断默认：`maxCharsPerMemory=0`、`maxTotalRecallChars=0`、persona 整份注入无上限 | `config.ts:513-514` |
| D10 | P2 | 管线参数硬编码（everyN=5、阈值、L2 间隔），桌面端无 UI 可调 | `memory-manager.ts:43-56` |

## 三、上游增量评估（v2.0.0 → v2.0.1-beta.1，fork 范围内 +1562 行）

| 上游增量 | 处置 | 理由 |
|---|---|---|
| `adapters/standalone/llm-runner.ts`（fork 时被排除） | **引入（Phase 1 蓝本）** | `enableTools:true` 参考实现：OpenAI 工具回路 ≤20 轮 + 沙箱 read/write/edit（`workspaceDir` 相对解析、`..` 穿越阻断，见 `storage-tools.ts` 的 `resolveStorageKey` 双重校验）。修复 D1 的现成方案，但用裸 fetch 重写，不引入 Vercel AI SDK |
| `core/memory-generation-log/`（新增） | **借鉴思想（Phase 2 简化版）** | 每次 L1/L2/L3 生成写溯源日志（层级/模型/延迟/状态/输入输出引用）。简化为单机 `.metadata/generation-log.jsonl`，正面命中 D5 |
| `core/memory-prompt/`（新增） | 不引入 | team/agent/instance 三级策略提示词下发，纯 Hub 多租户场景 |
| `utils/checkpoint.ts` +253 | 不引入 | 多节点分布式锁；单进程 `withFileLock` 已足够 |
| `store/sqlite.ts` +442 / `tcvdb.ts` +558 | 不引入 | 上述两子系统的存储表 + `deleteL0BySession` 修复（该 API 我们不存在，N/A）+ `MemoryContentClear`（已有 `clearProjectMemory` 等价） |
| l1-extractor / scene / persona 的 `memoryPrompt` 接线 | 不引入 | `undefined` 时行为不变，无需求 |
| `core/skill/` 全子系统 | **不引入（2026-08-21 拍板）** | 见 §五 |
| Hub / Proxy / Panel / SDK v3 | 不引入 | 独立服务形态，与进程内嵌入冲突 |

## 四、修复设计（四阶段，共约 7-8 天）

### Phase 0 — 止损（~0.5 天，可独立先发）

1. **关停 L2/L3 空转**：`MemoryManager.init` 暂停 L2/L3 调度（配置或 pipeline-manager 入口），消灭 D1 的重复无效 flash 消耗，直到 Phase 1 完成。
2. **摘除幽灵工具指南**：删 `auto-recall.ts` 的 `MEMORY_TOOLS_GUIDE` 注入（D6 止血；Phase 4 换成真注册）。
3. **NOTICE 补账**：按 §一 补记 fork 基准与 skill 排除决策。

**验收**：开启 memory 跑 10 轮对话，日志确认零 L2/L3 LLM 调用、注入的 system 消息不含工具指南文本。

### Phase 1 — 修复 L2/L3 工具回路（P0，~2-3 天）

- `adapter.ts` 新增工具回路：请求带 `tools`（read/write/edit 定义，移植上游 `createSandboxedTools` 的参数 schema）→ 执行 `tool_calls` → 回填 tool 消息 → 循环，上限 20 轮；路径 containment 按 `resolveStorageKey` 语义（拒绝对路径与任何 `..` 段，join 后二次校验前缀）。保持零依赖（裸 fetch），`enableTools:false` 时与现状完全一致。
- 恢复 L2/L3 调度；L3 失败加退避（避免冷启动条件无限重触发）。
- **验收**：端到端断言 L2 运行后 `scene_blocks/*.md` 真实变更、L3 能写出 `persona.md`；`npm run check && npm test` 全绿。

### Phase 2 — 消耗可见性（~1-2 天）

- 简化版生成日志：每次 L1/L2/L3 调用记 `{ts, layer, status, model, latency_ms, tokens, error}` 追加至 `.metadata/generation-log.jsonl`（best-effort，参照上游 `best-effort.ts` 容错语义——日志失败不影响生成成功）。
- `DeepOrcaLLMRunner` 累计响应 `usage` tokens → `MemoryManager` 计数器 → 经 `MemoryStats` IPC 暴露到知识面板/用量统计（D5 闭环）。

### Phase 3 — 消减叠加消耗（~2 天）

- **嵌入单例共享**（D4）：`@deeporca/embedding` 服务进程级共享，core 路由与 memory `store/factory` 复用同一 ONNX session。
- **技能匹配去重**（D3）：相同 prompt 文本缓存匹配结果；`appendDeferredPermissionPrompt` 复用已匹配结果；子代理沿用父会话匹配（评估后定）。
- **L1 降频**（D2 缓解）：`everyNConversations` 5→10（经 Phase 4 的透传机制落地）。三重摘要的架构性合并（共享游标）明确不做——L1 需要原文，compaction 是会话内视图，语义不同。

### Phase 4 — 质量与治理（~2 天）

- **真注册记忆检索工具**（D6 终态）：`MemoryProvider` 增加 `getToolDefinitions()/executeTool()`，`ToolExecutor` 兜底路由——`tdai_memory_search`/`tdai_conversation_search` 变成真能力（实现已在 `tdai/core/tools/`），恢复精简版使用指南。
- **启用清理器**（D7）：实例化 `LocalMemoryCleaner`，保守默认 L0 保 30 天 / L1 保 90 天 + settings 开关。
- **修 lineage 污染**（D8）：改为结构化元数据传递（messages[] 里显式 `kind: "system-hint"` 之类），L1 抽取端过滤。
- **截断默认**（D9）：`maxCharsPerMemory=300`、`maxTotalRecallChars=2000`。
- **参数透传**（D10）：`settings.memory.pipeline` 覆盖 everyN/阈值/L2 间隔，SettingsPanel 暴露。

## 五、明确不做（决策记录）

1. **不整体同步上游**——硬 fork，理由见 §一。
2. **不移植 `core/skill/`（对话→SOP 自动萃取）**。2026-08-21 拍板：**后续自研**。自研时的硬约束（沿用本次结论）：
   - 萃取产物 sink 必须对齐 DeepOrca 原生技能体系（`~/.deeporca/skills/` / 项目 `.deeporca/skills/` 的标准 SKILL.md），让 skill-routing G1/G2/G3、skill-up CI 直接消费——不得引入独立 skill 存储/版本/检索双体系；
   - 复用 Phase 1 的沙箱工具回路写文件；
   - 默认关闭 + 显式开关 + 纳入 Phase 2 generation-log（多记 `skill` 层）+ 预算上限（上游默认 `maxIterations:16` 可参考）。
3. **不做三重摘要的架构性合并**（见 Phase 3 说明）。
4. **不引入** memory-prompt 多租户、checkpoint 分布式锁、tcvdb 后端改动、Hub/Proxy/Panel 全家桶。

## 六、验证口径

- 每阶段 `npm run check && npm test`。
- Phase 1 端到端：开 memory 跑真实对话，断言 `scene_blocks/`、`persona.md` 产出。
- Phase 2 后：用量面板可见 memory tokens 与生成日志条数。
- Phase 4 后：知识面板可搜索/清除记忆，`vectors.db` 与 JSONL 体积受控。
