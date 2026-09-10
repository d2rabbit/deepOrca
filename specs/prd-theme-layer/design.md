# prd-theme-layer — 技术设计

> 对应 [requirements.md](./requirements.md)。关键裁决（user 2026-09-10）：入口两处都要；关系 PRD 级；参考全文注入+预算截断；UI 自动继承+可手动改。

## 1. 数据模型（全部挂在套件 META，不进版本内容）

主题与关系是**套件元数据**——调整它们不产生 PRD 新版本，不触发 20 版本 FIFO。版本内容（spec/openui/leafer/quality）完全不动。

```ts
// shared/ipc.ts（design-store.ts 镜像同构类型）
type DesignThemeRef = { suiteId: string; versionId?: string };
// versionId 省略 = 跟随该 PRD 的 head（注入时读当前 head）；指定 = 钉住具体版本

type DesignTheme = { id: string; title: string; note?: string; createdAt: string; updatedAt: string };

// DesignSuiteMeta / DesignSuiteSummary 增加（可选）：
  themeId?: string;
  stage?: string;                 // 阶段标签，纯展示（目录内按主题内顺序 + 阶段标签呈现）
  inherits?: DesignThemeRef;      // 继承（单父）
  references?: DesignThemeRef[];  // 交叉参考（多选）

// DesignIndex 增加：themes?: DesignTheme[]（可选；version 保持 1，getIndex 缺省补 []）
```

主题存 `index.json` 而非独立目录：主题是轻量分组实体（无版本、无投影文件），与 `suites` summary 同一注册表的既有模式一致（`writeSuiteIndex` 已在同一次原子写里合并多个数组）；独立目录模式（jobs/reviews 那种）适合有自身的重文件载荷的实体，主题不是。

## 2. 存储层 API（design-store.ts）

```ts
listDesignThemes(root): DesignTheme[]
createDesignTheme(root, { title, note? }): DesignTheme | null      // id = randomUUID，isSafeDesignId 同款守卫
updateDesignTheme(root, id, { title?, note? }): boolean
deleteDesignTheme(root, id): boolean                               // 解绑引用套件（meta+索引 themeId 置空）
assignSuiteTheme(root, suiteId, { themeId?|null, stage?, inherits?|null, references? }): boolean
```

- `createDesignSuite` 增加可选 `themeId/stage/inherits/references`（a2ui 建套件即带主题）。
- 主题 CRUD 与 assign 均发 `notifySuiteChange({root, suiteId, change:"theme"})`；`DesignSuiteChangeEvent.change` 联合扩为 `create|update|delete|theme`。
- delete 主题的解绑：遍历索引 summary 找 `themeId === id` 的套件 → 改各自 `meta.json` + 索引条目。

## 3. IPC 通道（shared → preload → design-ipc → renderer）

| 通道 | 读写 | 签名 |
|---|---|---|
| `design:themeList` | handle | `(root) => DesignTheme[]`（未注册根 → `[]`） |
| `design:themeCreate` | privileged | `(root, {title, note?}) => {ok, theme?}` |
| `design:themeUpdate` | privileged | `(root, id, {title?, note?}) => {ok}` |
| `design:themeDelete` | privileged | `(root, id) => {ok}` |
| `design:suiteAssignTheme` | privileged | `(root, suiteId, payload) => {ok}` |

`DesktopApi` 方法 + preload 单行 + `DesignStoreOps` 接口扩展（design-ipc 的 DI 面保持可测试性，测试 harness 以 overrides 注入）。

## 4. a2ui MCP（core↔desktop 唯一落盘缝隙）

- `render_spec` / `render_leafer` inputSchema 增加 `themeId? / stage? / inheritsSuiteId? / inheritsVersionId? / references?`；`persistSuiteContent` 创建/追加路径把主题字段写进 suite meta（meta 不随版本内容存储，`render_spec` 的"重置派生字段"逻辑不触及主题字段）。
- `read_suite_version` 返回载荷附加 `themeId/stage/inherits/references`（来自 meta）——core 的 `readSuiteVersion` 帮助函数解析后供 design.materialize 透传。

## 5. core 动作

### prototype.spec（参考注入）

```ts
PrototypeSpecInput += {
  themeId?: string;
  stage?: string;
  inheritsFrom?: { suiteId: string; versionId?: string };
  references?: { suiteId: string; versionId?: string }[];
}
```

- 注入装配：对 inheritsFrom + references 逐个 `readSuiteVersion(ctx, …)` → `content.spec`；预算：每篇截断 8000 字符（尾部加 `…[截断]`），总预算 24000 字符（超出后剩余参考只列标题）。
- 提示词区块（在需求之后、契约之前）：

```
## 参考 PRD（设计参考上下文）
### 继承：<标题>（<suiteId> v<n>）
<spec 全文（截断）>
### 交叉参考：<标题>（<suiteId> v<n>）
<spec 全文（截断）>
### 参考缺失：<suiteId>（套件或 spec 不可用，已跳过）
约束：延续参考 PRD 的术语/角色/架构约定，不复制其内容；与本次需求冲突时以本次需求为准。
```

- 无任何参考时不注入区块（提示词与现状字节一致——修订单不变性）。
- 标题解析：`readSuiteVersion` 载荷的 `title`；版本标签取返回 versionId 的序号（尽力，缺失则省略）。

### design.materialize（主题透传）

- 既有的 `readSuiteVersion(ctx, prototypeSuiteId, prototypeVersionId)` 载荷现已含 meta 主题字段 → 透传给 `render_leafer`（inherits/references 原样带过去）。UI 侧后续可在工作台/目录手动改（IPC assign）。

## 6. 渲染层

### WorkspaceDirectory（HubSheet 目录，两面板共用）

- 数据：每 workspace 组增加 `themes: DesignTheme[]`（`designThemeList(root)`）；套件 summary 已带主题字段。
- 结构（`ui-design-directory-body` 顶部插入）：

```
▾ 需求主题（theme section header，+ 新建主题 inline input）
  ▾ 人员管理 [n 篇]
    ├ PRD 卡：标题 · 阶段徽标 · [继承自 X] [参考 Y] chips（chips 解析目标套件标题）
  ▾ 登录 [2 篇]
  ─ 未分组（themeId 为空的套件，按现状平铺）
```

- 主题 CRUD：header 行"+ 新建"（inline 输入标题）；主题行 hover 菜单：重命名（inline）/删除（确认文案说明"仅解绑，不删 PRD"）。
- 每套件"…"菜单：归属主题（下拉）/ 阶段（inline 输入）。继承/交叉在目录**只读展示**（编辑在工作台编辑器）。
- 事件：`change: "theme"` 触发目录增量刷新（现有 subscribeToSuiteChanges 通道复用）。

### 工作台（PrototypeWorkspace / DesignWorkspace）

- `DesignWorkspaceFrame` 增加可选 `railHeader?: ReactNode`（`.ui-design-version-rail` 首个 cap 上方）；两工作台渲染 `ThemeStrip`（新小组件）：主题 chip + 阶段 + 继承/参考 chips，只读；无主题字段时整条隐藏（EARS 14）。
- 编辑器生成器（PrototypeWorkspace 现有 composer/spec 流程）增加"设计上下文"折叠区：主题下拉（含 + 新建主题 inline）、阶段输入、继承自单选、交叉参考多选（候选 = 已加载 `designSuiteList` 的 prototype 套件，排除自身）；随 `runSpec` 传入动作入参。
- UI 侧（DesignWorkspace）：主题条 + 目录分组自动生效（meta 透传），无新增编辑面（手动改主题走目录指派）。

### 命名冲突

现有 i18n"主题"= 设计系统主题（dark-tech…）。新实体措辞统一 **"需求主题"**，键空间 `designTheme.*`，与 `designWorkspace.setTokens("Design system")` 系键不混用。

## 7. 测试设计

- store：主题 CRUD 往返 / delete 解绑（meta+索引+事件）/ assign 不追加版本 / 旧索引缺 themes 字段缺省。
- design-ipc：五通道根校验（复用 harness，未注册根 → 空/拒绝/写拒绝）。
- a2ui：render_spec/render_leafer 主题字段落 meta；read_suite_version 载荷带主题；render_spec 重置逻辑不清主题。
- core：prototype.spec 注入全文/预算截断/缺参考跳过/无参考不注入区块（与现提示词字节一致）/字段随 render_spec 透传；design.materialize 主题透传。
- renderer：WorkspaceDirectory 主题分组/未分组/CRUD stub 渲染；ThemeStrip 条件渲染。

## 8. 非目标（重申）

主题级关系、代理自动建主题、目录点击跳转、版本级归属、跨工作区主题共享。
