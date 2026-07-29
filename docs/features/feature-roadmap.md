# DeepOrca 功能路线图

> 版本：v3.6 · 日期：2026-07-30 · 状态：规划中
>
> **v3.0 重大重组**：从"按项目编号"改为"按功能域分组"。所有调研过的项目按其贡献的能力域归类，
> 每个功能域包含已集成、规划中、搁置三层。OpenSpec 和 Superpowers 暂时搁置（见 §搁置项）。
>
> **v3.1 更新**：Bento 从"设计生成"拆出，独立为"办公套件"功能域（§四）。集成 Serena（符号级代码操作）和 Dart MCP。
>
> **v3.2 更新**：新增"移动开发"功能域（§三），Flutter Development（已集成）+ Android Development Kit（规划中）+ HarmonyOS Development Kit（规划中）。
>
> 历史版本：v2.1-v2.4 按项目逐个调研，v3.0+ 按功能重新规划。
>
> **v3.3 更新**：移动开发域新增 React Native（Expo 官方 Skills + Callstack）；新增桌面开发域（Electron/Tauri）；新增 .NET 开发域（Microsoft 官方 dotnet/skills）。只采纳第一方或官方社区认可的工具套件。
>
> **v3.4 更新**：桌面开发域新增 Apple（Xcode 27 第一方 7 Skills）和 Qt/KDE（Qt Group 第一方 7 Skills + MCP）。GNOME/GTK 无官方方案暂不纳入。Electron 自建搁置（调试工具链工程量过大）。
>
> **v3.5 更新**：新增"远程接入"（§十三）—— 本地 DeepOrca 通过反向隧道/蒲公英/ngrok 等暴露为 Web 端，移动端浏览器/App 直接访问；SessionBridge 与 IPC 已经完全 engine-agnostic，可零改造复用。新增"语音双工"（§十四）—— 语音代替输入法作为输入手段，主推 whisper.cpp + whisper-streaming LocalAgreement 方案。功能域位置无先后顺序，仅按添加顺序排号。
>
> **v3.5 更新**：新增"远程接入"功能域（WebSocket 桥 + 静态服务 + 隧道方案，架构可行性已验证）和"语音双工"功能域（whisper.cpp 本地优先 + API 兜底）。

---

## 功能域总览

| 功能域 | 已集成 | 规划中 | 核心目标 |
|--------|--------|--------|----------|
| [一、代码智能](#一代码智能) | codegraph, CRG, ocr | serena | 让 Agent 从"文本级"升级为"语义级"代码操作 |
| [二、知识中心](#二知识中心) | openwiki, TencentDB-Agent-Memory | Open Deep Research 理念 | 项目文档 + 跨会话记忆 + 深度研究 |
| [三、移动开发](#三移动开发) | Flutter Development（24 skills + Dart MCP）, Android Kit, HarmonyOS Kit, React Native（Expo + Callstack） | — | Flutter + Android + HarmonyOS + React Native |
| [四、桌面开发](#四桌面开发) | — | Apple（Xcode 27 第一方）, Qt/KDE（Qt Group 第一方）, Tauri（社区 MCP） | macOS/iOS + Qt/KDE + Tauri 桌面应用开发 |
| [五、.NET 开发](#五net-开发) | — | dotnet/skills（Microsoft 官方 12 域） | C# / ASP.NET / MAUI / 测试 / 诊断 / MSBuild |
| [六、设计生成](#六设计生成) | DeepDesign Phase 1 | taste-skill, Canvas UI, dashboard 模板 | brief→生成→预览→交付 的全流程设计能力 |
| [七、办公套件](#七办公套件) | Bento Slides | 文档/表格/表单生成 | 单文件办公文档（演示文稿/文档/表格）生成与预览 |
| [八、浏览器与联网](#八浏览器与联网) | browser-skill, WebSearch, web-access 理念 | obscura | 登录态操控 + 大规模抓取 + 深度联网策略 |
| [九、桌面自动化](#九桌面自动化) | — | pi-computer-use, CLI-Anything | 操控无 API 的桌面软件 |
| [十、引擎演进](#十引擎演进) | Plan Mode, UpdatePlan, Electron 35 | Prewalk, Subagent | 模型切换 + 子 agent |
| [十一、自进化](#十一自进化) | skill-writer, skill-digester（静态） | Self-Harness 理念, OpenSpace 理念 | harness 脚手架自改进 + 技能执行反馈闭环 |
| [十二、插件中心](#十二插件中心) | 分组展示, 插件分组 | opencli | 统一的插件/技能/MCP 管理入口 |
| [十三、远程接入](#十三远程接入) | — | WebSocket 桥 + 静态服务 + 隧道方案 | 手机/远程浏览器通过蒲公英/ngrok 接入 DeepOrca |
| [十四、语音双工](#十四语音双工) | — | whisper.cpp 本地 + API 兜底 | 语音替代键盘输入，实时转录填入 Composer |
| [搁置项](#搁置项) | — | OpenSpec, Superpowers, Electron 自建 | 暂不规划，理由见下 |
| [十三、远程接入](#十三远程接入) | — | 本地 Web 服务 + 反向隧道 | 移动端/外网浏览器直接访问本机 DeepOrca |
| [十四、语音双工](#十四语音双工) | — | whisper.cpp + whisper-streaming | 用语音代替键盘输入：ASR、流式上屏、命令识别 |

---

## 一、代码智能

> 让 Agent 理解代码的"在哪里、谁调用谁、多危险、怎么改"——从文本搜索升级为语义级图谱 + 风险分析 + 符号操作。

### 已集成

| 能力 | 项目 | 集成形态 | 定位 |
|------|------|----------|------|
| 符号检索 + 调用链 + 影响范围 | **codegraph** v1.5.0 | vendored CLI + MCP | 导航层——"代码 GPS"，35 语言，一次调用返回源码+调用链 |
| 风险评分 + 社区检测 + 架构概览 | **CRG** (code-review-graph) | vendored uv + MCP（dev 分支） | 分析层——"这个改动有多危险"，Leiden 社区 + 风险指数 + Mermaid 架构图 |
| AI 代码审查 | **ocr** (Open Code Review) | npm 依赖内置 | 审查层——审查未提交的工作区改动 |

**三层协同**：codegraph（在哪）→ CRG（多危险）→ ocr（怎么改）。桌面端代码审查面板 3 Tab：Quality（OCR）/ Risk（CRG）/ Architecture（Mermaid）。

### 规划中

| 能力 | 项目 | 集成形态 | 贡献 | 优先级 |
|------|------|----------|------|--------|
| 符号级重构（rename/find-references/replace-body） | **serena** | MCP Server（Python 3.13 + uv + LSP） | 从"文本替换"升级为"语义操作"，40+ 语言，跨文件 rename | P1 |

**与已有能力关系**：serena 互补——codegraph 做"检索"，serena 做"语义编辑"。read/edit 工具做文本级，serena 做符号级。

### 不采纳

| 项目 | 理由 |
|------|------|
| Understand-Anything | 与 codegraph+CRG+openwiki 三方高度冗余 |
| Graphify | 功能最强但 Python 重依赖；codegraph 已覆盖核心图谱，借鉴社区检测理念即可 |

---

## 二、知识中心

> 项目文档 + 跨会话记忆 + 深度研究——让 Agent 越用越懂项目，不遗忘已学的事实。

### 已集成

| 能力 | 项目 | 集成形态 | 定位 |
|------|------|----------|------|
| 项目 Wiki 自动生成与维护 | **openwiki** | vendored CLI + Skill + 桌面面板 | 为代码库生成 Agent 可引用的结构化文档 |
| 跨会话长期记忆 | **TencentDB-Agent-Memory** | core SDK（perf 分支） | 四层记忆 + 符号化检索，替换了原规划的 mem0 |

### 规划中

| 能力 | 项目 | 集成形态 | 贡献 | 优先级 |
|------|------|----------|------|--------|
| 多轮深度研究 | **Open Deep Research** 理念 | 借鉴工作流，Node.js 自建轻量版 | 从"单次 WebSearch"升级为"搜索→反思→再搜索→报告"的多轮循环 | P3 |

**关系说明**：Open Deep Research 是 Python（LangGraph），违背零依赖。借鉴其 4 阶段工作流（摘要→研究→压缩→报告），用 DeepOrca 的 Node.js 引擎自建轻量版。

---

## 三、移动开发

> Flutter + Android + HarmonyOS + React Native 开发能力包——官方/第一方技能包 + 运行时交互。

### 已集成

| 能力 | 项目 | 集成形态 | 定位 |
|------|------|----------|------|
| Flutter/Dart 开发技能（24 个） | **flutter/agent-plugins** | 构建 Skills（`scripts/install-flutter-skills.js`） | 架构/测试/路由/本地化/HTTP/FFI 等 |
| Flutter 运行时交互 | **Dart MCP server** | 内置 MCP（`dart mcp-server`，pubspec.yaml 项目自动激活） | 运行时布局分析/widget 树检查/pub.dev 搜索/测试执行/dart format |
| Android 开发技能（14 个） | **android/skills** | 构建 Skills（`scripts/install-android-skills.js`） | Jetpack Compose/Navigation 3/CameraX 迁移/R8 分析/edge-to-edge/测试/Perfetto 性能分析 等 |
| Android CLI 集成 | **Android CLI** | Skill 教 Agent 用 bash 调用 `android` 命令 | 项目创建/模拟器管理/截图标注/UI 布局树/文档搜索（Google 官方 CLI-first 方案） |
| HarmonyOS 开发技能 | **DevEco CLI** Skills | 构建 Skills（`scripts/install-harmonyos-skills.js`） | ArkTS/ArkUI 最佳实践、状态管理、导航、数据持久化、测试、性能优化 |
| HarmonyOS CLI 集成 | **DevEco CLI**（`devecocli`） | Skill 教 Agent 用 bash 调用 `devecocli` 命令 | 项目创建/构建(hvigor)/运行/模拟器/截图/布局检查/文档检索（华为官方，HDC 2026 发布） |
| React Native 开发技能 | **Expo Skills** + **Callstack Agent Skills** | 构建 Skills（`scripts/install-rn-skills.js`） | Expo 官方 Skills（SDK 升级/EAS 部署/调试最佳实践）+ Callstack 社区权威 Skills（性能优化/升级/原生模块） |
| React Native 运行时交互 | **Expo MCP Server** | 内置 MCP（`docs.expo.dev/mcp`） | SDK 知识注入 + 移动模拟器交互 + React Native DevTools |

### 规划中

| 能力 | 项目 | 集成形态 | 贡献 | 优先级 |
|------|------|----------|------|--------|

**四平台范式差异**：

| 维度 | Flutter | Android | HarmonyOS | React Native |
|------|---------|---------|-----------|-------------|
| 技能来源 | flutter/agent-plugins（24 个） | android/skills（14 个） | deveco-cli 内置 | Expo 官方 + Callstack |
| 运行时交互 | MCP（`dart mcp-server`） | CLI（`android`） | CLI（`devecocli`） | MCP（Expo MCP） |
| 官方认可 | ✅ Flutter 团队 | ✅ Google | ✅ 华为 | ✅ Expo + Callstack |
| 包管理 | pub.dev | Gradle | ohpm | npm |

**Flutter vs Android vs HarmonyOS 的范式差异**：

| 维度 | Flutter | Android | HarmonyOS | React Native |
|------|---------|---------|-----------|-------------|
| 构建系统 | dart compile | Gradle | hvigor | Metro |
| 设备调试 | flutter driver | adb | hdc | Expo/agent-device |
| 触发文件 | `pubspec.yaml` | `build.gradle(.kts)` | `build-profile.json5` | `app.json`/`package.json` |

详见各平台设计文档：[Android](../../specs/android-dev-kit/design.md) · [HarmonyOS](../../specs/harmonyos-dev-kit/design.md)。

---

## 四、桌面开发

> Electron + Tauri 桌面应用开发能力包。

### 规划中

| 能力 | 项目 | 来源认可度 | 集成形态 | 贡献 | 优先级 |
|------|------|-----------|----------|------|--------|
| Apple 平台开发（macOS + iOS） | **Xcode 27 Agent Skills**（Apple 第一方） | ✅ **Apple 第一方** | 构建 Skills（`xcrun agent skills export` 导出） | SwiftUI 现代 API/UIKit 现代化/测试现代化/安全审计/C 边界安全 7 个官方 Skills | P1 |
| Apple 社区精选 | **twostraws/swift-agent-skills**（Paul Hudson） | ✅ 社区权威 | 构建 Skills | SwiftUI Pro/Swift 并发/SwiftData/Swift Testing 4 个精选 Skills | P2 |
| Qt/KDE 应用开发 | **TheQtCompanyRnD/agent-skills**（Qt Group 第一方） | ✅ **Qt Group 第一方** | 构建 Skills + MCP | 7 个 Skills：qt-cpp-review/qt-cpp-docs/qt-qml/qt-qml-review/qt-qml-profiler/qt-qml-docs/qt-ui-design + Qt 文档 MCP | P2 |
| Tauri 应用开发 | **mcp-server-tauri** | 🟡 社区（Tauri 官方未出同类） | MCP + Skills | Rust 后端/IPC/Web 前端集成/capabilities 安全模型 | P3 |

**Apple 现状说明**：WWDC 2026 发布，Xcode 27 内置 7 个第一方 Agent Skills，可通过 `xcrun agent skills export --output-dir <path>` 导出为标准 SKILL.md。另有 Paul Hudson（hackingwithswift.com 创始人，Swift 社区权威）维护的社区精选目录 `twostraws/swift-agent-skills`。

**Qt/KDE 现状说明**：Qt Group（Qt 商业所有者）官方维护 `TheQtCompanyRnD/agent-skills`，7 个 Skills 覆盖 C++ 代码审查/QML 编码/QML 审查/性能分析/文档/UI 设计。另含 Qt 文档 MCP server。这是 KDE/Qt 桌面开发的官方第一方方案。

**GNOME/GTK 现状说明**：❌ **无官方方案**。GNOME 基金会和 GTK 团队未发布 Agent Skills。暂不纳入，待官方方案出现。

**Electron 现状说明**：见 [搁置项](#搁置项)——自建 Electron 调试工具链（MCP/CLI 操控窗口/IPC/DevTools）工程量过大，暂时搁置。

---

## 五、.NET 开发

> Microsoft 官方 .NET AI 开发技能包——C# / ASP.NET / MAUI / 测试 / 诊断 / MSBuild。

### 规划中

| 能力 | 项目 | 来源认可度 | 集成形态 | 贡献 | 优先级 |
|------|------|-----------|----------|------|--------|
| .NET 全栈开发技能 | **dotnet/skills**（Microsoft 官方） | ✅ **Microsoft 第一方** | 构建 Skills（12 个插件域） | 覆盖 .NET 开发全生命周期 | P2 |

**dotnet/skills 12 个插件域**（`github.com/dotnet/skills`）：

| 域 | 覆盖内容 |
|----|---------|
| `dotnet` | C# 核心、语言特性、LSP |
| `dotnet-aspnet` | ASP.NET Core（最小 API、OpenTelemetry、文件上传） |
| `dotnet-maui` | .NET MAUI 跨平台 UI（生命周期/数据绑定/导航/主题/CollectionView） |
| `dotnet-test` | 测试（执行/迁移/质量审计/覆盖率/框架迁移 MSTest→v3/v4/xUnit v3） |
| `dotnet-diag` | 诊断（性能分析/dump 收集/dotnet-trace/崩溃符号化） |
| `dotnet-msbuild` | MSBuild（binlog 分析/增量构建/并行/反模式/现代化） |
| `dotnet-nuget` | NuGet（中央包管理迁移） |
| `dotnet-upgrade` | 升级迁移（.NET 8→9→10→11/AOT 兼容/可空引用/线程中止） |
| `dotnet-ai` | AI/ML（MCP C# 创建/调试/发布/测试） |
| `dotnet-data` | 数据（EF Core 查询优化） |
| `dotnet-template-engine` | 模板引擎（发现/实例化/验证/编写） |
| `dotnet11` | .NET 11 新特性（System.Text.Json 等） |

**集成方式**：构建时从 `dotnet/skills` 仓库拉取 12 个插件域的 SKILL.md 到 `bundled/`。Agent 检测到 .NET 项目（`.csproj`/`.sln`）时自动加载对应 Skills。

---

## 六、设计生成

> brief → 生成 → 预览 → 交付 的全流程设计能力。Agent 是画师，Electron webview 是画布，Canvas UI 是画笔。

### 已集成

| 能力 | 项目 | 集成形态 | 定位 |
|------|------|----------|------|
| 通用设计生成（原型/落地页） | **DeepDesign** Phase 1 | Skill + seed 模板 + 3 设计系统 | 复刻 Claude Design 核心，零 daemon，Electron webview 预览 |

**DeepDesign 已有文件**：
- `deep-design` SKILL.md（工作流编排）
- `seed.html` + `layouts.md`（8 个 section 骨架 + P0/P1/P2 自检清单）
- 3 个 DESIGN.md 系统（dark-tech / modern-minimal / editorial）

### 规划中

| 能力 | 项目 | 集成形态 | 贡献 | 优先级 |
|------|------|----------|------|--------|
| 前端设计质量纪律 | **taste-skill** | 构建 Skill（纯 SKILL.md） | 布局/排版/动效/间距的反 slop 方法论，框架无关 | P1 |
| 视觉特效"画笔" | **Canvas UI** | 构建时 vendor 组件源码 | 25 个 Canvas/WebGL 特效（液体/火焰/玻璃/粒子），Agent 按需内联 | P1 |
| 仪表盘模板 | DeepDesign dashboard | seed + layouts | 侧边栏 + KPI 卡 + 内联 SVG 图表 | P2 |
| 移动端模板 | DeepDesign mobile-app | seed + layouts | iPhone 框架 + 多屏流程 | P3 |
| 海报模板 | DeepDesign poster | seed + layouts | 单页海报/社交媒体图 | P3 |

**实施路线**：
- Phase 1（已完成）：web-prototype 模板 + dark-tech 系统 + deep-design Skill
- Phase 2：dashboard 模板 + 3 设计系统 + DESIGN.md 用户自建 + PDF 导出
- Phase 3：Canvas UI 特效 vendor + mobile-app/poster 模板 + DesignStudioPanel 桌面面板

**替代决策**：DeepDesign 替代了原路线图的 OpenDesign daemon 集成——同能力，零 daemon，轻量 10 倍。

---

## 七、办公套件

> 单文件办公文档生成——演示文稿、文档、表格、表单。核心理念：一个 HTML 文件就是完整的办公应用（编辑器+查看器+导出器），零安装零依赖，任何浏览器可打开。

### 已集成

| 能力 | 项目 | 集成形态 | 定位 |
|------|------|----------|------|
| 演示文稿生成 | **Bento Slides** | 内置 Skill + 模板 | JSON → 单 `.bento.html` 文件（~644KB，含编辑器+放映+导出），支持文本/形状/图表(ECharts)/表格/图片/morph 动画 |

**Bento 的核心能力**：
- **单文件即完整应用**——`.bento.html` 包含 JS 运行时 + 文档数据，浏览器打开即可编辑/放映/导出
- **丰富的元素类型**——text（富文本）、shape（矩形/椭圆/箭头/路径）、chart（ECharts 柱状/折线/饼图/散点）、table、image、SVG
- **Morph 动画**——跨幻灯片同 ID 元素自动形变过渡（签名特性）
- **主题系统**——background/color/accent/fontFamily 四个 token 控制全局风格
- **零依赖**——无需服务器/安装/联网，纯前端

### 规划中

| 能力 | 集成形态 | 贡献 | 优先级 |
|------|----------|------|--------|
| 文档生成（Markdown → 单 HTML） | Skill + 模板 | 富文本文档（带目录/代码高亮/图表），单 HTML 导出，类似 Bento 但面向长文档 | P2 |
| 表格/电子表单生成 | Skill + 模板 | 数据表格（排序/筛选/公式），单 HTML 文件含查看器 | P3 |
| 办公文档预览面板 | Electron webview 组件 | 统一的办公文档预览（.bento.html + 文档 HTML），复用 DesignStudioPanel 的 webview 基础设施 | P2 |

**设计理念**（与 DeepDesign 的关系）：
- **DeepDesign** = 视觉设计（UI 原型/落地页/仪表盘/海报）——追求"好看"
- **办公套件** = 办公文档（演示文稿/文档/表格）——追求"实用"
- 两者共享 Electron webview 预览基础设施，但 Skill/模板/输出格式独立
- Bento 的 JSON 数据模型与 DeepDesign 的 HTML 模板是不同的产物范式——办公套件用 JSON 数据驱动，设计生成用 HTML 模板组合

---

## 八、浏览器与联网

> 登录态操控 + 大规模抓取 + 深度联网策略——让 Agent 能真正"上网干活"。

### 已集成

| 能力 | 项目 | 集成形态 | 定位 |
|------|------|----------|------|
| 真实 Chrome 操控（携带登录态） | **browser-skill** (bsk) | 内置插件（Rust CLI + Chrome 扩展） | 通用页面操控——表单/截图/UI 测试，Agent Window 隔离 |
| 单次网络搜索 | **WebSearch** | 内置工具 | 脚本钩子或托管 API，单次查询→文本结果 |
| 联网策略 + 站点经验 | **web-access** 理念 | 借鉴 Skill（不整体引入） | 联网工具自动选择（WebSearch/curl/Jina/CDP）+ 按域名积累操作经验 |

### 规划中

| 能力 | 项目 | 集成形态 | 贡献 | 优先级 |
|------|------|----------|------|--------|
| 大规模无头抓取 + Stealth | **obscura** | MCP Server（Rust 单二进制） | 30MB 内存、85ms 加载、反检测——bsk 做操控，obscura 做抓取 | P2 |

**分工设计**：
```
用户请求 → Agent 判断任务类型
  ├─ 通用页面操控（表单/UI 测试）→ browser-skill（登录态操控）
  ├─ 大规模数据抓取 / 反爬虫 → obscura（轻量无头 + Stealth）
  └─ 联网搜索 / 信息检索 → WebSearch（单次）/ Open Deep Research（多轮，规划中）
```

**关键判定**：web-access 的核心能力（真实 Chrome + 登录态）与 bsk 冗余，不整体引入。只借鉴其"联网策略选择 + 站点经验积累"两个独特点。

---

## 九、桌面自动化

> 操控无 API 的桌面软件——让 Agent 不局限于终端和浏览器。

### 规划中（全新空白域）

| 能力 | 项目 | 集成形态 | 贡献 | 优先级 |
|------|------|----------|------|--------|
| 桌面 GUI 操控（原生执行层） | **pi-computer-use** | Pi 扩展（macOS Swift + Windows Rust） | 查找窗口/观察 UI/点击输入/等待变化——操控 Figma/Photoshop/Excel 等桌面软件 | P2 |
| 视觉感知 fallback（VLM 定位层） | **ShowUI**（ShowLab, CVPR 2025） | Skill + 可选 Python sidecar（或 HF Space 远程） | 当无障碍树缺失时（Photoshop/自绘 UI/远程画面），VLM 视觉定位元素坐标 → pi-computer-use 执行点击 | P2-P3 |
| 万能 CLI 生成 | **CLI-Anything** | 内置 Skill（HARNESS.md 方法论） | 7 阶段为任意软件自动生成 CLI（分析→设计→实现→测试→文档→发布） | P2 |

**互补关系**：pi-computer-use 直接操控 GUI，CLI-Anything 把软件变成 CLI——两种思路解决同一问题（驱动无 API 的软件）。

**ShowUI vs pi-computer-use 分工**（仿 bsk/obscura 分工模式）：

```
用户请求 → pi-computer-use 查找窗口/元素
  ├─ 应用暴露无障碍树（原生应用）→ 原生 AX/UIAutomation API 定位（pi-computer-use 自带，快速精确）
  └─ 无障碍树缺失（Photoshop/自绘 UI/远程画面）→ ShowUI 视觉定位坐标 → pi-computer-use 执行点击
```

**ShowUI 不作为核心依赖**：Python + ~2B 参数模型 + GPU 需求违反"零外部运行时依赖"原则。作为可选 sidecar（仿 CRG/uv 模式）或通过 Hugging Face Space 远程调用（免本地 GPU）。

**ShowUI 技术参数**：~2B 参数 VLA 模型（Phi-3-Vision/Qwen2.5-VL 基座）、Apache-2.0、CVPR 2025。输入截图 → 输出交互元素坐标 + 任务决策。通过 `computer_use_ootb` 变体支持 macOS/Windows/Linux 全桌面控制。

### 模拟器使用（sim-use）

> 新增（2026-07-30 调研）——填补 iOS 模拟器交互空白 + 补齐 Android 验证循环。

| 能力 | 项目 | 集成形态 | 贡献 | 优先级 |
|------|------|----------|------|--------|
| iOS + Android 统一模拟器操控 | **sim-use**（LY Corporation） | 内置 Skill + PLUGIN.md（CLI-first，走 bash） | observe-act-verify 循环：UI 大纲（比无障碍树小 ~16x）、tap/swipe/type/paste、截图+崩溃检测 | P1 |

**与 android-cli 的互补关系**：

```
android-cli (Google)  →  项目生命周期：create/run/emulator/sdk/docs
sim-use (LY Corp)     →  运行时 UI：observe/tap/type/verify（iOS + Android 统一）
```

**sim-use 技术参数**：Swift CLI（macOS 14+）、Apache-2.0、~549 stars（3 周龄）。iOS 用 Meta idb XCFrameworks + Apple Accessibility API；Android 用 Kotlin AccessibilityService + HTTP over adb forward。前置条件：Xcode（iOS）或 adb + 模拟器（Android）。非 MCP——CLI-first，附带 SKILL.md。

---

## 十、引擎演进

> DeepOrca 引擎层的核心能力升级——模型路由、子 agent。

### 已集成

| 能力 | 来源 | 定位 |
|------|------|------|
| Plan Mode（3 阶段对话 + 权限强制 + proposed_plan） | 引擎核心 | 规划层权威——引擎级权限强制，force-ask 写操作 |
| UpdatePlan（markdown TODO 跟踪） | 引擎核心 | 执行阶段进度跟踪 |
| 模型路由（轻量子任务→flash） | `model-capabilities.ts` | 子任务降级（技能匹配/prompt 增强/压缩用 flash） |
| Electron 35（Node 22.16） | 引擎升级 | 内部插件零外部依赖（node:sqlite + require(esm)） |

### 规划中

| 能力 | 来源 | 贡献 | 优先级 |
|------|------|------|--------|
| 模型中途切换 | **Prewalk** 理念 | 贵模型规划→首次编辑→切换廉价模型执行。基于 model-capabilities.ts + UpdatePlan 扩展 | P1 |
| 子 agent（Subagent） | **DeepCode** 架构理念 | Paper2Code（论文→代码）+ Loop engineering（自主循环直到测试通过）。加 Task 工具 + runSubagent | P2 |

**架构可行性**（已验证）：DeepOrca 引擎对 subagent 友好——`activateSession` 已是 public 按 sessionId 参数化的纯异步函数，所有状态 Map<sessionId> 结构。加一个 Task 工具 + 抽取 `runSubagent()` 即可，不需重新设计引擎。

---

## 十一、自进化

> Agent 改进自身——双层自改进：**引擎脚手架**（prompt/工具/控制流）+ **技能内容**（SKILL.md 行为/描述）。
> 当前 DeepOrca 的技能系统是**静态**的（skill-writer 编写、skill-digester 改描述文案），没有任何基于执行结果的反馈闭环。

### 已集成（静态，无反馈闭环）

| 能力 | 项目 | 定位 | 局限 |
|------|------|------|------|
| 技能编写 | **skill-writer** | 教 Agent 创建 SKILL.md | 纯人工编写，无自动生成 |
| 技能描述审查 | **skill-digester** | 审查/重写 skill 的 description 字段 | 基于文本启发式，需人工批准，**无执行结果反馈** |

**关键空白**：搜索 `skillEvaluat`/`self-evolv`/`feedback loop` 在代码中零匹配——DeepOrca **没有任何基于执行结果的能力评估或自动改进机制**。

### 规划中（双层自改进）

#### 层一：技能自演化（技能内容改进）

| 能力 | 来源理念 | 贡献 | 优先级 |
|------|----------|------|--------|
| 技能执行→评估→改进闭环 | **OpenSpace** 理念（借鉴，不直接集成） | 技能执行后捕获结果（成功/失败/重试次数）→ 低成功率技能触发自动重写 → 高成功率技能在匹配时加权 | P2 |

**为什么不直接集成 OpenSpace**：Python 3.12+ 依赖 + Cloud 依赖（open-space.cloud）+ 它本身是完整 agent harness（与 DeepOrca 架构重叠）。只借鉴其"FIX/DERIVED/CAPTURED 演化触发器"和"provisional→trusted 信任状态机"设计理念，在 DeepOrca 内部用 Node.js 自建轻量版。

**轻量自建方案**：
```
技能执行 → 捕获结果（成功/失败/重试/用户纠正）
    ↓
低成功率技能 → skill-digester 自动重写 description（现有工具）
    ↓
高成功率技能 → 技能匹配时加权（identifyMatchingSkillNames 增强）
```

#### 层二：harness 自改进（引擎脚手架改进）

| 能力 | 来源理念 | 贡献 | 优先级 |
|------|----------|------|--------|
| 弱点挖掘→提案→回归测试 | **Self-Harness** 论文（arxiv:2606.09498） | Agent 分析自身执行轨迹发现失败模式 → 生成最小化脚手架修改（prompt/工具定义/控制流）→ 回归测试只保留有效改进 | P3 |

**三阶段闭环**：
```
1. 弱点挖掘（Weakness Mining）
   分析执行轨迹 → 发现失败模式/重复错误
   
2. Harness 提案（Harness Proposal）
   针对每个弱点 → 生成最小化、多样性的脚手架修改
   （如：调整 prompt 措辞、增加工具参数约束、修改控制流）
   
3. 回归测试（Regression Testing）
   只保留通过回归测试的修改 → 防止改好一处破坏他处
```

**与技能自演化的关系**：Self-Harness 改"引擎脚手架"（prompt/工具/控制流），OpenSpace 改"技能内容"（SKILL.md）——两者互补，不重叠。

**实施条件**：层二（harness 自改进）依赖层一（技能自演化）先落地建立执行结果捕获基础设施。建议作为远期方向（P3）。

#### 层三：蜂群协作（多 Agent 编排）

> 新增（2026-07-30 调研）——借鉴 JiuwenSwarm 理念，不引入 Python 运行时。

| 能力 | 来源理念 | 贡献 | 优先级 |
|------|----------|------|--------|
| 任务分治编排 | **JiuwenSwarm**（openJiuwen）理念 | 复杂任务自动分解 → 并行 subagent 分派 → 结果合并 | P3 |
| 上下文卸载 + 分层记忆 | JiuwenSwarm 理念 | 显式 token 成本控制（与 TDAM L0-L3 管线互补） | P3 |

**为什么不直接集成 JiuwenSwarm**：Python 运行时（pip install + Web UI），与 DeepOrca 的 Node/Electron 架构不匹配。只借鉴其"分治→并行→合并"编排模式和"上下文卸载保护 token 账单"的成本控制策略。落地方式：编写内置 Skill 教 Agent 在复杂任务中做任务分解 + 并行分派（复用 DeepOrca 已有的 subagent 能力）。

---

## 十二、插件中心

> 统一的插件/技能/MCP 管理入口——内置项分组展示，远程源一键安装。
> UI 方案：**设置面板内平铺卡片网格**（非左侧列表），按 category 分区。

### 已集成

| 能力 | 来源 | 定位 |
|------|------|------|
| 分组展示 | `builtin-plugins.json` 清单 | 内置 skills/MCP/plugins 按工具分组（Flutter/CodeGraph/代码审查/GitMCP…） |
| 内置项隔离 | MCP/Skills tab 过滤 | 内置项不在 MCP/Skills tab 单独展示，仅在 Plugins tab 分组卡片中 |
| Flutter/Dart 技能包 | flutter/agent-plugins | 24 个技能构建时内置 |
| Android/HarmonyOS/RN 技能包 | android/skills + deveco-cli + expo + callstack | 构建时内置 |
| Browser 统一分组 | browser-skill + web-access-strategy | Chrome 操控 + 联网策略 Skill |

### 规划中：远程源集成

#### 技术阻断点（必须先解决）

| # | 阻断点 | 影响 | 方案 |
|---|--------|------|------|
| 1 | **MCP HTTP/SSE 传输缺失** | 当前 `McpServerConfig` 只支持 stdio，远程 MCP 服务器（GitHub/ModelScope 等）无法接入 | 扩展 `McpServerConfig` 为 discriminated union：`type: "stdio" \| "http" \| "sse"` + `url` + `headers` |
| 2 | **远程源抽象缺失** | `BuiltinPluginGroup` 只读本地 JSON | 定义 `RemotePluginSource` 接口（`list()/search()/install()`），本地清单成为其中一个 source |
| 3 | **安装管线缺失** | Skills 自动发现、MCP 手动配置 | 实现"下载→放置→注册→启用→卸载"生命周期 |

#### 远程源清单（按优先级）

| 优先级 | 源 | 类型 | 格式 | API | 中国镜像 | 内容量 |
|--------|-----|------|------|-----|----------|--------|
| **P0** | **claude-plugins-official** (anthropics) | 插件+MCP+Skill | `marketplace.json`（**事实标准格式**） | Git clone + GitHub API | ❌ | 32.8k stars, 80+ 插件 |
| **P0** | **MCP Registry** (mcp-cn.com / registry.modelcontextprotocol.io) | MCP | REST API | ✅ 无认证 `GET /v0/servers` | ✅ mcp-cn.com | 官方 MCP 注册表 |
| **P1** | **ClawHub** (clawhub.ai) | Skill+Plugin | SKILL.md（原生兼容） | `clawhub install` CLI + `inspect` 安全扫描 | ✅ cn.clawhub-mirror.com (ByteDance) | ~57k skills |
| **P1** | **anthropics/skills** | Skill | SKILL.md | Git clone | ❌ | 165k stars, 501 skills |
| **P2** | **ModelScope** (modelscope.cn) | Skill+MCP | SDK/OpenAPI | ✅ 需 token | ✅ 原生 | 最大 CN 目录 |
| **P2** | **SkillHub.cn** | Skill | SKILL.md + CLI | `skillhub install` CLI | ✅ 腾讯云 COS | CN 精选 Top 50 |
| **P3** | **SwarmSkills** (swarmskills.openjiuwen.com) | Swarm Skill | SKILL.md 扩展 | 经 ClawHub 间接 | ❌ | JiuwenSwarm 生态 |
| ⚠️ | **skill.xfyun.cn** (讯飞) | 未知 | 未知 | 未确认 | — | 待验证 |

#### 标准格式：marketplace.json

采用 `anthropics/claude-plugins-official` 的格式作为远程源标准（与 DeepOrca 现有模型 1:1 对应）：

```
marketplace.json     ≈  DeepOrca 的 builtin-plugins.json（远程 SHA-pin 版）
plugin.json          ≈  DeepOrca 的 BuiltinPluginInfo manifest
.mcp.json            ≈  DeepOrca 的 mcpServers settings
skills/SKILL.md      =  DeepOrca 原生 skill 格式（完全相同）
```

用户可添加任意兼容源（设置 → 插件中心 → 添加来源 → 输入 Git URL 或 marketplace.json URL → 自动解析 → 一键安装）。

#### 插件中心 UI 方案

```
设置面板 → "插件中心" Tab
├── 搜索栏 + 来源筛选（内置 / ClawHub / MCP Registry / claude-plugins-official / 自定义）
├── 平铺卡片网格（每个卡片 = 一个插件/技能/MCP 服务器）
│   ├── 图标 + 名称 + 描述 + 来源标签
│   ├── 安装/卸载/启用/禁用 按钮
│   └── 详情展开（README 预览、权限要求、依赖、SHA pin）
├── 按 category 分区（development / automation / documentation / ...）
└── "添加自定义源" 入口（输入 marketplace.json URL → 解析 → 列出可用项）
```

#### 实施阶段

| 阶段 | 内容 | 解除阻断 |
|------|------|----------|
| Phase 0 | 扩展 MCP 客户端支持 HTTP/SSE 传输 | #1 |
| Phase 1 | 定义 `RemotePluginSource` 接口 + marketplace.json 适配器 | #2 |
| Phase 2 | 实现 claude-plugins-official 源（Git clone → 解析 → 安装） | 格式标准 |
| Phase 3 | 实现 MCP Registry 源（REST API → 列表/搜索 → 配置生成） | P0 MCP 源 |
| Phase 4 | 实现 ClawHub 源（CLI + inspect 安全扫描） | 最大 Skill 源 |
| Phase 5 | 设置面板插件中心 UI（平铺卡片 + 搜索 + 安装管线） | #3 |
| Phase 6 | ModelScope + SkillHub.cn + 自定义远程源 | 区域覆盖 |

#### 其他规划项

| 能力 | 项目 | 贡献 | 优先级 |
|------|------|------|--------|
| 网站适配器 + CLI Hub | **opencli** | 100+ 网站适配器（数据获取）+ CLI Hub 统一入口 | P2 |

---

## 十三、远程接入

> 让用户从手机或远程浏览器接入 DeepOrca——本地启动服务端，通过蒲公英/ngrok/frp 等隧道映射到外网，远程打开完整 UI。

### 架构（已验证可行性）

DeepOrca 的架构对 Web 远程接入**天然友好**：

- **Renderer 是纯浏览器 bundle**——零 Electron 导入，只通过 `window.deeporca` 与后端通信（`renderer/api.ts:9`）
- **SessionBridge 不依赖 Electron**——不导入 `electron`，通过 `emit` 回调注入事件（`session-bridge.ts:76`）
- **IPC 契约 JSON-safe**——81 个 request-response + 11 个 event，可 1:1 映射到 WebSocket
- **已有 `dist/renderer/` 静态站点**——index.html + renderer.js + CSS，任何 HTTP 服务器可直接 serve

```
手机/远程浏览器
  ↓ 蒲公英 / ngrok / frp 隧道（用户自行配置，DeepOrca 只提供服务方案）
  ↓
DeepOrca 本地服务端（Electron 主进程内置，新增）
  ├── HTTP 静态服务 → serve dist/renderer/（现有 UI，零改动复用）
  ├── WebSocket 服务 → 桥接 window.deeporca API
  │   ├── 81 个 request → 复用现有 ipcMain.handle 逻辑（提取为共享 dispatch table）
  │   └── 11 个 event → 广播给 WS 客户端
  └── SessionBridge → SessionManager（现有，零改动）
```

### 零改动部分

- ❌ 不改 `@deeporca/core`（SessionManager）
- ❌ 不改任何 renderer 组件（50+ React 组件全部复用）
- ❌ 不改 SessionBridge

### 规划中

| 能力 | 集成形态 | 贡献 | 优先级 |
|------|----------|------|--------|
| WebSocket 服务端 | Electron 主进程内 `ws` 库，提取现有 IPC handler 为共享 dispatch | 复用 100% 引擎和 UI，远程浏览器获得完整 DeepOrca 体验 | P1 |
| 浏览器端 shim | 注入 `window.deeporca` 的 `<script>`，通过 WS marshalling 实现 DesktopApi | 浏览器中无缝运行现有 React UI | P1 |
| HTTP 静态服务 | 同源 serve `dist/renderer/`（避免 CSP 问题） | 远程加载完整前端 | P1 |
| 隧道配置文档 | 文档 + 配置引导（蒲公英/ngrok/frp） | 用户一键配置外网访问 | P2 |
| 访问鉴权 | WS 连接 token + 可选 HTTPS | 防止未授权访问 | P1 |

### 设计原则

1. **DeepOrca 只提供服务端**——隧道/映射/HTTPS 由用户自行配置（蒲公英/ngrok/frp/Cloudflare Tunnel 等）
2. **本地优先**——服务端跑在 Electron 主进程内，不需要独立进程
3. **同源策略**——HTTP 静态服务和 WebSocket 跑在同一端口，避免 CSP 放宽
4. **完整体验**——远程浏览器获得与桌面端完全一致的 UI（因为是同一份 renderer bundle）

---

## 十四、语音双工

> 语音替代键盘输入——实时语音转录填入 Composer，让用户用说话代替打字。

### 规划中

| 能力 | 方案 | 贡献 | 优先级 |
|------|------|------|--------|
| 本地实时语音转录（默认） | **whisper.cpp** vendor + whisper-streaming LocalAgreement 策略 | 零外部依赖，CPU 可跑，3.3 秒延迟，74-244MB 模型 | P2 |
| 云端 API 兜底 | OpenAI Audio API / 用户配置的兼容端点 | 零体积，复用现有 API key，网络依赖 | P3 |

### 本地方案详情（whisper.cpp）

- **引擎**：whisper.cpp（OpenAI Whisper 的 C++ 移植，单二进制，MIT）
- **流式**：whisper-streaming 的 LocalAgreement 自适应延迟策略（3.3 秒延迟，非"录完再转"）
- **模型**：base(74MB) 或 small(244MB)，首次使用时下载或随包分发
- **vendor**：`scripts/vendor-whisper.js`（同 codegraph/openwiki 模式，预编译平台二进制）
- **集成先例**：Ditto（Windows Electron + whisper.cpp + CUDA）、WhisperScript（macOS+Windows Electron GUI）
- **加速**：Apple Silicon CoreML / Windows CUDA / Linux OpenBLAS

### 工作流

```
用户按住快捷键 / 点击麦克风按钮
  ↓
Electron 主进程 spawn whisper.cpp 子进程（vendor 二进制）
  ↓
麦克风音频流 → whisper-streaming LocalAgreement → 实时转录
  ↓
转录文本逐步填入 Composer 输入框
  ↓
用户说完 → 文本作为 prompt 发送给 Agent
```

### 备选方案（不首选）

| 方案 | 准确率 | 问题 |
|------|--------|------|
| NVIDIA Parakeet TDT 0.6B v2 | 业界最高 WER | 需 Python/NeMo，违背零依赖 |
| Superwhisper / Wispr Flow | 高 | 云端依赖 / macOS 为主 / 付费 |
| OpenAI Audio API | 高 | 网络依赖 + API key + 付费（但可作为兜底） |

---

## 搁置项

> 以下项目经深入分析后**暂时搁置**，不纳入当前规划。

| 项目 | 搁置理由 | 重新评估条件 |
|------|----------|-------------|
| **OpenSpec** | Plan Mode 已有成熟的提案→批准→执行流程（含权限强制），OpenSpec 的增量价值（spec 持久化）触及引擎核心改动，风险高 | Plan Mode 的 spec 持久化需求明确且迫切时重新评估 |
| **Superpowers** | 执行纪律类 skill（TDD/debug/review）可共存，但规划类（brainstorming/writing-plans）与 Plan Mode 争夺控制权；子 agent 类（subagent-driven）DeepOrca 无 Task 工具 | 引擎加入 Task 工具后，重新评估执行纪律类 skill 的引入 |
| **OmniGent** | meta-harness 与 DeepOrca 自身 harness 定位冲突，不互补 | 永不采纳（架构层级冲突） |
| **Electron 开发套件（自建）** | Electron 无官方 Agent Skills。自建需要实现 MCP/CLI 调试层（操控窗口/IPC/DevTools/进程），工程量巨大——本质上是在造 Electron 专用的 DevTools 自动化层 | 出现社区认可的 Electron Agent Skills 方案，或 DeepOrca 有明确的 Electron 应用调试自动化需求时 |

---

## 已集成能力清单（完整索引）

> 以下能力已在代码仓库中落地（跨 dev / perf / master 分支）。

| 能力 | commit / 分支 | 功能域 |
|------|---------------|--------|
| codegraph（导航层 MCP） | vendored CLI | 代码智能 |
| CRG（分析层 MCP） | `1f5146e` dev | 代码智能 |
| ocr（AI 审查） | `873f437` dev | 代码智能 |
| Serena（符号级代码操作 MCP） | `abb3f78` perf | 代码智能 |
| Dart MCP（Flutter 运行时分析） | `2b08460` perf | 移动开发 |
| openwiki（Wiki 生成） | vendored CLI | 知识中心 |
| TencentDB-Agent-Memory（记忆） | `08308c5` perf | 知识中心 |
| DeepDesign Phase 1（设计生成） | `127c912` perf | 设计生成 |
| Bento Slides（演示文稿） | `08308c5` perf | 办公套件 |
| browser-skill（浏览器操控） | 内置插件 | 浏览器与联网 |
| flutter/agent-plugins（24 技能） | 构建 skills | 移动开发 |
| Android Development Kit（14 技能 + CLI） | `16c4b2c` perf | 移动开发 |
| HarmonyOS Development Kit（Skills + MCP） | `16c4b2c` perf | 移动开发 |
| React Native Development Kit（Skills + Expo MCP） | `16c4b2c` perf | 移动开发 |
| web-access-strategy（联网策略 Skill） | `16c4b2c` perf | 浏览器与联网 |
| Plan Mode（规划+权限强制） | 引擎核心 | 引擎演进 |
| UpdatePlan（进度跟踪） | 引擎核心 | 引擎演进 |
| Electron 35（零外部依赖） | `d0ebc79` dev | 引擎演进 |
| 插件中心分组 | `dbf94fb`+`b70a7bb` perf | 插件中心 |
| vendor 镜像兜底 | `4eb24c0` dev | 引擎演进 |
| spawn 修复 | `04c1585` dev | 引擎演进 |

---

## 设计原则（v3.0 确立）

1. **零外部运行时依赖** — 内部插件全部跑 Electron 自带 Node，不依赖宿主机 Node/npm/Python（已有 codegraph/openwiki/ocr 验证）
2. **Agent 是引擎，浏览器是渲染层** — 不自研渲染/设计引擎，设计稿是 LLM 写的 HTML，展示靠 Electron webview（DeepDesign 核心洞察）
3. **三层代码智能分工** — codegraph（在哪）→ CRG（多危险）→ ocr/serena（怎么改），不重叠
4. **浏览器分工** — bsk（登录态操控）+ obscura（大规模抓取），不引入第三个冗余方案
5. **引擎演进渐进式** — Plan Mode 为权威，Prewalk/OpenSpace/Subagent 在其上叠加，不替换核心流程
6. **直接集成不从零开发** — 所有规划项目以 MCP/Skill/SDK/vendor 形式直接嵌入
7. **搁置优于冒进** — OpenSpec/Superpowers 触及核心流程，搁置等待条件成熟

---

> 关联文档：
> - [DeepDesign 内核设计](../../specs/deep-design/design.md)
> - [前期集成调研（5 项目）](../research/2026-07-open-source-integration-feasibility.md)
> - [OCR 集成 & Understand-Anything 分析](../research/2026-07-ocr-integration-and-ua-analysis.md)
