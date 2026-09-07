# CMB 延伸规划（cmb-next）— session 循环健壮性与结构自治未决项

> **日期**：2026-09-07 立稿 · **状态**：规划（独立任务规划）
> **来源**：2026-09-04 拍板——[cmb-adoption](../../archive/cmb-adoption/design.md) spec 六项四批次收官归档，其台账侧（[`docs/research/2026-09-04-codebrain-membrain-issues.md`](../../../docs/research/2026-09-04-codebrain-membrain-issues.md)）未落地/未决模块整体延伸为本文，作为**独立任务规划**推进；原 spec 的设计内容（§2 分批设计、§6 拍板项、M1 规则规范载体）继续有效，本文不重复。台账仍为 CMB-1~11 的唯一跟踪点。

## 1. 范围（自 cmb-adoption 延伸的未决模块）

| # | 模块 | 原出处 | 说明 |
| --- | --- | --- | --- |
| 1 | premature stop recovery（未验证停止续推） | 台账 CMB-6 对账表 #1 候选 | 判据必须是「是否有未验证的声明」而非「见消息无工具就续推」——本仓"停止"多为有意设计（`waiting_for_user`/`ask_permission` 显式状态） |
| 2 | dynamic reasoning effort（per-phase：规划/验证高档、实现中档） | 台账 CMB-6 对账表 #3 候选 | per-model 维度已有（per-family reasoning 契约）；per-phase 维度未实现；作 settings 项随数据门评估，与 depth-lane P1.2 Gate Directive 邻近但不同轴 |
| 3 | stuck-detection（重复同参调用检测） | 台账 CMB-6 对账表 #5 候选 | 需先与 AskUserQuestion 反问机制整合设计（检测到循环 → 反问用户而非自动重试） |
| 4 | 结构债调度（debt 公式 + top-K 预算审计 + 纯代码溶解兜底） | 台账 CMB-9 ❌ 否决（2026-09-04 全量清账） | 适用对象：任务树（嵌套失衡）、技能库（只增不减）、L3 人格（事实堆积）——都是只长不剪的结构；实体级实现须从 Graphiti 取并署名（08-17 许可红线） |
| 5 | L3 晚绑定渲染（渲染期叠加人格描述，不写死结论进历史事实） | 台账 CMB-11 ❌ 否决（2026-09-04 全量清账） | 事实记录"什么发生了"，人格/项目层记录"现在怎么看"，拼接发生在注入时；CMB-7 已落地的时间锚定覆盖了当前数据形态下的可行部分 |
| 6 | 检索即维护·按访问路径重组（消费侧） | 台账 CMB-10 ✅ 观察面已落地，消费侧未决 | auto-recall 遥测行 + depth-lane G0 遥测已落地；「按访问路径重组」消费侧留观察，数据积累后另行设计 |

## 2. 边界与依赖

- 项 1/2/3 全部挂 **depth-lane P0 观察数据门**——数据门未开，须先由 [depth-lane](../../review-ing/depth-lane/design.md) P0 观察数据证明对应失败模式真实发生频率后再逐条独立立项（联动其 review-ing 实际路径；cmb-adoption design.md 中 `specs/next-version/depth-lane/` 旧引用已随目录迁移失效）。不预设立场，候选条目启动与否由数据决定。
- 项 4/6 为**否决项重新立项**：原判 2026-09-04「三载体结构均无可观测失衡 / L3 无演进排期」。本文立稿即视为重新立项，启动前按当时拍板理由复核一次是否仍成立（sandbox-next 对 bwrap/WSL2 同款处理）。
- 项 5 依赖 CMB-10 已落地的遥测面积累数据（auto-recall 结构化遥测行 + depth-lane G0 遥测），数据积累后先设计再实现。
- **硬约束继承**：零新依赖、不引上游代码（MemBrain 无 LICENSE，禁止拷贝，只借鉴理念自写）；实体级结构债实现（项 4）从 Graphiti 取并署名。
- 项 4 与项 6 同场（L3 结构化讨论重启时一并评估）；项 1/3 与 AskUserQuestion / `waiting_for_user` / `ask_permission` 边界辨析先行。
- 完成一项即回写本文 [tasks.md](./tasks.md)；全部完成后本 spec 按 2026-09-03 归档口径收敛。

## 3. 任务清单

见 [tasks.md](./tasks.md)。
