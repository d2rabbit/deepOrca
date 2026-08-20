# PR-AF 预研 — 多智能体对抗式代码审查（Agent-Field/pr-af）

> 日期：2026-08-20 · 状态：**⬜ 未消费（结论型调研：整体不引入，仅借鉴"对抗证伪"思想，落地为自研 spec）**
> 产物去向：[`specs/index-knowledge-boost/design.md`](../../../specs/index-knowledge-boost/design.md)（K1 轨道）
> 仓库：`github.com/Agent-Field/pr-af`（维护线为 Go 单二进制 `go/`，Python 版保留 `src/pr_af/`；README + ARCHITECTURE.md + 源码走读）
> 立场口径：**不引入、不 vendor、不拷贝代码与 prompt 原文**——PR-AF 许可未核验，且其差异化能力应在本仓现有 review.full 链路内自研实现。

---

## 1. 一句话定位

PR-AF 是开源多智能体 PR 终审门禁：把每个 PR 编译成一套**现场生成的审查计划**（而非固定 checklist），并行派出多维度审查 agent，用代码证据锚定结论，再由对抗审查器专职推翻误报。自称在 Martian Code-Review-Bench 38 个可运行 PR 上以 GLM-5.2 取得 0.706 golden recall（开源第一）；代价是单次审查 35–50 分钟、成本上限 $2、时长上限 1 小时——**定位为 CI/CD 终审，完全不适合交互场景**。

## 2. 七阶段流水线（对照本仓能力）

| PR-AF 阶段 | 本仓等价物（dev 分支） | 差距判断 |
| --- | --- | --- |
| ① Intake 分类（PR 类型/风险/AI 代码置信度） | 无显式入口分类 | 空白，价值中 |
| ② Anatomy（diff 解析/依赖图/blast radius） | **CRG**：变更函数 + 影响半径 BFS + risk_index + 测试缺口（`packages/core/src/actions/crg-query.ts`） | **已覆盖且更深**（Leiden 社区检测） |
| ③ Planning 元提示（为该 PR 现场生成 N 个审查维度 prompt） | OCR 固定 prompt（CRG 摘要作 `--background` 注入） | 空白，但增量收益存疑（见 §4） |
| ④ 并行多维度审查 | OCR 单遍 | 空白 |
| ⑤ Adversary 对抗审查器 + Coverage Gate | **流程层有**（两轮对抗评审收敛至零，`docs/audit-archive/`），**产品层无** | **核心差距，也是唯一值得借鉴的点** |
| ⑥ Synthesis 确定性打分/去重/行号映射 | `mergeReviewWithCrgRisk`（确定性合并，无 severity×confidence 打分） | 部分覆盖 |
| ⑦ GitHub inline comments + 事件门禁 | CodeReviewPanel + review.full action | 形态不同（我们是桌面交互，非 CI 门禁） |

## 3. 值得记下的设计（思想层面）

1. **对抗性张力**：发现问题的 agent 与挑战问题的 agent 分离；对抗方被明确激励去推翻结论——是否预存在问题、是否项目既有惯例、严重度是否夸大、证据是否太弱。直接命中 AI 审查最大痛点（误报噪音），也正好是本仓 audit-archive 两轮人工对抗流程在做、但产品未自动化的环节。
2. **证据锚定 + 可证伪门**：finding 必须附带真实代码片段为证据，进结论前先自我证伪（安全行为？已有缓解？）。
3. **AI-PR 意识**：检测 AI 生成代码特征（过度描述性命名、琐碎代码高注释密度、镜像测试），置信度高时全局调策略（幻觉检查/过度抽象检测/测试有效性审查 + 打分乘数）。
4. **三级循环预算硬上限**：内环 3 跳/2 子代理，中环 5 次交叉深挖，外环 2 轮覆盖迭代；per-phase 成本上限。预算显式化模式与本仓 compaction 阈值管理同族。

## 4. 处置结论（2026-08-20 定稿）

- ❌ **路径 A（CI 侧外部挂载）不做**：收益未经本仓验证（benchmark 系其自建），却要引入 OpenRouter key、Docker 控制面（AgentField）、35–50 分钟 CI 时延。加了等于没加。
- ❌ **路径 C（PR-AF Go 二进制作为第三种 ReviewController）不做**：vendored 二进制 + 守护进程控制面违反本仓 vendor 形态（单二进制/无守护进程）；OpenRouter 强绑定与 DeepSeek 调优冲突；时延与交互面板根本冲突。
- ✅ **路径 B（概念内化）唯一采纳一项**：**对抗证伪 pass（K1 = `review.challenge`）**——把流程层已存在、纯人肉的"两轮收敛至零"自动化进产品。落点与设计见 `specs/index-knowledge-boost/design.md` §K1。
- ⏸ **元提示规划、AI-PR 意识、severity×confidence 打分**：记"已知晓、暂不采纳"。触发条件：K1 上线后若漏报集中在特定维度，再评估元提示规划的增量收益。

## 5. 风险与未核验项

- benchmark 为其自述（仓库含复现脚本，可复核但非第三方权威）；若未来重启外部对比，应先用本仓 `docs/audit-archive/` 历史 35 项发现做回放校验。
- PR-AF 许可证未核验——这是"不拷贝 prompt 原文"净室红线的直接原因。
