# prompt-doc-chain — 技术设计

> 对应 [requirements.md](./requirements.md)。链路：`PRD(spec) → pd-design.md → 原型(OpenUI) → ui-design.md → UI(Leafer)`。

## 1. 数据模型

两个新内容字段（随版本快照走，与 spec/arch 同待遇）：

```ts
PrototypeSuiteContent.pdDesign?: string;  // 原型提示词文档（markdown）
UiSuiteContent.uiDesign?: string;         // UI 强化提示词文档（markdown）
```

镜像三处：core `prototype.ts` 内容接口、desktop `design-store.ts`、`shared/ipc.ts`。投影：prototype 套件 `pd-design.md`、UI 套件 `ui-design.md`（`syncSuiteProjections`）。

## 2. 文档契约（core 内常量，提示词内嵌）

- `PD_DESIGN_CONTRACT`（pd-design.md 的产出契约）：必须有 `# 标题` + 固定骨架节——`## 页面结构`（每页：目的/核心区块/入口出口）、`## 交互叙事`（每页关键流：状态/跳转/反馈）、`## 信息架构`（导航模型/层级/术语表）、`## 视觉基调`（关键词级，不给具体样式）、`## 平台策略`（端声明与密度策略）、`## 继承要点`（来自参考 PRD 的延续项）。要求"可执行的提示词"而非 PRD 复述——每节都以指令语气写给原型生成器。
- `UI_DESIGN_CONTRACT`（ui-design.md 的产出契约）：以 pd-design 为输入的**视觉翻译**——`## 画布构图`（每页一帧：区块布局/网格/留白）、`## tokens 映射`（色彩/字级/圆角→设计系统 token 语义）、`## 视觉层级`（每帧焦点序）、`## 状态呈现`（空态/加载/错误的视觉处理）。禁止发明页面（页面集合以 pd-design 为准）。

技能：两级都走 `deep-design`（silent），提示词内嵌契约、不复述技能文档（防两份清单漂移——既有约定）。

## 3. core 动作改动（prototype.ts / design.ts）

### prototype.pddesign（新动作）

- 输入 `{suiteId, versionId, note?}`；读取 spec + 主题层参考区块（**复用** `collectSpecReferenceBlock`，继承/交叉参考的全文继续注入）；产出 pd-design.md → `save_pd_design` 持久化。
- 产出校验：`extractMarkdownDocument`（嵌套围栏感知）+ `#` 标题 + `##` 节 ≥2（轻结构门，缺则 fail-closed 返回结构化错误）。

### prototype.materialize（stage0）

- 设备循环前：`content.pdDesign` 缺失 → 跑 stage0（与独立动作共用同一生成 helper，进度码 `prototype.pddesign.generating/saved`）→ 持久化 → 继续设备循环；已存在 → 直接用。
- 原型生成提示词改为：指令 + 设备契约 + CREATE/QUALITY 契约 + **"The prompt document below is the distilled design intent — drive the program from it"** + pdDesign 全文 + **"The requirements document below is the contract source for scope validation"** + spec。旧数据无 pdDesign 时提示词维持现状（降级）。

### render_spec（失效）

- 重置清单追加 `pdDesign: undefined`（spec → pdDesign 派生链失效）。

### design.materialize（ui-design stage + 透传）

- 基底原型带 `pdDesign` → stage1：UI_DESIGN_CONTRACT + pdDesign + 原型内容 → uiDesign（进度码 `design.uidesign.generating/saved`）→ `render_leafer` 增参 `uiDesign` 落内容字段；leafer 生成提示词改为 uiDesign 主驱动（同样保留 spec/原型为契约源）。
- 基底原型无 `pdDesign` → **既有提示词字节不变**（降级）。
- `design.revise(part="design")`：存在 `uiDesign` 时注入修订提示词上下文（缺失不变）。

## 4. a2ui MCP（desktop）

- 新工具 `save_pd_design`：schema `{document, ...suiteLineageSchema, note}`；suite 路径必选（主题层同款判定键追加）；persist：`{...base, pdDesign, openui: undefined, openuiVariants: undefined, verification: pending, arch: undefined}`，status `"draft"`。
- `render_spec` 重置清单追加 `pdDesign: undefined`。
- `render_leafer` schema 追加 `uiDesign`；persist 落 `content.uiDesign`（不改 quality/review 语义）。
- `usesSuitePersistence` 判定键无需变（save_pd_design 强制 suite 路径）。

## 5. 渲染（desktop renderer）

- PrototypeWorkspace spec 页文档头：视图 seg 增加"提示词"（存在 `pdDesign` 才显示；`StreamdownView` 阅读）；动作区增加"重新生成"按钮（`actionRun("prototype.pddesign")`，进度码走 i18n）。
- `progress-label.ts` 追加 4 个码 → 4 个新键 ×6 语言目录：
  `prototype.pddesign.generating/saved`、`design.uidesign.generating/saved`。

## 6. 测试设计

- core：prototype.pddesign（产出/结构门/参考注入/失效重置）；materialize stage0（无→自动生成并驱动；有→不重算）；render_spec 重置 pdDesign；design.materialize（有 pdDesign → ui-design stage + render_leafer.uiDesign；无 → 提示词字节不变）；revise 注入。
- a2ui：save_pd_design 持久化 + 重置语义；render_leafer.uiDesign 落内容。
- store：投影文件 pd-design.md / ui-design.md。
- 渲染：spec 页"提示词"视图条件渲染 + 重算按钮。
- mutation check：stage0 自动生成、ui-design 透传。

## 7. 非目标（重申）

ui-design 独立重算、对话侧命令链路、设计系统变更自动重算、brief/arch 改动。

## 8. 交叉审查修复批（2026-09-10，五路交叉审查后落地）

- stage0 保存走 `preserveDerived`（同动作内 render_openui 将重建派生物；手动重算才重置——否则生成失败会把既有原型从 head 抹掉）；
- `design.uidesign.saved` 移到 render_leafer 成功后发射（画布失败不得谎报"已保存"）；stage0 自动路径同样发射 `prototype.pddesign.saved` 终态码；
- uiDesign 空串 = 显式清除（基底切换且新基底无 pd-design 时清旧视觉意图，revise 不再"keep it honored"过期意图）；
- save_pd_design / render_leafer：载荷钳制（suitePayloadError 同规）+ 严格 lineage 守卫（note 不再隐含套件意图）；
- 参考区块超预算"仅列标题"行硬上限 20 条 + 省略行（防 N 条参考=N 行注入）；
- 主题 IPC 通道载荷钳制（title≤200/note≤2000/stage≤64/references≤100×128）；
- store 嬗壮性：坏主题条目过滤不炸层、删主题先写索引（权威视图）meta 尽力收敛、references/stage 写入钳制；
- a2ui append 路径 assignSuiteTheme 返回值显式检查（主题被并发删除 → 工具显式失败）；
- 目录主题组 `<details>` 可折叠（EARS 10）+ 编辑器内联新建主题（EARS 12）+ 四个主题写路径失败显面；
- 已知限制（记录不修）：同基底 pd-design 重算后，已物化 UI 套件的 uiDesign 仍为旧蒸馏（无失效链；revise 注入旧意图）——需要派生谱系跟踪，超出本批范围。

## 9. 深度机械门与文档引导规范（2026-09-11 二次强化，p-core 走查后）

### 9.1 根因（为什么多次契约强化仍简陋）

历次深度要求全部落在 SKILL.md（静态技能文档），生成路径上唯一的门
`looksLikeSpecDocument` 只查"存在任意标题"——薄文档过门率 100%。且
prototype.spec 提示词刻意"只指到技能契约、不复述节名"（防漂移决策），
弱模型（step-3.7 级）读长技能文档会扫读后自由发挥。

### 9.2 修复（机械执行，不依赖模型自觉）

1. **骨架单源化**：`SPEC_SKELETON` 常量（core prototype.ts）承载九节骨架
   （含「数据与字段」实体表与「### 页面ID 逐页交互明细」），生成提示词内联
   填空式驱动；SKILL.md 撤模板改方法论——单一来源消除"两份清单漂移"。
2. **深度审计门 `specSectionsAudit`**：机械可判定的结构事实——九节齐全、
   功能需求表 ≥3 行且含 P0、数据与字段实体表 ≥2 数据行、页面清单每个页面 ID
   有 `### 页面ID 逐页交互明细` 小节且 ≥2 条 `→` 交互行、验收标准 ≥5 可勾选。
   findings 非空 → 带 findings 修复一轮 → 复审仍败 fail-closed 拒绝落盘。
3. **bug 修复**：`sectionBody` 节体截断（slice(1) 后标题行余部仍匹配
   `^#{1,3}`，行数统计恒 0）——改为从标题行换行符后起算。

### 9.3 pd-design / ui-design 的文档引导规范

两级提示词文档同样受骨架/契约内联驱动（弱模型友好），规范如下：

- **pd-design.md**（PD_DESIGN_CONTRACT）：九节契约已内联进生成提示词；
  审计门 `sectionCount ≥2 + # 标题` 结构门已有。后续若仍漂移，升级为
  与 specSectionsAudit 同构的 `pdSectionsAudit`（页面结构/交互叙事/信息
  架构/视觉基调/平台策略/继承要点 六节逐节点名）。
- **ui-design.md**（UI_DESIGN_CONTRACT）：四节契约（画布构图/tokens 映射/
  视觉层级/状态呈现）同样内联。视觉意图的"深度"主观性强，首版不做机械
  审计，靠 materialize 的修复环兜底结构合法性。
- **遵守契约**（materialize）：逐页（页面 ID 必现 $page）、逐 P0（交互要点
  三态分支化）、逐页明细照字实现、不得越界——四条点名已内联进生成提示词；
  verify 的逐页比对是持久化后的第二道机械校验。

### 9.4 弱模型适配原则（step-3.7 级）

1. 骨架/契约**内联进提示词**，不依赖系统上下文里的长技能文档；
2. 深度/结构要求**机械审计**，不依赖模型自觉；
3. 审计失败**带 findings 修复**，修复提示词逐条点名；
4. 两轮耗尽 **fail-closed**，薄文档永不落盘。
