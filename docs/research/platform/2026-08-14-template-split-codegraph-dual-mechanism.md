# 待办：模板拆分迁移 + CodeGraph 双机制修复

> **日期**：2026-08-14
> **状态**：待实施
> **前置**：SkillSpector 迁移、uv 离线集成、BrowserSkill/Bento actions、已知问题修复均已完成

---

## 一、模板拆分迁移（core/templates → desktop）

### 背景

当前 `packages/core/templates/` 包含 63 个文件，分为两类：

**core 自身基础设施**（应保留）：
- `templates/tools/`（7 个内置工具文档：bash.md, read.md.ejs, edit.md 等）
- `templates/prompts/`（plan.md, init_command.md.ejs）
- `templates/skills/karpathy-guidelines.md`（默认技能）

**产品级内容**（应迁移到 desktop）：
- `templates/plugins/`（7 组：browser/code/design/knowledge/memory/meta-skills/work，~50 文件）
- `templates/design/`（6 文件：3 设计系统 + UI 风格目录 + seed 模板 + layouts 参考）

### 方案

1. **移动文件**：
   - `core/templates/plugins/` → `desktop/src/main/templates/plugins/`
   - `core/templates/design/` → `desktop/src/main/templates/design/`

2. **加载机制改动**（controller-seam 模式）：
   - 新建 `core/prompt.ts` 中的 `configurePluginSkillsRoot(path)` / `getPluginSkillsRoot()`
   - 新建 `core/prompt.ts` 中的 `configureBuiltinPluginsRoot(path)` / `getBuiltinPluginsRoot()`
   - `session.ts` 的 `getPluginSkillRoots()` / `getBuiltinPluginsRoot()` 改为读取注入的路径
   - desktop boot 注入：`configurePluginSkillsRoot(join(__dirname, "templates", "plugins"))`

3. **vendor 脚本调整**：
   - `scripts/vendor-bento.js` 输出路径从 `core/templates/plugins/work/...` → `desktop/src/main/templates/plugins/work/...`

4. **package-desktop.js 调整**：
   - bento 的 vendorEntries 路径更新

5. **electron-builder.yml**：
   - 确认 templates 随 `extraResources` 或 app files 正确打包

### 风险

- `getExtensionRoot()` 当前解析为 core 包根目录——迁移后 plugin skills 在 core 的 templates 下不存在了
- 需要确保 dev 模式（tsx 源码树）和 packaged 模式（dist/）都能正确解析
- `karpathy-guidelines.md` 的硬编码加载路径（`DEFAULT_SKILL_TEMPLATES`）不受影响（保留在 core）

### 工作量

中等（~15 文件移动 + 3 个加载函数改造 + boot 注入 + vendor 脚本 + 打包验证）

---

## 二、CodeGraph 双机制修复

### 问题

`packages/desktop/build.mjs:244` 注释说 "CodeGraph: installed as npm dependency (@colbymchenry/codegraph) — no vendor script needed"，**不调用** `scripts/vendor-codegraph.js`。

但：
- `packages/desktop/vendor/codegraph/darwin-arm64/` 有完整二进制（~150MB：Node 24 + codegraph-kernel.node）
- `scripts/package-desktop.js` release 门控**要求** `vendor/codegraph/<arch>` 存在
- 全新 checkout 跑 `desktop:build` 不会填充 vendor/codegraph/，但 release 会失败

### 根因

CodeGraph 曾经有两个路径：
1. npm optional dependency（`@colbymchenry/codegraph` platform binaries）
2. vendor script 下载 GitHub Release 二进制

build.mjs 迁移到 npm 路径后注释掉了 vendor script 调用，但 package-desktop.js 的 release 门控仍然检查 vendor 目录。

### 方案选项

**方案 A（推荐）：统一到 npm 路径，删除 vendor 检查**
- `package-desktop.js` vendorEntries 删除 `codegraph` 条目
- 改为检查 `node_modules/@colbymchenry/codegraph` 存在
- 删除 `scripts/vendor-codegraph.js`（或保留为 fallback，不在 build 中调用）
- 清理 `vendor/codegraph/` 目录（gitignore）
- 更新 `core/common/codegraph.ts` 中的 resolver 移除 vendor fallback 路径

**方案 B：恢复 vendor 调用**
- `build.mjs` 恢复 `ensureVendored("codegraph", ...)` 调用
- 保持双路径（npm 优先 + vendor fallback）
- 代码更安全但冗余

### 工作量

小（~5 文件改动）

---

## 执行优先级

| 顺序 | 内容 | 工作量 | 优先级 |
|---|---|---|---|
| 1 | CodeGraph 双机制修复（方案 A） | 小 | P2 |
| 2 | 模板拆分迁移 | 中 | P3 |

---

## 不改动

- `templates/tools/` — core 自身的工具文档提示词
- `templates/prompts/` — plan mode + init command
- `templates/skills/karpathy-guidelines.md` — 默认技能模板
- Granite Embedding 包（共享基础设施）
- 已完成的所有迁移和 actions
