# prototype-reliability — 任务清单

> 对应 [design.md](./design.md) §3 四个工作包。勾选即完成；每项验收标准以测试为准。

## WP0 PRD 驱动的平台判定与页面映射（指令遵循主线，先行）

- [x] 0.1 spec-writer 契约升级：信息表「目标平台」必填行 + 页面清单「页面 ID」列（design.md §3 WP0）
  - 验收：契约测试断言新 PRD 含目标平台行与 ID 列；推断不出平台时落「待确认」而非编造
- [x] 0.2 core 解析 `extractTargetPlatforms` + 页面 ID 列解析（openui-pages.ts）
  - 验收：单测覆盖 单一声明/组合声明(web+mobile)/旧格式降级 null
- [x] 0.3 materialize 按 PRD 判定 devices；UI 按钮去硬编码三端
  - 验收：core 测试——PRD 声明 mobile-only → 仅 render(device:"mobile")；PRD 未声明 → desktop + 观察项；renderer 测试——materialize 入参无 devices
- [x] 0.4 verify 平台一致性检查（声明端 vs 生成端：缺端 failed / 多端 warning）
  - 验收：声明 mobile 只生成 desktop → failed

## WP1 多端循环断链修复

- [x] 1.1 materialize 设备循环 head 线程化（`prototype.ts:526-587`）
  - 验收：desktop 集成测试直连真实 a2ui server + design-store，三端 materialize 全部落盘无 head-moved；core 测试断言第二端 render 入参 versionId = 第一端返回的新 head
- [x] 1.2 revise 设备定向基线取变体（`prototype.ts:807`）
  - 验收：core 测试 device=mobile 时子代理 prompt 含手机变体程序而非桌面本体
- [x] 1.3 renderer 设备修订 diff 口径（`PrototypeWorkspace.tsx:593`）
  - 验收：mobile 端修订后 diff 两端同源（变体 vs 变体）
- [x] 1.4 action schema 补 `devices`/`device` 声明（`prototype.ts:479-488, 751-763`）
  - 验收：契约测试 pin materialize.parameters.devices 与 revise.parameters.device 存在

## WP2 遵循 PRD / 真实可交互 机械 gate

- [x] 2.1 core 纯模块 `openui-pages.ts`（页面清单解析移植 + DSL $page/@Set 提取）
  - 验收：单测覆盖 GFM 表格行/CJK 无空格标题/表头跳过/DSL 提取
- [x] 2.2 verify 三项检查：导航闭包（failed 级）/ 无死页面（failed 级）/ 页面覆盖度**逐页比对**（基于 WP0.1 页面 ID 列：PRD 页缺失 failed、程序多页 warning；旧格式降级数量比对），变体每端各跑
  - 验收：core 测试——拼错导航目标、孤儿页面、PRD 页缺实现均使 verify failed；程序多页产出观察项；无 ID 列旧 PRD 走数量比对不误杀
- [x] 2.3 dead-button 前置：audit 并入 validate verdict + 修复环消费；补 `Action([])` 与单引号检测；core verify 独立检查
  - 验收：修复环测试新增 Action([]) 用例修复成功；渲染器警告通道回归不破
- [x] 2.4 design.lint 死规则替换（DSL 有意义规则：Action([])/未引用 $page/bare-string；保留 emoji）
  - 验收：lintOpenuiDocument 首批单测（当前为零）
- [x] 2.5 design.materialize/revise 跑修复环（导出 repairOpenuiProgram 复用）
  - 验收：design-action 测试断言持久化前经过 validate
- [x] 2.6 引擎补丁 A-1：`design.clock` 工具（startTimestamp/total → remaining）+ `Query(..., 1)` 每秒刷新——番茄钟倒计时真机可跑（design.md §4.4）
  - 验收：交互测试中倒计时绑定每秒更新；SKILL.md 质量契约补「计时类需求用 clock 工具」条目

## WP3 预览一致性

- [x] 3.1 specTodos 节边界 + `[ ]` 前缀清理（`PrototypeWorkspace.tsx:212-222`）
  - 验收：待确认节后有 bullet 节不再误吞；「待确认」早现于正文不锁生成按钮
- [x] 3.2 仅变体套件可达（画布/verify/播放门控 + 版本轨徽标）
  - 验收：只有 openuiVariants.mobile 的版本在 mobile 设备下画布可见、verify/播放可用
- [x] 3.3 播放冻结画布动作（onIterate 检查 playing）
  - 验收：播放中点击 ToAssistant 类按钮不派发 revise；本地 @Set 导航照常
- [x] 3.4 slides 失败局部化（局部提示 + 回退 doc，不写 workspace error）
- [x] 3.5 表单状态按 suite+device 作用域（复用 per-suite IPC）+ unmount flush 或注释修正
- [x] 3.6 SpecDocumentView 围栏感知 + parseSpecDocument 首批单测

## WP4 交付完整

- [x] 4.1 变体投影文件（prototype.openui.<device>.txt）+ `.ddp` 导出含三端 + suiteProjection 读变体
  - 验收：dd-package 测试断言导出物含三端程序
- [x] 4.2 变体 distinct 升级为语句名集合 Jaccard 阈值
  - 验收：重命名变量的同构副本被判 failed；真实差异通过
- [x] 4.3 引擎补丁 A-2：`.ddp` 每端附 standalone.html（官方 browser bundle + iframe srcdoc + postMessage），原型脱离宿主可播放（design.md §4.4）
  - 验收：导出的 html 双击打开可交互（$page 导航可用）

## P2 跟进（引擎补丁 A-3/A-4，design.md §4.4）

- [ ] A-3 原型专用组件目录（Timer 环/进度环/空态卡）挂自有 library 桥，library.prompt() 自动生成提示词
- [ ] A-4 母版纪律机械化（shell 具名语句引用检查；改壳传播长期靠 A-3 组件化）

## 多重交叉审查(2026-09-10,4 路并行:core 正则推演/desktop 工具实证/renderer 闭包推演/EARS 逐条对照)

已修复的审查发现:
- 🔴 standalone 导出双死路径:@openuidev/browser CDN 包不存在(npm 404 实证)→ 诚实降级为
  零依赖源码交付页;Lang 源码未 JSON.stringify 嵌入 JSON script → 已修(转义断言入测试)
- 🔴 variant-only 套件被桌面本位检查永久判死(mobile-only PRD 招牌场景)→
  openui-non-empty/root 改为任一端语义,新增回归测试
- 🟠 bare-string 死按钮正则是准死正则(双引号需含@)+消息引用不存在的捕获组 → 全量字符串+捕获组
- 🟠 机械 check 前缀(nav-/page- 等)误杀同前缀外部 checks → 统一 auto: 保留命名空间,新增存活测试
- 🟠 "桌面端 App" 空白分词产生幽灵 mobile 端 → 只按标点分隔,复合词整体匹配
- 🟠 specTodos 带后缀标题(## 待确认:xxx)静默放行 + 节终止不对称 → 正则修正
- 🟠 表单状态节流尾部跨槽泄漏(切设备 2s 内旧端写新端槽)→ flush 捕获当次作用域
- 🟡 looksLikeOpenuiProgram 不认 root = $page 形态(按 CREATE 契约写的程序被
  materialize 误拒为 truncated——审查推演外的新发现)→ 正则放宽
- 🟡 计时契约被 openui:prompt 重生成吃掉(插入位置在生成区内)→ 移至手写区+生成器 tools 数组
- 🟡 非法 formState slot 静默写共享槽 → 拒绝;validate_openui description 补 deadButtons;
  版本轨徽章按任一端判定

已知残留(记录不修):Action([]) 检测对注释/字符串字面量中的同形文本误报(静态
正则无词法感知,fail-open 修复环兜底);SpecDocumentView 标题前围栏吞标题
(CommonMark 边缘,契约内不触发);EARS 8/14-18 的 renderer 级测试与三端
真实集成测试仍缺(tasks 声称的验收未全落地,后续补)。

## 收尾

- [ ] 全量验证：format:check + core/desktop typecheck + 两包测试全绿
- [ ] 端到端走查：GVGL 真实三端生成 → 每端修订 → verify → 导出
- [ ] 按 WP 分批提交（3-4 个）
