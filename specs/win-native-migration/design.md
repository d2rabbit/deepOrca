# Windows 原生重写 — C#/.NET + WinUI 3（win-native-migration）

> 日期：2026-09-02 · 状态：**立项（方案已评审定稿，未启动实现）**
> 基准：`feat/modern-ui-redesign` fork 点 `5d9e05fb`（Electron TS 全量能力面，**非 dev**）
> 参照：`feat/apple-native` 已验证的平移方法论（`deeporca-native/` README 能力对齐表即参照物）

---

## 一、定位与方法论铁律

1. **基准是 fork 点能力面**：`feat/apple-native` fork 自 `feat/modern-ui-redesign` 顶端
   `5d9e05fb`——含任务树 V2、按需审查、风险图谱、A2UI/OpenUI、Compaction、Plan Mode、
   全局 token 统计、文件历史 undo 的 Electron TS 全量能力。Windows 方案的目标覆盖面与
   apple 分支 README 的能力对齐表一致，逐项勾销。
2. **方法论照搬 apple 分支**（已验证有效）：
   - 单一平台语言整栈重写（apple = Swift；Windows = C#）；
   - 逐模块对上游 TS 语义直译（不重新设计），上游文件级对照进注释；
   - Core 引擎 UI-free 红线（不引 UI 框架、logger 注入）；
   - settings/技能目录/AGENTS.md 与 TS 版兼容；
   - 引擎先验证（CLI 可用），UI 壳独立演进；
   - 官方 SDK 优先，NuGet 可达不 vendor（apple 分支 vendor swift-sdk 是网络不可达的无奈，
     Windows 侧 MCP 官方 C# SDK 直接 NuGet 引用）；
   - 每步出口 = 单测绿 + CLI 可验证（对拍纪律）。
3. **与 `ts-native-migration`（scriptc 路线）正交**：那条线是"TS 源码原生化（不换语言）"，
   本方案与 apple 分支同属"平台原生重写"端点。core TS 主线完全不动。
4. **跨端共享资产（零重复建设）**：settings 格式（endpoints 数组）、`.deeporca/skills`
   目录约定、AGENTS.md 约定、Granite 97M ONNX 模型文件（`packages/embedding` 产物）、
   sessions-index / messages.jsonl 持久化格式。

## 二、目标与出口

| # | 目标 | 出口标准 | 对应里程碑 |
| --- | --- | --- | --- |
| G1 | 引擎可用 | CLI 端到端：真实 LLM 对话 + 工具循环 + 多会话并发 + Compaction/Plan Mode/token 统计/undo | M1–M5 |
| G2 | 任务面完整 | 任务树 V2 + Subagent + ActionRegistry + 技能/工具路由 + review.run + 沙盒 | M6–M8 |
| G3 | 桌面壳 | WinUI 3 三栏 + 任务树面板 + 审查面板 + A2UI 浮窗，端到端 GUI 联调 | M9 |
| G4 | Windows 沙盒分级 | S0 受限令牌 + Job 全量可用；S1 AppContainer 对齐 seatbelt 语义（AC 冒烟矩阵通过为准） | M7 |

**非目标**：不动 master/dev 主线（走 `feat/win-native` 分支，与 `feat/apple-native` 同轨并存）；
不做跨平台 UI（macOS 继续走 apple 分支、其余走 TS 版）；不承诺三端会话互迁（格式兼容是
事实，互迁工具是后续可选）；不替换 Electron 产品的发布节奏。

## 三、技术选型（2026-09 实地调研）

| 维度 | apple 分支做法 | Windows 方案 | 依据 |
| --- | --- | --- | --- |
| 语言/运行时 | Swift 6 + swift-tools 6.0 | **C# 14 + .NET 10 LTS** | .NET 10 于 2025-11-11 GA，LTS 支持到 2028-11；C# 14 随附 |
| 并发模型 | actor（编译器强制隔离） | **actor-style 单写者**（`Channel<T>` 邮箱 + 单消费循环，或 `SemaphoreSlim(1,1)`） | C# 无原生 actor，纪律靠规范 + 并发单测（风险 R4） |
| LLM 通信 | URLSession + AsyncSequence SSE | **HttpClient + `IAsyncEnumerable<T>`**（StreamParser 直译） | 逐事件对拍上游 SSE 语义 |
| 数据模型 | Codable | **record + System.Text.Json source-gen**（Any 值用 `JsonNode`） | JSONL/index 与 TS/apple 版字节兼容 |
| MCP | vendored swift-sdk（StdioTransport） | **官方 `ModelContextProtocol` NuGet 2.2.0** | 已实现 2026-07-28 MCP 规范修订；微软协作维护；**无需 vendor** |
| 工具执行 | Process（NSTask） | **System.Diagnostics.Process + 每调用 Job Object** | Windows 无进程组，树杀/限额由 Job 兜底 |
| 嵌入 | NLEmbedding + CoreML（Granite 需转换） | **ONNX Runtime（`Microsoft.ML.OnnxRuntime`）直接复用 TS 版 Granite ONNX** | 零模型转换（比 apple 路线省一段）；tokenizer 移植是唯一工作项（见 §六.2） |
| 沙盒 | seatbelt（SBPL 声明式档案 + sandbox-exec） | **AppContainer/LPAC + 受限令牌 + Job Object，三级交付** | Windows 无 SBPL 等价物，需原语组合；先例：Chromium 四件套、OpenAI Codex Windows 沙盒 |
| WebSearch | URLSession + 正则（DDG Lite 默认） | HttpClient + 正则直译（UA 换 Windows 形态） | 零依赖语义保持 |
| WebFetch 渲染 | （上游 TS）offscreen Chromium provider | **隐藏 WebView2 provider，宿主注入回调** | 保持 Core 不直接依赖 WebView2 的既有边界 |
| A2UI | vendored a2ui-swift（社区 i-swift 渲染器） | **WebView2 + 官方 TS 渲染器**（Lit Web Components 离线打包） | 官方渲染器矩阵无 C#/WinUI；WebView2 内零改造运行，官方度反高于 apple |
| OpenUI Lang | OpenUILang.swift 原生解析器 | C# 机械直译 | 纯文本处理，无平台依赖 |
| UI 壳 | SwiftUI 三栏 | **WinUI 3（Windows App SDK 2.x）主选；Avalonia 为 B 计划** | WinAppSDK 2.0 稳定已发、2.4.0 已于 2026-08-13 发布；触发条件见决策点 D1 |
| 构建/测试 | SPM + XCTest | **dotnet CLI / MSBuild + xUnit** | — |
| CLI | deeporcacli（chat/parallel/tokens/version） | DeepOrca.Cli 同四命令 | 对齐 apple 分支验证手段 |
| 打包 | （apple 未到） | self-contained 单文件发布 + 可选 MSIX | 引擎/CLI 不依赖 WinAppSDK，可独立分发 |

### 决策点

| # | 决策 | 选项 | 推荐 |
| --- | --- | --- | --- |
| D1 | UI 框架 | A. WinUI 3；B. Avalonia；C. WPF+Fluent | **A**；**触发条件**：M9 前若 WinAppSDK 2.x 出现阻塞性缺陷（渲染/打包/分发）→ 切 B，引擎层零改动 |
| D2 | A2UI 渲染 | A. WebView2 + 官方 TS 渲染器；B. 自研 XAML 渲染器 | **A**——B 需追平官方 18 组件 basic catalog 且长期跟随协议演进，成本不成立 |
| D3 | 沙盒交付分级 | S0 受限令牌+Job；S1 AppContainer/LPAC；S2 CreateProcessInSandbox/Win32 app isolation | **S0 全量 → S1 冒烟矩阵通过后启用 → S2 远期评估**（Win11 API 仍部分 experimental） |
| D4 | MCP 接入 | A. NuGet 官方 SDK；B. vendor 源码 | **A**——NuGet 可达即不 vendor（apple 分支的 vendor 是网络不可达的例外，不复制） |
| D5 | Granite tokenizer | A. `Microsoft.ML.Tokenizers` BPE 加载 vocab/merges；B. 自研 tokenizer | **A**；以 TS 版 transformers.js 输出做对拍基准，不达标降级关键词候选（fail-open 语义不变） |

## 四、包拓扑（对应 apple 分支 Package.swift targets）

```
deeporca-win/
├── DeepOrca.sln
├── src/
│   ├── DeepOrca.Core/      # net10.0 类库，UI-free 红线：不引 WinUI/WebView2；不 console.*；logger 注入
│   │   ├── Types/          # record + STJ source-gen（对应 Types/*.swift）
│   │   ├── Llm/            # OpenAiClient（SSE）+ StreamParser + MessageConverter
│   │   ├── Session/        # SessionManager + SessionStore + Compaction + GitFileHistory + TokenSummary
│   │   ├── Tools/          # 8 内建 handler + WebSearchProvider + ToolExecutor
│   │   ├── Sandbox/        # Windows 沙盒后端（§六.1；仅 Core 内接口，宿主注入实现）
│   │   ├── Mcp/            # MCPManager + 内置注册表 + GitMCP 解析
│   │   ├── Permissions/    # PermissionEngine + BashSideEffectInference
│   │   ├── Prompt/         # PromptBuilder（手拼，不引模板引擎——沿 apple 决策）
│   │   ├── Embedding/      # OnnxEmbeddingService（懒加载、fail-open、进程级单例）
│   │   ├── Routing/        # SkillRouter + CompositionalRouter（SAD 分解）
│   │   ├── Actions/        # ActionRegistry + Task/Review actions
│   │   ├── Tasks/          # TaskTreeService + Subagent（MAX_DEPTH=4）
│   │   └── A2UI/           # render_surface/render_openui 协议生成 + OpenUILang 解析器
│   ├── DeepOrca.UI/        # WinUI 3 三栏壳（Views/ViewModels/Styles）+ WebView2 宿主（A2UI/审查报告/markdown）
│   ├── DeepOrca.App/       # 薄入口（对应 @main；UI 库保持可测试）
│   └── DeepOrca.Cli/       # chat / tokens / parallel / version
└── tests/                  # xUnit：Core.Tests + UI.Tests
```

依赖方向单向：`UI / App / Cli → Core`；CI lint 守护（Core 引用扫描 WinUI/WebView2 即 fail，
对齐仓库 core UI-free 红线）。

## 五、模块直译映射（关键纪律点）

| Swift 形态 | C# 形态 | 纪律/注意 |
| --- | --- | --- |
| `actor` | actor-style 单写者：每 actor 一个 `Channel<T>` 邮箱 + 单消费循环 | **最大纪律点**——Swift 编译器强制隔离，C# 没有。纪律必须做成**接口属性**而非编码规范：邮箱（`enqueue(command) → Task<T>`）是该模块**唯一**公共入口，可变状态（如 `pendingIndex`）不暴露任何旁路读路径，让"绕开单写者"成为不可能而不是违规。并发敏感模块（SessionManager/MCPManager/Embedding/ActionRegistry）必写并发单测 |
| `Codable` | record + STJ source-gen；Any 值 `JsonNode` | sessions-index / messages.jsonl 字节兼容（`processes` Map 序列化注意 pendingIndex 语义，见 AGENTS.md 会话索引不变量） |
| `URLSession` + `AsyncSequence` | HttpClient + `IAsyncEnumerable<T>`（StreamParser 直译） | token/tool_call/reasoning 逐事件对拍上游 |
| `Process`（NSTask） | `System.Diagnostics.Process` + Job Object 包裹 | Job：`KILL_ON_JOB_CLOSE` + 内存上限；timeout 语义与上游一致 |
| `/bin/zsh -c`（普通）/ `/bin/bash`（沙盒） | **Git Bash `bash.exe -c`**（沿用 TS 版 `setShellIfWindows` 约束） | PowerShell 不作 POSIX 替身；启动探测 Git 安装路径 + `where bash`，缺失时 bash 工具给出安装指引 |
| seatbelt `GIT_CONFIG_GLOBAL=/dev/null` | 沙盒模式 HOME 不可读天然等价；普通模式仍显式置空 | 保留 apple 分支沉淀的 git 配置陷阱注释 |
| EJS 模板 | 不引引擎；PromptBuilder 手拼（上游 TS 模板已由 apple 分支内化为类型安全 builder） | Windows 侧仅改 runtime context 文案（OS/shell/arch）；cache-stable 顺序不变 |
| NLEmbedding / CoreML | ONNX Runtime + Granite ONNX 复用 | 懒加载 + fail-open（加载失败路由降级，对齐 TS warmup fire-and-forget 语义） |
| Liquid Glass 浮动面板 | WinUI 3 弹出 Window（A2UI 嵌 WebView2） | Mica/Acrylic 对应系统材质 |
| `ObservableObject` AppModel | CommunityToolkit.Mvvm + `DispatcherQueue` 线程封送 | UI 事件一律回 UI 线程；引擎事件经 Channel 批量泵 |
| 沙盒接口（Core 内） | **两模块拆分**（非 apple 同构，理由见下）：`SandboxProfileBuilder`（纯函数 `build(SandboxProfileInput) → ProfileArtifact`，逐字节确定性）+ `SandboxLauncher`（`probe() → CapabilityMap`、`launch(command, env, cwd, profile) → ProcessHandle`） | **不能照搬 apple 的 argv 接缝**：apple `wrapShell → (argv, env)` 成立是因为 sandbox-exec 可用命令行表达；Windows 的受限令牌/AppContainer ACL/Job Object 无法用 argv 表达，spawn 本身就是复杂度——若调用方保留 spawn 知识而复杂度藏在实现里，接口与实现同复杂（浅）。Job（KILL_ON_JOB_CLOSE + 内存上限）在 launch 内部创建关闭，调用方无法绕过；`ProcessHandle` 与**非沙盒**进程包装共用同一类型，避免 BashHandler 的 stdio 泵/超时/kill 逻辑分叉两份；`probe()` 返回工具→可用性的 CapabilityMap（降级矩阵 per-tool 标注），不是一个 boolean |

## 六、Windows 专属设计（方案核心）

### 6.1 沙盒：seatbelt → Windows 原语映射

apple 分支 seatbelt 语义（deny default / 读宽禁 HOME 再放行 / 写白名单 / 网络门 / bash 强制）
可映射到 Windows 原语组合：

| seatbelt 语义 | Windows 对应 |
| --- | --- |
| `(deny default)` | AppContainer Low-IL 默认无权（用户 profile 目录默认不可读不可写） |
| 读：宽放行 → 禁 HOME → 再放行 roots | **能力 SID ACL**：对 projectRoot / extraReadRoots 授读；HOME 零授予（默认即禁） |
| 写：严格白名单 + HOME 栅栏 | 能力 SID 仅对 writeRoots / tempWriteRoots 授 Modify |
| `allow process-exec* / process-fork` | 同一 AppContainer 内启动子进程 |
| `networkAllowed` 门 | AC `internetClient` 能力开关（或 WFP 每进程过滤） |
| （隐含）进程树管理 | **Job Object**：`KILL_ON_JOB_CLOSE` + 内存上限 + `JOB_OBJECT_UILIMIT_*` |
| 内 shell 强制 `/bin/bash` | Git Bash `bash.exe`；profile 生成器输入结构沿用 `SandboxProfileInput` |

**三级交付**（分级是刻意的：AC 下第三方工具兼容性必须实测）：

- **S0（安全网，Win10+ 全覆盖）**：受限令牌（`CreateRestrictedToken` 去特权组）+ Job Object
  + 完整性级别。语义上已超过 TS 版（TS 版 Windows 无沙盒、Git Bash 直跑）。
- **S1（完整对齐 seatbelt）**：`CreateAppContainerProfile` 每工作区建 profile + 能力 SID ACL
  精确授予 + LPAC 收紧 ALL APPLICATION PACKAGES 旁路。达到与 apple 分支同级隔离语义。
- **S2（远期评估）**：微软新 `CreateProcessInSandbox` Win32 API / Win32 app isolation
  （Win11，部分仍 experimental），API 成熟后切换。

**前置工作项**：S1 之前建"AC 兼容性冒烟矩阵"（bash / git / node / gh / uv / python 逐个在
AC 内跑通），不可用工具自动降级 S0 并在 UI 标注，不阻塞主流程。

### 6.2 嵌入与路由

- ONNX Runtime 直接加载 TS 版 Granite ONNX（零转换——比 apple 的 CoreML 转换路径省一段）；
  模型目录解析沿用 host 注入优先 + env 兜底的既有约定。
- tokenizer 用 `Microsoft.ML.Tokenizers` BPE 加载 vocab/merges；以 TS 版 transformers.js
  输出做向量对拍基准（沿用 apple 分支"对拍"思路）。
- SkillRouter / CompositionalRouter 直译，fail-open 语义保持：任何嵌入故障 → 路由器置 null
  → 全候选集，行为与 TS/apple 一致。

### 6.3 A2UI / OpenUI

- 官方渲染器矩阵现状：TypeScript（Lit Web Components）/ Flutter / Python agent SDK；
  Swift 为社区版（i-swift，2026-01）；**无 C#/WinUI**（决策点 D2 依据）。
- 方案：`render_surface` / `render_openui` 工具留在 Core（协议 JSON 生成，纯逻辑）；
  渲染走 WebView2 + 官方 TS 渲染器，组件包本地打包离线运行。
- OpenUI Lang 解析器：`OpenUILang.swift` 为纯文本处理，机械直译为 C#（行赋值语法、命名
  参数、前向引用提升、多行调用合并、不可达变量丢弃五项语义逐一对拍）。
- 原型浮动面板：WinUI 3 独立窗口嵌 WebView2；SurfaceState 持久化沿用 `.deeporca/prototypes/`。

### 6.4 WebFetch / WebSearch

- WebSearch：HttpClient + 正则直译（DDG Lite 默认、Brave/Tavily 带 key），UA 换 Windows
  形态；provider 布局变化表现为解析错误、不崩溃（上游 graceful degradation 语义保持）。
- WebFetch：静态抓取 HttpClient + HTML→text；渲染抓取走隐藏 WebView2 provider——provider
  由宿主注入回调（对齐 desktop 的 offscreen Chromium provider 是"框架级设施、Core 不直接
  依赖"的既有边界）。

### 6.5 文件系统与持久化

- `.deeporca` 目录约定不变：`%USERPROFILE%\.deeporca`（全局）+ `<project>/.deeporca`（项目）；
  sessions-index / messages.jsonl 与 TS/apple 版格式一致。
- Windows 路径规范（写进编码规范并做 lint/单测）：大小写不敏感比较、保留设备名
  （`CON`/`NUL` 等）、长路径（`longPathAware` 清单声明）、路径拼接一律走 `Path` API。
- GitFileHistory：git plumbing 直译（每会话 branch、manifest blob、CAS update-ref），
  依赖 Git for Windows 的 git.exe（与 bash 同源安装）。

### 6.6 接口纪律补充（深模块审视，2026-09-02）

按"小接口藏大量行为"逐接缝过一遍后固化的纪律：

- **tokenizer 不进接口（D5）**：BPE tokenizer 是 EmbeddingService 内部"小、可 mock、
  可换的部件"，不设公共 `ITokenizer` 接缝——唯一消费者是 embedding service，删掉这层
  包装复杂度不会重现（透传）。降级关键词候选是实现内替换；对 TS 版余弦对拍是测试侧
  Adapter，不是接口的一部分。
- **MCP 不加透传包装**：官方 NuGet SDK 本身已是成熟接缝，Core 直接消费；不再包
  `IMcpClientAdapter` 纯转发层（浅模块）。变化点（stdio → HTTP 等）由 SDK 自身接缝承接。
- **WebFetch provider 的 null 语义写进接口**：provider 为 null（CLI 形态）时必须
  fail-open 到静态抓取、以解析级错误收场不崩溃——上游 graceful degradation 语义是
  接口文档的一部分，不是实现细节。三个 Adapter（离屏 Chromium / WebView2 / 无）证实
  接缝真实。
- **沙盒降级永不静默**：`SandboxLauncher.probe()` 的 CapabilityMap 与 launch 结果携带
  `outcome: active|degraded` + detail，经 SessionManager 的 `sandboxStatus` 面上抛
  （对齐 apple 分支"never silent"约定）；S1→S0 per-tool 降级在 UI/CLI 可见。

## 七、里程碑（复刻 apple 分支节奏：引擎先验证、UI 后置）

| 里程碑 | 内容 | 出口标准 |
| --- | --- | --- |
| **M1 骨架** | Core + LLM SSE + 消息转换 + JSON 兼容层 | xUnit 单测绿（SSE 解析 / 消息配对 / AnyJson） |
| **M2 基建** | 权限引擎（scope 评估 + bash 副作用推断）+ MCPManager（官方 SDK，stdio）+ SessionStore（JSONL） | 单测 + 本地 MCP server 联调 |
| **M3 技能** | Skills 扫描（目录优先级不变）+ PromptBuilder（cache-stable 顺序） | 技能注入快照测试 |
| **M4 E2E** | 真实 LLM 对话 + 工具循环 + 多会话并发 + CLI（chat/tokens/parallel/version） | 双会话并发验证（对齐 apple 分支验收） |
| **M5 上游能力** | Compaction 两段式 + Plan Mode 强制权限 + token 统计 + GitFileHistory undo | 各能力单测 + CLI 验证 |
| **M6 任务面** | 任务树 V2 + Subagent（MAX_DEPTH=4）+ ActionRegistry（task.*）+ 内置 MCP 注册表 + GitMCP 解析 | action → LLM tool 全链路 |
| **M7 沙盒** | AC 冒烟矩阵 → S0 → S1 + WebSearch 真实 provider | 沙盒内 bash/git 读写域验证；越权写实测被拒；降级路径 UI 可见 |
| **M8 路由** | SkillRouter/ToolRouter G1/G2 + CompositionalRouter（SAD）+ AGENTS.md 注入 + Plan 任务树物化 + review.run | embedding 对拍 TS 基准；fail-open 行为一致 |
| **M9 UI 壳** | WinUI 3 三栏（会话列表/对话流/Inspector）+ 任务树面板 + 审查面板（WebView2 承接 HTML 报告）+ A2UI 浮窗 | 端到端 GUI 联调 |

排序理由：M7 沙盒排在引擎稳后（与 apple 分支 seatbelt 放后段同理——沙盒行为依赖稳定的
bash/权限语义）；M9 独立可中断——引擎 + CLI 在 M8 后已是可用产品（对齐 apple 分支
"引擎已验证、UI 壳独立演进"的状态）。

## 八、风险与缓解

| # | 风险 | 缓解 |
| --- | --- | --- |
| R1 | WinUI 3 生态坑：Markdown 渲染 / 代码高亮 / 编辑控件缺位 | 聊天/报告内容统一走 WebView2（markdown-it/Monaco，与审查模块 HTML 报告天然契合）；**B 计划触发条件**见决策点 D1 → Avalonia，引擎层零改动 |
| R2 | AppContainer 下工具进程破损面未知 | M7 前置冒烟矩阵；不可用降级 S0 并 UI 标注，不阻塞主流程 |
| R3 | Granite tokenizer .NET 移植精度 | 以 TS 版 transformers.js 输出对拍；不达标路由降级为关键词候选（fail-open 不变） |
| R4 | actor 纪律靠人守（Swift 是编译器强制） | 编码规范固化"单写者"模式 + code review 检查项 + 并发单测 |
| R5 | CI 需 Windows runner + Win11 真机（AC/LPAC 行为） | S0/S1 测试分层标注平台；真机冒烟纳入 M7 出口 |
| R6 | 三端（TS/apple/win）能力漂移 | 上游能力对齐表复制 apple 分支 README 形态，作为 `feat/win-native` README 活文档逐项勾销 |
| R7 | bash 强依赖 Git Bash（用户环境缺失） | 启动探测 + 安装指引（沿用 TS 版 `setShellIfWindows` 的既有约束与提示语） |

## 九、与既有规划的关系

- **与 `ts-native-migration`（scriptc）正交**：该线不换语言原生化 TS 源码；本方案是平台
  原生重写的第二端点（第一端点 = apple）。core TS 主线与 scriptc 排期不受影响。
- **复用清单**：Granite ONNX 模型、settings 格式、技能目录约定、AGENTS.md 约定、
  sessions/messages 持久化格式全部跨端共享；apple 分支的"上游能力对齐表"方法论直接复制。
- **成本相对 apple 分支**：MCP 免 vendor、嵌入免模型转换（两处净省）；新增成本集中在
  沙盒（无 SBPL 式声明式档案，需原语组合 + 冒烟矩阵）与 UI 生态控件（WebView2 化解大半）。

## 十、参考链接（2026-09-02 调研）

- 官方 MCP C# SDK：https://github.com/modelcontextprotocol/csharp-sdk ·
  https://www.nuget.org/packages/ModelContextProtocol/ （2.2.0，2026-07-28 规范修订）
- A2UI 官方渲染器矩阵 / roadmap：https://a2ui.org/roadmap/ · https://github.com/a2ui-project/a2ui
- Windows App SDK 版本通道：https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/release-channels
  （2.4.0，2026-08-13）
- 沙盒原语：https://learn.microsoft.com/en-us/windows/win32/secauthz/createprocessinsandbox ·
  https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects ·
  https://learn.microsoft.com/en-us/windows/security/book/application-security-application-isolation ·
  https://github.com/microsoft/win32-app-isolation ·
  Chromium sandbox design（restricted token + job + alternate desktop + AppContainer）
- 同类先例：OpenAI「Building a sandbox for Codex on Windows」
  （https://openai.com/index/building-codex-windows-sandbox/）
- .NET 10 LTS：https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core
  （2025-11-11 GA，支持至 2028-11）
- 嵌入：https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/overview
  （Windows ML = Windows 维护的 ONNX Runtime 分发；DirectML EP 弃用方向确认 → 直接用
  ORT NuGet 是稳态）
