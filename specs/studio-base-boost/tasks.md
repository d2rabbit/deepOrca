# Studio 基座增强（H 线）— 实现计划

> 日期：2026-08-20 · 状态：**规划中（`next/*` 版本窗口，随主线 B 节奏；冻结期不实现）**
> 依据：[design.md](./design.md)
> 前置调研：`docs/research/external-eval/2026-08-20-helix-harness-lego-prestudy.md`
> 口径：本文是 `specs/module-system/` 的借鉴增强子计划——H 线任务全部挂在母 spec 既有阶段（B1/B2/B4）的验收项上，不新增阶段；净室红线（design.md §5）对所有任务生效。

---

## H1 · 平台 API 契约测试套（挂 B1/P0 验收）

- [ ] **H1.1 契约用例集骨架**（`packages/core/src/modules/` tests 侧；每条已承诺契约 ≥1 可执行用例，输入 → 期望行为/错误面）
  - 用例格式与 C-M1 dispatch 契约测试对齐（开放问题 1，B1 与 M1 同批设计时拍板）。
  - 验收：内置实现对已承诺条目全过，进 CI；"契约变更 = 破坏性变更 → 兼容矩阵检查"链路可演示。
- [ ] **H1.2 双消费出口**：CI 回归（内置实现）+ 模块侧复跑接口（供 H2 夹具消费同一套用例）。
  - 验收：同一用例文件两处消费，零复制。

## H2 · port fixture 激活门禁（挂 B1/P0 起、B2/P1 扩全量）

- [ ] **H2.1 Tier-0 激活门禁**（CapabilityBroker 激活路径插入夹具步：限时跑 H1 用例，不过拒载该能力；模块整体 fail-open）
  - 载体与超时预算按开放问题 4 拍板（P0 主进程限时 or 等 P1 worker）。
  - 验收：拒载路径单测过（夹具失败 → 能力不进工具面、模块状态可见、内核会话无感）。
- [ ] **H2.2 审计接线**：夹具结果落 `module_activate` 审计事件（复用 sandbox/audit.ts 链式日志）。
  - 验收：链式日志校验过（hash chain 完整、事件可回放）。
- [ ] **H2.3 Tier-1 扩全量**（P1 worker 隔离就位后，`fs.read:<glob>` / `llm.judge` 等全能力过夹具）。

## H3 · dist.json provenance 强制（挂 B4/D1）

- [ ] **H3.1 schema 与组装器校验**：条目必填 `provenance: { source, license, version }`；缺失/license 不明 → 拒装或不可信降级（只许 wasm+数据 UI 层，禁带 renderer 组件代码）。
  - 本地路径条目的豁免格式按开放问题 3 拍板。
  - 验收：schema 校验单测两分支过；降级分支与 D2 签名链衔接（签名覆盖的清单必须可溯源）。

## H4 · 发行版编辑器四步流（挂 B4/D1-D2，设计参考级）

- [ ] **H4.1 流程骨架锁形**："检查（体检+provenance）→ 替换 → 验证（干跑+H1 套+H2 夹具）→ 导出（dist.json+签名）"，各步产物可回放——写入 B4 UI spec 的输入；交互细节不预支。

---

## 依赖与并行关系

| 事项 | 说明 |
| --- | --- |
| 与母 spec | H1/H2 = B1(P0)/B2(P1) 验收项增量，不改变 P0–P2 范围划分；H3/H4 随 D1/D2。母 spec 附录 A 为思想映射，本文为任务化。 |
| 与 C-M1 | H1 用例格式与 dispatch 契约测试统一（同批设计一次做对）；H2 载体若走 worker 则与 B2 worker 隔离同批。 |
| 与 A 线 | 无任务耦合；E1/E3 spec 各自吸收 trace 标签分类与搜索空间组织参照（design.md §0 末行）。 |
| 与 K 线 | 无冲突（K1 改 actions/review、K2a 改 session 记账；H 线全部在 modules/ 与 desktop 发行版层）。 |

## 风险继承

- 母 spec R2（契约冻结成本）→ H1 只覆盖已承诺条目，禁止预写未冻结契约（红线）。
- 夹具运行成本 → H2.1 超时预算先拍板再实现；拒载必须 fail-open，任何夹具异常不得阻塞内核会话。
- provenance 拒装的生态摩擦 → 本地/自有条目走豁免格式（开放问题 3），不做一刀切。
