# 当前版本收官计划 — 预生产切换（Pre-production Closeout）

> 日期：2026-08-17 · 状态：**定稿（本版本最终计划）**
> 分支基线：`feat/sandbox-p0-path-gate`（承载全部现代历史；dev tip `1f5146e` 是本分支祖先，合并可 fast-forward）
> 性质：**收官范围冻结计划**。本计划全部完成 = 当前版本功能开发结束，正式进入**首次预生产测试阶段**。
>
> 铁律（2026-08-17 项目所有者确立）：
> 1. 本计划是当前版本**最后一批功能扩展**；此后仅允许 修复（fix）/ 优化（perf）/ 功能闭环（完成本计划已立项条目）/ 文档与测试，不再新增能力。
> 2. **Router 模块是 MCP/技能选择的核心与唯一权威**。dsh 借鉴中的"工具序确定性"只在 router 输出层做稳定化与守护测试，**绝不以静态全局排序（toolOrder）替代或绕过 router**（G1 短名单 / G2 服务级路由 / G3 compose / RoutingFacade 会话级冻结决策的架构地位不变）。
> 3. 调研仅供参考（`docs/research/`），正式实现以 `specs/` 为准——本计划即为各调研落点的正式立项。

---

## 一、目标与出口

| # | 目标 | 出口标准 |
| --- | --- | --- |
| G1 | 完成六个功能工作流（A-F） | 各自验收全过（见 tasks.md） |
| G2 | 全域能力扫描通过 | 扫描报告全绿或挂账项均有处置；`npm run check && npm test` 全绿；`desktop:build`+`desktop:start` 真机烟雾通过 |
| G3 | 文档与仓库清理完成 | 作废/被取代文档归档、状态行回写、roadmap/CHANGELOG 终版对齐、无构建产物/会话垃圾入库 |
| G4 | 预生产切换完成 | 当前分支锁定 → 合并 dev（--no-ff 界碑 + tag）→ 冻结策略生效 |

## 二、总体结构与依赖

```
并行批 1（互不阻塞，可多线推进）:
  A skill-up CI ──┐
  B book-distill ─┼── A/B/C 同批（2026-08-17 已拍板并行）
  C GitMCP 增强 ──┘
  D dsh 理念深化（内部有序: P1-1 → P1-2 → P1-4 → 前缀收尾包; 与 A/B/C 文件面基本不重叠）
  E designer 增强（E1 dembrandt 品牌摄取 / E2 进化设计; 与 D 不重叠）
  G 文档清理（低风险，随时并行）

串行收尾:
  F 全域能力扫描（依赖 A-E 全部合入）
  H 预生产切换（依赖 F 通过）
```

工作量估算（人日，供排期参考）：A 3–4 · B 1–2 · C 2–3 · D 4–5 · E1 2–3 · E2 1 · F 2–3 · G 1 · H 0.5–1。合计 **约 17–23 人日**。

---

## 三、工作流详设

### A. skill-up CI（技能质量可回归）

依据：`specs/skill-eval/design.md` + 已排期的 `specs/skill-eval/tasks.md`（S1 CI 集成 → S2 自定义引擎；S3 不排期）。
要点重申：skill-up 二进制固定版本（不走 go install latest）；PR report-only + nightly 全量含 slow；rule_based/script 裁判为主、离线可重放；8 个内置插件包 evals 骨架（design.md 原文写 7，实为 8：vision 为后增）；S2 适配器用 @deeporca/core 直建 SessionManager、mkdtemp 隔离、120s 上限。

### B. book-distill（skillweaver P2）

定位：**纯 skill 层实现，零新代码依赖**——把书籍/长文档蒸馏为结构化 agent 技能的方法论技能。
- 新增 `packages/core/templates/plugins/knowledge/skills/book-distill/SKILL.md`（+ references/）：输入源评估（版权注意：只处理用户自有/合规内容）→ 章节地图 → 分批抽取（能力卡：触发条件/步骤/反模式）→ 去重合并 → 生成目标技能（SKILL.md + references/ 子文档）→ 自检（frontmatter 完整性、触发描述质量、体积预算）。
- 产物技能落 `~/.deeporca/skills/`（用户技能目录），不自动进内置。
- 与 A 的闭环：book-distill 产出的技能天然成为 skill-up 被测对象；为 book-distill 自身写 ≥3 条 evals 用例（正/反/边界）。
- 与 routing 的闭环：蒸馏产物的 `description` 质量直接影响 G1 短名单召回——SKILL.md 中写明"触发描述面向嵌入召回优化"的约束（多语关键词、场景化措辞）。

### C. GitMCP 四项增强（已核对，全部可行）

落点：`packages/desktop/src/main/tools/gitmcp/{tools,github,indexer}.ts`（工具从 4 → 8）：
1. `get_repo_structure`——GitHub trees API，目录树（深度/路径过滤，输出 token 预算封顶）；
2. `read_file`——raw.githubusercontent 读取任意文件（二进制嗅探拒绝、大小上限、host 白名单仅 github raw 域）；
3. docs 多文件索引——文档源从"根目录三选一（llms.txt→README）"扩展为 docs/ 目录发现 + 多文件分块入 BM25 索引（复用现有 store/chunk 机制）；
4. `outline`——已索引文档的标题大纲抽取（chunk.heading 已有，聚合即可）。
约束：保持 zod/v3 兼容写法（SDK 1.22 校验契约，见 tools.ts 头注释）；`fetch_documentation` 语义向后兼容（旧调用行为不变）；离线缓存路径不破坏；单仓库缓存体积上限与既有 store 一致。
测试：8 工具单测 + 离线缓存回退用例。

### D. dsh 理念深化（候选池核心 4 项，按整合台账推荐顺序）

依据：`docs/research/2026-08-17-dsh-consolidated.md`（唯一台账）。既有零件可复用：converter `interrupted` 元数据（P1-1 渲染层已有）、compactSession endIndex 前扫跳过 tool 消息（P1-2 END 侧已有软化保护）。

1. **P1-1 崩溃合成收尾**（正确性，最高优先）：在途 tool call 落盘合成结果——无 call 补 `TOOL_NOT_STARTED`、无 result 补 `TOOL_OUTCOME_UNKNOWN`；resume 不再实际重放 trailing pending（`session.ts:3474/:3756` 现行注释语义反转）；系统提示教模型"只重试只读/幂等操作"。保留 settings 开关兜底旧行为（默认新语义），存量会话兼容测试。
2. **P1-2 两段式 compaction**：超阈值先 model-free 预剪（tool-result 截断占位 + 摘要提示），重计量仍超才 LLM 摘要；切割边界加显式 call/result 配对断言（START 侧补齐，END 侧已有前扫）；**#11 前缀回放为决策点**——摘要固定 flash 而缓存按模型隔离，仅主模型为 flash 的会话受益，默认**不做**回放、记录决策（要改另议）。
3. **P1-4 beforeToolExecution 轻量钩子**：core 内数组式同步 listener 注册表（allow/ask/deny），权限检查为第一个内建 listener；与现有 `ToolExecutionHooks`（固定生命周期回调）并存不混淆。**执行层设施，位于 router 决策之后**，不参与工具选择。
4. **前缀守恒收尾包**：`prompt.ts` 段落 order 显式化；**router 输出字节一致性守护测试**（同一 MCP 集合、不同发现顺序 → 冻结输出逐字节一致——测 RoutingFacade+mcp-manager 排序的组合输出，而非引入全局 toolOrder）；#18 残余——desktop 用量面板拆出 cache_read 维度（core `getCacheReadTokens` 已具备取数）。

**⚠️ Router 红线（本工作流的验收否决项）**：任何实现不得引入绕过 SkillRouter/ToolRouter/RoutingFacade 的静态工具排序或白名单；确定性只允许存在于 router 输出之后（post-routing stabilization）与测试断言中。评审时按此检查。

### E. designer 模块增强

**E1 dembrandt 品牌摄取**（依据 `docs/research/2026-08-17-external-repos-prestudy.md`，MIT）：
- builtin MCP：`augmentMcpServersWithBuiltins`（`session.ts:1536`）注册 pinned `npx -y --package dembrandt@<pin> dembrandt-mcp`，core 只留 disable-gate + spawn 配置（desktop 注入），同 serena 模式。
- action：`actions/design.ts` 扩展 `design.extract`（URL → tokens/DESIGN.md，经 `ctx.spawner` 调 CLI `--json-only`）与 `design.drift`（基线对比，可直用其纯函数子包 drift/findings——零浏览器依赖，desktop 侧引入）。
- 闭环：`design.extract` 产物写入 `.deeporca/DESIGN.md` 品牌契约 + tokens 进 design-store——**正好补上 deep-design Step 0 品牌契约的自动化来源**；`design.drift` 作为 review 维度（确定性、零 LLM）。**2026-08-21 决策回写（specs/ui-domain-regroup）**：drift 的 **UI 落位由 review 面板改为设计面板**（DesignPanel，推翻 E1d 落位），action 归属与语义不变。
- 约束：输出目录过 `gateWrite`/PathGrant + audit bus（沙箱分支规约）；不单独 vendor Chromium（复用 browser-skill 浏览器或按需下载）；自研任何抓取包装层必须校验 host、拒绝 localhost/环回/私有/保留地址（SSRF 防线）；license 门禁（MIT 通过）；网络失败 best-effort 降级（vendoring 惯例）。

**E2 进化设计**（依据 `docs/research/2026-08-17-opendesign-openpencli-vs-designer.md`，纯 prompt/模板层，零新依赖）：
1. 内置设计系统预设扩充（P1）：`templates/plugins/design/` 增加精选 tokens 化 DESIGN.md 预设（现 3 套 → 目标 8–10 套），deep-design SKILL.md 系统选择表同步扩容；
2. taste 五维自评 + anti-slop（P2）：`taste/SKILL.md` 增加生成后五维评分卡（对照 dembrandt findings 精神）与"与 designs/ 近期产物比对防雷同"检查项；
3. 大页面两段式生成（P2 内可选）：deep-design 工作流加"先 section 骨架后填充"可选步骤（SKILL.md 层，不动工具面）。
- A2UI 边界不动（全域动态 UI，不介入 designer，guard 测试已有）。

### F. 全域能力扫描（预生产回归门）

方法复用 2026-08-15 两轮审计的四层验证 + spec-gap 方法论，产出报告 `docs/pre-production-capability-scan.md`：
1. 静态基线：`npm run check`（typecheck+lint+format+license 门禁）+ `npm test` 全 workspace；
2. 专项套件：sandbox（path-gate/audit 链校验/policy 矩阵）、routing（G1-G3 + 字节一致性新测试）、session（P1-1/P1-2 新语义 + 旧开关兼容）、actions（27 个 action 三面到达：IPC/LLM 工具表/MCP）、gitmcp 8 工具、designer（extract/drift/预设）；
3. 接线核验：8 插件包技能加载、MCP builtin 全量起停（codegraph/serena/skillspector/a2ui/activity-frames/vision/dembrandt/gitmcp placeholder）、vendor 13 脚本产物齐、i18n 5 语言键完整、desktop:build 三 bundle + electron-builder extraResources；
4. 真机烟雾：`desktop:start`（Windows 必测；mac/linux 尽力）——会话创建→plan mode→工具调用→permission 门→design.materialize→review.full→任务树→重启恢复（验证 P1-1 新恢复语义）；
5. 逐 spec 对账：`specs/` 全目录（19 个 spec）实现状态终判，挂账项列入冻结期允许的"功能闭环"清单或显式推迟到下一版本。

### G. 旧文档清理（原则：归档不删除、状态必回写、决策留痕）

1. 归档 `docs/research/archive/`：作废 3 份（zread、memos、pi-sdk）+ 被整合取代的 dsh 原文 3 份（deep-dive/adoption-plan/takeaways，台账已取代）+ `STATUS-2026-08-07.md`；archive 内放一行 README 指回主索引；
2. 状态行回写：`2026-08-11-knowledge-memory-materialization-design.md`（"待实施"→已实施+提交号）、`specs/archive/activity-frames/design.md` boot context（"待评估"→已实现默认关）、其余以 `docs/research/README.md` 台账为准逐条核对；
3. 仓库垃圾：`.playwright-mcp/*.yml`（26 个会话快照）移出 git 追踪 + 入 .gitignore；根目录 `v7-strike.png` 处置（移 docs 或删，执行时定）；过时代码注释（App.tsx:41 / build.mjs:85 的 Monaco+Mermaid 残留）顺手清；
4. 终版对齐：`docs/features/feature-roadmap.md` 冻结版快照（标注预生产基线）、CHANGELOG 汇总本版本全部工作流、`docs/research/README.md` 索引同步；
5. 文档对（`*_en.md` 孪生）一致性抽查——只修事实性漂移，不做全文重译。

### H. 预生产切换（分支与冻结）

前置核对已确认：dev tip `1f5146e` 是当前分支祖先 → 合并无冲突（fast-forward 可行，仍用 `--no-ff` 留合并界碑）。
1. 全部工作流合入当前分支并通过 F 扫描 → `npm run release:version` 版本定格；
2. `git checkout dev && git merge --no-ff feat/sandbox-p0-path-gate` + push origin dev；打 tag `pre-production-baseline`；
3. **锁定**：feat 分支与 dev 进入冻结——允许的提交类型：`fix:` `perf:` `docs:` `test:` `refactor:` `build:` `chore:` + `feat:` 仅限 tasks.md 中标记"闭环"的挂账条目；新功能一律开 `next/*` 分支留待下一版本；
4. master 同步问题在预生产阶段结束时决策（dev 验证稳定后 fast-forward master 发首个预生产版）。

## 四、风险与对策

| 风险 | 对策 |
| --- | --- |
| dsh 排序实现越权替代 router | 铁律 2 + D 工作流验收否决项 + 字节一致性测试只测组合输出；评审清单明列 |
| P1-1 恢复语义变更破坏存量会话 | settings 开关兜底旧语义（默认新）；存量会话 fixture 兼容测试；F 层真机重启恢复用例 |
| dembrandt 网络/浏览器依赖引入脆弱性 | pinned npx + best-effort 降级；不 vendor Chromium；纯函数子包（drift/findings）为主，浏览器提取为可选 |
| skill-up CI LLM 费用 | flash 模型 + 每包 ≤10 条 + PR 增量 + report-only；nightly 才全量 |
| 合并前 dev 出现新提交 | H 前置核对步骤重复执行；出现分叉则先 rebase/二次评审 |
| 冻结期范围蠕变 | tasks.md 为唯一范围清单；新增需求一律进 `next/` 清单不进本计划 |

## 五、明确不做（本版本）

- ruflo 任何形式的依赖或 vendor（模式已由 task-tree P3 承接，P3 本身推迟到下一版本）；
- OpenDesign/OpenPencil 依赖引入（参考借鉴已兑现为 E2 的 prompt 层演进）；
- sunlogin 远程接入、cad-3d、OpenOPC、CLI-Anything、HTTP transport、S1 事件溯源、S2 waterfall 化——全部推迟到下一版本；
- task-tree P3（branch=subagent 载体）——冻结期不做新架构演进。
