# Android Development Kit — 内核驱动的安卓开发套件

> 状态：内核设计 · 日期：2026-07-29
> 定位：DeepOrca 的内置安卓开发能力，对标 Flutter Development 分组。
> 来源：[android/skills](https://github.com/android/skills)（Apache-2.0）+
> [Android CLI](https://developer.android.com/tools/agents/android-cli)

---

## 1. 核心洞察：Android 官方 Agent 工具链是什么

Google 2026 年 4 月发布了 **Android Agent 开发三件套**：

| 组件 | 是什么 | 在 DeepOrca 中的角色 |
|------|--------|---------------------|
| **Android Skills** | 14 个 SKILL.md（官方最佳实践指令） | 构建 Skills——Agent 通过 bash 执行 `android` CLI |
| **Android CLI** | `android` 命令行工具（项目创建/模拟器/截图/布局检查/文档搜索） | Skill 教 Agent 使用 CLI（非 MCP，走 bash） |
| **Android Knowledge Base** | `android docs search` 官方文档检索 | CLI 内置，Agent 按需调用 |

**关键结论**：Android 官方选择了 **CLI-first 而非 MCP**——`android` 命令是给 Agent 的确定性接口，Agent 通过 bash 调用。这与 Flutter 的 Dart MCP server 不同（Dart 选了 MCP，Android 选了 CLI）。DeepOrca 已有 bash 工具，所以 Android Skills 直接走 bash 即可，不需要注册 MCP server。

---

## 2. 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DeepOrca Agent（已有）                        │
│                                                                     │
│  ┌──────────────────┐  ┌─────────────────────────────────────────┐  │
│  │ android-* Skills  │  │ android CLI（用户机器上的 android 命令） │  │
│  │（14 个内置技能）   │  │ create/run/emulator/sdk/layout/screen/  │  │
│  │ 教 Agent 怎么做   │──│ docs/skills                             │  │
│  └──────────────────┘  └─────────────────────────────────────────┘  │
│         │                                                           │
│         ▼  Agent 通过 bash 工具执行                                  │
│  $ android create -o ./myapp empty-activity-agp-9                   │
│  $ android emulator start medium_phone                              │
│  $ android run                                                       │
│  $ android screen capture --annotate                                 │
│  $ android layout --pretty                                           │
└─────────────────────────────────────────────────────────────────────┘
```

### 与 Flutter Development 的对比

| 维度 | Flutter Development | Android Development Kit |
|------|--------------------|-----------------------|
| 技能来源 | flutter/agent-plugins（24 个） | android/skills（14 个） |
| 运行时交互 | Dart MCP server（`dart mcp-server`） | Android CLI（`android` 命令，走 bash） |
| 官方选择 | MCP | CLI-first |
| 触发条件 | `pubspec.yaml`（Dart/Flutter 项目） | `build.gradle`/`build.gradle.kts`（Android 项目） |
| 前提依赖 | `dart` ≥ 3.9 在 PATH | `android` CLI 在 PATH（需用户安装） |

---

## 3. Android Skills 清单（14 个）

构建时从 `android/skills` 仓库拉取，内置到 `bundled/`：

| 分类 | Skill | 用途 |
|------|-------|------|
| **devtools** | `android-cli` | 核心——编排 `android` CLI 全部命令（项目创建/部署/SDK/模拟器/截图/布局/文档） |
| **jetpack-compose** | `adaptive` | 自适应布局（折叠屏/平板/大屏） |
| | `migration/migrate-xml-views-to-compose` | XML Views → Compose 迁移 |
| | `theming/styles` | Compose 主题系统 |
| **navigation** | `navigation-3` | Navigation 3（最新导航框架） |
| **camera** | `camera1-to-camerax` | Camera1 → CameraX 迁移 |
| **performance** | `r8-analyzer` | R8 混淆/压缩分析 |
| **system** | `edge-to-edge` | Edge-to-edge 全屏适配 |
| **testing** | `testing-setup` | 测试环境配置 |
| **play** | `engage-sdk-integration` | Google Play Engage SDK |
| | `play-billing-library-version-upgrade` | Play Billing 版本升级 |
| **identity** | `verified-email` | 邮箱验证 |
| **device-ai** | `appfunctions` | 设备 AI App Functions |
| **profilers** | `perfetto-sql` | Perfetto SQL 性能分析 |
| | `perfetto-trace-analysis` | Perfetto Trace 分析 |
| **xr** | `display-glasses-with-jetpack-compose-glimmer` | XR 眼镜 Compose UI |

---

## 4. Android CLI 能力（Agent 通过 bash 调用）

| 命令 | 功能 |
|------|------|
| `android create` | 从官方模板创建项目（避免 Agent 瞎拼 Gradle） |
| `android run` | 部署 APK 到设备/模拟器 |
| `android emulator create/start/stop/list` | 管理模拟器 |
| `android sdk install/list/update/remove` | 管理 SDK 组件 |
| `android screen capture --annotate` | 截图 + **自动标注 UI 元素**（赋予 Agent "视觉"） |
| `android layout --pretty` | 返回 UI 布局树 JSON（比截图更快定位 UI 问题） |
| `android docs search` | 搜索官方 Android 开发文档（解决知识滞后） |
| `android skills add/list/find` | 管理 Android Skills |
| `android describe` | 分析项目结构，生成元数据 |

---

## 5. 改动清单

| # | 文件 | 改动 | 优先级 |
|---|------|------|--------|
| 1 | `scripts/install-android-skills.js` | **新建** 构建时从 android/skills 拉取 14 个 Skill | P0 |
| 2 | `packages/core/templates/skills/bundled/android-*/` | 拉取的 skills（gitignored，构建时生成） | P0 |
| 3 | `packages/core/templates/builtin-plugins.json` | 新增 "Android Development" 分组 | P0 |
| 4 | i18n（messages.ts + locales） | `builtin-plugin.android-dev.name/desc` | P0 |
| 5 | `package.json`（root）构建脚本 | `prebuild` 加 `install-android-skills.js` | P1 |

### 不需要的

- ❌ **不需要注册 MCP server**——Android 官方选了 CLI-first，Agent 通过 bash 调用 `android` 命令
- ❌ **不需要 vendor android CLI**——它是用户安装的工具（`curl | bash` 一键安装），不是 DeepOrca 内置的二进制
- ❌ **不需要检测 `android` 在 PATH**——Skill 文档里说明前提条件即可，缺失时 bash 命令自然报错

---

## 6. 触发条件

- **Skill 触发**：Agent 收到 Android 相关请求时，skill 匹配器自动加载 android-* skills（基于 name+description 分类）
- **CLI 使用**：Agent 读 `android-cli` SKILL.md 后，通过 bash 工具执行 `android` 命令
- **前提**：用户机器已安装 Android CLI（`curl -fsSL https://dl.google.com/android/cli/latest/<platform>/install.sh | bash`）

---

## 7. 插件中心展示

在 `builtin-plugins.json` 新增分组：

```json
{
  "id": "android-dev",
  "name": "Android Development",
  "description": "Official Android development skills (14 SKILL.md from Google) + Android CLI integration. Covers Jetpack Compose, Navigation 3, CameraX migration, R8 analysis, edge-to-edge, testing, Perfetto profiling, and more.",
  "category": "development",
  "icon": "android",
  "skills": ["android-*"]
}
```

插件中心显示为 "Android Development" 卡片，14 skills 标签。无 MCP（Android 走 CLI 不走 MCP）。
