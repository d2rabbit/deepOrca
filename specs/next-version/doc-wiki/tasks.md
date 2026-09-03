# doc-wiki 任务清单 — 主线 D（D0 零基建 → D1 编译层 MVP → D2 检索/图谱/闭环）

> 日期：2026-08-19 · 状态：**规划（待 `next/*` 启动；冻结期不实施）**
> 依据：[design.md](./design.md)（净室红线 §2 / 架构 §3–§8 / D2 增量 §9）
> 前置：无硬前置——D0 两项完全独立；D1 建议待 D0 的 purpose 约定验证后启动。LLM 摄入
> 走辅助模型 flash 通道（对齐路线图 §十 辅助模型迁移方向）。

## 实施口径

- **许可**：llm_wiki（GPL-3.0）零代码继承；两步摄入/四信号/预算装配等均为思想借鉴，
  提示词与 schema 文本全部自研表述。
- **数据**：`<projectRoot>/.deeporca/docwiki/{purpose.md, raw/, wiki/, .metadata/}`；
  `.metadata/` 恒为可重建派生物；页面格式 = OKF frontmatter + `sources[]` 扩展。
- **分层**：引擎全落 `packages/core/src/docwiki/`（UI-free，LLM 经
  `configureDocwikiLlmRunner` 注入）；desktop 只做 IPC + 面板 + boot 接线。
- **铁律**：fail-open——runner 未注入/索引损坏/目录不存在一律降级跳过，绝不阻断会话
  与 `index.build-all`。
- D3（反向 MCP 暴露、PDF/DOCX/EPUB 多格式、Chrome 剪藏）**出本版范围**，见
  next-version-plan 主线 D 表。

## D0 零基建（独立，可先行）

- [ ] D0-1 purpose 注入：`session.ts` 仿 `getEffectiveProjectAgentsMdFile`
  （session.ts:4837 的三级解析模式）读取 `.deeporca/docwiki/purpose.md`，存在且非空时
  在 `createSession` 系统提示链（AGENTS.md 块之后）注入「项目知识意图」块；`prompt.ts`
  模板 + 单测（缺失/空文件不注入）
- [ ] D0-2 `kb-lint` skill（`templates/plugins/knowledge/skills/kb-lint/`）：教 agent 对
  `openwiki/` 与 `.deeporca/docwiki/wiki/` 页面做健康检查——矛盾断言、孤儿页（无入链）、
  被提及但缺页的概念、缺交叉引用——产出报告不自动改页（Lint 首版只读）

## D1 编译层 MVP

- [ ] D1-1 `docwiki/layout.ts` + `runner.ts`：目录结构保证、purpose 读取、
  `DocwikiLlmRunner` 接口与 configure/get 单例（仿 wiki-controller 注入惯例）
- [ ] D1-2 `docwiki/scanner.ts`：raw/ 递归扫描 + SHA256 缓存（`.metadata/hashes.json`），
  产出待摄入清单；单测覆盖未变更跳过/内容变更/文件删除三种迁移
- [ ] D1-3 `docwiki/queue.ts`：持久化串行队列状态机（落盘/启动恢复/重试 ≤3/取消/进度
  回调）；单测用 fake runner 跑崩溃恢复矩阵
- [ ] D1-4 `docwiki/pages.ts`：OKF + `sources[]` frontmatter 解析/序列化（gray-matter）；
  与 `actions/wiki.ts` 现有 OKF 读取约定对齐（泛化点记录到 design 开放问题）
- [ ] D1-5 `docwiki/ingest.ts`：两步摄入编排（Step1 分析 JSON → Step2 生成页面）+
  资料摘要页兜底 + `index.md`/`log.md`（`## [日期] ingest | 标题` 前缀）更新 +
  `overview.md` 重生成；提示词自研（分析/生成两模板落 `templates/docwiki/`）
- [ ] D1-6 删除级联：三重匹配（sources[]/摘要页名/章节引用）+ 共享实体保护（数组移除
  而非删页）+ index 条目与失效 wikilink 清理；单测覆盖共享实体不误删
- [ ] D1-7 actions：`docwiki.ingest` / `docwiki.read-page`（defineAction 静态注册，
  LLM/MCP/IPC 三面）；`index.build-all` 增第四阶段（未配置时 skipped 不失败）
- [ ] D1-8 desktop 接线：`shared/ipc.ts` 增 `docwiki:ingest/status/listPages/readPage`；
  main boot 注入 runner（secondary flash client）；`knowledge:status` 增第七源；
  `IndexLibraryPanel` 第七源卡（导入入口 + 队列进度，复用 `event:actionProgress`）
- [ ] D1-9 集成测试：临时目录全链（导入两文件 → ingest → 页面/index/log 产物断言 →
  删一文件 → 级联清理断言），fake runner 零网络

## D2 检索 / 图谱 / 闭环

- [ ] D2-1 `docwiki/store.ts` + `search.ts`：`SearchBackend` 抽象 + `Fts5Backend`
  （node:sqlite，仿 gitmcp store.ts）；`docwiki.search` action（FTS5 起步）
- [ ] D2-2 `docwiki/graph.ts`：解析 `[[wikilink]]` + `sources[]` 重叠构建邻接表
  （`.metadata/graph.json`）；两信号边权（直接 3.0 / 来源重叠 4.0）
- [ ] D2-3 检索图扩展：search 结果为种子 2 跳衰减遍历，合并排序；`VecBackend` 可选
  （复用 routing embedding 单例，不可用退化为 FTS5+图）；预算装配（默认 8K token，
  编号引用）；单测覆盖预算截断与回退路径
- [ ] D2-4 `docwiki.insights.ts` + `docwiki.graph`/`docwiki.insights` actions：孤儿页
  （度 ≤1）/ 桥接节点（跨 type 边 top）/ 稀疏域（tags 聚合互链密度近似）；Louvain
  留观察项不引入依赖
- [ ] D2-5 `docwiki/review.ts` + IPC（`docwiki:reviewList/reviewResolve`）+ 面板审核 tab：
  Step1 审核项落 `.metadata/review.json`，预定义操作 create-page|research|skip
- [ ] D2-6 `docwiki-qa` skill：镜像 `wiki-qa` 形态（先 search 后 read-page 的消费纪律）
- [ ] D2-7 `docwiki-research` skill：insights + overview + purpose → 生成研究主题 →
  `AskUserQuestion` 可编辑确认 → 内置 WebSearch/WebFetch 循环 → 结果落
  `raw/research/` 自动入队摄入（闭环复用 D1 队列）
- [ ] D2-8 回写：design.md 状态行、`docs/features/feature-roadmap.md` §0 终判表与
  §二 状态、`docs/spec-open-items-status.md` 台账（若立条目）
