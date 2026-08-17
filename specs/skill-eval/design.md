# skill-up 技能评估体系集成 — 详细设计

> 日期：2026-08-06 · 状态：规划中
>
> 源项目：[alibaba/skill-up](https://github.com/alibaba/skill-up)（Apache-2.0，Go ≥1.25）
> 前序评估：`docs/research/2026-08-06-skillweaver-skill-routing-integration.md` §3.4
>
> 设计约束：评估是**重 LLM 调用**的批处理任务——永远异步、永不进启动路径、永不阻塞 UI（2026-08-05 白屏事故教训）。

---

## 一、目标

让 DeepOrca 的技能（内置 7 个插件包 + 用户自编技能）质量**可度量、可回归**：

| #   | 目标                                                 | 阶段               |
| --- | ---------------------------------------------------- | ------------------ |
| E1  | 内置技能在 CI 上有回归评估：改技能 = 出报告          | 短期（零产品改动） |
| E2  | DeepOrca 注册为 skill-up 的被测引擎（engine.custom） | 中期               |
| E3  | 用户技能在应用内一键评估，报告进插件详情页           | 远期               |

非目标：不把 skill-upper 的"自动修复技能"循环接入产品（自动改技能风险高，保持人工评审）。

---

## 二、skill-up 能力映射

| skill-up 概念                                | DeepOrca 对应物                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `eval.yaml` + `cases/*.yaml` 声明式用例      | `packages/core/templates/plugins/<pkg>/evals/`（新增目录）                                |
| Agent Engine（claude_code/codex/qodercli）   | E1 用 claude_code 引擎跑（评估的是技能内容，引擎只是执行器）；E2 换成 DeepOrca 自定义引擎 |
| `rule_based` / `script` / `agent_judge` 裁判 | 内置技能用例以 rule_based + script 为主（确定性强、CI 快）；agent_judge 仅用于开放式用例  |
| `grading.json` / `benchmark.md` / JUnit XML  | CI 工件 + PR 评论摘要                                                                     |

关键事实（README 核实）：skill-up 原生支持 Anthropic `evals.json` 导入、`--auto` 自动检测；自定义引擎走 local transport（`docs/design/custom-engine.md`）。

---

## 三、E1 — CI 集成设计（短期）

### 3.1 目录与配置

```
packages/core/templates/plugins/<pkg>/
├── skills/<skill>/SKILL.md
└── evals/                     # 新增
    ├── eval.yaml              # 环境 + 引擎 + 模型 + 裁判默认值
    └── cases/
        ├── <case-id>.yaml     # 每个用例：prompt + 期望（rule/script/judge）
        └── ...
```

`eval.yaml` 骨架（以 browser 包为例）：

```yaml
version: 1
engine:
  type: claude_code # E1 阶段用现成引擎
model: deepseek-v4-flash # 用轻量模型跑用例，控制 CI 成本
judges:
  default: rule_based
```

### 3.2 用例编写规范

- 每个内置技能至少 3 条用例：1 条正向（应该触发/正确执行）+ 1 条反向（不该触发时不触发）+ 1 条边界。
- rule_based 优先：`must_contain` / `must_not_contain` / `regex`；script 裁判放 `cases/scripts/` 用 bash。
- 涉及真实工具调用（codegraph、uv 系）的用例标记 `tags: [slow]`，CI 里默认跳过，仅 nightly 跑。

### 3.3 CI 工作流（`.github/workflows/skill-evals.yml`）

```yaml
on:
  pull_request:
    paths: ["packages/core/templates/plugins/**"]
  schedule: [cron: "0 18 * * *"] # nightly 全量（含 slow）

jobs:
  skill-evals:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install skill-up
        run: go install github.com/alibaba/skill-up/cmd/skill-up@latest # 或下载 release 二进制（固定版本）
      - name: Run evals (changed packages only, PR) / full (nightly)
        run: node scripts/run-skill-evals.mjs --since origin/${{ github.base_ref }}
      - uses: actions/upload-artifact@v4
        with: { name: skill-eval-reports, path: "**/evals/**/benchmark.md" }
```

- `scripts/run-skill-evals.mjs`（新增）：找出变更的插件包 → 对每个包跑 `skill-up run` → 汇总退出码；PR 上不挂红线（report-only），连续 3 次 nightly 回归才开 issue。
- LLM 密钥走 CI secrets（`DEEPSEEK_API_KEY`），用 flash 模型控制成本。

### 3.4 验收（E1）

- 改一个内置技能描述 → PR 自动产出该包的 benchmark.md 工件；
- 用例全部离线可重放（rule/script 裁判不依赖外部服务）；
- CI 增量耗时 < 5 分钟。

---

## 四、E2 — DeepOrca 自定义引擎（中期）

### 4.1 引擎适配器

skill-up 的 `engine.custom` 走 local transport（本地命令/stdio 协议）。适配器：

```
scripts/skill-up-engine-deeporca.mjs   # 新增，Node CLI
  stdin  ← { prompt, workspace, skills[] }
  行为：用 @deeporca/core 直接创建 SessionManager（无 Electron），
        把 prompt 跑一轮（工具用真实内置工具，bash 限定临时工作区）
  stdout → { transcript, toolCalls, finalText }   # skill-up 自定义引擎协议格式
```

- 复用 core 的公开 API，不经过 desktop 包；
- 隔离：每次运行在 `mkdtemp` 工作区 + 隔离 HOME（复用 run-tests.mjs 的隔离做法），技能挂到该工作区；
- 超时与资源：单用例 120s 上限，bash 工具沙箱化（禁网络白名单外、禁写工作区外）。

### 4.2 注册方式

```yaml
engine:
  type: custom
  custom:
    command: ["node", "scripts/skill-up-engine-deeporca.mjs"]
```

### 4.3 验收（E2）

- 同一套用例在 claude_code 引擎与 deeporca 引擎下结果趋势一致（允许分数差异，看排序）；
- engine 适配器不进任何构建产物，纯脚本。

---

## 五、E3 — 产品内评估入口（远期，仅设计要点）

- 插件详情页（`PluginDetail.tsx` 技能视图）加「评估」按钮 → 主进程异步执行 vendored skill-up 二进制 → 进度经 `IpcEvent.SkillEvalProgress` 推流，报告渲染到详情页新区块。
- vendor：`scripts/vendor-skill-up.js`（GitHub Releases 固定版本 + 代理兜底 + `.vendored-skill-up-version` 标记），与 uv/serena/crg 同一通路；**只做版本标记与二进制下载，绝不在运行时编译**。
- 入口只对用户自编技能开放（内置技能只读，CI 已覆盖）。
- 评估产物存 `<project>/.deeporca/evals/<skill>/`，不进会话历史。

E3 实施前需单独评审：涉及在桌面端跑 LLM 批量调用（成本、速率限制、用户预期管理）。

---

## 六、风险与对策

| 风险                   | 对策                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| CI 跑 LLM 用例产生费用 | flash 模型 + 用例数预算（每包 ≤ 10 条）+ PR 只跑增量                   |
| agent_judge 评分抖动   | CI 以 rule/script 为准；judge 用例只做趋势观察，不挂红线               |
| skill-up 版本漂移      | release 二进制固定版本，vendor 标记文件锁定，升级走 PR                 |
| 引擎适配协议变动       | E2 适配器只做薄封装，协议变化时改一处                                  |
| 任何同步阻塞           | 所有执行一律异步子进程；UI 只读进度事件（同 CodeReview/Wiki 面板模式） |

---

## 七、里程碑

| 阶段 | 内容                                  | 出口标准                  |
| ---- | ------------------------------------- | ------------------------- |
| S1   | 7 个内置插件包 evals 骨架 + CI 工作流 | PR 出报告，nightly 全量绿 |
| S2   | DeepOrca 自定义引擎适配器             | 双引擎结果趋势一致        |
| S3   | 产品内评估入口（仅用户技能）          | 另行评审后立项            |
