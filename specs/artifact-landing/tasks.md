# 产物落地三链（Artifact Landing）— 实施计划

> 日期：2026-09-08 · 状态：三链代码面全部落地（UI 真机走查移交预生产清单）· 追溯目标：[requirements.md](./requirements.md) A1–A6 / B7–B11 / C12–C17
> 三链独立可分期，按由易到难实施：**B → A → C**（2026-09-08 用户拍板）。
> **2026-09-08 链路 A 落地**：任务 1–6 代码面完成（`@open-file-viewer/*@0.1.44` + `pdfjs-dist@4.10.38` 精确锁；EditorReadBinary 白名单 64MB；BinaryFileViewer 懒加载五插件；metafile 构建守护断言 three/leaflet/hls.js 零泄漏——OFV 单文件分发需 empty-shim onResolve 插件压制未挂载引擎的死 chunk，marked/mermaid 有既有消费者不得 shim；pdf worker 与 ofv-core.css 构建期拷贝）。UI 真机走查移交预生产清单。
> **2026-09-08 链路 B 落地**：任务 7–12 代码面完成（`@marp-team/marp-core@4.4.0` 精确锁；`spec-slides.ts` 纯函数 + 单测 7 条全绿，实证钉住 headingDivider 切页语义：1–2 级切、围栏内 `##` 不切、hr+标题叠加产生空页的守卫）；UI 真机走查移交预生产清单。
> **2026-09-08 链路 C 落地**：任务 13–18 代码面完成（`prototype-brief.ts` 纯函数：六节结构 zh/en 模板、`##` 屏幕抽取、待确认直录、锚点闭环缺口拦截、openui 源码附录降级；PrototypeBuildBrief 通道 + brief.md 落盘 + 生成/注入按钮 + i18n 六语言）。**C15 实现修正**：注入采用 `onQuoteToChat` 预填路径（避免跨工作区误发），`PromptSend` 直发留作 P2（需输入框状态检查）。单测 8 条全绿。

## TA 链路 A：编辑器二进制兜底预览（open-file-viewer SDK + 按需插件子集，2026-09-08 用户拍板）

- [x] 1. 依赖引入与资产：`@open-file-viewer/core` / `@open-file-viewer/react` / `pdfjs-dist` 精确锁版本入 `packages/desktop`；pdf.worker 静态资产接线（禁 CDN）
  - _Requirement: A5, A6_

- [x] 2. `EditorReadBinary` 通道：`shared/ipc.ts` 契约 + preload + main handler（`safePathWithinRoot` + 白名单 + `MAX_BINARY_SIZE`=64MB 上限 → ArrayBuffer；reason 四态）
  - _Requirement: A2_

- [x] 3. `BinaryFileViewer.tsx` 懒加载组件：`FileViewer`（react 适配层）+ **常量插件数组**（pdf/office/image/archive/fallback 五插件；text/video/audio/email/cad/3d/gis 等不挂载）；主题跟随 appearance；工具栏 labels/titles 六语言覆盖；`onUnsupported`/`onError` → 兜底态（原因 + 在系统中打开）
  - _Requirement: A1, A3, A4_

- [x] 4. `EditorWorkspace` binary 分支接预览视图；`use-editor-workspace` 状态机不动
  - _Requirement: A1_

- [x] 5. i18n：`editor.preview.*` keys 落满 6 locale
  - _Requirement: A4_

- [x] 6. 测试：handler 单测（逃逸/超限/白名单外/正常字节）+ dom-harness 挂载与兜底分支测试（mutation-check 一次）+ 构建守护断言（three/leaflet/hls.js 不进 renderer 依赖图与 dist；失败时验证 sideEffects 补丁兜底生效）
  - _Requirement: A2, A3, A6_

## TB 链路 B：需求文档幻灯片输出

- [x] 7. 依赖引入：`@marp-team/marp-core` 精确锁 4.x（main 侧）
  - _Requirement: B8_

- [x] 8. `main/tools/spec-slides.ts` 纯函数：`splitSpecIntoSlides`（围栏内 `##` 不切 / front-matter 直通）+ `renderSpecSlides`（deeporca 主题按明暗烘焙、auto-scaling、分页）
  - _Requirement: B7, B11_

- [x] 9. IPC 双通道：`PrototypeSpecSlides` / `PrototypeSpecExportSlides`（resolveRegisteredRoot；HTML 写 `slides.html`；PDF offscreen + printToPDF 横向写 `slides.pdf`；CSP 注入与外链统计）
  - _Requirement: B9, B10_

- [x] 10. PrototypeWorkspace spec tab「文档 | 幻灯片」视图段控：sandbox iframe 预览 + ←/→ 翻页 + 导出按钮 + 被阻止外链提示
  - _Requirement: B7, B9, B10_

- [x] 11. i18n：`prototypeWorkspace.slides*` keys 落满 6 locale
  - _Requirement: B11_

- [x] 12. 测试：`spec-slides` 纯函数单测（切页边界/直通/空 spec/主题烘焙两态）+ 导出 handler 落盘与衍生物不进版本内容的断言
  - _Requirement: B7, B9, B11_

## TC 链路 C：落地简报生成器

- [x] 13. `main/tools/prototype-brief.ts` 纯函数骨架：输入契约（spec/openui × 文本 + locale）→ 六节结构 zh/en 模板包（措辞按 design.md 附录 D）
  - _Requirement: C12, C13, C16_

- [x] 14. spec.md 结构化抽取：`## ` 章节 → 屏幕清单、`### ` 区块、`- [ ]` 行为条目、待确认清单复用；零绝对坐标的布局措辞生成
  - _Requirement: C12, C13_

- [x] 15. 闭环校验与降级：`links ⊄ screens` → gaps 返回不产出；openui 源码不可抽取部分降级「源码附录」
  - _Requirement: C14_

- [x] 16. `PrototypeBuildBrief` 通道 + 工件目录 `brief.md` 落盘（附属文件，不入版本内容）+ spec/openui tab「生成落地简报」按钮
  - _Requirement: C12, C15_

- [x] 17. 注入实现会话：成功后「注入实现会话」走 `api.sendPrompt`；无激活会话/输入框非空时预填输入框；i18n keys 落满 6 locale
  - _Requirement: C15, C16_

- [x] 18. 测试：`prototype-brief` 单测（六节快照、缺口拦截负例、附录降级负例、zh/en 两包）；真机走查移交预生产清单
  - _Requirement: C14, C17_

## TD 收尾

- [x] 19. 供应链收尾：ThirdPartyNotices 更新（open-file-viewer 及其 NOTICE 的 Apache-2.0 子件、pdfjs-dist、marp-core）；`npm run check && npm test` 全绿；justify 依赖锁的 package-lock 变更
  - _Requirement: A6, B8_
