# browser-skill

通过 `bsk` CLI 驱动用户的**真实 Chromium 浏览器**（包含用户的登录状态和 cookies）。该扩展会打开一个隔离的 **Agent Window** 用于自动化操作；用户的普通窗口会保持受保护状态，除非你显式借用某个标签页。

## 适用场景

- 打开页面、读取标题/文本、从用户已可访问的站点抓取结构化数据
- 填写表单、点击完成多步骤流程、对 UI 改动进行冒烟测试
- 先用 `bsk snapshot` 理解页面；仅在快照不足以满足需求时才使用 `bsk get-html` 或 `bsk screenshot`
- 操作用户指定给你的某个特定标签页（在 `bsk tab borrow` 之后）

## 不适用场景

- **不涉及浏览器**的任务（仅文件、API、数据库）
- 安装或配置该扩展（改为将用户指向安装文档）
- **凭证窃取**——切勿在银行、SSO 或密码管理器页面上运行 `bsk evaluate` 来提取令牌、cookies 或机密信息
- 长时间控制用户的个人登录窗口——仅借用以完成当前步骤，随后执行 `bsk tab return` 或结束会话
- 当用户只是想要一个解释时，替代用户的手动浏览

## 前置条件

1. `PATH` 中存在 `bsk`（来自 browser-skill 的 Rust CLI）
2. Chromium 中已加载并连接 browser-skill **扩展**（弹窗显示为绿色）
3. 任何 `bsk` 命令都会按需自动启动后台服务；如果出现任何问题，请使用 `bsk doctor`

## 强制工作流

每个自动化任务**必须**遵循此生命周期。**不要**依赖空闲超时（默认会话空闲时间为 5 分钟）。

```
1. bsk session start              → capture the 4-letter session id printed on stdout
2. … every tool command …        → always pass --session <id>
3. bsk session stop <id>          → REQUIRED when done (even on error paths)
```

可选：当连接了多个浏览器时，使用 `bsk session start --browser <instance-id-or-label>`（`bsk browsers` / 错误输出会列出它们）。

紧急清理：`bsk session stop --all` 或 Agent Window 覆盖层上的 **Stop all**。

## 达成目标后即停止

每个任务都是**有界目标**，而非开放式浏览。目标可能来自用户的请求、已记录的 `trace.json`，或两者兼有。

1. **首先定义成功标准**——一个源自用户原话、`purpose` 或 trace 中最后一个有意义步骤的具体、可观察的条件（例如"表单已提交"、"商品已加入购物车"、"播放已开始"）。
2. **走最短路径**——快照 → 操作 → 最多一次检查。不要漫游、重试无关的操作，或堆叠探索性步骤。
3. **一旦达成成功就停止**——立即运行 `bsk session stop <id>`，除非用户明确要求保持会话开启（例如"先别关闭"、"继续浏览"）。
4. **成功后不再操作**——一旦达成目标，不要点击、刷新、导航、重新搜索、切换标签页，或"复核"是否生效。后续验证属于一个新任务。
5. **遇到阻塞时暂停——不要蛮干**——如果页面需要人工输入（登录、验证码、OTP、支付确认），或某个操作连续失败两次且无进展，请调用 `bsk request-help` 而非盲目重试。参见下方的**向人类求助**。
6. **不确定时**——最多多做一次 `bsk snapshot`。如果看起来已达成成功，则停止；如果没有，则询问用户；不要持续点击。

**有 trace 时：**按顺序重放各个步骤，使用 `target` 的 role/name/tag 以及原始的 `value`/`selection` 字段。在最后一步之后（或当其 `effect.navigated_to` / 成功提示得到满足时），立即应用规则 3–4。trace 用于指导执行；它不会将控制范围扩展到目标之外。

**没有 trace 时：**用户的请求*就是*成功条件。满足该请求即结束任务——同样的停止规则依然适用。

## 核心交互循环

写入操作仅影响 **Agent Window** 中的标签页（或你**借用**到其中的标签页）。

```
bsk navigate <url> --session <id>
bsk snapshot --session <id>          → aria tree with @e1, @e2, … refs
bsk click @e3 --session <id>          → or bsk fill, bsk select, bsk press
bsk snapshot --session <id>            → again after navigation / DOM change
```

**引用在导航后会失效**——在新页面上点击、填写或选择之前，务必重新执行快照。

优先使用来自最新快照的 `@eN` 引用，而非原始 CSS 选择器。当存在歧义时使用 `--ref` / `--selector`（`bsk click --help`）。

## 观察优先级

首先使用 `bsk snapshot` 来了解页面结构、文本、控件和元素引用。仅当最新快照无法回答问题时才升级手段：

1. `bsk snapshot`——用于页面理解和交互规划的默认选择
2. `bsk get-html`——当需要隐藏 DOM、元数据或标记细节时
3. `bsk screenshot`——当无法从快照推断视觉布局、canvas/图像内容或样式时。使用 `--ref @eN`（来自最新快照）裁剪到单个元素；省略 `--ref` 则捕获整个可见标签页。

**不要**为了检查页面而首先调用 `bsk get-html` 或 `bsk screenshot`。

## 沙箱规则

| 规则 | 详情 |
|------|--------|
| Agent Window | `bsk tab create`、`bsk navigate`、`bsk click` 等默认作用于 agent 标签页 |
| 用户标签页 | 在被借用前为只读：先执行 `bsk tab list --session <id> --scope user`，再执行 `bsk tab borrow <tab-id> --session <id>` |
| 归还借用的标签页 | 完成后调用 `bsk tab return <tab-id> --session <id>`；未归还的标签页会在 `bsk session stop` 时**自动归还** |
| 在 agent 之外写入 | 当标签页不在 Agent Window 中时，修改页面的命令会失败——请先借用或创建标签页 |

## 全局标志

| 标志 | 用途 |
|------|---------|
| `--json` | 在 stdout 输出机器可读的 JSON（包括错误） |
| `--quiet` | 抑制信息性的 stderr 输出 |
| `-v` / `-vv` | 更详细的日志 |

命令专属标志（超时、`--tab-id`、`--wait-until` 等）：**`bsk <cmd> --help`**

## CLI 命令参考（每个一行）

详情和标志：**`bsk <cmd> --help`**

### 诊断

| 命令 | 摘要 |
|---------|---------|
| `bsk status` | 连接健康状况、已连接的浏览器、活动会话 |
| `bsk doctor` | 深度诊断和修复提示 |
| `bsk browsers` | 列出已连接的浏览器实例（id、label、版本） |

### 会话

| 命令 | 摘要 |
|---------|---------|
| `bsk session start` | 打开 Agent Window；打印 **4 字母会话 id** |
| `bsk session stop <id>` | 结束会话、关闭 Agent Window、自动归还借用的标签页 |
| `bsk session stop --all` | 停止所有活动会话 |
| `bsk session list` | 列出活动会话 |

### 标签页（需要 `--session <id>`）

| 命令 | 摘要 |
|---------|---------|
| `bsk tab list` | 列出标签页（`--scope user\|agent\|all`，默认为 `all`） |
| `bsk tab create` | 在 Agent Window 中创建新标签页（`--url`、`--no-active`、`--index`） |
| `bsk tab close <tab-id>` | 关闭一个 agent 标签页 |
| `bsk tab select <tab-id>` | 聚焦一个 agent 标签页 |
| `bsk tab borrow <tab-id>` | 将一个用户标签页移入 Agent Window |
| `bsk tab return <tab-id>` | 将借用的标签页归还到其原始窗口 |

### 观察（除非特别说明，否则需要 `--session`）

| 命令 | 摘要 |
|---------|---------|
| `bsk snapshot` | 首选的页面理解方式：带有 `@eN` 元素引用的可访问性树 |
| `bsk get-html` | 当快照不足以满足需求时的原始 HTML 转储（token 开销高） |
| `bsk screenshot` | 当快照不足以满足需求时的 PNG 捕获：整个可见标签页，或使用 `--ref @eN` 裁剪到单个元素（`--out` 路径可选） |

### 导航

| 命令 | 摘要 |
|---------|---------|
| `bsk navigate <url>` | 在 agent 标签页中前往 URL（`--wait-until`、`--timeout`） |
| `bsk navigate-back` | 历史记录后退一步 |
| `bsk navigate-forward` | 历史记录前进一步 |
| `bsk reload` | 重新加载当前标签页（`--hard` 绕过缓存） |

（`bsk navigate back` / `bsk navigate forward` 是等效的子命令。）

### 交互

| 命令 | 摘要 |
|---------|---------|
| `bsk click <ref-or-selector>` | 点击元素（`--button`、`--click-count`、`--modifiers`） |
| `bsk fill <ref-or-selector> --value <text>` | 清空并在输入框中输入内容 |
| `bsk select <ref-or-selector> --value <v>` | 通过 `value` 设置 `<select>` 选项（多选时重复使用 `--value`） |
| `bsk press <key>` | 按键/组合键（`Enter`、`Ctrl+A` 等；可选 `--ref` 先聚焦） |

### 脚本与计时

| 命令 | 摘要 |
|---------|---------|
| `bsk evaluate <expression>` | 在 agent 标签页中运行 JS（参见红线）；JS 抛出异常 → stderr，**退出码为 0** |
| `bsk wait-for-navigation` | 阻塞直到加载完成/DOM 空闲等（`--wait-until`、`--timeout`） |
| `bsk wait-ms <duration>` | 休眠（`500ms`、`2s`、`1m`；**无需** `--session`） |

### 向人类求助——`bsk request-help`

当某个步骤需要人工（验证码、登录、OTP），或你希望用户确认某个重要操作时，暂停并请求：

    bsk request-help --session <id> --prompt "Solve the captcha, then click Continue" \
      --title "Captcha required" --target @e7 --target "#submit" --timeout 5m

- `--prompt`（必填）：用户应该做什么。
- `--title`（可选）：覆盖面板的自定义标题。省略时，扩展会显示其默认的本地化标题。
- `--target`（可重复）：一个快照引用（`@e7`）或 CSS 选择器（`#submit`），用于滚动到该位置并闪烁高亮。**强烈推荐**——每当提示涉及一个具体元素（要点击的按钮、要填写的字段、要切换的复选框）时，请传入其 `@eN` 引用/选择器，以便将用户直接引导到正确位置，而不是让其自行寻找。对于交互场景，请始终包含相关的 target；仅在确实没有具体元素可指向时（例如"等待页面完成加载"），才使用不带 `--target` 的提示。
- `--timeout`（默认 `5m`）：等待时长。

目标标签页会被置于前台；当 agent 控制遮罩隐藏时，页面保持可交互状态。该调用会阻塞直到用户采取行动。结果的 `outcome` 取以下值之一：

- `continued`——用户已完成并点击了 Continue（视为确认）。
- `cancelled`——用户点击了 Cancel（视为拒绝/中止）。
- `timed_out`——在超时时间内无人采取行动。
- `navigated`——等待期间页面发生了导航（完全重新加载或 SPA URL 变更）。快照引用已失效；请在新页面上运行 `bsk snapshot`，然后再决定是否再次调用 `bsk request-help`。

`note` 携带用户回传的任何文本。`resolved_targets` 报告哪些引用/选择器匹配到了实际存在的元素。

### 录制——`bsk record`

将用户在 Agent Window 中的操作捕获到 `trace.json`，供后续基于 LLM 的自动化使用：

```bash
bsk record start --browser <instance-id-or-label> [--url https://…] [--purpose "publish a wiki doc"] [--output trace.json]
# `--url` is optional; default https://example.com/ when omitted (must be http(s)).
# Blocks until the user clicks Finish in the recording panel, then writes ./trace.json and closes the window.

bsk record stop [--output trace.json]   # terminal fallback if the browser panel is unavailable
```

- trace 是一个**仅记录的操作日志**（一个 `pages[]` 字典 + 带有 `target` 描述符的 `navigate`/`click`/`fill`/`select`/`press` 步骤）。它记录*用户做了什么*；决定哪些输入是变量则交由执行的 agent 来判断。
- `--purpose` 是可选的上下文元数据；它**不会**改变捕获的内容。
- **没有** `bsk replay` 命令——要重做一个流程，请读取 trace 并复用现有的 `session` / `snapshot` / `@eN` / `click` / `fill` 工具。遵循**达成目标后即停止**。
- **不要**在银行/SSO/密码管理器页面上录制；密码会被脱敏处理，但 trace 中仍可能包含敏感文本。

## 错误处理

### 退出码（在 `bsk …` 之后执行 `echo $?`）

| 退出码 | 含义 | 处理方式 |
|------|---------|------------|
| `0` | 成功（包括 RPC 成功但 JS 抛出异常的 `evaluate`） | 继续 |
| `1` | 用户错误——参数错误、未知会话、标签页不在 Agent Window 中、引用失效 | 修正参数；`bsk session list`；重新执行快照 |
| `2` | 协议/传输——服务不可达、IPC 失败 | `bsk doctor`；检查扩展是否已连接；重试该命令 |
| `3` | 浏览器/CDP 执行失败 | 重试；简化选择器；检查标签页是否仍然打开 |
| `4` | 超时 | 增大 `--timeout`；尝试 `--wait-until domcontentloaded` |
| `5` | 版本不匹配（CLI 与扩展之间） | 升级/重新安装匹配的版本 |

人为错误会在 stderr 上打印 `error:` + `hint:`；`--json` 包含 `code`、`message`、`hint`、`exit_code`。

### 何时运行诊断

| 情形 | 命令 |
|-----------|---------|
| 在一个会话中执行首个任务之前 | `bsk status`——扩展是否已连接？ |
| 任何一次重试无法修复的失败 | `bsk doctor` |
| 多个浏览器/目标错误 | 先 `bsk browsers`，再 `bsk session start --browser <id>` |

务必在类似 `finally` 的路径中执行 **`bsk session stop <id>`**，以确保 Agent Window 关闭、借用的标签页归还。

## 红线

1. **禁止窃取令牌**——不要在敏感站点上执行 `bsk evaluate` 来读取 `localStorage`、cookies 或 auth 头以用于外泄。
2. **禁止长时间借用**——不要在不相关的任务之间将用户的个人标签页留在 Agent Window 中。
3. **禁止跳过停止**——始终执行 `bsk session stop <id>`；切勿假设空闲超时会完成清理。
4. **禁止成功后继续控制**——一旦用户的用户目标（或 trace 的最后一步）已达成，不要继续操作页面；除非用户要求保持开启，否则停止会话。
5. **禁止在快照前升级观察手段**——先使用 `bsk snapshot`；仅当快照不足以满足需求时才使用 `bsk get-html` 或 `bsk screenshot`。元素截图（`--ref @eN`）仍需要新鲜的快照引用——切勿为了获取视觉图而跳过快照。
6. **`evaluate` 强大但有风险**——仅在快照 + click/fill/select 不足以满足需求时使用；切勿在凭证界面上使用。

---

**任何命令的更多详情：** `bsk <cmd> --help`
