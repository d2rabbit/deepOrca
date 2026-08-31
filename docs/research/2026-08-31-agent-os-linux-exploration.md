# Agent OS（Linux 内核）探索预研

> 日期：2026-08-31 · 状态：**探索性预研（无产品承诺）** · 触发：觉得有意思
>
> 问题定义：如果以 DeepOrca 为用户态内核，造一个"agent 是一等公民、Linux 为底层内核"
> 的操作系统，业界走到哪了？我们手里有多少现成积木？最有味道的技术映射是什么？
> 如果哪天想动手，最小实验长什么样？

---

## 一、先分清三个海拔的 "Agent OS"

这个概念被混用了，先对齐坐标，我们要做的是第 3 层：

| 海拔 | 含义 | 代表 |
| --- | --- | --- |
| ① 比喻层（LLM OS） | LLM=CPU、context window=RAM、工具=外设。任何 agent harness 都是这层的心智模型 | [Karpathy LLM OS](https://promptmetheus.com/resources/llm-knowledge-base/llm-os) |
| ② 软件内核层 | 把 agent 运行时本身设计成 OS 抽象（agent 调度、内存分级、存储管理），但跑在普通 OS 上 | [AIOS / Rutgers（arXiv:2403.16971）](https://arxiv.org/abs/2403.16971)、Letta(MemGPT) |
| ③ 真·发行版层 | Linux 内核 + 为 agent 重造的用户态：登录第一入口是自然语言 shell、init 直接拉起 agent runtime、内核原语（Landlock/seccomp/sched_ext）作为 agent 的权限/进程/调度基座 | [Alibaba Cloud Linux 4 Agentic Edition（ANOLISA，2026-06）](https://www.alibabacloud.com/help/zh/alinux/agentic-os) |

DeepOrca 今天处于 ①＋②之间（harness + 记忆分级 + 权限网关）；
`specs/module-system/design.md` 已经在向 ② 的"产品内核"演进；
本预研讨论的是把它钉到 ③。

## 二、业界先例盘点（截至 2026-08）

**ANOLISA（阿里云，2026-06）——离我们想法最近的真实产品。**
基于 Alibaba Cloud Linux 4 的 Agent-first 发行版：Copilot Shell（`cosh`）取代 bash
成为登录第一入口（自然语言/POSIX 命令双模，原生托管 bash/zsh）；四层架构
（Core / Runtime / Skill 层 / Copilot Shell）；四层纵深安全 + 审批模式。定位是云
ECS 镜像——"OS 的用户主体正在从人变成 agent"。**它验证了路线可行性，但留下了
"本地开发者桌面级 Agent OS"的空位。**

**AIOS（Rutgers，arXiv:2403.16971，200+ 引用）——学术抽象层基准。**
LLM 即内核，提供 agent 调度（上下文切换）、agent 内存分级、存储管理、工具并发管理。
贡献是证明了"OS 词汇表"可以系统性地套在 agent runtime 上，但它是 Python 框架，
不碰真内核。

**OpenClaw（2026-03 起）——极客侧实践。** 个人 AI 助手项目按 "kernel + agent loop
进程" 组织，被社区称为"真正的 Agent OS"，说明这个词在开发者心智里已经有落点。

**内核侧的两个 2026 新信号（最有趣的部分）：**

- [Sandlock](https://multikernel.io/2026/03/14/introducing-sandlock/)（2026-03）：
  用 **Landlock + seccomp-BPF + seccomp user notification** 三个非特权内核原语做
  agent 进程沙箱——无 root、无容器、无 C 编译器。结论：**"进程就是你所需要的一切"**，
  单机 agent 隔离不再需要 Docker/VM。
- [SchedCP](https://arxiv.org/html/2509.01245v3)（arXiv:2509.01245）：让 LLM agent
  通过安全控制面调 **sched_ext**（eBPF 可编程调度器）做内核调度优化，实测最高 1.79x
  加速。反方向的有趣佐证：agent 不只该跑在 OS 上，还能反过来管理内核。

## 三、DeepOrca 现有资产的 OS 映射（关键发现：已有约 60%）

### 3.1 最大发现：`specs/module-system/design.md` 已是半个 Agent OS 宪章

2026-08-15 的模块系统 v2 设计明确提出"**DeepOrca = AI Studio 内核**"，含四层模型
（L0 内核 / L1 平台服务 / L2 发行版 dist.json / L3 用户层）、信任三层（T0 内置 /
T1 签名发行版 / T2 wasm 模块）、**单一内核永不分叉**原则、平台 API semver 契约表。
这是"用户态发行版"意义的完整 OS 化路线。Agent OS = 它的自然延伸：**把 L0 从
Electron/Node 进程钉到 Linux 内核上**，L2 的 dist.json 从"应用清单"升格为"镜像构建清单"。

### 3.2 概念映射总表

| OS 概念 | DeepOrca 现有对应物 | 位置 | 成熟度 |
| --- | --- | --- | --- |
| 进程 / 进程树 | session / subagent / 后台 LLM 任务三层模型；`killProcessTree`（负 pid 组杀） | `core/src/session*.ts`、`common/process-tree.ts` | ✅ 可用 |
| 进程控制块 | SessionEntry（`sessions-index.json` = 进程表） | `session-manager-persistence.ts` | ✅ |
| **syscall 表** | **ActionRegistry**：~30 action，dotted 命名 + JSON Schema 参数 + sideEffects 声明，一次注册三表面（LLM 工具/IPC/UI） | `core/src/actions/registry.ts` | ✅ 天生像 ABI |
| **capability 模型** | 10 个 permission scope + PathGrant 路径级授权 + `SandboxLease`（generation fencing 的 capability 句柄） | `common/permissions.ts`、`common/path-boundary.ts`、`sandbox/policy.ts` | ✅ 雏形 |
| LSM / 沙箱后端 | Sans-IO 策略引擎（后端可插拔）；macOS sandbox-exec 已实现；**Linux bwrap/Landlock 已设计未实现** | `core/src/sandbox/`、`specs/sandbox/design.md` | ⚠️ 缺口 1 |
| execve + 进程组 | bash handler：spawn / 超时 / 后台运行 / killProcessTree | `tools/bash-handler.ts` | ✅ |
| 存储子系统 | 记忆管线：SQLite + sqlite-vec + FTS5、checkpoint、串行队列、托管定时器——**天生是常驻服务的料** | `memory/src/tdai/core/store/sqlite.ts` | ✅ 缺的只是进程边界 |
| swap / 虚拟内存 | compaction（context 超限摘要压缩，LLM 当压缩器） | `session.ts` | ✅ |
| 动态链接 / 共享库 | Skill 系统（XML 块注入）+ 语义路由（embedding 短路，软缓存） | `session-manager-skills.ts`、`routing/` | ✅ |
| 设备驱动总线 | MCP（进程外 server、tools/list 热发现）+ vendored 工具族（codegraph/serena/CRG/…） | `core/src/mcp/`、`desktop/main/tools/` | ✅ |
| **init / systemd** | desktop `main/index.ts` boot 序列：装配十几项系统服务 | `desktop/src/main/index.ts` | ✅ 但被 Electron 绑架 |
| 沙箱化设备 | offscreen Chromium 抓页器（`sandbox: true`、串行化导航队列） | `desktop/main/tools/web-fetch-provider.ts` | ✅ |
| 发行版 | dist.json 组装清单（模块/MCP/Skill/主题/品牌） | `specs/module-system/design.md` §6 | 📐 设计未实现 |
| **登录 shell** | — | — | ❌ 缺口 2 |
| **常驻 daemon** | 决策史上一直回避（"不引入外部 daemon"），但 memory 管线已备好全部素材 | — | ❌ 缺口 3 |

### 3.3 三个缺口（也是三个最有意思的工作项）

1. **Linux 沙箱后端**：sandbox 策略引擎是 Sans-IO 的，后端槽位是空的。补一个
   Landlock/bwrap 后端 = 第一块砖（sandbox spec 本来就规划了，被 macOS 先行挤掉）。
2. **agentd 常驻进程**：把 session manager + memory 管线 + ActionRegistry 装进一个
   systemd 服务。当前 desktop main 进程事实上就是 init，只是名字不叫 init。
3. **cosh 式入口**：自然语言/POSIX 双模 shell。我们的 bash handler + session loop
   拼起来就是一个 cosh，缺的只是把它做成登录壳。

## 四、目标架构草图（海拔 ③）

```
┌────────────────────────────────────────────────────────────┐
│ L3  用户层：dist.json（= 镜像配方）、模块(wasm)、Skill 包      │
├────────────────────────────────────────────────────────────┤
│ L2' cosh 登录 shell（自然语言 + POSIX 双模）/ Wayland 桌面    │
│     （A2UI 渲染面板、审批弹窗=内核 ask 的用户态投影）          │
├────────────────────────────────────────────────────────────┤
│ L1  agentd（PID 1 之下第一个服务，systemd unit）：            │
│     ActionRegistry(syscall 表) + SessionManager(调度器)      │
│     + 记忆 daemon(SQLite 常驻) + MCP(驱动总线) + 路由         │
├────────────────────────────────────────────────────────────┤
│ L0' Linux 内核原语直连层：                                    │
│     Landlock(PathGrant→ruleset) + seccomp(副作用过滤)        │
│     + seccomp user notify(syscall 级审批) + userns/bwrap     │
│     + cgroup v2(agent 资源账户) + sched_ext(可编程调度)       │
├────────────────────────────────────────────────────────────┤
│ Linux kernel + 最小用户态（systemd / busybox / node22）      │
└────────────────────────────────────────────────────────────┘
```

## 五、最有味道的三个技术映射（为什么内核侧不是噱头）

**① PathGrant ↔ Landlock ruleset，几乎一一对应。**
我们的能力粒度（read-in-cwd / write-in-cwd / delete / network…）在 Linux 5.13+
Landlock 里就是"路径 + 访问位"的 ruleset，**非特权、可叠加、不可逃逸**。现在
`permissions.ts` 靠解析命令文本猜副作用（`parseBashSideEffects` 是启发式，
`rm -rf` 声明成只读也拦得住但仅限识别出来的模式）；Landlock 让同一份 grant 变成
内核态强制——agent 里的任意子进程、任意解释器都逃不掉。Sandlock 已给出完整先例。

**② seccomp user notification = 内核态的 AskPermission。**
我们的权限三值（allow/deny/ask）里，"ask" 目前是用户态启发式。seccomp
`SECCOMP_USER_NOTIF` 允许监督进程在**真实 syscall 发生的那一刻**（execve、connect、
openat…）被内核挂起、问人、再放行——无 TOCTOU。这等于把 `AskUserQuestion` 下沉为
内核原语："这个进程想连外网，批准吗？" 是字面意义上内核级的审批弹窗。

**③ agent 的调度问题真的存在，但不是 CPU 调度。**
Agent 进程的阻塞态是全新的三种：等 LLM API（外部算力，秒级～分钟级）、等用户
（交互 IO，无限期）、等工具子进程。CPU 调度无关紧要，**token 预算/并发会话配额/
优先级抢占**才是新调度器——`SessionManager` + `endpoint-quota` 已经是这个调度器的
用户态原型，cgroup v2 可以给它加硬资源边界。反向玩法见 SchedCP：让 agent 调
sched_ext 调度器，形成"OS 为 agent 服务，agent 优化 OS"的闭环。

（同样成立的还有：context window = RAM、compaction = swap、记忆管线 = 页缓存 +
B-tree + 倒排索引、`sessions-index.json` = 进程表、skill 语义路由 = TLB。）

## 六、技术路线（三档，成本递增）

| 档位 | 内容 | 工作量 | 产出 |
| --- | --- | --- | --- |
| **A. 周末玩具** | mkosi 或 bootc 构建最小 Debian/Arch 镜像：systemd 拉起 `agentd`（core headless）+ TUI REPL + Landlock 启动器（读 PathGrant JSON → ruleset → exec bash）+ seccomp-notify 审批 demo，QEMU 试跑 | 1-2 个周末 | 可演示的 ISO |
| **B. 可用系统** | cosh 做成真实登录 shell；memory daemon 独立进程；dist.json 升格为镜像配方（bootc/ostree 原子升级 = 发行版升级）；Wayland greeter 嵌 A2UI 面板；参照发行版=`deeporca-os` | 1-2 个月业余时间 | 给自己日常用的开发机镜像 |
| **C. 内核侧研究** | sched_ext agent-aware 调度器（按任务优先级/token 预算分 cgroup）、eBPF agent 行为观测面、自定义 LSM | 研究项目 | 论文 / 技术旗帜 |

**档位 A 没有任何不可控风险**：core 是纯 Node/ESM、无 UI 依赖（铁律写死），
今天就能在 Linux headless 跑；缺的只是 Linux 沙箱后端和 daemon 入口两个模块。

## 七、冷思考（反方意见，认真记下来）

1. **受众现实**：我们的用户 95% 在 Windows/macOS（bash 工具甚至要靠 Git Bash 硬撑）。
   一个 Linux 专属镜像目前是极客玩具，不解决任何付费用户的问题。
2. **发行版 = 长期债务**：内核安全通告、镜像 CI、LTS 跟进。做一个发行版只要一个
   周末，养一个发行版是一支队伍。ANOLISA 背后是阿里云。
3. **80% 的好处不需要真内核**：硬沙箱（Landlock 后端）、常驻 daemon、自然语言
   shell，全部可以作为普通 Linux/macOS 应用能力落地——`specs/sandbox/design.md`
   里被推迟的 bwrap 后端就是通往同一个世界的第一块砖，而且它对现有产品直接有用。
4. **先例身位**："首个 Agent OS" 已被阿里云拿走（云侧）。差异化空位在
   **"本地开发者的 Agent OS"**——如果把 vision 写成一句话：别人把 agent OS 卖给
   云上租户，我们把自己开发机的 shell 换成 agent。这与 DeepOrca 的 coding-harness
   基因（snippet 编辑契约、file-history 可撤销、权限网关）严丝合缝。
5. **定位建议**：不立项，挂愿景。给 `next/*` 系列留一个 "North Star" 叙事：
   近期每个顺手的功能（Linux 沙箱后端、memory daemon 化、dist.json）都顺手地
   朝它靠近半步，将来想点火时柴已经备好。

## 八、如果哪天想动手：档位 A 实验清单

1. core dist 在 Alpine/Debian 容器内 headless 跑通 session loop（预计零改动，core 无 UI 依赖）。
2. Landlock 启动器：Go/Rust 小程序，输入 PathGrant JSON → `landlock_create_ruleset`
   + restrict self → `execve` bash。对照 `specs/sandbox/design.md` 的 bwrap 后端接口。
3. seccomp-notify demo：监督进程拦截 `connect(2)`，打审批再放行——即内核版 AskPermission。
4. `agentd`：core 的 session manager + memory 管线装进 systemd unit（memory 管线已有
   checkpoint/串行队列，迁移成本低）。
5. cosh 50 行原型：读 stdin，以 `:` 开头走 session（自然语言），否则透传 bash——
   即 ANOLISA copilot shell 的极简同构物。
6. mkosi 打 ISO，QEMU 开机即进 cosh。

## 九、参考来源

- [AIOS: LLM Agent Operating System (arXiv:2403.16971)](https://arxiv.org/abs/2403.16971) · [GitHub](https://github.com/agiresearch/AIOS)
- [Karpathy LLM OS 概念](https://promptmetheus.com/resources/llm-knowledge-base/llm-os)
- [Alibaba Cloud Linux 4 Agentic Edition（ANOLISA）产品概览](https://www.alibabacloud.com/help/zh/alinux/agentic-os)
- [Sandlock: Confining AI Agent Code with Unprivileged Linux Primitives (2026-03)](https://multikernel.io/2026/03/14/introducing-sandlock/)
- [SchedCP: An LLM Agent Framework for Linux Schedulers (arXiv:2509.01245)](https://arxiv.org/html/2509.01245v3) · [解读](https://eunomia.dev/blog/2026/07/10/schedcp-agentic-linux-scheduler/)
- [How to Sandbox and Monitor an AI Agent on Linux in 2026](https://yeet.cx/topical-takes/how-to-sandbox-and-monitor-an-ai-agent-on-linux-in-2026)
- [Is Linux the Best OS for AI Agents? (Wavect, 2026)](https://wavect.io/blog/linux-for-ai-agents/)
- 仓内关联：`specs/module-system/design.md`（内核+发行版宪章）、`specs/sandbox/design.md`（Linux bwrap 后端规划）、`docs/research/2026-08-19-kernel-wasm-systems-refactor-prestudy.md`（内核 wasm 化预研，已拍板保持 TS）
