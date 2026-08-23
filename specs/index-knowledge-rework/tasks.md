# 索引与知识模块重构 — 任务清单

> 对应设计：[design.md](./design.md)。2026-08-23 梳理立稿，未实施。
> 梳理结论先行：本模块 = 工作区中心 + 一键串行构建 + 三项产出物（符号/Wiki/架构图）+ AGENTS.md 入口；memory 与 routing 不属于本模块。

## T1 修 openwiki ENOENT（独立，先行）

- [ ] T1.1 `scripts/vendor-openwiki.js` 拷贝列表 `["dist", "package.json"]` → 加 `"skills"`（目录存在守卫：npm 包 files 声明含 skills；不存在则报错拒绝写 broken vendor）
- [ ] T1.2 `npm run desktop:build` 触发 `--force` 重建 vendor/openwiki；验证 `vendor/openwiki/skills` 存在且 `wiki.init` 端到端跑通
  - 根因记录：`dist/agent/skills.js` 以 `resolve(dist/agent, "../../skills")` 定位捆绑技能 → vendor 根的 skills/；vendor 脚本漏拷

## T2 arch-scan 静默化（消除对话行为泄漏）

- [ ] T2.1 `runSubagent` 增加 `silent` 语义（结果只回传调用方，不注入主会话消息流）；`index-build.ts` stage 3 传 `silent: true`
- [ ] T2.2 面板显示构建分段状态与失败原因（stage 3 失败不再只出现在会话里）
- [ ] T2.3 架构图生成质量排查（ENOENT 修复 + 静默化后实测 arch-scan 产物；生成失败/空图的具体原因记录留痕）

## T3 左列表 + 右内容区 tab 重构

- [ ] T3.1 左侧 `IndexLibraryPanel` 重构：**只列工作区**（条目含汇总状态/上次构建）+ 底部「构建索引与知识」按钮（作用于选中工作区；`index.build-all` 串行 符号→Wiki→图，失败即停显示错误）
- [ ] T3.2 内容区顶部 tab 系统：点击左侧工作区 → 按需生成「索引与知识」tab（与任务历史 tab 同级并列，复用/泛化 `ui-tasktab` 机制；主 tab = 会话任务工作区，常驻不可关闭；每工作区至多一个知识 tab，可 × 关闭）
- [ ] T3.3 知识 tab 内部三子 tab：**Wiki**（页面列表，点开→编辑器）/ **AGENTS**（AGENTS.md 展示/编辑）/ **架构图**（图列表+子 tab 内预览）；符号索引不设子 tab（状态在左侧条目）
- [ ] T3.4 移除 memory / routing / serena 卡片及其内嵌 UI（L0-L3 分解、语义搜索框）
- [ ] T3.5 **命名红线**：全部 UI 文案去引擎名——"OpenWiki"→"Wiki"，"CodeGraph"→"符号索引"（进度消息、按钮、状态、空态文案同此；现有 i18n `index.*` 键全量审计替换）

## T4 状态接口拆分

- [ ] T4.1 ipc `KnowledgeStatusResponse` 收敛为 `codegraph / openwiki / agents / archmaps`（archmaps 新增：扫描架构图产物目录）
- [ ] T4.2 memory 状态移至记忆域既有接口；routing 观测移至诊断/命令面板查询；主进程 `getKnowledgeStatus` 相应收敛
- [ ] T4.3 i18n 六语言：面板新文案（产出物名称/构建按钮/分段进度/失败提示），删除 memory/routing 卡片文案

## T5 产出物点开通路（子 tab 内）

- [ ] T5.1 Wiki 页列表数据源（openwiki 目录页面枚举 + 标题/新鲜度）；点击接 `onOpenFile`（App 级通路）
- [ ] T5.2 AGENTS.md 子 tab 展示/编辑
- [ ] T5.3 架构图 HTML 文件枚举 + 子 tab 内预览（实施时评估与右侧 dock 单槽的互斥取舍，倾向内嵌）

## 验收门

- [ ] 一键构建：符号→Wiki→图 串行完成，全程零主会话消息，面板分段进度可见，失败显示错误并停止后续段
- [ ] openwiki init/update 端到端成功（skills ENOENT 消除）
- [ ] Wiki 页 / AGENTS.md 点击在编辑器打开；架构图点击在右侧预览
- [ ] 面板无 memory/routing/serena 卡片；模块呈现 = 工作区卡片 + 产出物
- [ ] npm run check && npm test 全绿
