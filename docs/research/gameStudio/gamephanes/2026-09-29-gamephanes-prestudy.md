# GamePhanes（GameForgeBench / Game Terminal-Bench）：把"能跑 ≠ 可玩"做成评测基础设施

日期：2026-09-29 · 分支：`feat/modern-ui-redesign` · 性质：预研报告（无代码变更，不启动 spec）

> **总口径**：调研仅供参考，以项目实际实现方案为主，调研内容不列入正式实现；
> 正式实现一律以 `specs/` 为准。**本文不另立 spec、不启动代码、不给落地方案。**

## 定位声明（先读这个）

本文是 `gameStudio/` 档案的**第三轮第一份报告**，调研对象
**GamePhanes**（GitHub `GamePhanesStudio/GamePhanes`，MIT，475★）。它不是又一个
"prompt → 可玩物"生成器，而是本档案**第一个评测侧对象**：一个 Harbor 兼容的
**游戏 coding agent 基准**（自称"面向交互软件 Coding Agent 的 Terminal-Bench"），
评的是 agent 的**工程能力**（改代码、调试、运行时行为、回归控制），
不是玩家 bot 的操作策略。

| 前两轮报告                                                     | 形态           | 与本文对象的关系                                                                   |
| -------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| VibeGame ×2 / GameFactory-3A / Sprite Studio（第一轮）         | 生成侧三段链   | 生成器的"验证纪律"在 GamePhanes 里变成了**评分器本身**                               |
| OpenGame 09-24（第二轮）                                       | 学术生成+基准  | 同为基准但互补：OpenGame 评**生成质量**（BH/VU/IA，VLM 评审），GamePhanes 评**修复工程**（确定性探针，binary） |
| threejs-game-skills / CCGS 09-24（第二轮）                     | 3D 技能包/治理 | 其"证据链清单/账本"是 prompt 层纪律；GamePhanes 把同一思想做成了**可执行的基础设施** |

在档案全景图上，GamePhanes 补上第四种形态——**评测基础设施**（基准 + 环境 + 轨迹契约），
并且是六个既有对象中唯一以**真实引擎的可运行行为**为唯一事实源的：Godot headless、
Minecraft Paper 服务器、C++ 原生探针，全部绕开 LLM judge。它的口号与档案第一轮
VibeGame"不算证据"四反例、GameFactory"验证不是可选项"完全同源——但它是其中唯一
把这句话**产品化为评分器**的。

**身份澄清（一手核证，README 之间互相矛盾）**：同一仓库有三个名字——仓库与组织叫
**GamePhanes**；英文 README 与 BibTeX 引用叫 **GameForgeBench**（rubric schema 的
命名空间 `gameforgebench.rubric-behavior.v1` 亦此）；中文 README 与 `CITATION.cff`
叫 **Game Terminal-Bench**（署名个人 Chenyi "Zi, Chenyi"）。三者是同一项目，
调研行文以仓库名 GamePhanes 为主。创建 2026-08-21，最后 push 2026-09-12，
主分支仅 6 条 commit（含一条 "restore GamePhanes project"，历史有重置痕迹）。

### 调研材料（全部一手）

| 材料                                                                                                                         | 核证方式             |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `README.md`（EN，GameForgeBench 品牌，含 17 任务发布表）、`README.zh-CN.md`（Game Terminal-Bench 品牌）、`CITATION.cff`        | raw 全文             |
| `docs/architecture.md` / `taxonomy.md` / `benchmark-quality.md` / `trajectory.md` / `open-core.md` / `hosted-service.md`      | raw 全文             |
| Harbor 任务 `repair-kinetic-vault-controller` 全套：`task.toml` / `instruction.md` / `tests/harness.gd`（18 断言）/ `tests/test.sh` / `solution/solve.sh`（oracle 全文） | raw 全文             |
| 评测结果 `benchmark/results/*/v0.1.0/{summary.json,kimi-k3.json}`（含 30-turn K3 trial 全指标）                               | raw 全文             |
| release 任务 rubric 两份：`godot-endless-chunks/rubric.yaml`、`cpp-shadow-map-pass/rubric.yaml`（自审计字段全文）             | raw 全文             |
| 仓库全量文件树（1063 条目）、GitHub API 元数据、commit 历史（6 条）                                                          | API + tree 递归      |
| 本地 runner `src/`（17 文件：cli/core/evaluation/godot/runtime/trajectory）、`package.json`（9 个自检脚本）                   | 文件树 + package.json|
| 在线判题原型 `oj/server.js`（237 行）、Harbor agent 集成 `integrations/harbor/openai_tool_agent.py` + `response_policy.py`    | raw 全文             |

未核证（README 自报，无法独立复核）：语料库 **81 个规范化可执行候选**的规模、
Unity/Roblox/Unreal 任务的存在（尚未发布）。**明确不跟进**项见 §8。

---

## TL;DR

| 层                  | 判断                                                                                                                                                                                                                                   | 证据强度             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **第二层真相**      | 核心命题一句话：传统 Terminal Benchmark 评文件/命令/退出码，交互软件有第二层真相——**工程必须导入、启动、接受受控输入、改变运行时状态、产生预期行为**。整个仓库就是把这层真相做成可执行评分器                                                   | README + 全套任务包一手 |
| **评测对象之争**    | 旗帜鲜明：**评 coding agent 的工程能力，不评玩家 bot**。harness 输入是评测器控制的探针，只用于让提交代码暴露运行时行为；`press_key`/`move_player`/`attack` 等**玩家动作在轨迹契约里被有意拒绝**。这与 GameCraft-Bench（多模态 LLM 看回放打分）是两种对立哲学 | architecture.md + trajectory.md |
| **无 LLM judge**    | 评分路径零 LLM：确定性原生探针（GDScript SceneTree 断言 / C++ 编译探针 / headless marker 字符串）+ binary reward（全部必需行为检查过=1，否则 0）+ 可选 post-hoc 诊断分（passed/total，只做 near-miss 分析，**绝不替代主 reward**）            | harness.gd + rubric.yaml + EN README |
| **oracle/no-op 校准** | 每道任务要求双向校准：**starter 必须失败**（负样本）、**oracle 必须通过**（正样本）、NOP agent 必须得 0。kinetic-vault 实测：starter 挂 9/18 断言、oracle 18/18、Harbor 0.22.0 校准 Oracle=1.0 / NOP=0.0                                      | summary.json + README |
| **自审计 rubric**   | 本档案未见过的最锋利机制：rubric 除了"验证什么"，还**明文声明自己没验证什么**——`evidence_basis`（探针实际触达的证据）+ `unsupported_claims`（哪些声明无证据支撑，如"探针没比较不同 seed 值"）+ `contract_fingerprint`（sha256 版本指纹）  | godot-endless-chunks / cpp-shadow-map-pass rubric.yaml |
| **规模金字塔**      | 宣称 81 候选（五引擎）→ 实际发布 **17 任务**（Godot×10 / Minecraft Paper×4 / C++×2 / HTML5×1）→ 完整 Harbor 校准 **3 道** → 有公开模型分数 **3 条**（均为 Kimi K3：1.0 / 1.0 / 0.0）                                                            | 文件树逐一清点        |
| **诚实边界**        | 本地 runner 有意不宣称容器级保证；showcase 六 demo 是 `reference_environment` 不是 coding challenge；"smoke test ≠ benchmark score"；16 任务批次仅部分有 oracle/no-op 运行记录才算 reproducible                                                | 六份 docs 反复声明    |

**一句话**：GamePhanes 把本档案六项目反复收敛出的"验证纪律"（能跑≠可玩、证据链、
闭集跳过理由）从 prompt 层下沉到了**评分器与任务包格式层**——它对 DeepOrca 的价值
不在游戏内容，而在**给"自动验收"这件事本身立了可抄的工程标准**：
双向校准、确定性探针优先、binary 主分与诊断分分离、验证器自声明证据边界。

---

# Part I 项目画像与第三种评测哲学

## 1.1 基本盘

| 维度   | 事实（一手核证）                                                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 出品   | GamePhanesStudio 组织（CITATION 署名 Chenyi Zi，个人主导），MIT                                                                                       |
| 热度   | 475★ / **7 forks**（2026-09-29 API），创建 2026-08-21，pushed 2026-09-12，1 open issue                                                               |
| 技术栈 | 双语言：**Python**（Harbor 集成 + agent adapter）+ **JavaScript**（本地 runner/CLI/文档站，Node ≥22）；评测环境 Ubuntu 22.04 + Docker（rootless）+ Godot 4.3 |
| 规模   | 1063 文件：`benchmark/`（harbor 任务+harness+结果）、`release/tasks/`（17 任务）、`src/`（本地 runner）、`docs/`（站+6 个 WASM 可玩 demo）、`oj/`（在线判题原型）、`integrations/`（Harbor agent） |
| 主分支 | 仅 6 条 commit，其中 2026-09-12 一条 PR 一次性合入 16 个任务（"release: add 16 tasks (Godot, Paper, C++, HTML5)"）                                    |

## 1.2 三种评测哲学的对位（EN README 自带对比，一手转述）

| 基准                      | 任务类型                 | 评审判定                                     | 引擎运行时       |
| ------------------------- | ------------------------ | -------------------------------------------- | ---------------- |
| SWE-bench                 | 修 GitHub issue          | 仓库现有测试套件过/不过，binary              | 无               |
| JAMER（arXiv 2606.19830） | **生成** Godot 工程      | SCS 结构完整度 + BAS 行为对齐，连续分        | headless Godot   |
| GameCraft-Bench（arXiv 2606.17861） | 140 道 Godot 任务，15 游戏族 | **多模态 LLM rubric judge 看回放打分**，最强前沿 agent 41.5% | 有（回放）       |
| **GamePhanes**            | **既有工程修复**（repair） | **确定性原生探针 + binary reward，零 LLM judge** | Godot/Paper/C++/HTML5 真实运行 |

GamePhanes 自陈三点差异：①每道任务都是**真实引擎里的既有工程修复**，不是生成或纯函数题；
②reward **只**由任务特定运行时行为决定，文件存在/工程解析只是 supporting gate，
**单独不能换来通过**；③binary 主分 + 可选 post-hoc 诊断分，评分路径无 LLM。

与本档案对照：OpenGame 的 BH/VU/IA 是 **headless 执行 + VLM 评审**（生成质量）；
GameCraft-Bench 是 **MLLM 看回放**（更接近"玩起来像不像"）；
GamePhanes 是**状态断言**（行为对不对）。三种哲学分别覆盖"造得出来 /
玩起来对 / 逻辑对"，互不替代——但后两者在"判定不可贿赂"这一条上，
确定性探针是最强的一档。

## 1.3 四层证据分层（architecture.md "Evaluation Surfaces" 的评分版）

EN README "Evaluation Model" 把每个任务的证据分四层，
**"一个看起来合理的文件改动"与"引擎跑起来真的行为正确"由此区分**：

1. **Artifact**：必备文件、schema、绑定、受保护工作区完整性；
2. **Engine**：导入、解析、场景加载、原生启动；
3. **Behavior**：**有序事件、状态转移、边界、持久化、生命周期**（唯一给行为分的层）；
4. **Diagnostics**：不变量级结果，解释为什么过/不过。

这正是第一轮 VibeGame"不算证据"四反例的**基础设施化表述**：帧在动≠可运行
（Engine 层必须真启动）、eval≠证据（Behavior 层必须状态断言）。

---

# Part II 任务包：Harbor 契约深潜（kinetic-vault 全套一手拆解）

## 2.1 任务包五件套

```text
task-name/
├── task.toml          # schema 1.1：产物声明、超时（agent 1800s / verifier 180s）、资源限制
├── instruction.md     # 只描述用户可见结果与约束，不泄露 patch
├── environment/       # Dockerfile + project/（带真实 Bug 的 Starter 工程）
├── tests/             # benchmark 拥有的独立验证（harness.gd + test.sh）
└── solution/solve.sh  # oracle 参考解，评测时不进 agent 工作区
```

硬性禁止（贡献规范）：依赖贡献者本机绝对路径 / 私有包仓库 / 未声明资产 /
**评测时联网下载** / 必须手动操作 GUI 的步骤。

## 2.2 一道"有区分度的难题"长什么样（repair-kinetic-vault-controller）

- **题面**（instruction.md 全文核证）：确定性固定 tick 平台跳跃模拟器，
  "低速下看起来正常，生产回放暴露"六类缺陷——**隧穿、单向碰撞错误、
  丢 buffered jump、coyote off-by-one、dash 变向、移动平台失步**。
  要求整型子像素坐标、半开边界矩形、完整扫掠位移、同输入同 canonical state。
- **断言**（harness.gd，SceneTree GDScript，18 项）：确定性双跑比对 canonical_state、
  14 子像素 dash 贴 1px 薄墙、高速下落精确落在薄地板、单向平台"向上穿过/向下精确落顶/
  横向 dash 不挡"、**coyote 第三 tick 收/第四 tick 拒**、buffer jump 落地边界触发、
  dash 恰两 tick 保持初向、平台完整位移承载、推入死角置 `crushed`。
  通过输出 marker `KINETIC_VAULT_TESTS_PASSED` + 退出码判定；test.sh 另 grep
  `SCRIPT ERROR` 兜底编译错误。
- **oracle**（solve.sh）：直接 `cat` 出完整参考控制器实现（约 190 行 GDScript：
  逐像素扫掠、`_blocks_downward_step` 用"旧 bottom ≤ top < 新 bottom"判单向平台、
  coyote/buffer 双窗口、dash 状态机、平台承载先于自移动且承载碰撞可 `crushed`）。
- **task.toml**：`expert_time_estimate_hours = 6.0`、difficulty=hard、
  artifacts 显式声明 `/app/project.godot` 等三项。

## 2.3 校准与实测结果（versioned JSON，一手）

| 项 | 值 |
| --- | --- |
| 直接校验 | starter 退出码 1、**挂 9/18 断言**；oracle 退出码 0、**18/18 全过** |
| Harbor 0.22.0 校准 | Oracle=1.0、NOP=0.0，运行环境 Ubuntu 22.04 + Docker 28.2.2(rootless) + Godot 4.3 |
| Kimi K3 trial | **reward 0.0**：16/18 过，挂在"coyote 末 tick 收 jump"与"落地边界 buffer jump"两个 off-by-one；30 turns / 517,661 input（483,904 cached）/ 32,660 output / agent 执行 1183s / `finish_reason=stop` |
| 诚实注记 | "CPU 配额因 rootless Docker 无法应用 NanoCPUs 而在服务端副本省略"；"这是 verifier 失败，不是基建失败"；artifact 与 trajectory 各留 sha256，原始档案 `published: false` |

这条 0 分记录是全仓库最有说服力的单件：**一个真实 agent 正常完工、正常停机、
改了有效代码，仍死在边界条件上**——确定性探针把"看起来会了"和"边界上对了"
切开的能力，LLM judge 做不到。

## 2.4 发布矩阵与规模金字塔（文件树逐一清点）

- **harbor 校准任务 3 道**：repair-neon-relay-jump（smoke，K3=1.0，14 turns/13 tool calls）、
  repair-chrono-grid-rollback（回滚/延迟修正/不可变快照/RNG/有界历史，K3=1.0）、
  repair-kinetic-vault-controller（K3=0.0）。
- **release 任务 17 道**（09-12 一批 16 + 此前 1）：Godot×10（血条光泽/夜区状态机/
  回放轨道相机 DPI 无关灵敏度/小地图独立 CanvasLayer/载具效果/无尽区块/像素移动/
  手雷弹道/InkSans 战斗状态/场景运行管理器）、**Minecraft Paper 1.20.4×4**
  （椅子插件座位碰撞/柯基原生实体/kaucja 实体模型动画/en_us-ru_ru i18n settings）、
  C++×2（自研 "kay" 引擎 shadow-map pass 生命周期、台球自旋传递与重叠分离）、
  HTML5×1（cyberpunk 引擎状态转移+敌波+boss 注册表）。
- 自报语料 **81 个规范化可执行候选**（覆盖 Godot/Unity/Roblox/Minecraft/Unreal/Web/generic），
  "verifier 与 oracle/no-op 控件加固后才分批发布"；100 题目标分布：
  玩法系统 28 / 引擎与运行时 22 / UI 与交互 16 / 内容与设计 14 / 架构与数据 12 / 交付与质量 8；
  9 种 task_type（bug_fix / feature_implementation / runtime_debugging /
  interaction_repair / regression_repair / design_completion /
  performance_optimization / build_delivery / reference_environment）。

多引擎复用同一契约这件事本身值得记：**"Godot 优先、契约引擎中立"**
（architecture.md 设计原则第 6 条）在 Godot/Paper/C++/HTML5 四种运行时上都有
实例，说明任务包格式（starter+instruction+tests+oracle）是引擎无关的。

---

# Part III 三个新机制（档案内首次出现）

## 3.1 自审计 rubric：`evidence_basis` + `unsupported_claims`

release 任务的 `rubric.yaml`（schema `gameforgebench.rubric-behavior.v1`）结构：

```yaml
real_behavior_contract:   # 多步事件序列 / 状态转移 / 边界行为 / 观察方式 / runtime_adapter
behavior_scoring:
  task_contract:          # 目标、starter、事件序列、状态转移、边界、运行时观察
  checks:                 # 唯一行为分 check（godot_probe/cpp_probe，weight 1.0）
  no_op_requirement:      # "只有散文/文档不算交付，必须有可执行行为"
  static_checks_role:     # 明文声明 file_exists/file_contains 只是支撑证据，不给行为分
  evidence_basis:         # ← 探针实际触达了哪些证据
  unsupported_claims:     # ← 探针【没有】证明什么，逐条列出
  authoring:
    contract_fingerprint: c1236faf…   # 契约 sha256 指纹
    controls_required_before_release: true
  acceptance_mode: runtime_behavior
```

`unsupported_claims` 的真实条目（endless-chunks）："探针未比较不同 seed 值"、
"探针未对同一生成器实例二次 configure_seed"、"探针未证明 spike 特定落在平台缺口
（只证明了至少一个 spike 布尔）"、"探针未单独测试非法实体 id"、
"探针直接实例化脚本而未启动 Main.tscn，故完整场景级观察契约未满足"。
cpp-shadow-map-pass 同样自曝："未创建两个合格平行光，故'选第一个'未被直接证明"、
"只有一个合格 caster，故'画出每一个'未被直接证明"。

**为什么锋利**：这是"验证器给自己开无保留意见审计报告"——评分边界不是被研究者
逆向发现的，而是出题方主动声明的。本仓 `design.audit`（三轴机检）与 CRG review
报告只输出"查了什么、结论是什么"，从不输出"**我没查什么**"。补上这一条，
任何机检报告的可信度陈述就闭环了。

## 3.2 oracle/no-op 双向校准 + 发布门禁

每道生产任务的发布门禁（benchmark-quality.md，7 条）：
①pinned starter + 确定性重置；②instruction 只描述用户可见结果不指定 patch；
③至少一个真实诊断步骤 + 一次有意义编辑；④独立的构建/运行时/行为/回归检查；
⑤私有评测器、私有 fixture 或反捷径检查；⑥**一份干净运行报告 + 至少一败一成
两条作者轨迹**；⑦人工审查歧义/意外捷径/确定性/难度。

配套**拒绝清单**（评审直接拒）：删掉玩法循环即可通过 / 把工程换成空壳 /
削弱 verifier / 只依赖截图 / 把受控探针序列硬编码进候选工程即可通过。

最小充分校准对：**starter 必须失败 + oracle 必须通过 + NOP 必须得 0**。
EN README 还立了发布纪律："仅通过静态检查不能宣布任务已验证"、
"接口 smoke test 不等于 benchmark 分数"、"只有当前 Harbor 0.22.0
oracle/no-op 运行记录的任务才计入 reproducible"。

## 3.3 轨迹契约：coding-agent rollout ≠ gameplay trajectory

trajectory.md 定义版本化 schema（step/actor/action/observation/result/reward/cost），
**reward 描述工程进展（断言得分/构建成功），绝不描述玩家表现**。两条硬边界：

- **Agent 动作闭集**：`terminal_command / read_file / write_file / apply_patch /
  run_godot / run_playtest / inspect_scene / take_screenshot / repair`；
  `press_key / move_player / attack` 等**玩家控制动作被有意拒绝**记录。
- **evaluator_probe 轨迹单独标记**：`gamephanes run --trajectory` 只记录评测器侧
  探针轨迹，**明确不得计入 coding-agent rollout**。

用途声明同样克制：versioned 记录可作 Agent 上下文 / 基准证据 / 监督修复数据 /
后训练 RL 轨迹，"不应被描述成游戏操作轨迹"——这句话是防自己人过度营销的。

## 3.4 工程配套（简）

- **主机侧 agent adapter**（`integrations/harbor/openai_tool_agent.py`）：
  无第三方依赖的 OpenAI 兼容 tool agent，单工具 `run_terminal`，
  避免在每个一次性任务容器里装 uv/Agent SDK；`response_policy.py` 三态
  （有 tool_calls→执行 / finish=length→continue / stop→complete，其余抛错）。
  连"kimi-k3 网关要求 temperature=1、temperature=0 被拒"这种约束都记录在案。
- **oj/ 在线判题原型**（237 行 Node）：POST zip（12MB 上限）→ `safe_extract.py`
  防路径穿越 → 必备文件校验 → docker build → **两遍验证**（broken：原工程必须失败；
  solved：oracle 必须通过）→ `pending_review` 人工复核
  （admin password + `timingSafeEqual`，approved/rejected/changes_requested）。
  它判的是**任务投稿**而非 agent 提交——"出题本身也要过判题器"。
- **本地 runner**（`src/` 17 文件）：CLI `gamephanes doctor/validate/run/assets/…`、
  taxonomy 校验（拒绝未知领域/错挂子域/不支持类型）、Godot 探测与 headless 执行、
  事件协议（`GAMEPHANES_EVENT ` 前缀逐行 JSON，引擎日志穿插不干扰解析）、
  TrajectoryRecorder/CodingAgentAdapter。9 个 `node --test` 测试文件覆盖
  evaluator/protocol/workspace/taxonomy/trajectory 等。
- **容器纪律**（hosted-service.md worker 职责）：`--network none`、read-only、
  `cap-drop ALL`、pids/memory/cpu/tmpfs 配额、隐藏测试与参考解不出 agent 可见
  文件系统、按 trial 重置、导出脱敏。oj/server.js 实测使用了同一套 sandbox 参数。
- **可玩面**：docs 站 6 个 Godot WASM 导出 demo（`game.pck + game.wasm`）+
  registry 任务卡；架构文档明示它们是 `reference_environment`，
  "不是 coding challenge，不能用来证明 agent 修复能力"。

---

# Part IV 对照本仓（DeepOrca）

## 4.1 关系判定：被评测对象 vs 评测器

DeepOrca 是 coding-agent harness，GamePhanes 是给这类 harness 打分的基准——
**二者是同一食物链的相邻两层**。GamePhanes 的 agent 接入面（OpenAI 兼容端点 +
单工具 `run_terminal`）与本仓 core 的工具循环同构；理论上 DeepOrca 是它定义的
"coding agent"的一个合法被测体。这不构成集成需求（见 §8 不跟进），
但构成**验收方法论的可引用来源**。

## 4.2 逐项对位

| GamePhanes 机制 | 本仓对应物 | 差距判断 |
| --- | --- | --- |
| 四层证据（Artifact/Engine/Behavior/Diagnostics） | 游戏域证据协议仅存在于 gameStudio 调研笔记；本仓 review/CRG 有自己的证据分层 | **词汇可直借**：任何"自动验收"输出面（review 报告、design.audit、任务树完成判定）可用这四层命名，"文件在≠引擎起≠行为对≠可解释" |
| 确定性探针优先、评分路径零 LLM | taste #11 三轴可计算化 + design.audit（确定性零 LLM）已同向 | **原则互证**：本仓在 design 域已做对；游戏域若立项，"行为分只给确定性探针"应写进验收 spec |
| binary 主分 + post-hoc 诊断分分离 | review 结论三值（通过/风险/阻塞）但过程分与结论未分离 | **增量**："部分过≠过"的主/诊断分离可防 review 报告用 80% 通过率掩盖必需项未过 |
| oracle/no-op 双向校准（starter 必败、oracle 必成、NOP=0） | 无对应物（测试有正例，无"必须失败的负样本"制度化） | **本仓最大单条可借鉴**：任何自动验收链上线前先跑负样本，防"永远绿"的验收器 |
| 自审计 rubric（evidence_basis + unsupported_claims + contract_fingerprint） | design.audit / CRG review 报告只报"查了什么" | **档案内最新机制**：报告模板加一节"本报告未覆盖"成本极低、价值极高 |
| Harbor 任务包（starter 带真实 bug + instruction 不泄解 + oracle 独立） | specs 三件套 + 任务树 artifactRefs 有同构骨架 | 游戏线若立项，任务包格式是现成参照；"instruction 不泄露解法"对 eval 场景才关键 |
| 玩家动作闭集拒绝（agent 动作白名单） | 工具白名单 + 权限链同构 | 已有等价物；其"显式拒绝列表"写法可补 |
| 轨迹契约（coding-agent rollout 与 gameplay 轨迹二分、evaluator_probe 不计 rollout） | 使用台账 usage-ledger（请求级）+ 任务树快照 | 形态不同；"哪类轨迹不许混入哪类统计"的防污染意识值得记 |
| 版本化结果记录（task/env/evaluator 版本 + sha256 + 诚实注记） | 会话 usagePerModel 记账 + 调研台账消费状态 | 评测结果的可比性依赖三方版本钉住——本仓 skill-eval 报告可对照 |
| 事件协议（`GAMEPHANES_EVENT ` 前缀逐行 JSON） | 无对应物 | 若做游戏线运行时反馈，前缀协议是最简鲁棒形态 |
| 引擎中立契约、多引擎实例化 | 本仓 harness 引擎无关思想一致 | 互证 |

## 4.3 本仓已更强、不需要对位的部分

- **LLM 循环本体**：GamePhanes 明确"不拥有模型循环"，adapter 只 30 行——本仓
  session loop / compaction / 权限系统是它的上游能力。
- **知识沉淀**：本仓 memory L0–L3 / repair-rule-memory 比 GamePhanes（无记忆组件）完整。
- **交互面**：本仓是桌面 harness（审批/UI/多工作区），GamePhanes 只有 headless CLI。

---

# Part V 可借鉴清单（只记发现，全部 ∥ 观察记账）

> 集成深度标度：L0 = 知识/提示词层；L1 = 用户可选外挂；L2 = 内置能力；L3 = 源码级继承。

| #   | 发现                                                                                                                                             | 深度 | 为什么值得记                                                                                                          | 证据 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | **oracle/no-op 双向校准**：验收器上线前必须证明"starter 必败 + oracle 必成 + NOP=0"，否则分数无意义                                              | L0   | 本仓一切自动验收（review/design.audit/skill-eval/测试门禁）通用的"防永远绿"前置条件；成本一行命令                     | benchmark-quality.md + summary.json |
| 2   | **自审计报告字段**：`evidence_basis`（查了什么）+ `unsupported_claims`（没证明什么）+ `contract_fingerprint`（版本指纹）                          | L0   | 机检报告可信度陈述的闭环形态；design.audit 与 CRG review 输出面可加"本报告未覆盖"节                                    | endless-chunks / shadow-map rubric.yaml |
| 3   | **四层证据词汇**：Artifact→Engine→Behavior→Diagnostics，行为分只归 Behavior 层，文件/解析只是 gate                                                | L0   | "能跑≠可玩"的基建版命名法；游戏线（若立项）验收 spec 与非游戏 review 报告都可直接采用                                 | EN README Evaluation Model |
| 4   | **binary 主分 + post-hoc 诊断分分离**：全部必需检查过才=1；passed/total 只做 near-miss 分析，绝不替代主分                                        | L0   | 防"80% 通过"掩盖必需项未过的评分纪律                                                                                  | EN README 评分设计段 |
| 5   | **确定性探针优先于 LLM judge**：能用状态断言验证的不交给 LLM（其设计原则第 2 条"先确定性，再主观判断"）                                           | L0   | 与本仓 taste 机检同向，是"何时允许 LLM 评审"的清晰分界声明                                                            | architecture.md 设计原则 |
| 6   | **发布门禁 7 条 + 拒绝清单 5 条**（删玩法循环可过/空壳/削弱 verifier/只靠截图/硬编码探针即拒）                                                    | L0   | "验收材料本身的质量标准"——对 specs 任务验收与未来任何评测线都适用                                                    | benchmark-quality.md + README |
| 7   | **"smoke ≠ score" 发布纪律**：接口跑通不算分；仅静态校验不算验证；只有带 oracle/no-op 运行记录才算 reproducible                                  | L0   | 对本仓"功能层面测试"提交口径（如 afdb701a）的对外印证                                                                  | hosted-service.md / EN README |
| 8   | **coding-agent rollout ≠ gameplay trajectory 二分 + evaluator_probe 不计入 rollout**                                                             | L0   | 轨迹/台账防污染意识；usage-ledger 与未来评测数据若合流，需要同类边界                                                  | trajectory.md + architecture.md |
| 9   | **事件前缀协议**：`GAMEPHANES_EVENT {json}` 逐行输出，引擎日志穿插不干扰，坏行单独报告                                                           | L1   | 游戏线若做运行时反馈，这是最简鲁棒形态（grep 友好、可单独报告畸形）                                                   | architecture.md Event Protocol |
| 10  | **主机侧零依赖 agent adapter**（OpenAI 兼容 + 单工具 run_terminal + 三态响应策略），避免一次性容器装 SDK                                         | L1   | 与本仓"重运行时宿主注入、轻容器"倾向一致；未来接第三方 eval 服务时的接入面参照                                        | integrations/harbor/*.py |
| 11  | **任务包五件套格式**（starter 带真实 bug / instruction 不泄解 / tests 独立 / oracle 隔离 / task.toml 声明超时与资源）                            | L1   | 游戏能力线若立项，这是比 OpenGame（学术)更工程化的任务契约参照；"instruction 不泄露解法"一条对内部 eval 同样成立      | README Harbor 任务格式 |
| 12  | **K3 边界失败案例本身**：30 turn 正常完工仍死在 coyote/buffer off-by-one——"长任务正常收尾"不隐含"边界正确"                                       | L0   | 给 review-fix 循环与"多跑几轮就好"直觉的反例；也解释了为什么边界断言要显式枚举                                        | kimi-k3.json failed_assertions |
| 13  | **出题也要过判题器**：oj 原型对任务投稿跑"原工程必败 + oracle 必成"两遍机检再人工复核                                                            | L0   | "specs/spec 本身的质量也要机检"的同构思想（本仓 spec-gap-audit 是人工轮）                                             | oj/server.js evaluate() |

---

# Part VI 风险与不跟进

## 6.1 风险

- **单人项目、生态极弱**：475★ 但仅 7 forks、1 open issue、主分支 6 条 commit
  （历史有重置痕迹）；无论文、无第三方复现、无第二个组织背书。
- **规模金字塔很尖**：81 候选（自报）→ 17 发布 → 3 道完整 Harbor 校准 →
  3 条模型分数（全部 Kimi K3，单一模型、单 trial、无方差）。**任何"排行榜"解读
  都不成立**——项目自己也没这么宣称，这点诚实。
- **品牌与元数据混乱**：GamePhanes / GameForgeBench / Game Terminal-Bench 三名并存；
  zh/EN README 引用署名不一致（个人 vs 组织）；oj/server.js 硬编码个人机器路径与
  内网代理地址直接入库（与其自家"任务不得依赖贡献者本机路径"规范相悖——
  说明内部原型与对外规范之间有卫生落差）。
- **公开侧永远不是生产侧**：open-core 模式下，隐藏变体/反捷径检查/评测权重全在私有侧；
  公开的 17 道任务是"公开开发样本"，**其分数既不可比也不可背书**。
- **容器级保证未兑现**：本地 runner 有意不宣称文件边界/网络策略/配额/签名——
  architecture.md 原话"当前公开版本……尚未宣称提供容器级 Session Gateway"。
- **快照时效**：最后 push 2026-09-12，此后无动静；项目可能转入私有服务化开发
  或停滞，均无法从公开侧分辨。

## 6.2 明确不跟进

- **接入其基准/跑分**：DeepOrca 无对外模型交付诉求，跑 GameForgeBench 无产品收益；
  其 agent 接入面（OpenAI 兼容单工具）与本仓 harness 形态不匹配。
- **Harbor 生态依赖**：Harbor 是其选择的执行框架，本仓自有 session/任务体系，
  引入第二套任务执行框架零收益。
- **oj 在线判题服务**：面向"任务投稿"的社区运营形态，与本仓产品方向无关。
- **81 候选语料 / 私有排行榜 / Rollouts 商业线**：闭源侧内容，无从获取亦无需求。
- **任何形式的代码 vendor**：MIT 干净，但同档案两轮结论一致——**价值在机制与
  纪律层，不在代码层**；且其本地 runner 与本仓 core 职责重叠度低、代码量小
  （17 文件），无可继承面。

---

## 结论

GamePhanes 是本档案第七个对象、第四种形态：前六项回答"AI 怎么把游戏**做出来**"，
它回答"怎么**证明**做出来了"。它把档案反复收敛的验证纪律做成了三件可复用的工程标准：

1. **双向校准**是验收器可信的最小充分条件（负样本必败、正样本必成、无操作得零）；
2. **确定性探针优先、binary 主分与诊断分分离**是评分不可贿赂的最低配置；
3. **验证器自声明证据边界**（unsupported_claims）是机检报告可信度陈述的闭环形态。

三者全部是 prompt/流程层可零成本移植的纪律（§V #1/#3/#4/#5/#2），对 DeepOrca
**非游戏线**（review / design.audit / skill-eval / specs 验收）同样成立，
可在对应 spec 修订时直接回引。游戏线若未来立项，其 Harbor 任务包格式与
引擎中立契约（Godot/Paper/C++/HTML5 四实例）是比学术基准更贴近生产的参照。

**建议动作**：全部候选以 ∥ 状态记账于本文与 gameStudio/README.md，不另立 spec、
不启动代码；唯一建议的跨线动作是把"报告须自声明未覆盖范围"（#2）与
"验收器上线前跑负样本"（#1）两条记入未来 review/评测相关 spec 的修订候选池。
