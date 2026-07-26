# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Monaco Editor 集成** (2026-07-26)
  - 集成 Monaco Editor 代码编辑器模块到桌面客户端
  - 支持代码编辑、语法高亮、智能提示
  - 提交: `35fd032`

- **GitMCP 本地模块** (2026-07-25)
  - 完整实现本地 GitMCP 模块
  - 独立索引库 + 边缘快捷项 + MCP 权限控制
  - 基于 SQLite FTS5 全文索引，BM25 排序
  - 4 个内置工具：fetch_documentation、search_documentation、search_code、fetch_url_content
  - 提交: `5f8c537`

- **官网交互优化** (2026-07-26)
  - 添加 CSS 呼吸动画效果（grid-breathe、glow-pulse）
  - 实现导航栏滚动隐藏/显示交互
  - 添加 IntersectionObserver 滚动动画
  - 优化用户体验和视觉效果
  - 提交: `015162b`

- **Feature 路线图 v2.1** (2026-07-26)
  - 新增 Penpot vs Open Design 对比分析（选择 Open Design）
  - 新增 Obscura 轻量级无头浏览器集成方案
  - 标记已集成项目（flutter/agent-plugins、openwiki、codegraph）
  - 提交: `015162b`

### Changed
- **桌面端 UI 增强** (2026-07-24)
  - 8 项 UI 增强：vendored openwiki & flutter skills
  - 提交: `bcba151`

- **Feature 路线图 v2** (2026-07-23)
  - 重写 Feature 路线图，8 个项目直接集成方案
  - 包含 CLI-Anything、openwiki、open-design
  - 提交: `2062418`

### Fixed
- **CodeGraph 修复** (2026-07-22)
  - 修复 Electron 中 codegraph init 命令拼接错误
  - 提交: `f51d16b`

- **桌面端修复** (2026-07-22)
  - 当前工作区始终显示在会话列表中
  - 提交: `821d97b`

- **macOS 修复** (2026-07-21)
  - 修复 macOS traffic light buttons 不可点击问题
  - 提交: `7e36b79`

## [0.1.0] - 2026-07-20

### Added
- 初始版本发布
- 终端 CLI（Ink TUI）
- Electron 桌面客户端
- VSCode 插件
- 核心引擎（LLM 会话循环、7 内置工具、上下文压缩）
- 扩展系统（Skills / MCP / 内置插件）
- 代码索引（CodeGraph MCP Server）
- 代码审查（Open Code Review 内置插件）
- 浏览器自动化（browser-skill 内置插件）
- 源码管理（Git 面板）
- 权限控制（细粒度 scope 策略）
- 会话持久化（跨会话恢复、归档、导出）
- 联网搜索（内置 WebSearch 工具）
- 多模态支持（图片粘贴/拖拽输入）

---

## 提交历史详录

### 2026-07-26
- `015162b` - docs: 更新 Feature 路线图 v2.1 + 官网交互优化
- `35fd032` - feat(desktop): 集成 Monaco Editor 代码编辑器模块

### 2026-07-25
- `18875b2` - docs: update README, GitHub Pages site, and add CI/CD workflows
- `5f8c537` - feat(gitmcp): 本地 GitMCP 模块完整实现 — 独立索引库 + 边缘快捷项 + MCP 权限控制

### 2026-07-24
- `bcba151` - feat(desktop): 8-item UI enhancement round + vendored openwiki & flutter skills

### 2026-07-23
- `2062418` - docs: 重写 Feature 路线图 v2 — 8 个项目直接集成方案（含 CLI-Anything/openwiki/open-design）
- `005bf33` - docs: 修正 Feature 路线图 — 5 个项目定位为直接集成而非参考
- `92fc182` - docs: 新增 Feature 规划路线图 — 5 个开源项目集成调研 + 近期开发计划
- `00a3b83` - docs: 更新 README — 当前功能全景 + Feature Roadmap（近期开发 + 后期特性）

### 2026-07-22
- `99051a3` - feat(desktop): integrate Open Code Review plugin + code review panel; Glass Prism theme; research docs
- `809324d` - feat: GitHub Pages 官网 + 修复 readSkillDoc ENOENT
- `f51d16b` - fix(codegraph): 修复 Electron 中 codegraph init 命令拼接错误
- `821d97b` - fix(desktop): 当前工作区始终显示在会话列表中
- `5d2d0d6` - feat(desktop): 深化 UI 组件交互与 core 能力整合 (v12-v22)

### 2026-07-21
- `7e36b79` - fix(desktop): fix macOS traffic light buttons not clickable
- `92b0d76` - merge: integrate main branch (index reset + visualization + compaction model) into qoder
- `0bc7713` - feat: fix index reset, add visualization pipeline, and use fixed compaction model
- `dd9cc03` - fix(desktop): harden BuiltinPluginDetail IPC calls
- `622d732` - feat(desktop): chat rendering revamp — avatars, entry animation, responsive margins
- `a569ac9` - fix(i18n): keep deepcode-self-refer name as "Deep Code" to match skill doc
- `144a500` - feat(desktop): toylike context-progress bar with two-decimal readout
