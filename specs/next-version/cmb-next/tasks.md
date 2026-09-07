# CMB 延伸规划 — 任务清单

> 对应 [design.md](./design.md)；延伸自 [cmb-adoption](../../archive/cmb-adoption/design.md)（2026-09-04 收官归档）台账未决模块；唯一跟踪点：[`docs/research/2026-09-04-codebrain-membrain-issues.md`](../../../docs/research/2026-09-04-codebrain-membrain-issues.md)。

## 数据门型（启动前须过 depth-lane P0 观察数据门，逐条独立立项）

- [ ] 1. premature stop recovery（台账 CMB-6 对账 #1）：判据=「是否有未验证的声明」而非「见消息无工具就续推」；先与 `waiting_for_user`/`ask_permission` 显式状态边界辨析
- [ ] 2. dynamic reasoning effort per-phase（台账 CMB-6 对账 #3）：per-phase（规划/验证高档、实现中档）作 settings 项，随 depth-lane P0 数据门评估；与 depth-lane P1.2 Gate Directive 邻居关系确认
- [ ] 3. stuck-detection（台账 CMB-6 对账 #5）：重复同参调用检测；先与 AskUserQuestion 反问机制整合设计（循环 → 反问而非自动重试）

## 结构自治（启动前复核 2026-09-04「否决」拍板理由是否仍成立）

- [ ] 4. 结构债调度（台账 CMB-9）：debt 公式 + top-K 预算审计 + 纯代码溶解兜底；适用任务树/技能库/L3 三载体；实体级实现从 Graphiti 取并署名
- [ ] 5. L3 晚绑定渲染（台账 CMB-11）：事实与人格描述分层，拼接发生在注入时；与项 4 同场（L3 结构化讨论重启时评估）

## 数据积累型（依赖 CMB-10 已落地遥测面）

- [ ] 6. 检索即维护·按访问路径重组消费侧（台账 CMB-10）：遥测数据（auto-recall 遥测行 + depth-lane G0 遥测）积累后先设计再实现
