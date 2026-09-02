# DeepOrca Win (C#/.NET)

DeepOrca 的 **Windows 原生重写** —— 从 Core 引擎到桌面交互层全部用 C# 14 + .NET 10 (LTS)
实现，UI 壳为 WinUI 3（Windows App SDK 2.x）。规格：`specs/win-native-migration/design.md`
（2026-09-02 立项，方案已评审定稿）。

> 分支：`feat/win-native`（fork 自 `feat/modern-ui-redesign` 顶端 `5d9e05fb`，
> 与 `feat/apple-native` 同轨并存；core TS 主线不动）
> 宏观 UI 布局对齐 TS 版：左侧会话列表 + 中间对话流 + 右侧 Inspector。

## 与 TS / apple 版的架构差异

| 维度 | TS 版 (Electron) | apple 版 (Swift) | **Win 版 (C#)** |
|------|------------------|------------------|-----------------|
| 并发模型 | 单 bridge 串行 | actor（编译器强制） | **actor-style 单写者**：`Channel<T>` 邮箱为唯一公共入口（`enqueue → Task<T>`），无旁路读路径 |
| LLM 通信 | Node fetch + 手拼 SSE | URLSession + AsyncSequence | HttpClient + `IAsyncEnumerable<T>`（StreamParser 直译） |
| 数据模型 | JSONL + 手写序列化 | Codable | record + System.Text.Json source-gen（Any 值 `JsonNode`） |
| 工具执行 | child_process | Process (NSTask) | System.Diagnostics.Process + 每调用 Job Object |
| MCP | 自研 stdio client | swift-sdk (vendored) | **官方 `ModelContextProtocol` NuGet**（不 vendor） |
| 嵌入 | Granite ONNX (transformers.js) | NLEmbedding + CoreML | **ONNX Runtime 直接复用 TS 版 Granite ONNX**（零模型转换） |
| 沙盒 | （Windows 无沙盒） | seatbelt (SBPL) | AppContainer/LPAC + 受限令牌 + Job Object，三级交付 S0→S1→S2 |
| UI | Electron + 自研 CSS | SwiftUI | WinUI 3 + WebView2（markdown/报告/A2UI 渲染统一走 WebView2） |
| bash | Git Bash (`setShellIfWindows`) | zsh / 沙盒内 bash | **Git Bash `bash.exe -c`**（沿用 TS 版约束；PowerShell 不作 POSIX 替身） |

## 项目结构

```
deeporca-win/
├── DeepOrca.sln
├── Directory.Build.props          # net10.0 / C# 14 / nullable 全局
├── src/
│   ├── DeepOrca.Core/             # net10.0 类库，UI-free 红线（M1 起建目录树）
│   │   ├── Types/                 # record + STJ source-gen
│   │   ├── Llm/                   # OpenAiClient (SSE) + StreamParser + MessageConverter
│   │   ├── Session/               # SessionManager + SessionStore + Compaction + GitFileHistory
│   │   ├── Tools/                 # 8 内建 handler + ToolExecutor
│   │   ├── Sandbox/               # SandboxProfileBuilder（纯函数）+ SandboxLauncher（S0/S1）
│   │   ├── Mcp/                   # MCPManager（官方 SDK，stdio）
│   │   ├── Permissions/           # PermissionEngine + BashSideEffectInference
│   │   ├── Prompt/                # PromptBuilder（手拼，cache-stable 顺序）
│   │   ├── Embedding/             # OnnxEmbeddingService（懒加载、fail-open、进程级单例）
│   │   ├── Routing/               # SkillRouter + CompositionalRouter
│   │   ├── Actions/ Tasks/ A2UI/  # 任务面 + 协议生成 + OpenUILang 解析器
│   ├── DeepOrca.UI/               # WinUI 3 三栏壳（M9 起建，见目录内 README）
│   ├── DeepOrca.App/              # 薄入口（M9 起建）
│   └── DeepOrca.Cli/              # chat / parallel / tokens / version
└── tests/DeepOrca.Core.Tests/     # xUnit
```

## 构建与运行（Windows 侧；本机骨架阶段未验证）

```powershell
cd deeporca-win
dotnet build
dotnet test
dotnet run --project src/DeepOrca.Cli -- version
# M4 起：dotnet run --project src/DeepOrca.Cli -- chat "你好" / parallel
```

## 环境要求与验证记录（M0.1）

| 项 | 要求 | 状态 |
| --- | --- | --- |
| .NET 10 SDK | 10.0.x（LTS，2025-11-11 GA） | ⬜ Windows 侧待装/待验证；**本机 macOS 无 dotnet**（骨架文件为手写） |
| Windows App SDK | 2.4.0（2026-08-13，NuGet 已核实） | ⬜ M9 前验证 |
| WebView2 Runtime | Evergreen 最新 | ⬜ M9 前验证 |
| Git Bash | `where bash` 可达（R7：缺失给安装指引） | ⬜ M4 前验证 |
| CI | GitHub-hosted `windows-latest` + `setup-dotnet`（net10） | ⬜ M1.0 接入时确认；Win11 真机（AC/LPAC 行为，R5）⬜ M7 |
| 本机（macOS） | 仅承担骨架/规格/单测编写，不承担构建 | ✅ dotnet 不存在已确认 |

## 依赖基线（M0.2，2026-09-02 经 nuget.org 核实钉死）

| 包 | 钉死版本 | 用途 | 引入里程碑 |
| --- | --- | --- | --- |
| `ModelContextProtocol` | **2.2.0**（2026-07-28 规范修订） | MCP 官方 SDK | M2 |
| `Microsoft.ML.OnnxRuntime` | **1.29.0** | Granite ONNX 嵌入 | M8 |
| `Microsoft.ML.Tokenizers` | **2.0.0** | BPE tokenizer（D5：不达标降级关键词候选） | M8 |
| `CommunityToolkit.Mvvm` | **8.4.2** | UI MVVM | M9 |
| `Microsoft.WindowsAppSDK` | **2.4.0** | WinUI 3 | M9 |
| `Microsoft.Web.WebView2` | **1.0.4191.47** | markdown/报告/A2UI 渲染宿主 | M9 |
| 测试栈 | `xunit` 2.9.3 + `xunit.runner.visualstudio` 3.1.5 + `Microsoft.NET.Test.Sdk` 18.9.0 | 单测（已写入 Tests csproj） | M0 |

升级规则：钉死版本变更须在本表记录新版本 + 核实日期 + 对拍结论（对齐 apple 分支纪律）。

## 上游能力对齐（feat/modern-ui-redesign 5d9e05fb 移植，逐项勾销）

| 能力 | 上游参考 | Windows 实现（规划） | 状态 |
|------|---------|---------------------|------|
| LLM SSE 对话 + 工具循环 | `session.ts` activateSession | `Llm/` StreamParser + `Session/` 激活循环 | ✅ M1/M4（fake-SSE E2E 全绿） |
| 消息转换（tool 配对/中断恢复/多模态） | `common/openai-message-converter.ts` | `Llm/MessageConverter` | ⬜ M1 |
| Any JSON 兼容层 | — | `Types/AnyJson`（`JsonNode`） | ⬜ M1 |
| 权限引擎（scope + bash 副作用推断） | `common/permissions.ts` | `Permissions/` | ⬜ M2 |
| MCP（stdio + tools/list changed） | `mcp/` | `Mcp/`（官方 SDK） | ⬜ M2 |
| 会话持久化（JSONL + index 不变量） | `session-manager-index.ts` | `Session/SessionStore`（**邮箱唯一入口 + pendingIndex 读优先 + 终端 flush**） | ⬜ M2 |
| 技能扫描（目录优先级 + frontmatter） | `session.ts` skills | `Prompt/SkillScanner` | ⬜ M3 |
| PromptBuilder（cache-stable） | `prompt.ts` + EJS 模板 | `Prompt/PromptBuilder`（手拼） | ⬜ M3 |
| 8 内建工具（read/edit snippet 契约） | `tools/` | `Tools/`（snippet_id 契约保持） | ✅ M4（片段限定搜索 + 修改守卫 + 候选清单） |
| CLI（chat/parallel/tokens/version） | — | `DeepOrca.Cli` | ✅ M4（tokens 自 M5 全量） |
| 多会话并发 | apple: 1.7s 双会话验收 | 每会话独立控制器 Task（无共享状态旁路） | ✅ M4 双会话 E2E |
| Compaction 两段式 | `common/compaction.ts` | `Session/Compaction`（Stage A/B + pairing guard） | ⬜ M5 |
| Plan Mode 强制权限 | `permissions.ts` forceAskScopes | `Permissions/` + 模式切换消息流 | ⬜ M5 |
| 全局 token 统计 | `tokens-summary.ts` | `Session/TokenSummary` + CLI `tokens` | ⬜ M5 |
| 文件历史 undo | `common/file-history.ts` | `Session/GitFileHistory`（git plumbing 直译） | ⬜ M5 |
| 任务树 V2 | `tasks/task-tree-service.ts` | `Tasks/TaskTreeService` | ⬜ M6 |
| Subagent（MAX_DEPTH=4） | `session-manager-tasks.ts` | `Tasks/Subagent` | ⬜ M6 |
| ActionRegistry + task.* | `actions/` | `Actions/`（host 注入） | ⬜ M6 |
| 内置 MCP 注册表 + GitMCP 解析 | — | `Mcp/` | ⬜ M6 |
| 沙盒 S0（受限令牌 + Job） | TS 版无沙盒 | `Sandbox/SandboxLauncher`（S0） | ⬜ M7 |
| 沙盒 S1（AppContainer/LPAC） | apple seatbelt 同级语义 | AC 冒烟矩阵通过后启用（§六.1） | ⬜ M7 |
| WebSearch（DDG Lite/Brave/Tavily） | `tools/web-search-providers.ts` | `Tools/WebSearchProvider` | ⬜ M7 |
| WebFetch（静态 + 渲染 provider 注入） | `tools/web-fetch-handler.ts` | 静态 HttpClient + 隐藏 WebView2 provider（null → fail-open 静态抓取） | ⬜ M7/M9 |
| 嵌入（Granite ONNX）+ 路由 | `routing/` + `packages/embedding` | `Embedding/OnnxEmbeddingService` + `Routing/`（fail-open） | ⬜ M8 |
| tokenizer BPE 对拍 | transformers.js 输出 | `Microsoft.ML.Tokenizers`（余弦阈值验收，降级候选） | ⬜ M8 |
| CompositionalRouter（SAD） | apple `CompositionalRouting.swift` | `Routing/` | ⬜ M8 |
| AGENTS.md 注入 + Plan 任务树物化 | 上游 bc97a5f0 | `Routing/` | ⬜ M8 |
| review.run | `actions/review.ts` | `Actions/Review`（CRG/OCR 外部后端同 apple 状态 ⏳） | ⬜ M8 |
| A2UI render_surface/render_openui | 官方 a2ui 协议 v0.9 | Core 协议生成 + WebView2 官方 TS 渲染器（离线打包） | ⬜ M6/M9 |
| OpenUI Lang 解析器 | apple `OpenUILang.swift` | C# 机械直译（五项语义逐一对拍） | ⬜ M6 |
| WinUI 三栏 + 任务树/审查面板 + A2UI 浮窗 | apple SwiftUI 三栏 | `DeepOrca.UI` | ⬜ M9 |
| 打包（self-contained + 可选 MSIX） | apple 未到 | dotnet publish | ⬜ M9 |

沙盒接口形状（关键决策，design §五）：**两模块拆分** —— `SandboxProfileBuilder`
（纯函数，输入结构对齐 apple `SandboxProfileInput`，逐字节确定性可单测）+
`SandboxLauncher`（`probe() → CapabilityMap` per-tool 可用性；`launch → ProcessHandle`
与非沙盒进程包装共用类型；Job 生命周期在 launch 内部）。不照搬 apple 的 argv 接缝
（令牌/ACL/Job 无法用 argv 表达）。降级 outcome: active|degraded 永不静默。

## 回写义务（自 tasks.md）

- [x] M4 完成 → 本表引擎行回写 ✅（2026-09-02）
- [ ] M7 完成 → §六.1 冒烟矩阵结果回写 design.md
- [ ] M8 完成 → tokenizer 对拍余弦读数回写 D5
- [ ] M9 完成 → 与 `feat/apple-native` README 对齐表并排核对
