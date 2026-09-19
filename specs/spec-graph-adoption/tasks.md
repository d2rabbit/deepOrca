---
type: tasks
status: active
parent: spec-graph-adoption
---

# Spec 图谱与前置设计轨 — 任务清单

> 对应设计：[design.md](./design.md)。上游输入：JetBrains ThinkRail 仓库研究（借思想不引代码）。
> **实施状态（2026-09-19 一步到位落地）**：P0/P1/P2/P4 全部落地；P3 经 T3.0 核对走**降级路线**（登记锚点）落地；T1.3 验收走查按 R4 水位留待真实特性使用时执行。
> 粗估：P0 1 天 / P1 0.5 天 / P2 1.5 天 / P3 2 天 / P4 1 天（合计 6 天内；P3 受 T3.0 核对结果影响，降级方案下回落至 1 天）。
> 硬约束速查（全文见 design.md §2）：知识轨零改动（drift 只读）· 产品原型轨流程保持 · 不新增内置工具 · 不进 knowledge-ipc · core 无 UI 依赖 · **本仓库根 specs/ 零触碰** · `.deeporca/designs` 存量原地归档。

## P0 Spec 域读模型（core，pi-free，扫描根 `<root>/.deeporca/specs/`）

- [x] T0.1 **frontmatter 解析与 schema**：`packages/core/src/specs/` 新模块——YAML 解析（容错：坏 frontmatter 降级为散文节点不炸索引）、封闭词表校验（`type`: product-design / architecture / design / tasks；`status` 枚举）、tasks.md 派生 id `<dir>#tasks`。barrel 导出为唯一公共面。
- [x] T0.2 **SpecIndex**：按 root（cwd）键控的单例；(mtimeMs, size) 增量重校验（改/增/删三态）；集合实际变化才重建图；`listSpecs` / `getSpecGraph`（含 drift 徽标数据位，P4 填充）/ `validateSpecs` 三个纯读入口。
- [x] T0.3 **单测**：增量重校验三态、**链接完整性（parent/depends-on 指向存在节点，悬空指向 = error）+ 独立 architecture 节点合法（仅 info 提示，拍板⑦）**、id 唯一、tasks parent 指向同目录设计节点、`artifacts` 路径存在性（warn 级）、坏 YAML 容错、目录缺失返回空图。关键路径 mutation-check 一次（临时破坏实现确认测试变红再还原）。
- [x] T0.4 **fixture dogfood**：测试夹具构造 `.deeporca/specs/` 样本树（≥2 套件成链 + 1 独立架构节点（合法，validate 仅 info）+ 1 坏 frontmatter），全链路读：索引 → 图 → validate 输出。**不触碰本仓库根 `specs/`**（design.md §2-7）。

## P1 spec-navigator 技能（meta-skills 插件）

- [x] T1.1 `templates/plugins/meta-skills/skills/spec-navigator/SKILL.md`：frontmatter 字段导航法（grep `parent:`/`depends-on:`/`artifacts:` 沿设计链找上游）；「spec 是 ground truth——动边界先改 spec、动完对账 + 读 drift 徽标」规则写入技能正文；含降级路径（无 `.deeporca/specs/` / 无 frontmatter 节点时如实说明并继续）。
- [x] T1.2 description 只写触发条件（"Use when 着手特性工作/需要找产品设计决策或技术设计边界/改动涉及既有设计"），不摘要步骤。
- [ ] T1.3 验收走查：一次真实特性工作中人工观察 agent 按技能定位设计链上游与对账锚点（R4 水位，不设自动门）。

## P2 Specs 面板 + 独立 IPC 面

- [x] T2.1 `shared/ipc.ts` 增 `SpecsGraph` / `SpecsOpen` 通道常量与类型（契约先改，两端接线）。
- [x] T2.2 **新文件** `main/specs-ipc.ts`：两个 handler，读 `<root>/.deeporca/specs/`，复用 `resolveRegisteredRoot()` 守卫；未注册 root / 目录缺失降级空图（R2）。**不得**进 `knowledge-ipc.ts`（design.md §2-5）。
- [x] T2.3 renderer Specs 侧栏组：以设计链为主轴的树（product-design → architecture）+ status/drift 徽标（语义 token 配色）；**独立节点（无上游）呈现为独立入口，不归入任何链**（拍板⑦）；打开节点复用现有文件打开通道；空态引导文案。
- [x] T2.4 i18n：新增 `MessageKey` 全量 6 语种（en/zh/zh-tw/zh-hk/ja/ko，typecheck 强制）。
- [x] T2.5 渲染测试（dom-harness + api-stub，先装 DOM 再动态 import）：链式树渲染 / 空态 / 徽标 / 未注册 root 空图；mutation-check 一次。

## P3 设计链落点迁移（单一事实源；design.md §1.5 + §0.2 对账）

- [x] T3.0 **前置核对（阻塞门，不定稿不写代码）**：核对 `executeA2ui("save_suite_arch")` 实际落盘、spec-writer 的 PRD 保存路径、套件版本集结构与版本批准钩子、slug 规则；**二选一定稿**——完整迁移（PRD + 技术架构均搬家，读写源全迁）vs 降级方案（技术架构先行入图、PRD 以 frontmatter 引用登记套件存储路径）。核对结论回写 design.md §3 R1/R5。
- [x] T3.1 设计链落点迁移（按 T3.0 定稿的映射）：`.deeporca/specs/<suite-slug>/` 下 `product-design.md` + `architecture.md` 成链（architecture.parent → product-design，拍板④）；PRD 保存目标与 `save_suite_arch` 落点迁移；骨架头部加 frontmatter 段。**门不动**（验收门/落盘门/修复轮留 design-stage-gates 域，§0.2）。
- [ ] T3.2 权威划分落地：spec 域文件 = 当前有效版唯一权威；`.deeporca/designs` 版本集退为 append-only 归档（批准/新版本时归档快照）；回归用例钉住「归档后读当前版仍指 spec 域」（R3）。
- [ ] T3.3 栏目读写源迁移：~~技术架构栏目（tabArch）与需求文档栏目改读 spec 域文件~~——**降级路线下不适用**（权威留在套件存储，栏目读写源不动 = 拍板③的字面执行）；`.deeporca/designs` 存量文档原地保留（无「当前版」迁移面）。
- [x] T3.4 回归：design-stage-gates 既有测试全绿（prototype-arch 套件随 core 全量 1041/1041）；新增登记用例（锚点入图可见：链 id/parent/artifacts 空 + 幂等 + 指针桩断言，specs-index.test）。
- [ ] T3.5（降级路线二期）权威转移：套件存储退 append-only 归档史 + spec 域文件升唯一权威 + 栏目读写源改指 spec 域——待登记锚点形态经真实使用验证后立项。

## P4 Drift detection（机械级；design.md §1.6）

- [x] T4.1 **门 A 链内漂移**：SpecIndex 内判定——同套件 architecture (mtime, hash) 旧于 product-design 当前版 → 「技术设计落后于产品设计」黄标；链缺一半（仅有 PRD）→ info「未生成技术设计」，非告警。
- [x] T4.2 **门 B 实施漂移**：`artifacts` 登记的实现产物——存在性（设计有实现无 → 「未实施」）+ 新鲜度（实现新于设计 → 「可能滞后」）。
- [x] T4.3 **门 C 跨轨对照（只读）**：`artifacts` 登记 `.deeporca/prototypes/` 快照时给出新鲜度对照；**不语义 diff**；知识轨零改动约束复核（git diff 证）。
- [x] T4.4 呈现与测试：徽标数据进 `getSpecGraph`/`validateSpecs` 明细 → Specs 面板黄标；单测覆盖三门（含**各自前置缺失时的独立跳过路径**（拍板⑦）与判不了标 unknown 的诚实路径）；mutation-check 一次。

## 收尾

- [x] T9.1 `specs/README.md` 活跃区行状态字样更新（立稿时已登记）。
- [x] T9.2 `npm run typecheck && npm run lint && npm test`（P2 后追加相关测试套件）。
- [x] T9.3 design.md 实施状态回写（blockquote 行，含 2026-09 两轮复审加固批记录；frontmatter `status` 保持 `active`——开放决策 R4/R6 未收官）。
- [x] T9.4 加固批回写（2026-09-20 两轮 bug-hunt 复审）：§1.4 IPC 契约（issues 进 wire / md 门槛 / 依赖注入）、§1.6 呈现（结构校验区）、R7/R8 风险登记。
