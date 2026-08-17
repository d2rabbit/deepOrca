# HarmonyOS Development Kit — 鸿蒙开发套件

> 状态：内核设计 · 日期：2026-07-29
> 定位：DeepOrca 的内置鸿蒙开发能力，归属"移动开发"功能域。
> 来源：[openharmony-sig/deveco-cli](https://gitcode.com/openharmony-sig/deveco-cli)（华为官方，HDC 2026 发布）

---

## 1. 核心洞察：DevEco CLI 是什么

华为在 HDC 2026 发布了 **DevEco CLI**——将 DevEco Studio 工具链统一封装为一个 CLI，为第三方 AI Agent 提供标准化的鸿蒙开发能力调用接口。它与 Google 的 Android CLI 定位完全对等。

**三件套**：

| 组件 | 是什么 | 在 DeepOrca 中的角色 |
|------|--------|---------------------|
| **DevEco CLI**（`devecocli`） | 命令行工具（项目创建/构建/运行/模拟器/日志/文档） | Skill 教 Agent 通过 bash 调用 |
| **HarmonyOS Skills** | 精品 SKILL.md（ArkTS 最佳实践） | 构建 Skills 内置 |
| **HarmonyOS Knowledge Base** | `devecocli docs` 本地文档检索 | CLI 内置 |

**关键特性**：DevEco CLI 同时支持 **Skill 模式**（CLI-first，走 bash）和 **MCP 模式**（`devecocli init --mcp`）。默认推荐 Skill 模式。

---

## 2. DevEco CLI 命令清单

| 命令 | 功能 | 对标 Android CLI |
|------|------|-----------------|
| `devecocli init` | 初始化环境 + 将 Skill/MCP 安装到 Agent | `android init` |
| `devecocli create` | 项目脚手架（Empty Ability 模板，创建新工程） | `android create` |
| `devecocli build` | 编译打包（产出 .hap/.hsp/.har） | `android run`（构建部分） |
| `devecocli build clean` | 清理构建产物 | — |
| `devecocli run` | 安装并运行应用到设备/模拟器 | `android run` |
| `devecocli emulator` | 模拟器管理（创建/启动/停止/列表） | `android emulator` |
| `devecocli screenshot` | 设备截图 | `android screen capture` |
| `devecocli layout` | UI 布局树检查 | `android layout` |
| `devecocli docs` | 本地 HarmonyOS 文档检索 | `android docs search` |
| `devecocli skills` | Skill 管理（安装/列表/查找） | `android skills` |

**内置工具链**（封装在 CLI 内）：
- **ohpm**——包管理（类似 npm/pip）
- **hvigor**——构建系统（类似 Gradle）
- **hdc**——设备调试（类似 adb）
- **emulator**——模拟器
- **hilog**——日志系统

---

## 3. 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DeepOrca Agent（已有）                        │
│                                                                     │
│  ┌──────────────────┐  ┌─────────────────────────────────────────┐  │
│  │ harmonyos-* Skills│  │ devecocli（用户机器上的 devecocli 命令） │  │
│  │（内置技能）        │  │ create/build/run/emulator/screenshot/   │  │
│  │ 教 Agent 怎么做   │──│ layout/docs/skills                      │  │
│  └──────────────────┘  │ 内置 ohpm/hvigor/hdc/hilog              │  │
│         │               └─────────────────────────────────────────┘  │
│         ▼  Agent 通过 bash 工具执行                                  │
│  $ devecocli create -n MyApp -t app -s default                      │
│  $ devecocli build --product default                                │
│  $ devecocli emulator start                                         │
│  $ devecocli run                                                    │
│  $ devecocli screenshot                                             │
│  $ devecocli docs search "ArkTS 状态管理"                            │
└─────────────────────────────────────────────────────────────────────┘
```

### 与 Flutter / Android 的对比

| 维度 | Flutter | Android | HarmonyOS |
|------|---------|---------|-----------|
| 技能来源 | flutter/agent-plugins（24 个） | android/skills（14 个） | deveco-cli 内置 Skills |
| 运行时交互 | MCP（`dart mcp-server`） | CLI（`android` 命令） | CLI（`devecocli`）+ 可选 MCP |
| 官方选择 | MCP | CLI-first | CLI + MCP 双模式 |
| 包管理 | pub/dev | Gradle | ohpm |
| 构建系统 | dart compile | Gradle | hvigor |
| 设备调试 | flutter driver | adb | hdc |
| 触发文件 | `pubspec.yaml` | `build.gradle(.kts)` | `build-profile.json5` / `oh-package.json5` |
| 安装方式 | Dart SDK 自带 | `curl \| bash` | `npm i -g @deveco/deveco-cli` |

---

## 4. 改动清单

| # | 文件 | 改动 | 优先级 |
|---|------|------|--------|
| 1 | `scripts/install-harmonyos-skills.js` | **新建** 构建/拉取鸿蒙 Skills | P0 |
| 2 | `packages/core/templates/skills/bundled/harmonyos-*/` | 鸿蒙 skills（gitignored，构建时生成） | P0 |
| 3 | `packages/core/templates/builtin-plugins.json` | 新增 "HarmonyOS Development" 分组 | P0 |
| 4 | i18n（messages.ts + locales） | `builtin-plugin.harmonyos-dev.name/desc` | P0 |

### 不需要的

- ❌ **不需要 vendor devecocli**——npm 安装（`npm i -g @deveco/deveco-cli`），用户自行安装
- ❌ **不需要注册 MCP**——默认走 CLI（bash），MCP 模式可选但非必需
- **不需要检测 devecocli 在 PATH**——Skill 文档说明前提条件

---

## 5. HarmonyOS Skills 内容

DevEco CLI 自带 Skills，覆盖 HarmonyOS 开发关键场景：

- **ArkTS 语法与最佳实践**——状态管理（@State/@Prop/@Link）、组件生命周期
- **ArkUI 声明式 UI**——布局（Row/Column/Stack/Flex）、组件组合、动画
- **项目结构与构建**——模块化（HAP/HAR/HSP）、hvigor 构建配置
- **导航与路由**——Navigation 组件、路由栈管理
- **数据持久化**——Preferences、关系型数据库、分布式数据
- **网络请求**——HTTP 请求、WebSocket
- **测试**——单元测试、UI 测试（ArktsJUnit）
- **性能优化**——Profiler、性能分析

构建脚本从 deveco-cli 仓库或 npm 包拉取最新 Skills。

---

## 6. 插件中心展示

```json
{
  "id": "harmonyos-dev",
  "name": "HarmonyOS Development",
  "description": "HarmonyOS development skills + DevEco CLI integration. Covers ArkTS/ArkUI, hvigor build, ohpm packages, hdc debugging, emulator, and HarmonyOS docs.",
  "category": "development",
  "icon": "harmonyos",
  "skills": ["harmonyos-*"]
}
```

---

## 7. 三平台移动开发统一

DeepOrca 移动开发域现在覆盖三大平台：

| 平台 | 技能 | 运行时交互 | 触发文件 | 官方工具 |
|------|------|-----------|----------|---------|
| **Flutter** | 24 skills | Dart MCP | `pubspec.yaml` | `dart mcp-server` |
| **Android** | 14 skills | Android CLI | `build.gradle` | `android` 命令 |
| **HarmonyOS** | 内置 skills | DevEco CLI | `build-profile.json5` | `devecocli` 命令 |

用户打开不同项目时，Agent 自动加载对应平台的 Skills，通过 bash 调用对应的 CLI 工具。
