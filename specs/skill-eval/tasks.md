# skill-up 技能评估体系 — 实现计划

> 日期：2026-08-17 · 状态：**S1/S2 产物落地（2026-08-17 `2c98142`），S1 出口过、S2 出口待对拍**（2026-08-18 回写：此前 T1.1–T2.3 复选框未回写与 pre-production A1-A6 已勾不一致——已按实况补齐勾选；pin v0.9.0 已定版）
> 依据：[design.md](./design.md)（2026-08-06，S1/S2/S3 里程碑与验收口径）
> 前序调研：`docs/research/2026-08-06-skillweaver-skill-routing-integration.md` §3.4
>
> 口径：本文件是正式实现计划（spec 级）；调研文档仅为参考来源。
> 覆盖范围修正：design.md 写"7 个内置插件包"，当前 `packages/core/templates/plugins/` 实为 **8 个**（browser / code / design / knowledge / memory / meta-skills / **vision**（后增）/ work），计划按 8 包计。

---

## S1 — CI 集成（先行，零产品改动）

- [x] **T1.1 skill-up 二进制接入方式确定**（`2c98142`；`scripts/get-skill-up.mjs` Releases API 资产解析 + `.cache/` 缓存 + 校验；**pin 于 2026-08-18 定版 v0.9.0**——ls-remote 核实真实 tag 列（v0.1.0…v0.9.0）后 bump + 本机实拉验证）
  - 不用 `go install @latest`（版本漂移）；固定版本从 GitHub Releases 下载 amd64/arm64 二进制，CI 缓存。
  - 本地开发可选 `scripts/` 下的同版本下载 helper（复用 `scripts/vendor-download.js` 的代理回退 + `assertSafeVersion`），不做 vendor 进包（CI-only 工具，不进 `desktop:build`）。
  - 验收：同一版本号在 CI 与本地行为一致。

- [x] **T1.2 `scripts/run-skill-evals.mjs`（新增）**（`2c98142`；变更包检测 + report-only/nightly 双模式 + 退出码 0/1/2 契约）
  - `--since <ref>`（默认 `origin/master`）：`git diff --name-only` 过滤 `packages/core/templates/plugins/<pkg>/**` 得变更包集合；`--all` 跑全量；`--package <pkg>` 单包。
  - 对每个包：`skill-up run` 于 `packages/core/templates/plugins/<pkg>/evals/`，收集 `benchmark.md` / `grading.json` / JUnit XML。
  - 退出码策略：PR 模式 `--report-only`（永不非零，产物为准）；nightly 模式聚合非零触发告警；连续 3 次 nightly 回归才开 issue（design.md §3.3 口径）。
  - 验收：本地 `node scripts/run-skill-evals.mjs --package browser` 可跑通（无 skill-up 二进制时报清晰错误并退出码 2）。

- [x] **T1.3 `.github/workflows/skill-evals.yml`（新增）**（`2c98142`；PR paths 过滤 + cron `0 18 * * *` + artifacts；**CI 首跑待首次 PR 验证**）
  - 触发：`pull_request.paths: ["packages/core/templates/plugins/**"]` + `schedule: cron "0 18 * * *"`（nightly 全量含 `slow`）。
  - Secrets：`DEEPSEEK_API_KEY`；模型 `deepseek-v4-flash`（design.md §3.1 成本口径）。
  - 步骤：checkout → 下载固定版本 skill-up → PR 跑变更包 / nightly 跑 `--all` → `upload-artifact` 收集 `**/evals/**/benchmark.md`。
  - 验收：改一个内置技能描述的 PR 自动产出该包 benchmark.md 工件；CI 增量耗时 < 5 分钟。

- [x] **T1.4 8 个插件包 evals 骨架 + 首批用例**（`2c98142`；8 包 eval.yaml + 14 用例，rule_based 离线可重放）
  - 每包新增 `evals/eval.yaml`（骨架照 design.md §3.1：`engine: claude_code`、`model: deepseek-v4-flash`、`judges.default: rule_based`）。
  - 每包 ≥ 3 条用例（1 正向 + 1 反向 + 1 边界），`rule_based`（`must_contain` / `must_not_contain` / `regex`）优先；script 裁判放 `evals/cases/scripts/`。
  - 首批重点包（触发频率高/已回归过的）：`code`（arch-scan、smart-code-review）、`browser`（web-access-strategy）、`knowledge`（wiki-qa）；其余 5 包先立骨架 + 各 1 条正向用例，逐步补齐。
  - 涉及真实工具（codegraph/uv/serena）的用例标 `tags: [slow]`，PR 跳过、nightly 跑。
  - 验收：rule/script 裁判用例全部离线可重放（不依赖外部服务）。

- [x] **T1.5 S1 出口检查**（`2c98142`；本地验证退出码路径全过；CI 首跑闭环项）
  - design.md §3.4 三条验收全过（PR 出报告 / 离线重放 / 增量 < 5min）；
  - `docs/research/README.md` 中 skillweaver 行 P3 状态由"实现计划已建"回写为"S1 ✅"。

## S2 — DeepOrca 自定义引擎（S1 稳定后启动）

- [x] **T2.1 `scripts/skill-up-engine-deeporca.mjs`（新增，Node CLI）**（`2c98142`；mkdtemp 隔离 + 120s 上限 + 权限钳制）
  - 协议：stdin ← `{ prompt, workspace, skills[] }`；stdout → `{ transcript, toolCalls, finalText }`（skill-up `engine.custom` local transport 格式，见其 `docs/design/custom-engine.md`）。
  - 实现：直接 `import("@deeporca/core")` 建 `SessionManager`（无 Electron），跑一轮激活；工具用真实内置工具。
  - 隔离：每次运行 `mkdtemp` 工作区 + 隔离 HOME（复用 `packages/*/src/tests/run-tests.mjs` 的隔离做法）；技能挂到该工作区。
  - 限制：单用例 120s 上限；bash 工具限临时工作区（写路径白名单），网络禁用白名单外目标。
  - 验收：适配器不进任何构建产物（纯脚本）；本地可被 skill-up 以 `engine.custom` 拉起。

- [x] **T2.2 注册与对照**（`2c98142`；`engine.custom` 示例已注册于 code/evals.yaml（注释态，对拍时临时启用）；**双引擎趋势对拍待联网跑真实 LLM 用例——留作预生产测试内容**）
  - eval.yaml 支持 `engine: { type: custom, custom: { command: ["node", "scripts/skill-up-engine-deeporca.mjs"] } }`。
  - 同一套用例（建议 code + browser 两包）在 claude_code 引擎与 deeporca 引擎下各跑一轮，比较排序趋势。

- [ ] **T2.3 S2 出口检查**（**未过——双引擎趋势一致未验证（T2.2 对拍未跑），待真实 LLM 闭环**）
  - design.md §4.3 验收：双引擎结果趋势一致（允许分数差异，看排序）。

## S3 — 产品内评估入口（**不排期**，另行评审后立项）

- 维持 design.md §五 定位：仅用户自编技能、异步执行、vendored skill-up 二进制（`scripts/vendor-skill-up.js` + `.vendored-skill-up-version`）。
- 前置条件：S1/S2 稳定运行 ≥ 2 周，且确有用户诉求；届时单独评审（成本/速率限制/用户预期）后再转正式任务。

---

## 依赖与并行关系

| 并行线 | 说明 |
| --- | --- |
| GitMCP 四项增强 | 2026-08-17 同批拍板，互不阻塞（GitMCP 在 `packages/desktop/src/main/tools/gitmcp/`，本计划在 `scripts/` + CI + templates） |
| skillweaver P2 book-distill | 同批拍板；book-distill 产出的新技能天然成为本体系的被测对象（先有 evals 骨架，后有新技能，顺序正好） |

## 风险继承（design.md §六）

- CI LLM 费用 → flash 模型 + 每包 ≤ 10 条 + PR 只跑增量；
- agent_judge 抖动 → CI 以 rule/script 为准，judge 仅趋势观察；
- skill-up 版本漂移 → release 二进制固定版本，升级走 PR；
- 任何同步阻塞 → 全部异步子进程，产品侧（S3）UI 只读进度事件。
