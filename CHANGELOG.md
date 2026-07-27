# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### ✨ 新功能

- **Monaco Editor 集成** (2026-07-26, `35fd032`)
  - 集成 Monaco Editor 代码编辑器模块到桌面客户端
  - 支持代码编辑、语法高亮、智能提示
  - 提升代码编辑体验和开发效率

- **GitMCP 本地模块** (2026-07-26, `5f8c537`)
  - 完整实现本地 GitMCP 模块
  - 独立索引库 + 边缘快捷项 + MCP 权限控制
  - 基于 SQLite FTS5 全文索引，BM25 排序
  - 4 个内置工具：fetch_documentation、search_documentation、search_code、fetch_url_content
  - 提供强大的代码搜索和文档获取能力

- **Open Code Review 集成** (2026-07-25, `99051a3`)
  - 集成 Open Code Review 插件 + 代码审查面板
  - 新增 Glass Prism 主题
  - 提供代码审查和质量分析能力

- **GitHub Pages 官网** (2026-07-24, `809324d`)
  - 创建 GitHub Pages 官网
  - 提供项目文档和介绍

- **DeepOrca 品牌重塑** (2026-07-23, `c89bf67`)
  - 对外文案品牌替换为 DeepOrca
  - 设置面板新增「关于」Tab（包含更新日志）
  - 明确项目定位：DeepOrca 只提供桌面客户端版本

- **聊天渲染改进** (2026-07-23, `622d732`)
  - 新增头像显示
  - 添加入场动画效果
  - 优化响应式边距

- **上下文进度条** (2026-07-23, `144a500`)
  - 添加玩具风格的上下文进度条
  - 支持两位小数读数
  - 实时显示上下文使用情况

- **本地化文档** (2026-07-23, `5bbb089`)
  - 本地化内置插件/技能文档（中文 .zh.md）
  - 提升中文用户体验

- **可折叠工具卡片** (2026-07-23, `8f2912a`)
  - 可折叠 bash/cli 工具卡片
  - 头部显示结果提示
  - 优化工具执行结果展示

- **插件模块重构** (2026-07-23, `b2fb598`)
  - 内置插件分组显示
  - 精简插件列表
  - 重新设计插件详情页

### 🎨 优化改进

- **自迭代性能与稳定性优化** (2026-07-27)
  - 消息 Markdown 渲染结果缓存 + 消息组件 memo 化，长会话与空闲时 CPU 占用显著下降
  - 加载动画心跳仅在任务进行中运行；流式输出期间侧边栏刷新节流至 1.5s/次
  - IPC 错误统一归一化；启动/切换工作区失败不再静默卡死，错误直接展示在输入区
  - 代码审查/Wiki 后台进程随应用退出自动终止；复制反馈计时器卸载时清理
  - runPrompt 尾部 IPC 并行化；Wiki 目录读取改为静态导入
  - 设置面板变更日志新增 v0.5.0 / v0.6.0 条目

- **官网交互优化** (2026-07-26, `015162b`)
  - 添加 CSS 呼吸动画效果（grid-breathe、glow-pulse）
  - 实现导航栏滚动隐藏/显示交互
  - 添加 IntersectionObserver 滚动动画
  - 优化用户体验和视觉效果

- **桌面端 UI 增强** (2026-07-26, `bcba151`)
  - 8 项 UI 增强
  - vendored openwiki & flutter skills
  - 提升整体用户体验

- **桌面端 UI 深化** (2026-07-24, `5d2d0d6`)
  - 深化 UI 组件交互与 core 能力整合 (v12-v22)
  - 优化组件交互逻辑

- **Fusion 主题优化** (2026-07-23, `0231517`)
  - 使 Fusion 玻璃效果为磨砂，而非透明
  - 提升视觉效果

- **索引轨道图标优化** (2026-07-23, `1aa8998`)
  - 使用单色 ☷ 作为索引轨道图标
  - 统一图标风格

- **Fusion 顶栏徽章优化** (2026-07-23, `2d5b56f`)
  - 移除 Fusion 顶栏徽章的强调色背景
  - 简化视觉设计

### 🐛 问题修复

- **CodeGraph 修复** (2026-07-24, `f51d16b`)
  - 修复 Electron 中 codegraph init 命令拼接错误
  - 解决代码索引功能异常问题

- **桌面端修复** (2026-07-24, `821d97b`)
  - 修复当前工作区始终显示在会话列表中的问题
  - 提升工作区管理体验

- **macOS 修复** (2026-07-23, `7e36b79`)
  - 修复 macOS traffic light buttons 不可点击问题
  - 解决窗口控制按钮失效问题

- **索引重置修复** (2026-07-23, `0bc7713`)
  - 修复索引重置问题
  - 添加可视化管道
  - 使用固定压缩模型

- **IPC 调用加固** (2026-07-23, `dd9cc03`)
  - 加固 BuiltinPluginDetail IPC 调用
  - 提升系统稳定性

- **i18n 修复** (2026-07-23, `a569ac9`)
  - 保持 deepcode-self-refer 名称为 "Deep Code" 以匹配技能文档
  - 解决国际化文本不一致问题

- **索引图标修复** (2026-07-23, `6b2bfaa`)
  - 修复索引图标显示问题
  - 解决当前目录被注入为空工作区的问题

### 📝 文档更新

- **README 重构 + CHANGELOG** (2026-07-27, `e48de0a`)
  - 新增 CHANGELOG.md，记录所有重要变更和提交历史
  - 重构 README.md，以 DeepOrca 项目名重新定位
  - 突出项目现状和发展路线图
  - 将原 README 作为子项引入（README-deepcode-cli.md）

- **Feature 路线图 v2.1** (2026-07-26, `015162b`)
  - 新增 Penpot vs Open Design 对比分析（选择 Open Design）
  - 新增 Obscura 轻量级无头浏览器集成方案
  - 标记已集成项目（flutter/agent-plugins、openwiki、codegraph）

- **GitHub Pages 官网 + CI/CD** (2026-07-26, `18875b2`)
  - 更新 README、GitHub Pages 站点
  - 添加 CI/CD 工作流

- **Feature 路线图 v2** (2026-07-25, `2062418`)
  - 重写 Feature 路线图，8 个项目直接集成方案
  - 包含 CLI-Anything、openwiki、open-design

- **Feature 路线图修正** (2026-07-25, `005bf33`)
  - 修正 Feature 路线图：5 个项目定位为直接集成而非参考

- **Feature 规划路线图** (2026-07-25, `92fc182`)
  - 新增 Feature 规划路线图：5 个开源项目集成调研 + 近期开发计划

- **README 更新** (2026-07-25, `00a3b83`)
  - 更新 README：当前功能全景 + Feature Roadmap（近期开发 + 后期特性）

---

## 提交历史详录

### 2026-07-27
- `e48de0a` - docs: 重构 README + 新增 CHANGELOG

### 2026-07-26
- `015162b` - docs: 更新 Feature 路线图 v2.1 + 官网交互优化
- `35fd032` - feat(desktop): 集成 Monaco Editor 代码编辑器模块
- `18875b2` - docs: update README, GitHub Pages site, and add CI/CD workflows
- `5f8c537` - feat(gitmcp): 本地 GitMCP 模块完整实现 — 独立索引库 + 边缘快捷项 + MCP 权限控制
- `bcba151` - feat(desktop): 8-item UI enhancement round + vendored openwiki & flutter skills

### 2026-07-25
- `2062418` - docs: 重写 Feature 路线图 v2 — 8 个项目直接集成方案（含 CLI-Anything/openwiki/open-design）
- `005bf33` - docs: 修正 Feature 路线图 — 5 个项目定位为直接集成而非参考
- `92fc182` - docs: 新增 Feature 规划路线图 — 5 个开源项目集成调研 + 近期开发计划
- `00a3b83` - docs: 更新 README — 当前功能全景 + Feature Roadmap（近期开发 + 后期特性）
- `99051a3` - feat(desktop): integrate Open Code Review plugin + code review panel; Glass Prism theme; research docs

### 2026-07-24
- `809324d` - feat: GitHub Pages 官网 + 修复 readSkillDoc ENOENT
- `f51d16b` - fix(codegraph): 修复 Electron 中 codegraph init 命令拼接错误
- `821d97b` - fix(desktop): 当前工作区始终显示在会话列表中
- `5d2d0d6` - feat(desktop): 深化 UI 组件交互与 core 能力整合 (v12-v22)

### 2026-07-23
- `7e36b79` - fix(desktop): fix macOS traffic light buttons not clickable
- `92b0d76` - merge: integrate main branch (index reset + visualization + compaction model) into qoder
- `0bc7713` - feat: fix index reset, add visualization pipeline, and use fixed compaction model
- `dd9cc03` - fix(desktop): harden BuiltinPluginDetail IPC calls
- `622d732` - feat(desktop): chat rendering revamp — avatars, entry animation, responsive margins
- `a569ac9` - fix(i18n): keep deepcode-self-refer name as "Deep Code" to match skill doc
- `144a500` - feat(desktop): toylike context-progress bar with two-decimal readout
- `5bbb089` - feat: localized built-in plugin/skill docs (Chinese .zh.md)
- `8f2912a` - feat(desktop): collapsible bash/cli tool cards with result hint in header
- `b2fb598` - feat(desktop): revamp plugin module — built-in grouping, leaner list, detail redesign
- `c89bf67` - feat(desktop): rebrand to DeepOrca + add About/Changelog settings tab
- `1aa8998` - style(desktop): use monochrome ☷ for index rail icon
- `6b2bfaa` - fix(desktop): distinct index icon + don't inject cwd as empty workspace
- `2d5b56f` - style(desktop): drop accent tile backgrounds from Fusion topbar badges
- `0231517` - fix(desktop): make Fusion glass frosted, not see-through
