# 记忆管线修复 — 任务清单

> 对应设计：[design.md](./design.md)。勾选粒度 = 可独立验证的提交。

## Phase 0 — 止损（~0.5 天）✅ 2026-08-21 完成

- [x] T0.1 `MemoryManager.init` 暂停 L2/L3 调度（消灭空转 flash 消耗），代码注释标注 Phase 1 恢复点
  — 落地为 `TdaiCoreOptions.disableL2L3`（tdai-core.ts）+ MemoryManager 传入 true；回归测试 `phase0-stopgap.test.ts`
- [x] T0.2 删除 `auto-recall.ts` 的 `MEMORY_TOOLS_GUIDE` 注入（指向未注册工具）
  — 连带移除截断后缀里的 `tdai_*` 工具指引（同一缺陷类）；sanitize.ts:294 的标签黑名单属防御性过滤，保留
- [x] T0.3 `tdai/NOTICE.md` 补记：fork 基准 `0aff21a`（v2.0.0）+ `core/skill/` 未纳入及 2026-08-21 不移植决策
  — 同节记录硬 fork + 择优移植策略与 v2.0.1-beta.1 不引入清单
- [x] T0.4 验证 — 自动化部分完成：memory 包 39/39 测试通过（含 2 条新增回归）；全仓 typecheck / lint / format:check 三绿；调用点审计确认 `createL2Runner`/`createL3Runner` 仅存在于闸门分支内、pipeline-manager 对 null runner 全路径跳过（延迟触发/maxInterval/关停 flush 均不产生 LLM 调用）。真实 10 轮对话 e2e（需 Electron + API key）留待用户环境执行，预期日志特征：`L2/L3 runners NOT wired`、无 `[L2]`/`[L3]` LLM 调用行、注入 system 消息无 `memory-tools-guide`。

## Phase 1 — L2/L3 工具回路（~2-3 天）✅ 2026-08-21 完成

- [x] T1.1 `adapter.ts` 实现工具回路：tools 数组（read/write/edit，schema 移植上游 `createSandboxedTools`）→ tool_calls 执行 → 回填 → 循环 ≤20 轮；裸 fetch，零新依赖
  — 落地为新文件 `packages/memory/src/runner-tools.ts`（工具定义/执行）+ `adapter.ts` 循环；工具 schema 与上游参数形状一致，L2/L3 提示词无需改动
- [x] T1.2 沙箱路径 containment：拒绝对路径与 `..` 段，join 后二次前缀校验（对齐上游 `resolveStorageKey` 语义）+ Windows 反斜杠归一
  — `resolveSandboxedPath` 另拒盘符/UNC/工作区根本身；测试覆盖 9 种逃逸向量
- [x] T1.3 恢复 L2/L3 调度；L3 失败退避（冷启动条件不再无限重触发）
  — `MemoryManager` 撤下 `disableL2L3`（选项保留为紧急开关）；`L3RunnerResult {ok}` + 指数退避 30min→24h、成功即重置；`createL3Runner` 不再吞失败
- [x] T1.4 测试：工具回路单测（正常/穿越攻击/超轮次）+ 端到端断言 `persona.md` 产出
  — 8 项：containment 向量、write 快乐路径（断言第二轮请求携带 assistant/tool_calls/tool 消息）、穿越拒绝、轮次上限（恰 21 次 POST）、无工具 runner 忽略幻觉调用（L1 路径）、非法 JSON 参数、L3 退避全流程（destroy-flush 亦不可绕过）、PersonaGenerator×工具回路 E2E（persona.md 真实落盘）。SceneExtractor 全链路 E2E 需 L1 记录+场景索引 fixture，由 persona E2E + scene_blocks 沙箱写用例替代覆盖
- [x] T1.5 `npm run check && npm test` 全绿（memory 51/51；typecheck/lint 绿；format 见 T0.4 备注）

## Phase 2 — 消耗可见性（~1-2 天）✅ 2026-08-21 完成

- [x] T2.1 生成日志：L1/L2/L3 每次调用追加 `{ts, layer, status, model, latency_ms, tokens, error}` 至 `.metadata/generation-log.jsonl`（best-effort）
  — `adapter.ts` `onGeneration` 遥测（含失败调用与工具轮次）+ `createGenerationRecorder` 落盘（IO 失败不影响生成，语义对齐上游 best-effort.ts）
- [x] T2.2 `DeepOrcaLLMRunner` 累计 `usage` tokens → `MemoryManager` 计数器
  — `MemoryUsageStats`（按层分桶 calls/totalTokens、failedCalls）+ `getUsage()`；计数为进程内、日志为持久审计
- [x] T2.3 `MemoryStats` IPC 扩展 + 桌面知识面板/用量统计展示 memory 消耗
  — `shared/ipc.ts` `MemoryUsageSnapshot`（契约文件保持零依赖）+ `IndexLibraryPanel` 记忆卡片新增 LLM 消耗行 + 6 个语言块（en/zh/ja/ko/zh-hk/zh-tw）`index.memory.usage`

## Phase 3 — 消减叠加消耗（~2 天）✅ 2026-08-21 完成

- [x] T3.1 `@deeporca/embedding` 进程级单例：core 路由与 memory `store/factory` 共享 ONNX session
  — 落地为 embedding 包内共享注册表（`shared.ts`：按 resolve 后 modelDir 键控 + 引用计数，每次 acquire 返回独立句柄、句柄 close 幂等且只减自身引用，末引用释放才真关）；core `embedding-loader` 与 memory `factory` 均改走 `acquireSharedEmbeddingService`；桌面退出顺序（先 stopMemory 后 closeEmbeddingService）天然完成末释放。4 条注册表测试（同 dir 共享/异 dir 隔离/幂等 close+末释放真实关闭/委托面）
  — 注意事项：embedding 需 `npm run build` 产出 dist（包 exports 指向 dist），已重建
- [x] T3.2 技能匹配去重：同 prompt 文本缓存；`appendDeferredPermissionPrompt` 复用结果
  — `common/skill-match-cache.ts`（键=候选池签名+prompt，池变更自动失效，空结果亦缓存，FIFO 64）+ `identifyMatchingSkillNames` 入口查缓存/成功路径写缓存；权限批复路径自动命中（同 prompt 同池零 LLM/零嵌入）。5 条缓存单测
- [x] T3.3 `everyNConversations` 默认 5→10（经 T4.5 透传落地）
  — 默认值已改（MemoryManager 注释标明；settings 透传仍留 T4.5）

## Phase 4 — 质量与治理（~2 天）✅ 2026-08-21 完成

- [x] T4.1 `MemoryProvider.getToolDefinitions()/executeTool()` + `ToolExecutor` 兜底路由，注册 `tdai_memory_search`/`tdai_conversation_search`，恢复精简版指南
  — MemoryProvider 两个可选方法 → MemoryManager 实现（复用 TdaiCore.searchMemories/searchConversations，limit 钳 1-20、query 必填校验）；executor 新增 MemoryToolBridge（invoke），分派序 builtin→MCP→action→memory→unknown；工具定义注入 activateSession 工具列表（memory 关闭时零变化）；精简版指南回到 recall 稳定段（Phase 0 对应测试已翻转为锁定新契约）
- [x] T4.2 实例化 `LocalMemoryCleaner`（L0 保 30 天 / L1 保 90 天）+ settings 开关
  — 清理器升级为**双保留期**（l0RetentionDays/l1RetentionDays，每日 03:30，最小保留护栏不变）；设置单旋钮 `retentionDays`（默认 30，0=禁用），L1 = max(90, 3×retention)；MemoryManager 持有清理器生命周期（clearProjectMemory 先销毁旧实例防定时器泄漏）
- [x] T4.3 lineage 结构化传递，L1 抽取端过滤 system-hint（替代伪装 assistant 文本）
  — core 侧以真实 `role:"system"` 传递（assistantText 保持干净）；l0-recorder 角色联合扩展；`filterL1VisibleMessages` 在 L1 输入侧剔除非对话角色（L0 仍可被 tdai_conversation_search 检索）；task-tree 测试断言同步翻转
- [x] T4.4 截断默认：`maxCharsPerMemory=300`、`maxTotalRecallChars=2000`
- [x] T4.5 `settings.memory.pipeline` 参数透传 + SettingsPanel 控件
  — settings 链路（MemorySettings → mergeMemory 钳制 → EditableSettings → session-bridge 保存钳制 → startMemory → MemoryManager）；SettingsPanel 新增抽取频率/保留天数两个数值控件，6 语言块齐备（hint 标注重启后生效）

## 全域审查轮（2026-08-21，独立对抗式代理 + 自查）✅ 全部收敛

修复清单（按代理报告编号）：
- **P0-1** clearProjectMemory 的 repoint 补偿块引入 TS never 收窄错误 → 删除（init() 本就重挂新清理器）
- **P1-2** clearProjectMemory 泄漏旧清理器（每日定时器 + 已关 store）→ 先 destroy 再重建
- **P1-3** L3 工具沙箱是整个 dataDir（可写 vectors.db/伪造 L0 = 持久化提示注入）→ `LLMRunParams.allowedFiles` 白名单（L3 仅 persona.md）+ read 256KB 截断；新增 allowlist/read-cap 测试
- **P2-4** L3 "无变化"零成本跳过被误报失败并指数退避 → `generateLocalPersona` 返回 `"skipped"` 三态区分
- **P2-5** enqueueL3 的 finally 重入绕过退避 → 补 `Date.now() >= l3BackoffUntilMs` 条件
- **P2-6** store 降级/构造抛错/初始化异常三路径泄漏共享嵌入引用计数 → 各路径先 close 再丢弃
- **P2-7** edit 工具 `$&`/`` $` ``/`$'` 替换模式展开 → 函数形式 `replace(old, () => new)`
- **P2-8** 手改 settings 的 everyN=0 会退化为每轮抽取 → mergeMemory 钳 `>= 1`
- **P2-9** L1 保留期规格偏差 → 清理器双保留期（见 T4.2）
- **P2-10** 运行期改参数不生效 → hint 标注"重启后生效"（与 embedding 字段既有行为一致）
- **P2-12** ipc.ts 悬空注释归位（SettingsSummary 找回文档）、phase0 测试头注释与断言对齐
- 审查确认干净：resolveSandboxedPath 全逃逸向量（盘符相对/UNC/NUL/8.3 短名/大小写/尾点）、工具分派顺序、MemoryProvider 结构契约、system 角色全链路、i18n 六语言、telemetry、共享注册表竞态
- 保留不修（已评估）：SkillMatchCache 池签名仅覆盖 name（description 编辑最长 64 条 FIFO 内回放，可接受）；无 id 的 tool_call 回显（主流后端均带 id，兼容性备注）；sleep 计时类测试的慢 CI flake 面（watchdog 兜底）

## 不做（决策，勿重开）

- 上游整体同步 / `core/skill/` 移植（自研，约束见 design.md §五）/ 三重摘要架构合并 / memory-prompt 多租户 / checkpoint 分布式锁 / tcvdb 改动 / Hub·Proxy·Panel
