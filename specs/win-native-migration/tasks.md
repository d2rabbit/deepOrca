# Windows 原生重写 — 任务清单（win-native-migration）

> 对应 `design.md`（2026-09-02 立项）。每段出口标准以 design.md §七为准。
> 标记：⬜ 未启动 · 🔄 进行中 · ✅ 完成 · ⏸ 条件未触发
> 分支：`feat/win-native`（fork 自 `feat/modern-ui-redesign`，与 `feat/apple-native` 同轨并存）

## M0 立项准备 🔄（0/2 完成，1 待 Windows 侧环境）

- [x] 0. 建 `feat/win-native` 分支（fork 自 `5d9e05fb`）+ `deeporca-win/` 骨架（sln / Directory.Build.props / Core+Cli+Tests 工程 / UI+App 占位目录 / .gitignore / README 上游能力对齐表逐项 ⬜）✅ 2026-09-02
- [ ] 1. .NET 10 SDK + Windows App SDK 2.x + WebView2 运行时环境验证（含 CI windows runner 可用性确认）——本机 macOS 无 dotnet 已确认并记录到 deeporca-win/README.md 环境表，Windows 侧验证待做
- [x] 2. 依赖基线锁定：`ModelContextProtocol` 2.2.0、`Microsoft.ML.OnnxRuntime` 1.29.0、`CommunityToolkit.Mvvm` 8.4.2、`Microsoft.ML.Tokenizers` 2.0.0（+ WinAppSDK 2.4.0 / WebView2 1.0.4191.47 / 测试栈，2026-09-02 经 nuget.org 核实，钉死于 deeporca-win/README.md）✅ 2026-09-02

## M1 骨架：Core + LLM ✅（2026-09-02，41 单测全绿 + 边界检查通过）

- [x] 0. `DeepOrca.Core` 类库（net10.0）+ UI-free lint 守护（`tools/check-core-boundaries.mjs`：引用扫描 WinUI/WebView2/MAUI/Avalonia/Console.* 即 fail）✅
- [x] 1. Types：record + STJ source-gen（`CoreJsonContext` camelCase）；AnyJson（`JsonNode` 封装 + 深比较）；settings 反序列化（TS endpoints 数组兼容，对拍 apple `SettingsTypes.swift` fromTSJSON：六块同构）✅
- [x] 2. StreamParser 直译：SSE 逐事件（token / tool_call 按 index 装配 / reasoning / role/refusal / [DONE] / 畸形 JSON 打捞 / Flush）+ 对拍 apple `StreamParser.swift` 用例 ✅
- [x] 3. OpenAiClient：HttpClient + `IAsyncEnumerable<LlmStreamEvent>`（handler 注入可测）；超时/错误体（HTTP code + body prefix 200）/ include_usage 尾包真实 usage；wire snake_case 手拼（tools 递归编码）✅
- [x] 4. MessageConverter：tool 结果 ↔ tool_call 按 id 配对（每个 tool 消息至多用一次；优先非中断结果）、中断回填（TS JSON.stringify(,null,2) 形状 + metadata.interrupted）、多模态 parts 过滤（注入 SupportsMultimodal）、compaction 过滤、turn tail（仅最后一条 user）、thinking reasoning 回放（empty-field 默认，DeepSeek 契约）、/init 渲染、trailing pending tool calls ✅
- [x] 5. xUnit：SSE 解析（9）/ 消息配对（10）/ AnyJson+Settings（8）/ OpenAiClient（5）/ 骨架（1）+ 边界（2）共 41 全绿 ✅

## M2 基建：权限 + MCP + 持久化 ✅（2026-09-02，全套 69 单测绿）

- [x] 0. PermissionEngine：scope 评估（**deny > Plan force-ask > ask > allow > 路径授权 > 模式默认**）+ BashSideEffectInference 直译（七类副作用正则 + out-cwd 升级；Windows 盘符路径形态支持）✅ 16 用例
- [x] 1. MCPManager：官方 SDK `ModelContextProtocol` 2.2.0（stdio 传输，D4 不 vendor；§6.6 不加透传包装）+ 工具发现缓存 + `RefreshAsync`（tools/list changed 重列）；SemaphoreSlim 单写者门；连接失败摘除不拖累其它 server ✅
- [x] 2. SessionStore：JSONL 读写（sessions-index.json + messages.jsonl）；**单写者门为唯一公共入口（WithGateAsync 统一获取/释放），内存 index 永远权威——pendingIndex 读优先为结构性成立，无旁路读路径**；终端性变更（删除）强制 flush 绕过去抖；250ms 去抖定时器门外落盘；50 条上限淘汰；原子重写（M5 Compaction 备用）✅ 7 用例
- [x] 3. 本地 MCP server 联调用例：`tests/DeepOrca.Core.Tests/Mcp/test-mcp-server.mjs`（newline-delimited JSON-RPC 桩）跑通 工具发现（schema 递归转换）/ 执行（文本渲染 + metadata）/ notFound 结构化错误 / 失败 server 隔离 / 配置移除断连 ✅ 5 用例

## M3 技能 + Prompt ⬜（前置：M2）

- [ ] 0. SkillScanner：目录优先级（项目 .deeporca → .agents → 全局 → bundled）+ YAML frontmatter 解析
- [ ] 1. PromptBuilder：cache-stable 顺序直译（base prompt / runtime context / skills XML 块 / memory / plan / compaction）；runtime context 文案换 Windows（OS/shell/arch）
- [ ] 2. 技能注入快照测试（与 apple 分支 SkillScanner 语义对拍）

## M4 E2E + CLI ⬜（前置：M3）

- [ ] 0. SessionManager 激活循环：LLM → tool_calls → 权限检查 → Process 执行 → 结果回传 → 循环；waiting_for_user / ask_permission 语义
- [ ] 1. 8 内建 tool handler 直译（bash=read/write/edit/AskUserQuestion/UpdatePlan/WebSearch/WebFetch 占位）；bash 走 Git Bash 探测（缺失给安装指引，R7）
- [ ] 2. ToolExecutor + snippet_id 读写契约保持（AGENTS.md 片段编辑契约）
- [ ] 3. 多会话并发：actor-style 单写者下双会话并行验证（对齐 apple 分支 1.7s 双会话验收）
- [ ] 4. CLI：`chat`（交互/单发）、`parallel`、`version`；配置读取优先级 env → 项目 settings → 全局 settings
- [ ] 5. 端到端：真实 DeepSeek 端点中文对话 + 工具调用闭环录屏/日志留档

## M5 上游能力移植 ⬜（前置：M4）

- [ ] 0. Compaction 两段式（Stage A 截断 + Stage B LLM 摘要 + pairing guard，对拍 `Compaction.swift` / `compaction.ts`）
- [ ] 1. Plan Mode 强制权限（force-ask > ask > allow；计划模式把 allow 含显式授权强制转 ask）+ 模式切换消息流
- [ ] 2. TokenSummary：全会话聚合（含 silent subagent）+ per-model 明细 + CLI `tokens`
- [ ] 3. GitFileHistory：git plumbing 直译（每会话 branch、manifest blob、删除恢复、CAS update-ref）；undoToCheckpoint 语义
- [ ] 4. 全局 token 统计 index 写入走 flush 路径（会话索引不变量回归用例）

## M6 任务面 ⬜（前置：M5）

- [ ] 0. TaskTreeService：不可变内容寻址节点、fork（why 必填）/切换/放弃/reflog、id 穿越防护、lineage
- [ ] 1. Subagent：隔离子会话 + silent 零残留 + MAX_DEPTH=4 递归护栏
- [ ] 2. ActionRegistry：register → toToolDefinitions → execute；host 注入（taskTrees / activeSessionId / setSessionTaskRef / reviewService）
- [ ] 3. task.* actions 直译（对拍 `TaskActions.swift` / 上游 actions）
- [ ] 4. 内置 MCP Servers 注册表 + GitMCP slug 解析（`GitMCPResolver.swift` 直译）

## M7 Windows 沙盒 + 真实 WebSearch ⬜（前置：M5；与 M6/M8 可并行）

- [ ] 0. **AC 兼容性冒烟矩阵**：bash / git / node / gh / uv / python 逐个在 AppContainer 内跑通记录；不可用项列降级清单（R2）——此项未过前 S1 不启用
- [ ] 1. **两模块拆分**（design §五 沙盒行）：`SandboxProfileBuilder` 纯函数（输入结构对齐 `SandboxProfileInput`，规则语义 §六.1 映射表，输出确定性单测）+ `SandboxLauncher`（`probe() → CapabilityMap` per-tool 可用性；`launch(...) → ProcessHandle` 与非沙盒进程包装共用类型）；P/Invoke 隔离在 Sandbox/ 内
- [ ] 2. **S0**：受限令牌（CreateRestrictedToken 去特权组）+ Job Object（KILL_ON_JOB_CLOSE + 内存上限，Job 生命周期在 launch 内部）+ 完整性级别；降级 outcome: active|degraded 不静默
- [ ] 3. **S1**：CreateAppContainerProfile（每工作区 profile）+ 能力 SID ACL（读 roots / 写 roots / temp）+ LPAC + internetClient 网络门；越权写实测被拒用例
- [ ] 4. 降级路径：S1 不可用工具自动回退 S0 + UI/CLI 标注
- [ ] 5. WebSearchProvider 直译：DDG Lite 默认 + Brave/Tavily 带 key；UA 换 Windows 形态；解析错误不崩溃
- [ ] 6. ⏸ **S2**：CreateProcessInSandbox / Win32 app isolation 评估（等 API 脱 experimental，事件触发再立项）

## M8 路由 + 注入 + 审查 ⬜（前置：M4；与 M6/M7 可并行）

- [ ] 0. OnnxEmbeddingService：Granite ONNX 复用（host 注入目录 + env 兜底）+ 懒加载 + fail-open + 进程级单例（对齐 closeEmbeddingService 生命周期约定）
- [ ] 1. tokenizer：`Microsoft.ML.Tokenizers` BPE 加载 vocab/merges；**对拍 TS 版 transformers.js 输出**（向量余弦阈值验收）；不达标降级关键词候选（D5）
- [ ] 2. SkillRouter / ToolRouter G1/G2 直译（shortlist / select，fail-open 语义）
- [ ] 3. CompositionalRouter：SAD 分解 + 兼容性组合（对拍 `CompositionalRouting.swift`，SkillWeaver M4）
- [ ] 4. AGENTS.md 指令注入 + Plan 模式任务树物化（对拍上游提交 bc97a5f0 语义）
- [ ] 5. review.run：作用域解析 + LLM 审查 + 结构化输出（对拍 `ReviewActions/ReviewService.swift`；CRG/OCR 外部后端依赖面与 apple 分支同状态，标注 ⏳）

## M9 UI 壳（WinUI 3）⬜（前置：M6–M8；独立可中断）

- [ ] 0. WinUI 3 三栏骨架：会话侧栏 / 对话流 / Inspector；Mica/Acrylic 材质；AppModel（CommunityToolkit.Mvvm）+ DispatcherQueue 封送 + Channel 事件泵
- [ ] 1. 对话流：markdown-it（WebView2）渲染 + 流式增量 + 权限确认卡 + Plan 卡
- [ ] 2. 会话侧栏：列表/删除/重命名/搜索；会话索引 invariant（flush 时机）联调
- [ ] 3. 任务树面板：树视图 + fork 切换 + reflog（对齐 apple 分支侧栏闭环）
- [ ] 4. 审查面板：范围选择 + 运行态持久化 + HTML 报告 WebView2 承接
- [ ] 5. A2UI 浮动原型窗：WinUI 3 独立 Window 嵌 WebView2 + 官方 TS 渲染器离线打包（组件包 vendored，D2）+ SurfaceState 持久化
- [ ] 6. 设置页：endpoints / MCP servers / 权限 / 沙盒模式（S0/S1 切换与降级标注）
- [ ] 7. B 计划判定点（D1）：若 WinAppSDK 阻塞缺陷在此前暴露 → Avalonia 迁移决策记录
- [ ] 8. 打包：self-contained 单文件（引擎/CLI）+ WinUI 安装包（可选 MSIX）；Win11 真机烟雾
- [ ] 9. 端到端 GUI 联调：会话创建 → 对话 → 工具（沙盒 S1 下）→ 任务树 → A2UI 渲染全链路录屏留档

## 回写义务

- [ ] M4 完成 → README 上游能力对齐表回写（引擎行 ✅）
- [ ] M7 完成 → §六.1 冒烟矩阵结果回写 design.md（工具 × S0/S1 可用性表）
- [ ] M8 完成 → tokenizer 对拍余弦读数回写 D5 决策记录
- [ ] M9 完成 → 与 `feat/apple-native` README 对齐表并排核对，差异项列清单
