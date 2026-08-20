# HELIX 预研 — Harness 乐高化组装工作台（HKUDS/HELIX）

> 日期：2026-08-20 · 状态：**⬜ 未消费（结论型调研：整体不引入，机制借鉴回 `specs/module-system/`（Studio 基座主线 B）与主线 A 自进化）**
> 产物去向：`specs/module-system/design.md` 附录「HELIX 对照与借鉴」；`docs/features/next-version-plan.md` 主线 B/A 注记
> 仓库：`github.com/HKUDS/HELIX`（港大 HKUDS，TypeScript monorepo，配论文 arXiv:2608.13951；README_zh + 仓库结构走读；自认 status: research prototype）
> 立场口径：**不引入、不 vendor、不拷贝代码**（其 lego-\* 包是另一套完整 harness 内核，引入等于抛弃本仓自有引擎；license 未核验，净室红线）。

---

## 1. 一句话定位

HELIX 回答的问题是："对一个模型，如何挑出/拼出最适合它的 harness？"——它把 4 个真实产品级 harness（OpenCode、Pi Mono、Nanobot、Hermes）拆解成 **1,332 个原子**（8 维度：shell / session+hooks / config / prompt / tools / turn loop / acceptance / runtime policy），通过**装配契约（assembly contract）里的 96 个标准 port/swap point** 声明式组合（recipe JSON），在目标场景评测搜索更强 harness，并把 rollout 转成可回训数据（成功/失败/near-miss/regression/preference 标签）。

结果（其自述）：LiveCodeBench 子集 76→87/100、SWE-Bench 子集 44→49/55（全量搜索口径 Pass@N），即"harness 组合本身是可优化变量"这一论点的实证。

## 2. 与本仓的两大关联

### 2.1 对 Studio 基座（主线 B / specs/module-system）——印证 + 机制借鉴

| HELIX 机制 | module-system 对应物 | 判断 |
| --- | --- | --- |
| **assembly contract：96 个标准 port/swap point** 约束全部原子的插拔面 | "七张平台 API 契约表" + CapabilityBroker Tier-0/1（design §四） | **同构印证**：契约先行（先冻结插拔面，再谈模块生态）是已被两家（我们与 HELIX）独立收敛的路线；借鉴其 **port fixture** 思想——每个 port 附契约级测试夹具，模块激活前先过夹具 |
| **recipe = source-traceable 声明式 JSON** | dist.json 发行版清单 | 同构印证；借鉴 **source-traceable**：dist.json 模块条目强制 provenance（来源/许可/版本锁），与本仓 Provenance 块实践对齐 |
| **conformance/ 跨模块一致性测试包**（契约变更即跑 parity） | M1 的契约漂移测试同族；B1 尚无对应验收项 | **直接可借**：立"平台 API 契约测试套"为 B1 验收项（模块/发行版对契约表的 parity） |
| **browser builder**（本地 docs site 里检查/替换/验证/导出 recipe） | B3 模块管理 + B4 发行版 MVP 的 UI | 形态参考：发行版编辑器 = recipe builder（检查→替换→验证→导出 四步流） |
| runtime policy 作为独立第 8 维度 + permission ports | permission sideEffects 网关 + sandbox 信任分级 | 同构印证（policy 是一等拼装维度，不是附注） |

### 2.2 对自进化引擎（主线 A）——同类先证

- **harness search ≈ E3 Self-Harness/HarnessBank 的同类先证**：HELIX 实证了"harness 是可搜索优化的变量空间"，且其搜索空间组织（8 维度 × port 约束 × smoke-screen 预筛）是 E3 设计时可引用的结构模板。注意差异：HELIX 换的是**研发期 harness 配方**，我们 E3 目标是**运行期技能/harness 资产的自改进**（skill-writer/skill-digester/HarnessBank），不直接搬其搜索器。
- **sibling rollouts + trace 级标签**（near-miss / regression-aware negatives / no-action negatives / preference pairs / patch-hygiene filters）：这是 E1 执行捕获的**数据 schema 参照**——我们的 E1 记录成功/失败/重试/用户纠正，HELIX 进一步细分标签粒度并保留 audit boundaries；skill-up 数据飞轮（层一闭环）与其 training-data loop 同构。

## 3. 处置结论（2026-08-20 定稿）

- ❌ **整体引入不做**：HELIX 是 research prototype（自认），lego-runtime/lego-session/lego-agent-loop 是完整替代性 harness 内核——引入即抛弃本仓 session/engine 与全部已落地资产（ActionRegistry/A2UI/MCP SDK）；其定位是"研发期 harness 搜索工作台"，我们是"产品内核 + 发行版组装"，产品定位不同。
- ✅ **借鉴四项回 module-system（B 线）**：① port fixture（能力契约夹具，激活前门禁）；② dist.json 条目强制 provenance（source-traceable）；③ 平台 API 契约测试套列为 B1 验收项；④ B4 发行版编辑器采"检查→替换→验证→导出"流程形态。
- ✅ **借鉴两项回 A 线**：⑤ E3 设计引用其搜索空间组织（8 维度 × port 约束）作结构模板；⑥ E1 数据 schema 参照其 trace 标签分类（near-miss/regression-aware negatives/preference pairs）。
- 📌 **印证价值**：契约先行 + 声明式组装 + policy 一等维度三条架构选择获得独立先证，module-system v2 的方向风险下降。

## 4. 未核验项

- license 未核验（README 无 license badge）——不拷代码红线的直接原因。
- 其 benchmark 数字为自述（论文 + docs/reports 可复核），未独立复现；对本仓决策无阻塞（我们借鉴机制不采纳其结论）。
- OpenCode/Pi/Nanobot/Hermes 四家拆解的原子粒度是否真可互换（conformance 通过率）未深查——不影响机制借鉴。
