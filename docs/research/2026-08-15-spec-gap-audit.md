# 规范完整性 + 健壮性 + 模块联动闭环审计 — 2026-08-15（差距审计轮）

> 前置：[2026-08-15-full-regression-review.md](2026-08-15-full-regression-review.md)（功能回归，全绿）。本轮换视角：**逐 spec 对照设计找差距** + **跨模块联动链追踪**。
> 方法：两个并行深度审计（16 份 spec 逐条对照代码；7 条跨模块链路端到端追踪），发现项逐条复核后修复。

## 一、规范完整性判定表（16 spec）

| Spec                                         | 判定                   | 说明                                                                                                                                                   |
| -------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| task-tree                                    | ✅ 完整                | P0/P1/P2 全实 + 面板操作化 + 工作区绑定；唯一缓期 = 快照切换（有记录）；memory-lineage L2 字段被"隐藏消息通道"显式取代                                 |
| pm-design-v2                                 | 🟡 主体完整 + 记录偏差 | 存储管线/Action/面板/materialize 路由全在；**本轮补齐一键具现化按钮**；偏差已回写 tasks.md（2 管线决策 / analysis.json 缓期 / 版本 UI 与独立导出后续） |
| skill-routing                                | ✅ 完整并超越          | G1/G2/M4 + R1-R4 闭环；状态头已从"规划中"更正；两处设计演进（vendored 模型替代运行时下载、会话冻结替代每轮重算）有记录                                 |
| activity-frames                              | ✅ 完整                | 6+3 工具、双管线、13 测试；对账节在 spec 内                                                                                                            |
| deep-design                                  | 🟡 主体完整            | 3 设计系统 + .dd 管线 + 沙箱预览全在；dashboard/deck/mobile/poster 模板与 Canvas UI 未做（产品级后续，非本轮缺陷）                                     |
| define-action                                | ✅ 完整并超越          | 27 个 action > spec 的 11 个；crg.analyze 显式取代记录在案                                                                                             |
| behavior-memory                              | ⚪ 被取代              | L1-L3 behavior.db 设计被 activity-frames 管线 B 取代（轻量画像 + boot 注入）；spec 未标状态——记录为 superseded                                         |
| skill-eval                                   | ⚪ 未启动              | 0%——spec 自标"规划中"，无欺骗性记录                                                                                                                    |
| text-embedding                               | ✅ 完整                | Granite ONNX + 懒加载 + fail-open；运行时下载被 vendor 取代（有记录）                                                                                  |
| mcp-sdk-migration                            | ✅ 完整                | SDK 1.22 全面接入，无缺口                                                                                                                              |
| gitmcp-local-module                          | ✅ 功能完整            | 13/15 勾 + 2 条手工回归项；位置迁移 desktop 有据                                                                                                       |
| a2ui-integration                             | ✅ P0 完整             | 四工具 + 渲染器；P1/P2 为产品方向非核对项                                                                                                              |
| cad-3d / android-dev-kit / harmonyos-dev-kit | ⚪ 未启动              | 规划态，0 代码，无欺骗性记录                                                                                                                           |

**结论**：无"记录声称完成但代码缺失"的欺骗项；所有缺口要么是显式缓期/取代（有文档），要么是诚实的未启动。唯一**陈旧账目**（pm-design-v2 未勾框、skill-routing"规划中"头）已本轮修正。

## 二、跨模块联动链判定（7 链）

| 链                                         | 判定                | 处置                                                                                                                                                                                                          |
| ------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1 UpdatePlan→树→面板                      | 🟡 断（无刷新推送） | ✅ **本轮修复**：面板 15s 温和轮询（plan 物化/agent 分叉最终一致）                                                                                                                                            |
| L2 AskUserQuestion→recall 提示→LLM 可见    | ✅ 通               | hidden 系统 message 仅 display-only 标记，converter 不过滤——LLM 下一轮可见（核验 converter 源码）                                                                                                             |
| L3 merge/abandon→lineage→记忆 capture      | 🔴 **真断链**       | ✅ **本轮修复**：maybeCaptureMemory 纳入 `<task-lineage>`/`<task-recall-hints>` 系统消息（flat assistantText + 结构化 messages[] 双路径）；+回归测试（此前 recycle 注释声称"记忆管道摄取"为**假**——现真闭环） |
| L4 materialize→树 step（面板触发）         | 🟡 条件性静默跳过   | 记录为设计内：无绑定会话则跳过（best-effort try/catch），materialize 本身成功                                                                                                                                 |
| L5 behaviorContext→collectProfile→会话数据 | 🟡 边界缺口         | ✅ **本轮修复**：采集器改用 core `getProjectCode`（含 >64 字符路径的哈希变体），不再漏长路径项目                                                                                                              |
| L6 knowledgeStatus→routing 卡              | ✅ 通（拉取式）     | 手动刷新/mount 拉取；诊断卡可接受，不改                                                                                                                                                                       |
| L7 工作区切换→面板                         | ✅ 通               | 上轮真机验收已锁定                                                                                                                                                                                            |

## 三、健壮性

四套件全绿维持（core **436** / desktop 163 / memory 14 / embedding 10，+1 L3 闭环测试）；check 0 error。本轮修复均为闭环/正确性修复，未引入新表面积。

## 四、dsh 计划 P1 项状态勘误

P1-3（工具顺序稳定化）**代码已实现**（mcp-manager 确定性排序 + 前缀缓存注释）但计划文档未标记——代码为准；P1-1（崩溃合成收尾）/P1-2（压缩两段式）/P1-4（权限钩子）确属未实现，为计划明示的"merge 后下一迭代"，非本轮缺口。

## 五、结论

- 欺骗性差距：**0**（所有缺口有显式记录或诚实未启动标记）
- 真实断链：**1 处（L3）已修复并测试锁定**；边界缺口 1 处（L5）已修复；UX 断链 1 处（L1）已修复
- 本轮新增：DesignPanel 一键具现化（spec P0 核对项）；账目修正 2 处
