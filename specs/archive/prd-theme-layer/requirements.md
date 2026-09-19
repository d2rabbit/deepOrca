# prd-theme-layer — 需求（EARS）

> Phase 1 of spec-workflow。技术方案见 [design.md](./design.md)；任务分解见 [tasks.md](./tasks.md)。本文件只锁验收口径。
> 立项依据：user 2026-09-10 需求——一个工作区不止一个 PRD（分阶段/分模块），PRD 之间不是历史版本而是**并列/继承/交叉**关系，需要以 PRD 主题为维度管理；四项裁决：① 管理入口**两处都要**（HubSheet 侧边目录完整管理 + 工作台版本历史上方轻量指示）；② 关系建在 **PRD 级**（主题纯分组）；③ 新建 PRD 参考已有 PRD **全文注入 + 预算截断**；④ UI 设计稿**自动继承**基底原型主题、可手动改。

## 范围

需求原型（`prototype.*`）与 UI 设计（`design.*`）两个模块新增 **PRD 主题层**：主题（分组维度）+ 套件级主题归属/阶段标签/继承/交叉参考关系，持久化于 `.deeporca/designs/`；HubSheet 侧边目录按主题分组并管理主题；工作台版本历史上方渲染轻量主题条；`prototype.spec` 将继承/参考 PRD 全文注入生成提示词；`design.materialize` 将基底原型的主题字段透传给 UI 设计稿。**不含**：主题级关系（已裁决 PRD 级）、对话代理自动建主题（首版主题 CRUD 全在 UI）、目录内点击跳转（目录维持 view-only）、PRD 历史版本的主题归属（主题跟套件走）。

## 用户故事

- 作为用户，我把同一个功能模块（如"人员管理"）的不同阶段 PRD 归入同一主题，在侧边目录一眼看清模块全貌；
- 作为用户，我新建"登录"模块 PRD 时选择**继承**"人员管理"的既有 PRD——生成的 PRD 延续其术语/角色/架构约定，而不是从零开始各说各话；
- 作为用户，我可以把任意既有 PRD 标记为**交叉参考**（多选），新 PRD 设计时参考它们但不从属它们；
- 作为用户，UI 设计稿从基底原型自动带上主题与关系，UI 目录同样按主题分组（"ui 那边也是如此"）；
- 作为用户，主题与关系的调整**不产生** PRD 新版本——它们是套件元数据，不是版本内容。

## 验收标准（EARS）

### WP1 — 存储层

1. When 主题 CRUD 运行, the system shall 将主题持久化于 `<root>/.deeporca/designs/index.json` 的 `themes` 数组（可选字段，向后兼容，读侧缺省 `[]`），id 走与套件相同的 `isSafeDesignId` 守卫，写入走 `writeJsonAtomic` 原子写。
2. When 删除主题, the system shall 自动将引用该主题的套件（meta + 索引 summary）的 `themeId` 置空（解绑），不删除任何 PRD。
3. When `assignSuiteTheme` 修改套件的主题归属/阶段/继承/交叉参考, the system shall 更新 `meta.json` 与索引 summary 并发出套件变更事件（`change: "theme"`），**不追加版本**。
4. When 主题字段出现在旧数据上缺失, the system shall 一切照常工作（可选字段零迁移）。

### WP2 — IPC 与 MCP 通道

5. When 渲染层调用主题通道, the system shall 提供 `design:themeList / themeCreate / themeUpdate / themeDelete / suiteAssignTheme` 五条通道（读写分离：写走 privileged），全部经 `resolveRegisteredRoot` 根校验，未注册根降级为空/拒绝。
6. When `render_spec` / `render_leafer` 携带主题字段, the system shall 将其写入套件 meta；When `read_suite_version` 返回, the system shall 载荷附带 meta 主题字段（core 由此读取基底原型的主题）。

### WP3 — 生成注入与透传

7. When `prototype.spec` 携带 `inheritsFrom` / `references`, the system shall 经既有 `read_suite_version` 通道拉取目标 PRD 的 `spec` 全文，按预算截断（每篇 ≤8K 字符、总预算 ≤24K）注入 spec-writer 提示词的"参考 PRD"区块，并附约束行（延续参考 PRD 的术语/角色/架构约定，不复制内容，与本次需求冲突时以本次需求为准）。
8. When 被参考 PRD 缺失/损坏/无 spec, the system shall 跳过该参考并在提示词中注明"参考缺失"，不阻断动作。
9. When `design.materialize` 从基底原型生成 UI 设计稿, the system shall 将基底套件的主题字段（themeId/stage/inherits/references）透传给 `render_leafer` 落入 UI 套件 meta。

### WP4 — 渲染层

10. When HubSheet 目录打开, the system shall 在套件列表上方渲染主题区：主题可折叠分组（组内 PRD 卡带阶段徽标与继承/参考 chips，chips 显示目标 PRD 标题），无主题套件归"未分组"；支持新建/重命名/删除主题（删除带确认）与每套件 归属主题/阶段 快捷指派；两块面板（需求原型/设计）同构。
11. When 工作台打开, the system shall 在版本历史上方渲染轻量主题条（主题 chip + 阶段 + 继承/参考 chips，只读；现有 i18n 的"主题"指设计系统主题，新措辞统一为"需求主题"，键空间 `designTheme.*`）。
12. When 在工作台编辑器新建/修订 PRD, the system shall 提供主题选择（含新建主题）、阶段输入、继承单选、交叉多选（候选来自已加载套件列表），随动作入参传递。

### WP5 — i18n 与兼容

13. When 新增用户可见文案, the system shall 落 `designTheme.*` 键于全部 6 语言目录（typecheck 强制）。
14. When 旧工作区无主题数据, the system shall 目录平铺展示（等价"未分组"），工作台主题条缺省隐藏，无回归。

## 非目标

- 主题级继承/交叉关系（user 裁决 PRD 级）；
- 对话代理自动创建/管理主题（首版主题 CRUD 全在 UI）；
- HubSheet 目录内点击跳转打开工作台（目录维持 view-only，`directoryOnly`）；
- PRD 历史版本级主题归属（主题/关系跟套件走，不跟版本）；
- 主题跨工作区共享（主题按 workspace root 隔离，与根校验边界一致）。
