# 预生产收官 — 任务清单

> 日期：2026-08-17 · 依据：[design.md](./design.md) · 本文件是**唯一范围清单**（冻结期 `feat:` 仅限此处标"闭环"的条目）
> 并行批 1：A/B/C/D/E/G 可多线推进；F 依赖 A-E 合入；H 依赖 F。
> 每项完成即勾选并在括号内记提交号。
>
> **执行状态（2026-08-17 收尾）**：A/B/C/D/E/G 全部完成并分主题提交（9 个提交，`9385687`→`60d86d6`）；**F（全域能力扫描）与 H（预生产切换）保留待办，暂未执行**。
> 提交链：docs 台账 `9385687` · GitMCP `bdc6227` · 安全整改 `f0b7cf9` · book-distill `eed17c3` · skill-up CI `2c98142` · designer 进化 `2308b0c` · serena 补漏 `ac50cfb` · dsh 四件套 `29801ee` · dembrandt 离线化 `60d86d6`。
> **Mimosa 门禁说明**：所有高危已清零（audit 引擎 21 文件 0 findings）；唯一 medium（web-search-handler 活动标签污点，已净化 spawn 参数原样功能不变）经项目所有者 2026-08-17 知情确认，本批提交以一次性 `--no-verify` 放行——后续提交恢复钩子。

## A. skill-up CI（详见 `specs/skill-eval/tasks.md`，此处为总控镜像）

- [x] A1 skill-up 二进制固定版本接入方式落地（T1.1）（`2c98142`；`scripts/get-skill-up.mjs` Releases API 资产名解析 + `.cache/skill-up/` 缓存 + 魔术字节/大小校验；版本 pin 占位 v0.1.0 待联网定版，闭环项）
- [x] A2 `scripts/run-skill-evals.mjs`（变更包检测 + 汇总 + report-only/nightly 双模式）（T1.2）（`2c98142`；退出码契约 0/1/2）
- [x] A3 `.github/workflows/skill-evals.yml`（PR paths 过滤 + nightly + artifacts + secrets）（T1.3）（`2c98142`；PR 增量 report-only + cron `0 18 * * *` 全量）
- [x] A4 8 插件包 evals 骨架；code/browser/knowledge 三包首批 ≥3 用例，其余各 ≥1（T1.4）（`2c98142`；8 包 eval.yaml + 14 用例，rule_based 离线可重放）
- [x] A5 S1 出口：PR 出报告 / 离线重放 / 增量 <5min（T1.5）（`2c98142`；本地验证退出码路径全过；CI 首跑待首次 PR 验证，闭环项）
- [x] A6 S2 自定义引擎适配器 + 双引擎趋势一致（T2.1-T2.3，S1 稳定后启动）（`2c98142`；`skill-up-engine-deeporca.mjs` 隔离 HOME/120s/权限钳制；engine.custom 示例已注册于 code/evals；**双引擎趋势对拍待联网跑真实 LLM 用例**，闭环项）

## B. book-distill

- [x] B1 `templates/plugins/knowledge/skills/book-distill/SKILL.md` + references（方法论：源评估→章节地图→分批抽取→去重合并→生成技能→自检；触发描述面向 G1 嵌入召回优化的约束写明；版权注意声明）（`eed17c3`；244 行 + capability-cards/output-contract 两 references + 短源快路径）
- [x] B2 book-distill 自身 evals ≥3 条（正/反/边界），纳入 A 的 CI 体系（`eed17c3` + `2c98142`；3 用例随 knowledge 包 evals 进 CI）
- [ ] B3 端到端演练一次：选一本自有文档蒸馏出技能 → 验证 G1 短名单能召回该技能（**未做——需真实 LLM 会话演练，留作预生产测试内容**）

## C. GitMCP 四项增强

- [x] C1 `get_repo_structure`（trees API，深度/路径过滤，token 预算封顶）（`bdc6227`；目录优先+计数，400 条目封顶）
- [x] C2 `read_file`（raw 读取，host 白名单仅 github raw 域，大小上限，二进制拒绝）（`bdc6227`；256KB，二进制/非 UTF-8 拒绝，显式 ref 不静默回退）
- [x] C3 docs/ 多文件索引（文档源扩展 + 多文件分块入 BM25，`fetch_documentation` 向后兼容）（`bdc6227`；llms.txt 链接 + trees 发现 ≤30 文件，旧缓存向后兼容）
- [x] C4 `outline`（chunk.heading 聚合）（`bdc6227`；h1-h3 折叠 trie，懒索引；含计划外补齐的 `get_repo_info`）
- [x] C5 测试：8 工具单测 + 离线缓存回退 + zod/v3 契约回归（`bdc6227`；23 测试离线全覆盖，tsc/eslint 干净）
- [x] C6（闭环项）`docs/research/2026-08-17-external-repos-prestudy.md` 中 GitMCP 相关引用核对（如有）（`9385687` 台账索引已收编；zread 对比文档已归档）

## D. dsh 理念深化（顺序执行 D1→D2→D3→D4；⚠️ Router 红线见 design.md §三-D）

- [x] D1 P1-1 崩溃合成收尾：`TOOL_NOT_STARTED`/`TOOL_OUTCOME_UNKNOWN` 落盘合成 + resume 不重放 trailing pending + "只重试幂等操作"系统提示 + settings 开关兜底旧语义 + 存量会话兼容测试（`29801ee`；7 用例：真值表/双状态合成/暂停豁免/replay 回退）
- [x] D2 P1-2 两段式 compaction：model-free 预剪（tool-result 截断占位）→ 重计量 → LLM 摘要；START 侧配对断言（END 侧前扫已有）；#11 前缀回放**默认不做**、决策记录入本文件（`29801ee`；5 用例；CJK 感知估算 + 投影 <阈值×0.7 跳过 LLM 摘要；#11 决策见决策记录表）
- [x] D3 P1-4 beforeToolExecution 注册表：数组式同步 listener（allow/ask/deny），权限检查为首个内建 listener，执行层设施位于 router 之后（`29801ee`；5 用例；`registerBeforeToolExecution` 公开）
- [x] D4 前缀收尾包：`prompt.ts` 段序显式化；**router 输出字节一致性守护测试**（不同发现顺序 → RoutingFacade 冻结输出逐字节一致；禁止全局 toolOrder）；desktop 用量面板 cache_read 维度接线（`29801ee`；段序常量化 + 字节一致性测试 2 用例；**cache_read 接线经查早已存在**——`prompt_cache_hit_tokens`→token-usage.ts 聚合→TopBar cache%/TokenStatsPanel，此前"未接线"系字段名误判，台账已更正为 ✅）
- [x] D5（闭环项）`docs/research/2026-08-17-dsh-consolidated.md` 台账状态回写（`9385687`；落地记录段 + #18 更正行已写入）

## E. designer 增强

### E1 dembrandt 品牌摄取

- [x] E1a builtin MCP 注册（pinned npx `dembrandt-mcp`，core disable-gate + desktop spawn 注入，同 serena 模式）（`60d86d6`；最终为 vendored 离线 spawn 而非 npx——见 E1e 收口）
- [x] E1b `design.extract` action（spawner 调 CLI `--json-only`，产物写 `.deeporca/DESIGN.md` 品牌契约 + tokens 入 design-store；过 gateWrite/PathGrant + audit bus）（`60d86d6`；agent 介导写 DESIGN.md 走 write 工具自身 PathGrant 门控）
- [x] E1c `design.drift` action（优先纯函数子包 drift/findings，desktop 侧引入；基线对比 0-100 评分 + findings 审计）（`60d86d6`；`--compare` 基线漂移门，exit 1=drift-detected 非错误）
- [ ] E1d review 维度接线：drift 结果并入 review 面板展示（确定性、零 LLM）（**未做——UI 卡片列为冻结期闭环项；当前 drift 结果以工具输出在会话/审查上下文可见**）
- [x] E1e 约束验收：不 vendor Chromium；SSRF host 校验（如自研抓取包装）；网络失败 best-effort 降级；license 门禁通过（`60d86d6`）
  - **offline 收口（2026-08-17，两次用户拍板：干掉首次运行联网下载 + 使用内置 Chromium）**：① 构建期 `scripts/vendor-dembrandt.js` pinned 安装到 `packages/desktop/vendor/dembrandt`（`--omit=dev --omit=optional --ignore-scripts`，实测 **26.3MB**/113 包，**无浏览器二进制**，installer 增量即这 26.3MB）；② **无运行时 npx 回退**——vendor 树缺失即报"需先 desktop build"离线配置错误，绝不联网；spawn 字面量 `node <vendored dist js>`（argv 四重校验：绝对/无 `..`/落根内/存在性）；③ **浏览器 = Electron 内置 Chromium**：desktop 隐藏 offscreen 窗口 CDP 暴露内嵌 Chromium（loopback 9333，`main/tools/dembrandt-browser.ts`），构建期给上游 CLI/MCP/PDF 三处 launch 打 version-pinned fail-closed patch 令其优先 `connectOverCDP(DEMBRANDT_CDP_ENDPOINT)`（上游 MCP/PDF 原生不支持 CDP），`--check` 语法校验内置于 vendor 流程（曾正确拦下括号不平衡的 patch），`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 恒设兜底；**端到端已验证**（Chromium CDP 渲染 example.com 提取 17 类设计数据）；④ SSRF 防线 `validateDembrandtTargetUrl`（仅 http/https，拒 localhost/环回/私有/保留/链路本地，含 scheme 走私与空白编码绕过）先于一切 spawn；30 用例全绿（含 CDP 注入/URL SSRF 矩阵/containment）；MIT 过 license 门禁
- [x] E1f（闭环项）external-repos 预研文档状态回写（dembrandt 部分 ✅）（`9385687` 台账索引 + CHANGELOG 条目）

### E2 进化设计（纯 prompt/模板层）

- [x] E2a 内置设计系统预设 3 → 8–10 套（tokens 化 DESIGN.md + deep-design 选择表扩容）（`2308b0c`；9 套：+brutalist-contrast/swiss-international/terminal-mono/glass-morphism/soft-neumorphic/warm-handcrafted，全部对比度脚本核验 ≥4.5:1）
- [x] E2b taste 五维自评评分卡 + anti-slop（与 designs/ 近期产物比对防雷同）（`2308b0c`；第 11 条 anti-slop + 五维自评每维 ≥3 且总分 ≥20 方交付）
- [x] E2c 大页面两段式生成可选步骤（SKILL.md 工作流层，不动工具面）（`2308b0c`；骨架确认→填充，小页面单遍跳过）
- [x] E2d（闭环项）opendesign 预研文档状态回写（`9385687` 台账索引）

## F. 全域能力扫描（依赖 A-E 合入）— F1–F3+F6 已完成（2026-08-17，见 `docs/pre-production-capability-scan.md`）；F4/F5 保留待办

- [x] F1 静态基线：`npm run check && npm test` 全绿（含 license 门禁）（Node 22.23.2 下通过；首轮 format:check 红——`--no-verify` 批次带入 9 文件 prettier 违规，已修复回归；core 550/desktop 191/embedding 10/memory 14 全 0 失败）
- [x] F2 专项套件：sandbox / routing（含 D4 新测试）/ session（P1-1、P1-2 新语义+旧开关）/ actions 27 项三面到达 / gitmcp 8 工具 / designer（extract、drift、预设）（六专项声明逐一在树核证，用例数与本文记载逐项吻合：D1=7/D2=5/D3=5/D4=2/gitmcp=23/dembrandt=32≥30；registry 实测 28 个 action id）
- [x] F3 接线核验：8 插件包技能加载、MCP builtin 全量起停（含新增 dembrandt）、vendor 13 脚本、i18n 5 语言、desktop:build 三 bundle + extraResources（8 包 eval.yaml 齐备；builtin 起停循环 8 名单；vendor-* 恰 13；6 locale（en+5）；extraResources vendor→app/vendor 与运行时解析一致）
- [ ] F4 真机烟雾（Windows 必测）：会话→plan mode→工具→permission→design.materialize→review.full→任务树→**重启恢复（验证 P1-1）**（**保留待办——需真机**）
- [ ] F5 逐 spec 终判（specs/ 全目录 19 个）：产出挂账清单——冻结期"闭环"项或显式推迟（**保留待办——独立文档作业，建议与 F4 同批**）
- [x] F6 扫描报告 `docs/pre-production-capability-scan.md` 落盘

## G. 旧文档清理

- [x] G1 `docs/research/archive/` 建立 + 迁入（zread / memos / pi-sdk / dsh 原文 3 份 / STATUS-2026-08-07.md）+ archive README 指回索引（`9385687`；含 v7-strike.png；全库引用路径已修复）
- [x] G2 状态行回写（knowledge-materialization、activity-frames spec 等，以 `docs/research/README.md` 台账逐条核对）（`9385687`；两处状态块回写 + 台账索引同步）
- [x] G3 仓库垃圾：`.playwright-mcp/` 移出追踪 + .gitignore；`v7-strike.png` 处置；Monaco+Mermaid 过时注释清理（`9385687`；28 个快照移出追踪保留磁盘；v7-strike.png 归档；App.tsx/build.mjs 注释修正）
- [x] G4 roadmap 预生产基线快照 + CHANGELOG 本版本汇总 + `docs/research/README.md` 索引同步（`9385687` + `60d86d6`；roadmap v3.19 收官快照 + CHANGELOG 全部条目 + 台账落地记录）
- [x] G5 `*_en.md` 孪生事实性漂移抽查（随 G2/G4 台账核对覆盖，未发现事实性漂移需修）

## H. 预生产切换（依赖 F 全过）— **保留待办，暂未执行**

- [ ] H0 前置复核：dev 无新分叉（重复 merge-base 检查）；tasks.md A-G 全勾
- [ ] H1 `npm run release:version` 版本定格
- [ ] H2 合并：`git checkout dev && git merge --no-ff feat/sandbox-p0-path-gate` + push origin dev
- [ ] H3 tag `pre-production-baseline`
- [ ] H4 冻结生效：dev/feat 分支仅接受 fix/perf/docs/test/refactor/build/chore + 上表"闭环"项；新功能开 `next/*` 分支；AGENTS.md 分支策略段落更新（master 同步决策推迟到预生产结束时）

---

## 决策记录（执行中追加）

| 日期 | 决策 | 依据 |
| --- | --- | --- |
| 2026-08-17 | #11 compaction 前缀回放默认不做（缓存按模型隔离，仅 flash 主模型会话受益，收益<复杂度） | dsh-consolidated §三-2 |
| 2026-08-17 | Router 为工具/技能选择唯一权威；dsh 确定性仅限 router 输出层与测试 | 项目所有者铁律 |
| 2026-08-17 | task-tree P3、sunlogin、cad-3d、HTTP transport、S1/S2 推迟下一版本 | design.md §五 |
| 2026-08-17 | dembrandt 完全离线：干掉首次运行联网下载（vendor 构建期安装 + 无 npx 运行时回退） | 用户拍板 |
| 2026-08-17 | dembrandt 浏览器 = Electron 内置 Chromium（CDP 方案，非系统浏览器 executablePath、非 CDP 挂外部浏览器） | 用户拍板"使用内置的Chromium" |
| 2026-08-17 | Mimosa medium（web-search 活动标签污点，已净化）经所有者知情确认，本批提交一次性 --no-verify 放行，后续恢复钩子 | Mimosa 门禁契约 + 用户确认 |
| 2026-08-17 | F（全域能力扫描）与 H（预生产切换）保留待办，本版本功能开发到此为止 | 用户指示 |
