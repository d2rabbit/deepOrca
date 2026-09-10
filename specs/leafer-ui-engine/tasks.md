# leafer-ui-engine — 任务清单

> 对应 [design.md](./design.md) §3 四个工作包。勾选即完成；每项验收标准以测试为准。依赖顺序：WP0 → WP1 → WP2/WP3 可并行 → WP4 收尾。

## WP0 生成协议与修复环（core，先行）

- [ ] 0.1 `LEAFER_CREATE_CONTRACT` / `LEAFER_PRESERVE_CONTRACT`（`core/src/actions/leafer-contract.ts` 新建）
  - 验收：契约测试 pin 图元白名单/画布规范/tokens 注入段/JSON-only 输出口径；EARS 1/4
- [ ] 0.2 `repairLeaferProgram`（解析→结构校验→图元合法性→越界→有限次回喂修复）
  - 验收：单测三类用例（非法 JSON/未知图元/越界）修复成功；耗尽返回结构化错误不落盘；EARS 2/3
- [ ] 0.3 `design.materialize` 切换 Leafer 栈：prompt 换契约、持久化写 `content.leafer`（`design.leafer.json`）、不再调 `render_openui`
  - 验收：core 集成测试断言 leafer 字段落盘 + `render_openui` 零调用；EARS 1
- [ ] 0.4 `design.revise(part="design")` 切换：基线 `content.leafer` + PRESERVE 契约 + 修复环
  - 验收：单测断言 leafer 基线与修复环路径；EARS 10
- [ ] 0.5 deep-design SKILL.md 产出格式章节改写 + 防漂移测试（契约外漂移即 fail）

## WP1 渲染与画布编辑（desktop renderer）

- [ ] 1.1 依赖引入：`leafer-editor`（web）+ `@leafer-in/flow`，精确版本 pin（无 `^`，v2.2.x 线）
  - 验收：`npm ls` 断言无 range；typecheck + esbuild 构建冒烟无 Node 依赖泄漏；EARS 8
- [ ] 1.2 `LeaferPreview.tsx`（新）：初始化/JSON 导入/editor+view 插件/主题变量/错误态局部化
  - 验收：jsdom 生命周期冒烟；非法 JSON 不写 workspace 级 error；EARS 5
- [ ] 1.3 `DesignWorkspace` content 字段路由（`leafer`→LeaferPreview；仅 `openui`→OpenuiRenderer 只读徽标）+ composer 文案
  - 验收：renderer 测试两分支路由；旧产物只读可达；EARS 15/17
- [ ] 1.4 画布编辑→版本快照（防抖 2s → `toJSON()` → design-store 版本通道）+ 版本切换重导入
  - 验收：编辑产生新版本、切换画布随动、FIFO 20 不变；EARS 6/7

## WP2 质量闭环移植（core）

- [ ] 2.1 `lintLeaferDocument`：越界/空文本/未引用 tokens 色/遮挡重叠四规则（emoji 保留于文本值）
  - 验收：首批单测（当前为零）；EARS 9
- [ ] 2.2 `design.lint / review / revise(quality|tokens|components)` 按字段路由到对应栈输入
  - 验收：leafer 栈 lint/review 走 JSON 输入，schema 校验口径不变；EARS 9/11

## WP3 导出（desktop main/renderer）

- [ ] 3.1 `buildDduLeaferPackage`：manifest（pipeline `leafer`）+ `design.leafer.json` + 可交互 index.html（npm dist 运行时 + JSON 内嵌，双击得可交互画布）+ `design-ipc` 导出路由 + build.mjs 运行时拷贝
  - 验收：dd-package 测试断言四件套与 JSON 转义嵌入；导出 html 双击可交互；EARS 12/14
- [x] 3.2 ~~图片导出~~ **移出首版**（user 2026-09-10 裁决：只关注可交互 `.ddu`；上游 toSVG 未实装/PDF 伪 mime，EARS 13 = shall-not）
  - 验收：P2 重估前不实现；EARS 13

## WP4 兼容、边界与收尾

- [ ] 4.1 guard 测试三条：prototype.ts 无 leafer import；design 新栈无 `render_openui` 调用；suite 字段路由单值不混写
  - 验收：guard 测试入 CI（对齐三层定位边界批纪律）；EARS 16
- [ ] 4.2 旧产物兼容回归（仅 `content.openui` 套件全链路只读可达）
- [ ] 4.3 全量验证：`npm run check` + core/desktop 测试全绿
- [ ] 4.4 端到端走查：一句话生成 → 画布微调 → 版本轨 → lint/review → `.ddu` 双击可交互（平移/缩放/选中微调）
- [ ] 4.5 按 WP 分批提交（4 个：WP0 / WP1 / WP2+WP3 / WP4）

## P2 跟进（不在本 spec 实施范围）

- [ ] Stitch 借鉴：自动补缺失屏（`@Set($page,…)` 目标缺失 → 可选 agent 补屏，failed 兜底）
- [ ] 设计/原型能力暴露为 MCP 工具（供外部编码 agent 消费）
- [ ] `@leafer-ui/node` 服务端离屏渲染（批量截图/无头校验；注意：子包 npm 只发 TS 源码、需 `useCanvas('napi', canvas)` 显式挂后端）
- [ ] 图片导出重估（PNG 可行已实测；SVG 阻塞于上游 `toSVG` 未实装、PDF 阻塞于伪 mime——跟踪上游实装进度）/ 富文本渲染（leafer-x-richText）
- [ ] 文本就地编辑启用评估（等上游 text-editor 稳定）
- [ ] Agent Manager 式多方向并排对比（复用变体机制）
