# 对抗式代码评审报告 — 37fb81e9..3a9c1e9a

日期：2026-08-17 · 分支：`feat/sandbox-p0-path-gate` · 对象：收官批次后追加的 4 提交
（`febf8957` 文档/审查 → `77ecd832` designer 线 → `2d8fec64` memory 线 → `3a9c1e9a` design action 线，
49 文件 +2993/−112）· 无 PR（本地评审）

> **处置：只评审不修复**（项目所有者指示）。全部 18 项候选经独立打分代理按 0–100
> 置信度评级，**≥80 过滤线：0 项通过** —— 无阻塞级问题。以下为次阈值的已验证
> 发现，留作修复排期参考。

## 评审管线

5 路并行对抗式评审（AGENTS.md 合规 / diff 浅扫 bug / git 历史上下文 / 历史评审
教训复用 / 代码注释契约），收敛 18 个去重候选；每项再由独立打分代理验证并按
标准 rubric 评级。合规面（Agent #1）零发现：core UI-free、无 console、vendor
路径未在 core 内推导、ESM/import type/命名约定全部通过。

## 一、已验证真实的功能性发现（70–75 分，最值得排期）

| # | 分 | 位置 | 问题 |
| --- | --- | --- | --- |
| 1 | 75 | `packages/memory/src/tdai/core/hooks/query-variants.ts:80` | `/\d{1,2}\s*号\b/g` 是死正则：CJK 字符后接 `\b` 只在后面跟 ASCII 字符时成立，独立 `N号` 形态（"5号提的需求"）永远不剥离——模块文档（:75）声称覆盖 `5号`，测试只测了 `3月5号`（走另一条模式），掩盖缺口。降级 graceful（事件向变体退回原查询），但该变体对 `N号` 输入完全失效 |
| 2 | 75 | `packages/memory/src/tdai/core/record/l1-extractor.ts:616` | `findFabricatedDates` 内容侧只扫 ISO 日期（`FULL_DATE_RE`），中文全日期（`2025年3月1日`）漏检——而源侧 `collectDateTriples` 两种都收、函数文档自称"notation-insensitive"、新 prompt 规则点名的恰恰是中文形态。中文优先系统里半边遥测失效 |
| 3 | 70 | `packages/core/src/actions/review.ts:131-145` | `status: "active"` 仅凭 `hasGraph`（图文件存在）判定，不看结构富化是否真的产出：CRG 查询失败被裸 `catch` 吞掉（:120）或内部 catch 返回空后，仍自述 "semantic + structural enrichment"——正是 `analysis-status.ts:5-8` 头注释禁止的"fail-open 不自述降级"（默认 CrgGraphQuery 实现不抛错而是返回 []，所以该路径经空结果即可命中，非仅异常路径） |
| 4 | 70 | `packages/memory/src/tdai/core/record/l1-extractor.ts:185` | `findFabricatedDates` 只拿消息 `.content` 做真值，但 prompt 把消息 `timestamp` 渲染进上下文且**指示模型**从 timestamp 推算绝对日期（`l1-extraction.ts:50-51,143`）——合规推导出的日期会被误报 "fabricated"，软遥测退化为常规噪音，违背该校验器的目的 |

## 二、安全加固类（50–65 分，真实但低频/缓解充分）

| # | 分 | 位置 | 问题 |
| --- | --- | --- | --- |
| 5 | 65 | `packages/core/src/actions/design-audit.ts:225-240,269` | `resolveTarget` 对 LLM 入参 `target` 做 `path.join` 无包含校验：`../../` 可出 `.deeporca/designs/`，绝对路径被显式接受后 `readFileSync`；action 却声明 `sideEffects: ["read-in-cwd"]`。重复了 security-audit A1（design-store `isSafeArtifactId` 修复）与 `120684cf`（treeId 包含性校验）确立的教训。缓解：只读、返回 findings 不回传文件内容、registry 现不强制 sideEffects——扣在 75 下的原因 |
| 6 | 50 | `packages/core/src/common/dembrandt.ts:349` | 版权拒绝清单精确匹配 hostname：尾点 FQDN（`themeforest.net.`，DNS 同站）绕过；同站子域（`booster.themeforest.net`）绕过。打分代理还实证了同款归一化缺口让 SSRF IPv4 检查也吃尾点（`192.168.1.1./x`）。需要刻意构造（提示注入 LLM 威胁模型下成立），属策略防线加固而非常规缺陷 |
| 7 | 40 | `packages/core/src/common/sqlite-runtime.ts:248-253` | prettier 提交把 `// mimosa-ignore` 从 sink 行尾注释（`f0b7cf90` 确立的约定，另两处存续用法均如此）挪进选项对象内独占一行。若 Mimosa 按 finding 行锚定抑制则抑制失效——但仓库内无任何文档/配置描述锚定语义，多数抑制指令引擎接受 finding 跨度内注释，后果无法在仓内证实 |

## 三、文档/注释一致性（均 50 分：已验证、无功能影响）

8. `bucket-sample.ts:81` 文档写 `## key (total) · …`，实际输出 `key (total): …`（无 `##`）。
9. `l1-extractor.ts:576` 文档称幻觉引用 "reset to []"，混合数组实际保留合法子集（测试锁定的行为）。
10. `l1-extractor.ts:8-13` 文件头管线注释未纳入新增的确定性校验阶段（2→3 步之间）。
11. `macrostructures/landing-flow.md:3` 自称"十者中列最后"，`deep-design/SKILL.md` 选择表却把它列第一（同批两文件自相矛盾；"default-slop 需说明理由"的护栏本体无损）。
12. `taste/references/motion-patterns.md:5` 引用 "SKILL.md 6 行动效段"——同批把该段扩到 5 条 bullet，计数过时。
13. `common/dembrandt.ts:267-277` 两道门契约 JSDoc 现挂在 `COPYRIGHT_DENYLIST` 常量上，`validateDembrandtTargetUrl` 本体无文档。
14. **`docs/pre-production-capability-scan.md:44` / `specs/pre-production/tasks.md:65` 记 dembrandt=32 用例，实测 31**（基底 30 + 本批 1 条版权测试）——本评审抓到上午审查报告自身的 off-by-one；≥30 结论仍成立。
15. `docs/research/README.md:70` 与预研文档引用 `auto-recall.ts:655-677`（RRF 常量/合并块），本批改写后实际在 :680/:689/:702——同日落盘的文档对同批代码的行号引用过时。
16. `analysis-status.ts:38-43` `formatBackendStatusBlock` 文档自称"appended to an action's text output"，实际无 action 使用（仅测试引用）；两个消费者都只用 `describeBackendStatus`。
17. `l1-extraction.ts:36` 新规则 4（时间保真）与同 prompt 既有指令（"尽量/务必结合 timestamp 推算绝对时间"）存在张力——可调和读法存在（timestamp 本身是秒级源数据，从中推导非虚构），判 50。
18. `query-variants.ts:133` 导出 `RRF_K=60` 与 `auto-recall.ts:680` 本地 `const RRF_K = 60` 双源同值，仅靠注释维系 parity——今日零行为差异，同源性隐患。

## 结论

对抗式管线（5 路评审 × 18 项独立打分）**未发现达到 80 分阻塞线的缺陷**；真实且
值得排期的集中在 memory 校验器/变体生成器的四个功能缺口（#1–#4，70–75 分）与
design-audit 的路径包含性加固（#5，65 分）。全部发现按指示**未做任何修复**；
建议下批以 `fix(review)` 主题一次性收敛一/二类，三类随下一次触碰对应文件时顺带
清理。
