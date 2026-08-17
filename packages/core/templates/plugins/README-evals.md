# Plugin skill evals (skill-up)

每个内置插件包的技能评估用例，供 CI 回归与本地复跑。
规范来源：`specs/skill-eval/design.md` + `specs/skill-eval/tasks.md`（S1/S2）。

## 目录结构

```
packages/core/templates/plugins/<pkg>/
├── skills/<skill>/SKILL.md
└── evals/
    ├── eval.yaml          # 环境 + 引擎 + 模型 + 裁判默认值
    └── cases/<case-id>.yaml
```

- `eval.yaml`：`version: 1` / `engine: claude_code`（E1 阶段用现成引擎，评估的是技能内容）
  / `model: deepseek-v4-flash`（轻量模型控 CI 成本）/ `judges.default: rule_based`。
- 用例格式以 `knowledge/evals/cases/*.yaml` 为准：
  `id` / `title` / `description` / `input.prompt`（中文）/ `constraints`
  (`timeout_seconds`, `max_turns`) / `expect` (`must_contain`, `must_not_contain`) /
  `judge.type: rule_based`。
- 编写口径：首批重点包（code / browser / knowledge）每包 ≥3 条（正向 + 反向 + 边界），
  其余包 ≥1 条正向；裁判一律 `rule_based`（离线确定性，不依赖外部服务）；
  涉及真实工具（codegraph/uv/serena）的用例未来标 `tags: [slow]`，PR 跳过、nightly 跑
  （当前无 slow 用例，slow 过滤待 pinned 二进制的 CLI 参数核实后接入）。
- `must_not_contain` 尽量用“错误产物”的具体 token（如 `.mmd`、`.pptx`）而非概念词，
  避免模型在解释“为什么不用 X”时误伤（见 `knowledge/evals/cases/book-distill-boundary.yaml`
  的已知局限注释）。

## 本地运行

```bash
# 1) 下载 pinned 版本的 skill-up 二进制（缓存到 .cache/skill-up/，已 gitignore）
node scripts/get-skill-up.mjs
node scripts/get-skill-up.mjs --check   # 打印解析出的版本与路径

# 2) 跑评估（需要 DEEPSEEK_API_KEY）
export DEEPSEEK_API_KEY=sk-...
node scripts/run-skill-evals.mjs --package browser   # 单包
node scripts/run-skill-evals.mjs --all               # 全量
node scripts/run-skill-evals.mjs --since origin/master  # 变更包（默认 ref）
```

- 二进制缺失且 PATH 上也没有 → 明确报错、退出码 2（infra 错误）。
- 每包超时默认 15 分钟，可用 `SKILL_EVAL_TIMEOUT_MS` 覆盖。

## CI（`.github/workflows/skill-evals.yml`）

| 触发        | 命令                                                                | 退出码策略 |
| ----------- | ------------------------------------------------------------------- | ---------- |
| PR（templates 路径变更） | `run-skill-evals.mjs --since origin/<base_ref> --report-only` | 永不因评估失败挂红线，`benchmark.md` 作为工件上传 |
| 每日 18:00 UTC（nightly） | `run-skill-evals.mjs --all --nightly`                          | 任一包失败 → 退出码 1；连续 3 次 nightly 回归才开 issue |

退出码约定（`scripts/run-skill-evals.mjs`）：

- `0`：全部通过；或 report-only 模式下存在评估失败（以工件为准）。
- `1`：仅 nightly 模式下存在评估失败。
- `2`：infra 错误（无 skill-up 二进制 / git 失败 / 缺 DEEPSEEK_API_KEY）——任何模式下都会挂。

## S1 出口检查（design.md §3.4）

- [x] 改一个内置技能描述 → PR 自动产出该包 `benchmark.md` 工件（workflow 已接线，
      首个真实 PR 上验证）。
- [x] 用例全部离线可重放（rule_based 裁判不依赖外部服务；LLM 调用本身走
      DEEPSEEK_API_KEY，非裁判依赖）。
- [ ] CI 增量耗时 < 5 分钟 —— 待首个真实 PR 的 workflow 运行数据核实。

## S2：DeepOrca 自定义引擎（中期）

`scripts/skill-up-engine-deeporca.mjs` 是 skill-up `engine.custom` 的本地适配器
（stdin `{prompt, workspace, skills[]}` → stdout `{transcript, toolCalls, finalText}`），
直接用 `@deeporca/core` 跑一轮会话。注册示例见 `code/evals/eval.yaml` 中注释掉的
`engine.custom` 块——默认保持 `claude_code`，双引擎对照时临时切换。
