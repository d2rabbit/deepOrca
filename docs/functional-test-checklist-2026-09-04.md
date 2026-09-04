# 功能测试清单（2026-09-04 批次：CMB 供给侧工程 · memory.audit/distill · depth-lane 双轨）

> 适用版本：`feat/modern-ui-redesign` @ 2026-09-04 批次提交（007d57e8…本清单提交）。
> 使用方法：按节顺序测，每项标 ✅/❌；**前置准备**先做，否则一半的项没有触发条件。
> 环境注意：Node ≥22.5（桥需 node:sqlite）；桌面包 `npm run desktop:build && npm run desktop:start`。

---

## 0. 前置准备（约 5 分钟）

| # | 步骤 | 期望 |
| --- | --- | --- |
| P1 | `npm run check && npm test` | 全绿（0 失败） |
| P2 | `npm run desktop:build`，然后 `npm run desktop:start` 启动应用 | 应用正常启动，无报错弹窗 |
| P3 | 打开设置，确认模型端点可用（StepFun/DeepSeek 任一） | 能正常对话 |
| P4 | 找一个真实项目工作区注册（建议 GVGL 或本仓自身） | 侧栏出现该工作区会话列表 |
| P5 | **开启 complexityGate**：编辑 `~/.deepcode/settings.json`，顶层加 `"complexityGate": { "enabled": true }`（不开启则 C/D/E 节的 lane 相关项无法触发） | 保存后重启应用 |

---

## A. 基础回归（先确认没打破既有功能）

| # | 操作 | 期望 | 对应提交 |
| --- | --- | --- | --- |
| A1 | 普通提问（"解释一下 X"） | 走轻轨直接作答；行为与改动前一致 | depth-lane P0 |
| A2 | 连续对话 3+ 轮 | 上下文连贯，无异常截断 | — |
| A3 | 编辑一个代码文件（让 agent 改 .ts） | 工具结果里出现一行"（已修改 xxx.ts，建议立即运行诊断检查该文件。）"；改 .md 时**不**出现 | CMB-3 `95e0ac5d` |
| A4 | 让 agent 写一个新代码文件 | write 结果同样带诊断提示 | CMB-3 |
| A5 | 既有技能自动匹配（提问命中某 skill 描述） | 匹配行为不变（模板化重构后语义等价） | CMB-4 |

## B. 诊断诚实化（CMB-1 + CMB-5，`007d57e8`）

| # | 操作 | 期望 |
| --- | --- | --- |
| B1 | 让 agent 修改一个有类型错误的 .ts 文件，回合结束 | 系统消息注入"⚠️ 编辑后诊断检查发现 N 个错误"+ 文件+行号列表 |
| B2 | 设置开启 `lspDiagnostics.enabled` + `trigger: "auto"`，改一个 TS 文件 | 诊断同时含 Serena（语法）与 LSP 桥（类型）两路结果，去重合并 |
| B3 | **假阳性防线**：在一个**没有 node_modules** 的 TS 项目（或临时改名 node_modules）让 agent 改代码 | 诊断消息为"部分诊断检查不可用：LSP bridge（deps-missing…run npm install）"，**不是**一堆假 import 错误 |
| B4 | 恢复 node_modules 后再改一次 | 诊断恢复正常（探测不缓存，立即自愈） |
| B5 | turn 结束时 kill 掉 Serena（或断开其 MCP）再改文件 | 降级行出现（Serena（原因…）），不再静默假 clean |

## C. 复杂性双轨（depth-lane，`500fdff7`/`cdf2d162`）

| # | 操作 | 期望 |
| --- | --- | --- |
| C1 | 开启 gate 后问简单问题（"什么是 X"） | **轻轨**：会话卡出现青色 ⚡轻轨徽标；响应速度与未开 gate 时一致 |
| C2 | 问复杂多权衡问题（含"方案/权衡/风险/要不要"等词） | **重轨**：会话卡琥珀色 ▤重轨徽标 |
| C3 | 重轨运行中观察消息区上方 | **阶段进度条**依次显示 S1 情境编译 → S1.5 证据闸 → S2 分歧生成 · 1/3 → S3 对抗测试 → S4 融合校准 → S5 判定输出，完成后 4 秒自动消失 |
| C4 | 重轨最终输出 | `<proposed_plan>` 形态深度报告：**结论（先读这里）**置顶 + 置信度 + 分歧点 + 关键假设 + 风险与红线（不可逆风险置顶标"需用户拍板"）+ 下一步 |
| C5 | 重轨运行中点停止 | 中断干净落点，无残留后台子代理（活动监视器查 silent 子进程） |
| C6 | 设置面板 → 关于/About 区块顶部 | **"车道观察（只读）"**区块：轻/重轨会话数、追问率/负反馈率（真实历史会回溯，L1×N 标记）、autoTune 保持关闭提示 |
| C7 | 把 gate 关掉再测 C1 类问题 | 无徽标、无进度条、无额外 flash 调用（字节级等价回归） |
| C8 | 观察设置面板空数据项目（新工作区） | 显示"暂无车道数据"空态，不报错 |

## D. 记忆审计 memory.audit（`19b3bcf9`/`3754ea29`，对 agent 说）

| # | 操作 | 期望 |
| --- | --- | --- |
| D1 | "运行 memory.audit"（dryRun 默认） | 返回证据快照：扫描会话数/排除 silent 数/失败事件/佐证模式；**不写任何文件** |
| D2 | "memory.audit，synthesize 开启且落盘" | 产出记忆规则建议（≤5 条，每条带 ev-N 证据引用）+ 双语 HTML 报告落 `.deeporca/audits/` |
| D3 | 按 reviewInstructions 逐项回答接受/拒绝 | agent 用 AskUserQuestion 逐项问；回答后调 recordDecisions |
| D4 | 接受一条 | 返回受控写回指令：明确"用原生 edit 工具、先 read 取 snippet_id"；随后 agent 真的经 edit 写 AGENTS.md（弹权限确认） |
| D5 | 再跑一次 D2 同素材 | 已决策的提案**不再出现**（决策持久化生效） |
| D6 | 篡改 auditId（"memory.audit recordDecisions auditId=../../x"） | 干净报错"invalid auditId/snapshot not found"，不越界 |

## E. SOP 萃取 memory.distill（`35790718`）

| # | 操作 | 期望 |
| --- | --- | --- |
| E1 | 跑完一个成功任务后说"memory.distill 这次会话" | 会话摘要（意图序列/工具画像/结论）+ SOP 提案 |
| E2 | 合成包含新建技能提案时 | body 是完整 SKILL.md 草案（frontmatter name/description + 步骤） |
| E3 | 提案里技能名与已有技能同名时 | 该条被丢弃（dropped 计数+1），只留增补类 |
| E4 | 接受一个 skill-new | 写回指令指定**原生 write 工具**建 `.deeporca/skills/<name>/SKILL.md`；落盘后技能列表出现新技能 |
| E5 | 拒绝一条后再蒸馏同会话 | 该条不再重现（与 memory.audit 共享决策库） |

## F. 记忆供给面（CMB-2/CMB-7/CMB-8，`584440aa`/`3754ea29`）

| # | 操作 | 期望 |
| --- | --- | --- |
| F1 | 对 memory 包跑 `node packages/memory/src/tests/run-tests.mjs` | 71/71 全绿 |
| F2 | 聊天里说"我上周做了 X"（等 L1 抽取后新会话召回） | 召回行"上周"后跟"（→ 绝对日期区间）"标注；原文保留 |
| F3 | 召回一条无活动时间、仅有记录时间的记忆 | 显示"（记录于 YYYY-MM-DD）"而非"活动时间" |
| F4 | 检索命中率场景（生僻旧记忆+模糊问法） | 日志出现 `telemetry: recall rounds=2`（稀疏首轮触发二轮） |

## G. 视觉与 i18n（`b40d36d5`/`181530b4`/本批）

| # | 操作 | 期望 |
| --- | --- | --- |
| G1 | 六语言切换（设置→语言）后看徽标/进度条/面板 | 轻轨/重轨/阶段名/面板文案全部跟随本地化（zh/zh-tw/zh-hk/ja/ko/en） |
| G2 | 徽标视觉 | 1x 尺寸下图标清晰、青/琥珀对比可辨、文字不挤（内边距已按 mmx 评审修过） |
| G3 | 停止/权限/沙箱既有路径 | 全部不受影响（重轨中断走 interruptSession 语义） |

---

## 已知观察项（非缺陷，测试时留意记录）

1. **L2 空评分率**：StepFun flash 端点实测 2/4 概率返回空评分 → fail-open 兜底为轻轨（真机验证过）。测试时统计你环境下的比例，>50% 的话值得为评分调用加一次重试。
2. **重轨耗时/成本**：真机一次完整重轨 ≈102s、十余次 LLM 调用。观察设置面板的重轨会话数与负反馈率是否与体感一致。
3. **autoTune 保持关闭**：面板只读展示；开闸需积累 ≥20 会话数据后另行拍板。

## 遇到问题时

- 失败项请记录：工作区、prompt 原文、期望 vs 实际、`~/.deepcode/projects/<code>/` 下对应会话 jsonl 的 sessionId。
- 诊断桥问题另附：`audit/` 目录是否存在、语言服务器命令行输出。
- 全部测试入口命令：`export PATH="/Users/kelthas/.nvm/versions/node/v24.19.0/bin:$PATH"` 后跑 npm 脚本。
