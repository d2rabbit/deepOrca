# 内置组件全量清单（供人工分组）

> 生成时间：2026-08-03。共 **183 个 Skills + 10 个 MCP + 4 个 CLI 插件**。
> 分组维度建议：仓库/官方组织优先，功能为辅。同一仓库的组件尽量合并在一个组里。

---

## 一、MCP 服务器（10 个）

| # | server name | 作用 | 仓库来源 |
|---|---|---|---|
| 1 | `codegraph` | 代码图谱导航——符号定义/引用跨文件跳转 | colbymchenry/codegraph（vendored） |
| 2 | `code-review-graph` (CRG) | 代码风险图谱——变更影响分析 + AI 审查 | DeepOrca 自研 vendored |
| 3 | `serena` | 语义级符号操作——find/rename/replace body，40+ 语言 (SolidLSP) | oraios/serena |
| 4 | `dart-mcp-server` | Dart/Flutter 运行时分析——widget inspect、pub.dev 搜索、测试执行 | Dart 官方 |
| 5 | `harmonyos-mcp` | 鸿蒙 DevEco CLI——create/build/run/emulator/screenshot/docs | 华为 DevEco |
| 6 | `expo-mcp` | Expo SDK 知识 + 模拟器交互 + RN DevTools（远程 HTTP） | Expo 官方 mcp.expo.dev |
| 7 | `skill-spector` | AI skill/MCP 安全扫描——68 漏洞模式、prompt injection、供应链 CVE | NVIDIA/SkillSpector |
| 8 | `a2ui` | Agent-to-UI 交互原型渲染（进程内 MCP） | DeepOrca 自研 |
| 9 | `activity-frames` | 行为记忆——跨平台多源采集（file/git/shell/session） | DeepOrca 自研 |
| 10 | `gitmcp:*`（动态前缀） | GitHub 仓库 → MCP 知识源（每个 repo 一个 server） | idosal/git-mcp |

---

## 二、CLI 插件（4 个）

| # | name | 作用 | 仓库来源 |
|---|---|---|---|
| 1 | `android-cli` | Android CLI 集成——项目创建/模拟器/截图标注/布局检查/文档搜索 | Google developer.android.com/tools/agents |
| 2 | `browser-skill` | 真实 Chrome 操控（携带登录态），bsk CLI | Tencent/BrowserSkill |
| 3 | `git-mcp` | CLI 插件——配合 gitmcp:\* MCP 使用，管理 GitHub repo 知识源 | idosal/git-mcp |
| 4 | `open-code-review` | AI 代码审查 CLI（Alibaba OCR） | alibaba/open-code-review |

---

## 三、Skills（183 个）

### 3.1 Android（20 个）— 源：`github.com/android/skills`

| 目录名 | frontmatter name | 作用 |
|---|---|---|
| android-adaptive | adaptive | 自适应 UI（手机/平板/折叠屏/XR） |
| android-agp-9-upgrade | agp-9-upgrade | 升级到 Android Gradle Plugin 9 |
| android-appfunctions | appfunctions | AppFunctions 工作流分析 |
| android-camerax | camerax | CameraX 相机开发指南 |
| android-cli | android-cli | ⚠️ **同时是 CLI 插件**（见二-#1） |
| android-display-glasses-with-jetpack-compose-glimmer | display-glasses-with-jetpack-compose-glimmer | XR 眼镜投影开发 |
| android-edge-to-edge | edge-to-edge | 边到边布局迁移 |
| android-engage-sdk-integration | engage-sdk-integration | Play Engage SDK 集成 |
| android-intent-security | intent-security | Intent 安全最佳实践 |
| android-migrate-xml-views-to-jetpack-compose | migrate-xml-views-to-jetpack-compose | XML → Compose 迁移 |
| android-navigation-3 | navigation-3 | Jetpack Navigation 3 |
| android-perfetto-sql | perfetto-sql | Perfetto SQL 查询 |
| android-perfetto-trace-analysis | perfetto-trace-analysis | Perfetto trace 分析 |
| android-play-billing-library-version-upgrade | play-billing-library-version-upgrade | Play Billing 升级 |
| android-play-policy-insights | play-policy-insights | Play Policy 合规审计 |
| android-r8-analyzer | r8-analyzer | R8 混淆/keep 规则分析 |
| android-styles | styles | Compose Styles API |
| android-testing-setup | testing-setup | Android 测试策略 |
| android-verified-email | verified-email | Verified Email 实现 |
| android-wear-compose-m3 | wear-compose-m3 | Wear OS Compose M3 |

### 3.2 Dart（12 个）— 源：`github.com/flutter/agent-plugins`

| 目录名 | 作用 |
|---|---|
| dart-add-unit-test | 单元测试编写 |
| dart-build-cli-app | CLI 应用入口结构 |
| dart-collect-coverage | 代码覆盖率收集 |
| dart-fix-runtime-errors | 运行时错误修复 |
| dart-generate-test-mocks | Mock 对象生成 |
| dart-migrate-to-checks-package | 迁移到 checks 包 |
| dart-resolve-package-conflicts | 包版本冲突解决 |
| dart-run-static-analysis | 静态分析（dart analyze） |
| dart-setup-ffi-assets | FFI 资源编译打包 |
| dart-use-ffigen | ffigen 自动绑定生成 |
| dart-use-pattern-matching | 模式匹配/switch 表达式 |
| dart-use-primary-constructors | 主构造函数 |

### 3.3 Flutter（10 个）— 源：`github.com/flutter/agent-plugins`

| 目录名 | 作用 |
|---|---|
| flutter-add-integration-test | 集成测试配置 |
| flutter-add-widget-preview | Widget 预览 |
| flutter-add-widget-test | Widget 组件测试 |
| flutter-apply-architecture-best-practices | 架构最佳实践 |
| flutter-build-responsive-layout | 响应式布局 |
| flutter-fix-layout-issues | 布局错误修复 |
| flutter-implement-json-serialization | JSON 序列化 |
| flutter-setup-declarative-routing | 声明式路由（go_router 等） |
| flutter-setup-localization | 国际化（intl） |
| flutter-use-http-package | http 包网络请求 |

### 3.4 Expo（22 个）— 源：`github.com/expo/skills`

| 目录名 | 作用 |
|---|---|
| expo-app-clip | iOS App Clip |
| expo-brownfield | 棕地集成（已有原生项目） |
| expo-data-fetching | 网络数据获取 |
| expo-dev-client | Dev Client 构建分发 |
| expo-dom | DOM 组件 |
| expo-eas-app-stores | EAS 应用商店部署 |
| expo-eas-hosting | EAS 网站托管 |
| expo-eas-observe | EAS Observe 监控 |
| expo-eas-simulator | EAS 远程模拟器 |
| expo-eas-update-insights | EAS Update 健康检查 |
| expo-eas-workflows | EAS Workflows |
| expo-examples | 官方示例项目 |
| expo-migrate-module | 原生模块迁移 |
| expo-module | Expo Native Module 开发 |
| expo-native-ui | 原生 UI（@expo/ui） |
| expo-project-structure | 项目结构规范 |
| expo-router | 路由导航 |
| expo-skill-feedback | 技能反馈 |
| expo-tailwind-setup | Tailwind CSS v4 集成 |
| expo-ui | @expo/ui 组件库 |
| expo-upgrade | SDK 版本升级 |
| expo-web-to-native | Web → 原生迁移 |

### 3.5 HarmonyOS（1 个）— 源：华为 DevEco

| 目录名 | 作用 |
|---|---|
| harmonyos-deveco-cli | DevEco CLI 全流程（ArkTS/ArkUI/hvigor/ohpm/hdc/模拟器/文档） |

### 3.6 .NET（96 个）— 源：`github.com/dotnet/skills`

涵盖 ASP.NET Core、MAUI、EF Core、MSBuild、NuGet、测试、性能诊断、AOT、OpenTelemetry、模板、迁移等。

| 分类 | 代表 skill | 数量 |
|---|---|---|
| 测试 | code-testing-agent, run-tests, writing-mstest-tests, test-anti-patterns, coverage-analysis, test-gap-analysis, test-smell-detection, test-tagging, grade-tests, filter-syntax, find-untested-sources, generate-testability-wrappers... | ~20 |
| MSBuild/构建 | msbuild-antipatterns, incremental-build, build-perf-diagnostics, binlog-failure-analysis, binlog-generation, build-parallelism, build-perf-baseline, eval-performance, msbuild-modernization, msbuild-server, property-patterns, target-authoring, item-management, extension-points, directory-build-organization, check-bin-obj-clash, copy-to-output-directory, including-generated-files, resolve-project-references... | ~18 |
| 迁移 | migrate-dotnet8-to-9, migrate-dotnet9-to-10, migrate-dotnet10-to-dotnet11, migrate-xunit-to-mstest, migrate-xunit-to-xunit-v3, migrate-mstest-v1v2-to-v3, migrate-mstest-v3-to-v4, migrate-vstest-to-mtp, migrate-nullable-references, migrate-static-to-wrapper, migrate-thread-abort, thread-abort-migration... | ~12 |
| MAUI | maui-app-lifecycle, maui-data-binding, maui-shell-navigation, maui-theming, maui-collectionview, maui-dependency-injection, maui-safe-area, dotnet-maui-doctor... | ~8 |
| 模板 | template-authoring, template-comparison, template-discovery, template-instantiation, template-smart-defaults, template-validation... | ~6 |
| 性能 | analyzing-dotnet-performance, exp-simd-vectorization, microbenchmarking, optimizing-ef-core-queries, dotnet-trace-collect, dump-collect, crap-score... | ~8 |
| ASP.NET/Web API | dotnet-webapi, minimal-api-file-upload, create-datadriven-aspnetcore, convert-blazor-server-to-webapp, support-prerendering... | ~5 |
| 诊断/工具 | dotnet-aot-compat, dotnet-pinvoke, configuring-opentelemetry-dotnet, nuget-trusted-publishing, clr-activation-debugging, code-testing-extensions, test-analysis-extensions, system-text-json-net11, csharp-scripts, detect-static-dependencies, dotnet-technology-selection... | ~19 |

<details><summary>全部 96 个 dotnet skill 目录名（点击展开）</summary>

```
dotnet-analyzing-dotnet-performance
dotnet-android-tombstone-symbolication
dotnet-apple-crash-symbolication
dotnet-assertion-quality
dotnet-author-component
dotnet-binlog-failure-analysis
dotnet-binlog-generation
dotnet-build-parallelism
dotnet-build-perf-baseline
dotnet-build-perf-diagnostics
dotnet-check-bin-obj-clash
dotnet-clr-activation-debugging
dotnet-code-testing-agent
dotnet-code-testing-extensions
dotnet-collect-user-input
dotnet-configure-auth
dotnet-configuring-opentelemetry-dotnet
dotnet-convert-blazor-server-to-webapp
dotnet-convert-to-cpm
dotnet-coordinate-components
dotnet-copy-to-output-directory
dotnet-coverage-analysis
dotnet-crap-score
dotnet-create-blazor-project
dotnet-create-datadriven-aspnetcore
dotnet-csharp-scripts
dotnet-detect-static-dependencies
dotnet-directory-build-organization
dotnet-dotnet-aot-compat
dotnet-dotnet-maui-doctor
dotnet-dotnet-pinvoke
dotnet-dotnet-trace-collect
dotnet-dotnet-webapi
dotnet-dump-collect
dotnet-eval-performance
dotnet-exp-mock-usage-analysis
dotnet-exp-simd-vectorization
dotnet-exp-test-maintainability
dotnet-extension-points
dotnet-fetch-and-send-data
dotnet-filter-syntax
dotnet-find-untested-sources
dotnet-generate-testability-wrappers
dotnet-grade-tests
dotnet-including-generated-files
dotnet-incremental-build
dotnet-item-management
dotnet-maui-app-lifecycle
dotnet-maui-collectionview
dotnet-maui-data-binding
dotnet-maui-dependency-injection
dotnet-maui-safe-area
dotnet-maui-shell-navigation
dotnet-maui-theming
dotnet-microbenchmarking
dotnet-migrate-dotnet10-to-dotnet11
dotnet-migrate-dotnet8-to-dotnet9
dotnet-migrate-dotnet9-to-dotnet10
dotnet-migrate-mstest-v1v2-to-v3
dotnet-migrate-mstest-v3-to-v4
dotnet-migrate-nullable-references
dotnet-migrate-static-to-wrapper
dotnet-migrate-vstest-to-mtp
dotnet-migrate-xunit-to-mstest
dotnet-migrate-xunit-to-xunit-v3
dotnet-minimal-api-file-upload
dotnet-msbuild-antipatterns
dotnet-msbuild-modernization
dotnet-msbuild-server
dotnet-mtp-hot-reload
dotnet-nuget-trusted-publishing
dotnet-optimizing-ef-core-queries
dotnet-plan-ui-change
dotnet-platform-detection
dotnet-property-patterns
dotnet-resolve-project-references
dotnet-run-tests
dotnet-setup-local-sdk
dotnet-support-prerendering
dotnet-system-text-json-net11
dotnet-target-authoring
dotnet-technology-selection
dotnet-template-authoring
dotnet-template-comparison
dotnet-template-discovery
dotnet-template-instantiation
dotnet-template-smart-defaults
dotnet-template-validation
dotnet-test-analysis-extensions
dotnet-test-anti-patterns
dotnet-test-gap-analysis
dotnet-test-smell-detection
dotnet-test-tagging
dotnet-thread-abort-migration
dotnet-use-js-interop
dotnet-writing-mstest-tests
```

</details>

### 3.7 Qt（12 个）— 源：`github.com/TheQtCompanyRnD/agent-skills`

| 目录名 | 作用 |
|---|---|
| qt-qt-cmake-project | CMake 项目 |
| qt-qt-cpp-docs | C++ 文档 |
| qt-qt-cpp-review | C++ 代码审查 |
| qt-qt-figma-component-generation | Figma → 组件生成 |
| qt-qt-figma-token-extraction | Figma 设计 token 提取 |
| qt-qt-qml | QML 编码 |
| qt-qt-qml-docs | QML 文档 |
| qt-qt-qml-profiler | QML 性能分析 |
| qt-qt-qml-review | QML 审查 |
| qt-qt-qml-test | QML 测试 |
| qt-qt-qml-test-run | QML 测试运行 |
| qt-qt-ui-design | UI 设计 |

### 3.8 DeepOrca 自研 Skills（10 个）

| 目录名 | 作用 | 来源 |
|---|---|---|
| deep-design | DeepDesign .dd 格式设计生成 | DeepOrca 自研 |
| a2ui-prototype | A2UI 原型模板 | DeepOrca 自研 |
| pm-designer-openui | PM-Designer（OpenUI Lang） | DeepOrca 自研 |
| taste | 设计纪律/品味准则 | DeepOrca 自研 |
| openwiki | 项目 Wiki 知识图谱生成 | DeepOrca 自研 |
| web-access-strategy | 智能联网策略（WebSearch/curl/Jina/bsk） | DeepOrca 自研 |
| deeporca-self-refer | DeepOrca 自引用文档 | DeepOrca 自研 |
| bento-slides | Bento 演示文稿生成 | DeepOrca 自研 |
| skill-writer | Skill 编写向导 | DeepOrca 自研 |
| skill-digester | Skill 审查/消化 | DeepOrca 自研 |

---

## 四、待入库（平台门控，当前磁盘为空）

| 组 | 仓库 | 平台门控 | 预期 skills |
|---|---|---|---|
| Apple | `xcrun agent skills export`（Xcode 27）+ `twostraws/swift-agent-skills` | 仅 macOS | apple-xcode-skills + 社区精选（SwiftUI/UIKit 现代化/测试/安全审计） |
| Deepin | `github.com/linuxdeepin/deepin-skills` | 仅 Linux | DTK 原生应用、DDE Shell 扩展、控制中心模块、托盘插件（4 个） |

---

## 附：分组参考（当前 builtin-plugins.json 的 15 组）

> 这只是参考，你可以重新定义。告诉我最终分组方案，我来改代码。

| 组 ID | 当前包含 |
|---|---|
| code-intelligence | MCP: codegraph, code-review-graph, serena · CLI: open-code-review |
| flutter-dev | Skills: dart-\*, flutter-\* · MCP: dart-mcp-server |
| android-dev | Skills: android-\* · CLI: android-cli |
| expo-dev | Skills: expo-\* · MCP: expo-mcp |
| harmonyos-dev | Skills: harmonyos-\* · MCP: harmonyos-mcp |
| dotnet-dev | Skills: dotnet-\* |
| qt-dev | Skills: qt-\* |
| apple-dev | Skills: apple-\*, swift-\*, uikit-\*, swiftui-\*（platform: darwin） |
| deepin-dev | Skills: deepin-\*, dde-\*, dtk-\*（platform: linux） |
| design | Skills: deep-design, a2ui-prototype, taste, pm-designer-openui · MCP: a2ui |
| documentation | Skills: openwiki · MCP: gitmcp:\*, activity-frames · CLI: git-mcp |
| browser | Skills: web-access-strategy · CLI: browser-skill |
| security | MCP: skill-spector |
| skill-tools | Skills: skill-writer, skill-digester |
| deeporca | Skills: deeporca-self-refer, bento-slides |
