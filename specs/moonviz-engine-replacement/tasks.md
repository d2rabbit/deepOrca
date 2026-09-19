---
type: tasks
parent: moonviz-engine-replacement
---

# MoonViz 引擎更换 — 任务清单

> 对应设计：[design.md](./design.md)；实现级唯一权威：[docs/engine-integration-plan.md](../../../docs/engine-integration-plan.md) v4.1（§1 删除/不动清单、§2 接缝、§3 工件、§4 门映射、§5.3 DDP、§7 电池与路线）。
> 粗估：P0 1 天 / P1 2 天 / P2 3 天 / P3 2 天（合计 ~8 天；**P2 时点受上游引擎迭代收敛制约**，见 design §3 门槛表）。
> 门槛速查：P0 无门槛即可开工（同时是上游快照体检）· P1 仅需 P0 报告 · **P2 需上游收敛 + P0 全绿** · P3 的 lint/critique 另需上游全量面导出。

## P0 验收电池（命令级，9 项——基准文档 §7；同时是对当前上游快照的问题记录面）

- [ ] T0.1 宿主就绪：Electron 主进程 + 渲染进程各实例化一次；**打包形态**（extraResources 路径）加载验证。
- [ ] T0.2 黄金对拍（核心判据）：`examples/login-demo.mbt.md` + 固定 op 序列，wasm `apply_agent_op` 输出（canonical+SVG）与原生 CLI `apply-agent-mbt-op-b64` 逐字节比对；CI 常驻快照层（`login-demo.render.json` 黄金）。
- [ ] T0.3 载荷形状：溢出文档 → `mbt_gate_block` 四段解析；`render_mbt` 错误路径；`export_html` 结构断言（绑定表/CSS 变体/导航栈）+ 真浏览器点击冒烟（login_btn→prof、pressed 切换）。
- [ ] T0.4 种子闭环：`MOONVIZ_SEED_DOC` → `template login` → `delete-artboard entry` → 交互 op → canonical 落盘 → 重载渲染一致。
- [ ] T0.5 性能与阻塞：≥3 画板 + 大文本 worst-case 单调用耗时分布 → 定 worker_thread 阈值（决策 1）。
- [ ] T0.6 生命周期：trap 后实例重建、内存曲线、重复实例化成本。
- [ ] T0.7 CSP 冒烟：previewHtml 在 renderer iframe 内加载（基准 §5.1 策略：按不受信内容对待）。
- [ ] T0.8 版本探针：marker 哈希 + `version_info()` 可用性（不作版本判据）。
- [ ] T0.9 上游问题清单：电池跑出的引擎已知问题逐项登记（跟踪至收敛——P2 硬门槛的判据面）。
- [ ] T0.10 marker 锁定 + P0 报告留档（全绿或带已知问题清单的诚实报告）。

## P1 接缝周（引擎 mock/fixture 驱动，无 UI）

- [ ] T1.1 `scripts/vendor-moonviz-wasm.js`（desktop 构建 vendor 面：运行时仅 wasm 资产；原生 CLI 仅 CI 对拍临时下载——决策 3）。
- [ ] T1.2 `packages/core/src/common/moonviz-engine.ts` 引擎接缝（7 导出封装 + 计时观测 + 版本探针；决策 1）。
- [ ] T1.3 `packages/core/src/actions/moonviz-contract.ts` 薄合同层（页面覆盖比对 / 平台契约句迁入 prompt + 画板尺寸实参化；视觉项 pending 标注位）。
- [ ] T1.4 CI 对拍接线（快照层常驻 + 发版层原生对拍）。
- [ ] 出口：接缝单测全绿（mutation-check 一次）。

## P2 替换周（硬门槛：上游收敛 + P0 全绿；替换与删除同一提交）

- [ ] T2.1 materialize / revise / verify 换 moonviz 路径（Gate 推进式回灌 ≤2 轮 + GateBlock 诊断；`apply_human_op` 不对 Agent 开放）。
- [ ] T2.2 预览 iframe 分支：`DesignPreview.tsx` / `PrototypeWorkspace.tsx` 读 `previewHtml`（sandboxed srcDoc）；每画板 SVG 缩略复用附件挂载。
- [ ] T2.3 工件模型切换：套件版本 payload 单 `moonviz.doc`；三端 = 单文档三画板（删 openuiVariants 三程序结构）；`design-store.ts` / `design-ipc.ts` / `shared/ipc.ts` 同构类型调整。
- [ ] T2.4 `.ddp` 导出设计包管线换 `"moonviz"`（`doc.mbt.md` + `index.html` 作 viewer）。
- [ ] T2.5 **同提交物理删除基准 §1.1 全清单**（OpenUI 物化四件套 / inline fence 链 / 旧测试）；存量 `content.openui` 作废前跑 designs 清单留样确认。
- [ ] 出口：一句话 → 三画板可交互原型；`git grep -i openui -- packages/` 零命中；**断言等价迁移复核**（devices→画板尺寸 / repair→Gate 回灌 / coverage→合同层比对，保留原断言语义）。

## P3 闭环周

- [ ] T3.1 `common/ddp-codec.ts` TS 自建（CRC32/zstd/Argon2id/XChaCha20-Poly1305，格式与错误码对齐 Rust 参照；`@noble/*` exact-pin 审计）。
- [ ] T3.2 DDP 黄金向量 4 组：DDP2 逐字节解密、自建加密回灌 wasm、Rust 参照 DDP1 夹具双向互解、错误码同名断言。
- [ ] T3.3 `export_ddp` 动作 + 密码 UX（遗留决策 7，产品输入待定——仅阻塞此动作 UI）。
- [ ] T3.4 上游全量面 wasm 落地后（marker 升级点）：接 `lint_design/critique/auto_fix` 评审步骤 + 运行时 `list_components`（决策 5），verify 视觉项去 pending。
- [ ] 出口：日常完整走 moonviz 栈。

## 收尾

- [ ] T9.1 基准文档随实施更新版本号与遗留项；本 spec 状态回写（立项稿 → 实施中 → 收官）。
- [ ] T9.2 每阶段 `npm run check && npm test` 全绿；P2 后补打包形态实测（移交预生产清单可，不挡归档）。
