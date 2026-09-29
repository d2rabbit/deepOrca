---
type: tasks
parent: moonviz-engine-replacement
---

# MoonViz 引擎更换 — 任务清单

> 对应设计：[design.md](./design.md)；实现级唯一权威：[docs/engine-integration-plan.md](../../../docs/engine-integration-plan.md) **v5.2**（§0 事实基线（0.1.7 + deepDesign 协议移植清单 + #12 双门探针）、§1 删除/不动清单、§2 接缝与 worker、§3 vendor 锚点、§4 动作面、§5 预览、§6 决策 12 项、§7 电池与路线）。
> 门槛速查：P0/P1 即可开工 · **P2 需 P0 全绿** · P3 的 DDP 另需密码 UX 拍板（决策 7）。
> **进度（2026-09-29 收官批）**：P0–P3 主体全部落地——vendor 管线 + 接缝 + P0 电池（命令级 20 项全绿，报告 [p0-report.md](./p0-report.md)）+ 替换删除（`git grep -i openui -- packages/` 仅剩存量兼容与注释）+ DDP codec 与黄金向量全绿。全仓 `npm test`：core 1192 pass / desktop 806 pass / 0 fail。遗留：打包形态实测（移交预生产清单）、DDP1 密码 UX（决策 7）、真机 GUI 走查（移交预生产）。

## P0 验收电池（命令级，9 项——基准文档 §7；验收对象 = 本方接缝实现面，引擎侧回归由 vendor 契约探针拦）

- [x] T0.1 宿主与资产：wasm-gc 实例化（主进程 ✅ vendor 探针 + **worker 内** ✅ 电池）；**打包形态**（extraResources 路径）加载验证（⏳ 移交预生产清单——dev 形态已全覆盖，路径解析同 `__dirname/../vendor` 约定）；vendor 探针全链 ✅（sha512 锚点版本 `0.1.7` / 批式 11 + session 全量导出在场 / **14 模板 id 集合** / 组件快照双门 place 探针）；版本不符拒绝路径 ✅（探针内建 + host init 断言）。
- [x] T0.2 canonical 黄金往返（核心判据，v5.2 判据修正）：信封 canonical（`mbt` 字段）逐 op 权威回传 ✅；close → 重开 canonical 渲染逐字节一致 ✅；批式 `render_mbt` 与会话路径输出一致 ✅；`session_save`→project JSON→`session_open_project_json` 再水化 ✅（结构等价；byte 怪癖 = 重水化渲染重复一份节点，canonical 通道不经过它——已记录于报告已知问题）。
- [x] T0.3 会话缓存协议（deepDesign 移植验证）：同 canonical 命中复用 ✅；变更信封 canonical 键前移 ✅；Gate 拒绝（= 旧"解析失败弃缓存"的引擎级形态）弃缓存后原文档可用 ✅；棘轮/terminate 重建后缓存恢复零语义断言 ✅（T0.4/T0.7）。
- [x] T0.4 worker 隔离：超时 terminate 路径 ✅（test-hook `hang` + 主进程看门狗真中断，~0.6s 触发 + 重建）；terminate 后主进程零副作用、重建可用 ✅；worker 内 trap 弃缓存不传染主进程 ✅（worker 侧 catch + evict 路径）；`withSession` 异常路径 close（try/finally）✅ + `session_count` 泄漏探针 ✅（stats 面，缓存键控语义下 count = warm 缓存数）。
- [x] T0.5 载荷形状：违规文档 → `mbt_gate_block` 四段解析 ✅；`lint/critique/query_nodes/flows/spec` 信封结构断言 ✅；`export_html` 结构断言 + 自包含（零外链资源）✅；真浏览器点击冒烟（⏳ 由 jsdom sandboxed-srcDoc 断言 + 预生产真机走查覆盖，电池报告范围注记）。
- [x] T0.6 tap 行为验证：login-demo 交互流逐条 `session_tap` 命中断言 ✅（t_login→t_home via login_btn · t_home→t_prof via activity_0）。
- [x] T0.7 内存棘轮：多轮 op 内存水位曲线（deepDesign 实测 ~200 op ≈ +37MB 复核——`mutatingOps` 计数面）；阈值重建触发与恢复 ✅（op 计数阀 maxMutatingOps=6 → 12 op 触发 rebuilds≥2 + canonical 重放零语义；heap 水位 192MB 阈值实现于 worker）。
- [x] T0.8 种子闭环：`MOONVIZ_SEED_DOC` → `template login` → `delete-artboard` 种子板 → 交互 op → `save` → 重载一致 ✅（`session_open("") = -1` 契约断言）。
- [x] T0.9 CSP 冒烟：previewHtml 自包含（零外链资源、12666B）✅；renderer iframe sandboxed-srcDoc 属性断言由渲染测试覆盖（MoonvizPreview 无 allow-same-origin）。
- [x] T0.10 锚点锁定（`engine-v0.1.7` + sha512/256 双锚）✅ + P0 报告留档 ✅（[p0-report.md](./p0-report.md)，全绿 20 项）。

## P1 接缝周（seam 单测 fixture 驱动，无 UI）

- [x] T1.1 `scripts/vendor-moonviz.js`（原案名 vendor-moonviz-wasm.js，随 `build.mjs ensureVendored` 派生命名约定落定）：GitHub Releases 直链（`moonviz-wasm-gc-0.1.7.wasm` **唯一目标**）+ sha512 整文件锚点（+传输级 sha256）+ 实例化契约探针（硬失败语义；**探针运行时选择器：MOONVIZ_PROBE_BIN → 仓库 Electron-as-node → Node ≥24**，决策 12）+ `components.json` 快照入库（**#12 双门探针语义**：AgentGate 拒=gateDebt 警告不硬失败——0.1.7 实测 7 项全 fill 宽组件 artifact）+ manifest/marker 幂等跳过；`build.mjs` ensureVendored 接线、vendor-notice 登记（MIT）、eslint/prettier 通过、本机全绿（71 exports / 14 模板 / 65 组件）。
- [x] T1.2 `packages/desktop/src/main/` worker 宿主（`moonviz-engine-worker.ts` + `moonviz-engine-host.ts` + `moonviz-runtime.ts` 懒加载接线 + `dist/moonviz-engine-worker.cjs` 独立 esbuild 入口）：wasm-gc 实例承载 + canonical 键控会话缓存（LRU≤4 + refcount，warm-cache 语义）+ 脏缓存全弃 + 内存棘轮（heap 192MB / op 计数阀，refcount-0 边界重建）+ callTimeout 看门狗 terminate（主进程侧——worker 同步调用自堵事件循环，中断只能从外层做）+ MoonvizResetError 语义与 withSession 自动重放；deepDesign `wasmtime_host.rs` 为协议参照。
- [x] T1.3 `packages/core/src/common/moonviz-engine.ts` 引擎接缝：`configureMoonvizEngine`（seam 注入，vendor 路径红线——路径推导只存在于 desktop `moonviz-runtime.ts`）+ `withSession` 唯一编排入口（open→fn→close + reset 自动重放 + canonical 契约强制：mutating 信封漏 `mbt` 即 MoonvizCanonicalError）+ 批式直通（render/validate/exportHtml/list_*）+ GateBlock 四段解析 + 泄漏/缓存探针 + 计时环形缓冲；接缝单测 13 项（fixture 驱动，无 wasm）+ mutation-check 一次（canonical 传播突变→测试红→还原绿）。
- [x] T1.4 `packages/core/src/actions/moonviz-contract.ts` 薄合同层：`MOONVIZ_SEED_DOC` 种子常量（canonical visual-block 形态，vendor 脚本 SEED_DOC 同源）+ 画板覆盖比对（PRD 页面 ID ↔ `<page>@<device>` 画板 + flows 非空）+ 平台/质量合同 prompt 材料（迁自 openui-contract，moonviz 词汇）+ op 计划解析（引擎动词白名单 + 未闭合围栏拒收）+ 组件词汇读快照。
- [x] T1.5 CI 接线：`scripts/vendor-moonviz.js --force` 探针 + P0 电池进 ci.yml（ubuntu + node 22，Electron-as-node）；黄金快照层常驻 = 电池 T0.2（`golden/login-demo.render.json` 已按 0.1.7 重生成入 spec 目录）。
- [x] 出口：接缝单测全绿（mutation-check 一次 ✅）。

## P2 替换周（硬门槛：P0 全绿 ✅；替换与删除同批落地）

- [x] T2.1 materialize / revise / verify 换 moonviz 会话路径 ✅（Gate 推进式回灌 ≤2 轮 + GateBlock 诊断 + 失败 op 不入档（同 base 全量重放）；`apply_human_op` 不对 Agent 开放；verify 检查项 = validate + AgentGate（随 op 内建）+ 覆盖比对 + flows + `session_lint`/`session_critique`（pending 观察项）+ `session_tap` 逐 flow 仿真）。
- [x] T2.2 预览 iframe 分支 ✅：`MoonvizPreview.tsx`（sandboxed srcDoc，无 allow-same-origin）+ suite read 附带 `previewHtml`（prototype.html 导出缓存，persist 时 best-effort 导出 + 缺失回退 canonical 文档面板）+ App 伴生面板 moonviz 模式。
- [x] T2.3 工件模型切换 ✅：套件版本 payload 单 `moonviz.doc` + `prototype.html` 导出缓存 + `doc.mbt.md` 投影；三端 = 单文档三画板（`<page>@<device>`，删 openuiVariants 三程序结构）；`design-store.ts` / `design-ipc.ts` / `shared/ipc.ts` 同构类型调整。
- [x] T2.4 `.ddp` 导出设计包管线换 `"moonviz"` ✅（`doc.mbt.md` + 交互 `index.html`（真 viewer，替代旧 stub）+ verification.md）。
- [x] T2.5 **物理删除** ✅（openui-contract / openui-pages / design-gates 三门函数 / openui-library-schema / openui-validate / renderer/openui 全目录 / openui-bridge.css / openui-components.css 拷贝 / inline fence 链 + openuiInlineMode / @openuidev/* 三依赖 + generate-openui-prompt + openui/opm 设计技能模板 + 10 个 openui-era 测试文件）；**断言等价迁移复核** ✅（devices→画板计划+平台覆盖 / repair→Gate 回灌 / coverage→合同层比对 / distinct→随变体结构消亡（有注）/ legacy badge→作废不渲染）。
- [x] 出口：一句话 → 单文档多画板可交互原型（动作链真机链路 e2e 测试覆盖）；`git grep -i openui -- packages/` 剩余命中仅为：存量工件只读兼容（pipeline "openui" 保留防旧盘死锁）、"已退役"注释、pre-migration 清理字符串——无任何活跃调用面。

## P3 闭环周

- [x] T3.1 `common/ddp-codec.ts` TS 自建 ✅（CRC32=zlib.crc32 / zstd=node:zlib（params 压缩级 8）/ Argon2id(m=19MiB,t=2,p=1,32B,v=0x13)=@noble/hashes 2.4.0 exact-pin / XChaCha20-Poly1305(45B 头 AAD)=@noble/ciphers 2.4.0 exact-pin；错误码与字节布局逐项对齐 deepDesign 生产 vendor 参照 crate；license:check MIT ✅）。
- [x] T3.2 DDP 黄金向量 4 组 ✅（`golden/login-demo.ddp`（引擎仓库 0.1.7 产物）逐字节解密=canonical 文档、自建 DDP2 加密回灌（压缩生效+篡改 CRC 拒）、DDP1 头布局+KDF 参数+错密码/篡改双认证拒绝、错误码同名+尺寸门；zstd 缺失运行时 skip-guard，CI 22.x/电池 24 全跑）。
- [x] T3.3 `prototype.export-ddp` 动作 ✅（canonical → .ddp 落盘套件目录；空密码 = DDP2 免密直开 / 带密码 = DDP1 认证加密；registry 注册 + core index 导出）。**密码 UX（决策 7）仍遗留**：动作面两形态已支持，GUI 密码输入待产品拍板——不阻塞闭环。
- [x] T3.4 `session_lint/critique/tap` 检查项全量接入 verify ✅（能力已就位，纯本方接线——见 T2.1）；`session_infer_*` 增益评估（v1.5 择期，维持不做清单）。
- [x] 出口：日常完整走 moonviz 栈 ✅（代码路径全替换 + 测试全绿；真机 GUI 走查移交预生产清单）。

## 收尾

- [x] T9.1 基准文档随实施更新版本号与遗留项 ✅（v5.1→v5.2：0.1.7 基线 + 事实修正 + 决策 12）；本 spec 状态回写（**实施中 → 主体收官**：P0–P3 完成，打包形态实测 + 真机走查移交预生产）。
- [x] T9.2 每阶段 `npm test` 全绿 ✅（core 1192 / desktop 806 / 0 fail；`npm run check` 0 error）；**打包形态实测移交预生产清单**（与 leafer/clay 同款移交口径，不挡归档）。
