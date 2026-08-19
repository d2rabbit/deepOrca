# Orca Deck v3 模块覆盖矩阵：审计模块 → v3 落点 → 设计稿帧号

> 日期：2026-08-19 · 配套：`2026-08-19-ui-ux-complete-design.html`（27 帧完整设计稿，Liquid Glass）
> 上游：[[2026-08-19-ui-ux-audit-report]]（现状审计）、[[2026-08-19-ui-ux-redesign-vision]]（v3 范式）、[[2026-08-19-ui-ux-redesign-wireframes]]（交互规格）
> 本文回答一个问题：**审计报告里点名的每一个模块/问题，在 v3 里去了哪里。**

## 1. 布局结构件

| 现状模块（审计证据） | 审计问题 | v3 落点 | 帧 |
|---|---|---|---|
| Rail 19 按钮（`App.tsx:1160-1297`） | P1-1 过载、P0-2 条件显隐、P2-1 emoji 图标 | **全部移除**。动作进命令层/目标带；面板进抽屉与浮层；图标全描边 SVG | 01/05 |
| TopBar 48px 多职拥挤（`TopBar.tsx`） | 标题栏/模型/状态/token 挤一排 | **目标带 40px**：目标名 + 步骤进度 + 时长成本 + 上下文环 + 🔔⚭ | 01 |
| 侧栏 280px 11 视图（`use-panel-layout.ts`） | P1-1/2/3 | 拆散重定位（见 §2 逐面板） | — |
| 右侧 `.ui-preview-panel` 无 grid 归属 | **P0-1 疑似缺陷** | 不修复，**拆除**：预览/diff 统一走焦点卡；`.ui-rightpanel`/`.right-open` 死代码删除 | 09/13/14 |
| StatusBar（v1 方案曾有） | v2 已取消 | 信息上移到目标带，进程数在 ⌘⇧P 抽屉 | 01/11 |
| Composer（`Composer.tsx`） | P1-5 待决时整体禁用 | **指示条**：地址化（对选中对象说）、待决不禁用、发送键 44px | 01 |

## 2. 十一个侧栏面板的去向

| 面板 | v3 落点 | 帧 |
|---|---|---|
| Sidebar 会话树 | **车间墙 ⌘⇧M**（工单卡片墙）；搜索/归档进 ⌘K | 04 |
| SourceControlPanel | **变更抽屉 ⌘⇧E**：按工单分组改动 + 提交走闸门 | 10 |
| TaskPanel（计划清单） | **消失并升格**：计划即工单步骤板，主视图本体 | 01 |
| TokenStatsPanel | **账本浮层**（⌘K "账本"）：按工单归账；目标带常驻迷你环 | 18/01 |
| IndexLibraryPanel | **知识源浮层**（改名，去黑话） | 17 |
| CodeReviewPanel | **审查浮层**：按工单归档，意见一键转介入 | 16 |
| DesignPanel / PrototypePanel | **设计资产浮层**（.dd/.ddp/原型统一陈列） | 15 |
| TaskTreePanel（双 UI 割裂 P1-3） | **任务树画布**：单一全屏浮层，git-graph | 19 |
| GitMcpPanel | 并入**插件与 MCP 浮层**（三合一） | 20 |
| EditorPanel | **文件抽屉 ⌘E** + 焦点卡；主区永不被编辑器替换 | 09 |
| PluginMcpPanel + PluginDetail | **插件与 MCP 浮层**：详情为浮层内页，不整页接管（修 P1-3） | 20 |

## 3. 三卡与控制的重新设计

| 现状 | 审计问题 | v3 落点 | 帧 |
|---|---|---|---|
| PermissionCard 逐 scope 审问 | P1-5 打断式、deny 去向隐晦 | **闸门前置**（工单下发时逐步设定）+ **自律度三档** + 高危内联待决（可"仅提交"等第三选项）；deny 以可见胶囊呈现 | 02/06/01 |
| PlanCard 三选一 | 计划是聊天里的临时卡 | **工单起草页**：步骤/范围/gate 全可改，盖章下发 | 02 |
| QuestionCard 问答 | 掐断流 | **步骤内联问答**：问题挂步骤，其余步骤继续；数字键直选保留 | 07 |
| Esc 停止生成 | 单通道 | **⏸ 刹车**（Space）：冻结/恢复，现场保留；指示条发送键生成中变 ■ 双通道 | 08 |
| 流式 "思考中…" | AI 感 | 主视图只有量化仪表；逐字流只在 Tape | 03 |

## 4. 八类浮层 → 统一浮层栈

| 浮层 | v3 处理 | 帧 |
|---|---|---|
| CommandPalette（伪模糊/11 条） | P1-4 → **命令层**：真模糊评分、全注册表、前缀锁域 | 05 |
| UndoModal | **检查点恢复**：按工单步骤归组 | 22 |
| ShortcutsModal | **快捷键表**：与命令层同源 | 23 |
| WorkspaceTrustDialog | **信任 = 默认自律度**，一次讲清 | 24 |
| 分支冲突 Modal | 三选项白话化（合并/变基/停下 + 后果标签） | 25 |
| DiffOverlay | **全屏 Diff**：逐 hunk 接受/拒绝 | 14 |
| EditorOverlay（Monaco 接管主区） | 编辑器改为焦点卡"在编辑器打开"的全屏浮层实例，主区永存 | 09 |
| 预览面板（previewOpen/graphHtml 可同挂） | 互斥由浮层栈统一管理；内容进焦点卡 | 13 |

栈层级：`抽屉 < 焦点卡 < 面板浮层（Tape/资产/审查/账本…） < 命令层/车间墙 < 模态（信任/冲突）`。Esc 关最上层，⌘⇧Esc 清栈（修 P2-3）。

## 5. 反馈与系统模块

| 现状 | v3 落点 | 帧 |
|---|---|---|
| Toast（5 条上限，3.5s 逝） | 保留行为 + **全部落档通知抽屉 ⌘⇧N**（错过≠丢失） | 26/12 |
| ContextProgress 仪表条 | 收编为目标带迷你环 + 焦点卡拆解 | 01/13 |
| ProcessOutputPanel（⌘O/⌘J 冗余 P2-2） | **进程抽屉 ⌘⇧P**，多进程 tab + 超时分档 | 11 |
| TaskProgressPanel 自动浮现 | 并入目标带速率文案 + 通知抽屉 | 01/12 |
| 主题系统（6 套 token 化） | 保留为资产；完整稿用 Liquid Glass 作主视觉，风格试板证明正交性 | style-studies |
| 欢迎页 4 静态卡 / 无导览（P2-8） | **车间墙空态 + 三步导览卡**（⌘K / 工单可改 / 刹车） | 27 |
| i18n 硬编码残留（P2-5）、tooltip 混用（P2-6）、命名不一致（P2-7） | 文案规范入 wireframes §10；tooltip 统一；黑话改名（index→知识源等） | 全稿 |
| Monaco/重面板懒加载、流式节流（亮点 §5） | **原样继承**，完整稿不改动性能纪律 | — |

## 6. Token 体系（Liquid Glass 主视觉）

```
--ink / --ink-2 / --ink-3        文字三级
--paper / --paper-2 / --hairline 纸面内容（永不透明）
--blue / --green / --amber / --red(+soft 各一)   语义色
玻璃配方（仅控件层）:
  background: rgba(255,255,255,.46)
  backdrop-filter: blur(18px) saturate(1.6)
  shadow: 0 8px 28px rgba(31,45,74,.13) + inset 上高光
  形状: 胶囊 / 同心圆角（18px 面板 · 999px 控件）
```

与现有 6 主题并存：新组件只消费 token；Liquid Glass 作为第 7 套主题 `liquid` 进 appearance 注册表（设置帧 21 已体现）。

## 7. 未覆盖声明（诚实清单）

- **Monaco 编辑器全屏实例**：帧 09 只到焦点卡入口，全屏编辑器浮层未单独出图（形态同 14 全屏 Diff 的玻璃壳）。
- **PrototypeWindow 独立窗口**（`?view=prototype`）：维持现状独立窗口，不进浮层栈。
- **A2UI 动态 UI 消息**：在 Tape 中保持原渲染；工作台步骤卡内的富结果（RichToolResult 6 种）沿用现有组件，仅换肤。
- **六主题逐帧适配**：本稿只出 Liquid Glass 主视觉；其余主题靠 token 换肤，不逐帧出图。
