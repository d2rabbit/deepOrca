# Android Development Kit — 任务指引（规划中）

> 日期：2026-08-18 文档整顿建立 · 状态：**规划中（P0 未开工，属冻结期外 `next/*` 范畴）**
> 阶段模型：**预研 → 设计 → 任务**，三层在当前树内可查（无外部仓库依赖）：
>
> | 层 | 文档 | 现状 |
> | --- | --- | --- |
> | 预研 | `docs/features/feature-roadmap.md` §三（四平台范式对比）+ 2026-07-29 立项调研（路线图 v3.2 版本日志） | ✅ 完成 |
> | 设计 | [`design.md`](./design.md)（预研与设计合一稿：官方 CLI-first 三件套洞察、架构、触发条件、插件中心展示） | ✅ 定稿 |
> | 任务 | **本文件**（2026-08-18 由 design.md §5 改动清单抽离） | ⏳ 待开工 |

## 预研结论摘要

Android 官方 Agent 工具链 = **三件套**：`android/skills`（14 个第一方 SKILL.md）+ **Android CLI**（CLI-first，对标 deveco-cli）+ `android/docs` 本地文档检索。DeepOrca 集成形态 = 构建 Skills（脚本拉取）+ Skill 教 Agent 用 bash 调用 `android` 命令。详见 design.md §1/§2。

## 任务清单（自 design.md §5 抽离，P0/P1）

- [ ] **A1** `scripts/install-android-skills.js` 新建——构建时从 `android/skills` 拉取 14 个 Skill（P0）
- [ ] **A2** `packages/core/templates/skills/bundled/android-*/` 拉取的 skills（gitignored，构建时生成）（P0）
- [ ] **A3** `packages/core/templates/builtin-plugins.json` 新增 "Android Development" 分组（P0）
- [ ] **A4** i18n（messages.ts + locales）：`builtin-plugin.android-dev.name/desc`（P0）
- [ ] **A5** 根 `package.json` 构建脚本 `prebuild` 挂载 `install-android-skills.js`（P1）

**明确不做**（design.md §5 附注）：自研 MCP server（CLI 足够）、vendor Android SDK（走用户本机安装）、复写 14 个 skill（原样拉取官方内容）。

## 开工前置条件

- 预生产冻结解除或 `next/*` 分支立项；移动域整体回归窗口（同域 HarmonyOS/RN/Flutter 同样临时下线于 `f680c14`，回归宜同批评估）。
- 验收：构建后 Android 技能包进插件中心分组展示；Agent 会话内可经 bash 调用 `android` 命令创建/模拟/截图（design.md §7）。
