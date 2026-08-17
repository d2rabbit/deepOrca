# 预生产收官 — 任务清单

> 日期：2026-08-17 · 依据：[design.md](./design.md) · 本文件是**唯一范围清单**（冻结期 `feat:` 仅限此处标"闭环"的条目）
> 并行批 1：A/B/C/D/E/G 可多线推进；F 依赖 A-E 合入；H 依赖 F。
> 每项完成即勾选并在括号内记提交号。

## A. skill-up CI（详见 `specs/skill-eval/tasks.md`，此处为总控镜像）

- [ ] A1 skill-up 二进制固定版本接入方式落地（T1.1）
- [ ] A2 `scripts/run-skill-evals.mjs`（变更包检测 + 汇总 + report-only/nightly 双模式）（T1.2）
- [ ] A3 `.github/workflows/skill-evals.yml`（PR paths 过滤 + nightly + artifacts + secrets）（T1.3）
- [ ] A4 8 插件包 evals 骨架；code/browser/knowledge 三包首批 ≥3 用例，其余各 ≥1（T1.4）
- [ ] A5 S1 出口：PR 出报告 / 离线重放 / 增量 <5min（T1.5）
- [ ] A6 S2 自定义引擎适配器 + 双引擎趋势一致（T2.1-T2.3，S1 稳定后启动）

## B. book-distill

- [ ] B1 `templates/plugins/knowledge/skills/book-distill/SKILL.md` + references（方法论：源评估→章节地图→分批抽取→去重合并→生成技能→自检；触发描述面向 G1 嵌入召回优化的约束写明；版权注意声明）
- [ ] B2 book-distill 自身 evals ≥3 条（正/反/边界），纳入 A 的 CI 体系
- [ ] B3 端到端演练一次：选一本自有文档蒸馏出技能 → 验证 G1 短名单能召回该技能

## C. GitMCP 四项增强

- [ ] C1 `get_repo_structure`（trees API，深度/路径过滤，token 预算封顶）
- [ ] C2 `read_file`（raw 读取，host 白名单仅 github raw 域，大小上限，二进制拒绝）
- [ ] C3 docs/ 多文件索引（文档源扩展 + 多文件分块入 BM25，`fetch_documentation` 向后兼容）
- [ ] C4 `outline`（chunk.heading 聚合）
- [ ] C5 测试：8 工具单测 + 离线缓存回退 + zod/v3 契约回归
- [ ] C6（闭环项）`docs/research/2026-08-17-external-repos-prestudy.md` 中 GitMCP 相关引用核对（如有）

## D. dsh 理念深化（顺序执行 D1→D2→D3→D4；⚠️ Router 红线见 design.md §三-D）

- [ ] D1 P1-1 崩溃合成收尾：`TOOL_NOT_STARTED`/`TOOL_OUTCOME_UNKNOWN` 落盘合成 + resume 不重放 trailing pending + "只重试幂等操作"系统提示 + settings 开关兜底旧语义 + 存量会话兼容测试（可复用 converter `interrupted` 元数据）
- [ ] D2 P1-2 两段式 compaction：model-free 预剪（tool-result 截断占位）→ 重计量 → LLM 摘要；START 侧配对断言（END 侧前扫已有）；#11 前缀回放**默认不做**、决策记录入本文件
- [ ] D3 P1-4 beforeToolExecution 注册表：数组式同步 listener（allow/ask/deny），权限检查为首个内建 listener，执行层设施位于 router 之后
- [ ] D4 前缀收尾包：`prompt.ts` 段序显式化；**router 输出字节一致性守护测试**（不同发现顺序 → RoutingFacade 冻结输出逐字节一致；禁止全局 toolOrder）；desktop 用量面板 cache_read 维度接线
- [ ] D5（闭环项）`docs/research/2026-08-17-dsh-consolidated.md` 台账状态回写

## E. designer 增强

### E1 dembrandt 品牌摄取

- [x] E1a builtin MCP 注册（pinned npx `dembrandt-mcp`，core disable-gate + desktop spawn 注入，同 serena 模式）
- [x] E1b `design.extract` action（spawner 调 CLI `--json-only`，产物写 `.deeporca/DESIGN.md` 品牌契约 + tokens 入 design-store；过 gateWrite/PathGrant + audit bus）
- [x] E1c `design.drift` action（优先纯函数子包 drift/findings，desktop 侧引入；基线对比 0-100 评分 + findings 审计）
- [ ] E1d review 维度接线：drift 结果并入 review 面板展示（确定性、零 LLM）
- [x] E1e 约束验收：不 vendor Chromium；SSRF host 校验（如自研抓取包装）；网络失败 best-effort 降级；license 门禁通过
  - **offline-first 收口（2026-08-17）**：运行时零网络下载——`scripts/vendor-dembrandt.js` 构建期 pinned 安装（`--omit=dev --omit=optional --ignore-scripts`，onnxruntime-node 跳过）到 `packages/desktop/vendor/dembrandt`（实测 **26.3MB**/113 包，裁掉 sourcemap+上游测试后；无任何浏览器二进制——118MB Granite 模型为既有体积先例，本次 installer 增量即这 26.3MB）；core `configureDembrandtVendorRoot()` host 注入（packaged = `Resources/app/vendor/dembrandt`），`resolveDembrandtCommand()` 优先 vendored `node <dist js>` argv（绝对路径/无 `..`/落根内/存在性四重校验，失败降级 pinned npx——仅 dev checkout 无 vendor 树时）；浏览器零下载：源码验证 dembrandt 运行时从不自动下载（唯一下载器是显式 `install-browser` 子命令，DeepOrca 不调用），子进程恒设 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`，`PLAYWRIGHT_BROWSERS_PATH` 仅在 `~/.deeporca/browsers/ms-playwright` 已离线预置（存在 `chromium*`/`firefox*` 目录）时导出——打包侧一条命令离线预置：`PLAYWRIGHT_BROWSERS_PATH=<dir> npx playwright@1.61.1 install chromium`（同落 `chromium-1228` + `chromium_headless_shell-1228` 两工件——headless 启动用的是 headless shell，缺一仍启动失败；实测：仅 junction 全量 chromium 时 launch 报 Executable doesn't exist，补 headless-shell 后 vendored CLI 离线完整抽取 example.com exit 0）；CLI 另支持 `BROWSER_CDP_ENDPOINT` CDP 挂接（MCP server 源码不支持，故不作统一策略）；测得 vendored `dembrandt --version` + `dembrandt-mcp` stdio 握手均离线可用；25 用例（含 vendored argv/npx 降级/路径含 `..` 与非绝对根拒绝）
- [ ] E1f（闭环项）external-repos 预研文档状态回写（dembrandt 部分 ✅）

### E2 进化设计（纯 prompt/模板层）

- [ ] E2a 内置设计系统预设 3 → 8–10 套（tokens 化 DESIGN.md + deep-design 选择表扩容）
- [ ] E2b taste 五维自评评分卡 + anti-slop（与 designs/ 近期产物比对防雷同）
- [ ] E2c 大页面两段式生成可选步骤（SKILL.md 工作流层，不动工具面）
- [ ] E2d（闭环项）opendesign 预研文档状态回写

## F. 全域能力扫描（依赖 A-E 合入）

- [ ] F1 静态基线：`npm run check && npm test` 全绿（含 license 门禁）
- [ ] F2 专项套件：sandbox / routing（含 D4 新测试）/ session（P1-1、P1-2 新语义+旧开关）/ actions 27 项三面到达 / gitmcp 8 工具 / designer（extract、drift、预设）
- [ ] F3 接线核验：8 插件包技能加载、MCP builtin 全量起停（含新增 dembrandt）、vendor 13 脚本、i18n 5 语言、desktop:build 三 bundle + extraResources
- [ ] F4 真机烟雾（Windows 必测）：会话→plan mode→工具→permission→design.materialize→review.full→任务树→**重启恢复（验证 P1-1）**
- [ ] F5 逐 spec 终判（specs/ 全目录 19 个）：产出挂账清单——冻结期"闭环"项或显式推迟
- [ ] F6 扫描报告 `docs/pre-production-capability-scan.md` 落盘

## G. 旧文档清理

- [ ] G1 `docs/research/archive/` 建立 + 迁入（zread / memos / pi-sdk / dsh 原文 3 份 / STATUS-2026-08-07.md）+ archive README 指回索引
- [ ] G2 状态行回写（knowledge-materialization、activity-frames spec 等，以 `docs/research/README.md` 台账逐条核对）
- [ ] G3 仓库垃圾：`.playwright-mcp/` 移出追踪 + .gitignore；`v7-strike.png` 处置；Monaco+Mermaid 过时注释清理
- [ ] G4 roadmap 预生产基线快照 + CHANGELOG 本版本汇总 + `docs/research/README.md` 索引同步
- [ ] G5 `*_en.md` 孪生事实性漂移抽查

## H. 预生产切换（依赖 F 全过）

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
