# DeepOrca 原型模块生成栈替换方案 — OpenUI Lang → MoonViz 自研引擎

> 状态：方案（未编码）。本文是 `packages/core/src/actions/prototype.ts` 生成栈从 OpenUI Lang 整体替换为 MoonViz 引擎的设计文档。
> 前置约束：引擎存在未验证问题，替换必须**可验证、可回滚、可并行**。

---

## 1. 替换的范围与不动点

**替换**（prototype 模块内的生成栈）：

| 现状（OpenUI Lang） | 替换为（MoonViz） |
|---|---|
| LLM 生成 OpenUI Lang 程序文本 → 脆弱解析 → 修复循环 | Agent 调**结构化操作**（引擎模板 + ops），引擎保证合法，无 DSL 文本生成 |
| `openui-contract.ts` 四套合同（CREATE/PRESERVE/DEVICE/QUALITY）+ 自写结构校验 | `moonviz-contract.ts` 薄合同：`.mbt.md` 即工件，**校验委托引擎**（P0–P4 谓词 + 双 Gate） |
| `openui-pages`（componentJaccard/extractProgramPages/parsePageList）自写页面解析 | 引擎原生多画板 + `flows` 交互流（tap 跳转），解析消失 |
| `openuiInteractivityFindings`/`pageCoverageFindings` 自写质量门 | 引擎原生质量门：AgentGate 拒绝时返回阻断清单（画板+谓词+详情），修复循环直接消费 |
| 设备预设 `OPENUI_DEVICE_CONTRACTS`（desktop/mobile/tablet） | 画板尺寸即设备（mobile 390×844 引擎原生；desktop/tablet 为任意 w/h 画板） |
| 渲染走 OpenUI 管线 | 引擎 `render-mbt-b64` → 每画板 SVG（黄金参照已备） |

**不动**（模块外骨架全部保留）：ActionRegistry/defineAction 动作模式、`.deeporca/designs/<id>/` 工件目录与 spec.md、design-gates 的舞台编排（runDesignStage）、A2UI 画布接缝、桌面持久化边界。

**删除策略（不做兼容）**：OpenUI Lang 路径**整体物理删除**——`openui-contract.ts` 四套合同、`openui-pages` 解析、自写质量门、`update_openui` 修订路径、legacy `content.openui` 处理，全部随本次替换一并移除。存量 `content.openui` 工件**直接作废**（不提供渲染/修订通道，仅存档在原目录）。替换后 prototype 模块**只有 MoonViz 单一栈**，无 flag、无双栈、无浸泡期。回滚手段 = git revert 替换提交，不在代码里养死路径。

## 2. 架构：三层隔离

```
┌─ prototype.* 动作层（改造）────────────────────────────┐
│  prototype.moonviz_create / _revise / _export_ddp      │
│  合同: moonviz-contract.ts（薄，校验委托引擎）          │
├─ moonviz-bridge 桥接包（新建 packages/moonviz-bridge）──┤
│  包装 moonviz-engine-sdk（预编译 CLI 模式）             │
│  二进制定位/版本握手/超时/崩溃重启/错误码映射/熔断      │
├─ 引擎进程边界（唯一事实源语义保留）────────────────────┤
│  moonviz-cli（自包含二进制，仅链 libc，离线）           │
│  工件 = 磁盘上的 doc.mbt.md（.deeporca/designs/<id>/） │
└────────────────────────────────────────────────────────┘
```

关键决策：

- **进程隔离，绝不开环**：引擎永远是子进程。桌面端任何崩溃/挂起不传染 DeepOrca 主进程。
- **复用 vendored 离线模式**：与 `vendor:openwiki`/`vendor:uv` 同款——新增 `vendor:moonviz` 脚本，把 `moonviz-bin-<platform>` 平台包二进制落进 `packages/desktop/vendor/moonviz/`，打包时进 extraResources；运行时经 `process.resourcesPath` 定位。**不依赖 npx、不依赖网络、不依赖 moon 工具链**。
- **无状态批式会话**：每个动作 = 一次进程批（`load-mbt-b64 → ops → export-mbt-human` → 进程退出）。牺牲常驻会话的毫秒级延迟，换取崩溃免疫与零状态管理；v2 需要画布级交互时再升级常驻会话。
- **`.mbt.md` 落盘即事实源**：工件目录从 `spec.md + content.openui` 变为 `spec.md + doc.mbt.md`。引擎哲学（单一事实源）与 DeepOrca 工件模型天然同构。

## 3. 二进制与版本治理

- 引擎二进制版本由桥接包锁定（package.json `engineVersion` 字段）；会话首命令读引擎 banner 校验主次版本，不匹配即拒绝启动并提示更新。
- 引擎侧升级纪律：moonviz 仓库发新二进制 → DeepOrca 侧 PR 升版本号 + CI 黄金重放 → 合入。工具链风险被冻结在 moonviz 仓库的发布物里，DeepOrca 永远只消费产物。
- 平台矩阵：v1 只签 darwin-arm64（本机已验证）；linux-x64/linux-arm64 CI 已产出可跟进；Windows 端待引擎验证后开放。

## 4. 动作面（prototype 模块 v1）

| 动作 | 输入 | 引擎批 | 产出 |
|---|---|---|---|
| `prototype.moonviz_create` | 需求 spec（一句话即可） | Agent 选模板（引擎 8 套）→ `template` ×N → 结构化 `update/flow` ops → `export-mbt-human` | 套件工件：`doc.mbt.md` + 每画板 SVG + flows |
| `prototype.moonviz_revise` | 工件 id + 修订指令 | `load-mbt-b64` → `apply-human-mbt-op-b64`（结构化 op，非文本） → export | 新 revision 工件 |
| `prototype.moonviz_export_ddp` | 工件 id + 密码（可空） | 桥接包调 `ddp_codec`（DDP2 免密先行，DDP1 二期） | `.ddp` 文件（分享/交付） |

Agent 工具经现有 ActionRegistry 暴露（dispatchToolCall 桥不变）。**修复循环的简化**是本次替换最大收益：OpenUI 时代"生成文本→解析失败→LLM 修文本"的循环，变成"op 被 AgentGate 拒绝→引擎返回结构化违规清单→Agent 按清单修参数重放"，引擎侧 `auto_fix` 还能自动清偿一部分。

## 5. 渲染与画布接缝

- **预览**：动作返回的每画板 SVG 直接进 A2UI 画布/聊天内嵌（SVG 是通用交换格式，零适配）。
- **交互预览**：flows（`tap:<node>` → 目标画板）在预览层做画板切换——参照 deepDesign 仓库 `ddpView.html` 的成熟模式（节点命中 → 切换 SVG）。
- **二期（可选）**：`moonviz-engine-wasm`（Electron 43 的 Chromium 完整支持 WasmGC + js-string builtins）进渲染进程，编辑态免进程跳转即时重渲；v1 不做，进程批已够。

## 6. 质量门映射（design-gates 对接）

DeepOrda 自写质量门 → 引擎谓词一一承接：

| 原 OpenUI 门 | 引擎侧对应 |
|---|---|
| 交互性检查 | `flows` 表存在性 + 谓词层流断裂检测（P 级） |
| 页面覆盖检查 | frontmatter `artboards` vs spec 页面清单（薄合同层比对） |
| 结构合法性 | AgentGate 硬阻断（引擎保证，自写校验删除） |
| 视觉质量 | 谓词 P 级（溢出/重叠）+ `lint`/`critique` 工具（后续接分数） |

## 7. 验证前置（Phase 0 —— 引擎未验证问题的清障清单）

接入编码开工前，引擎侧必须过一遍验收电池（全部有现成黄金参照）：

1. **容器**：`examples/login-demo.ddp` 解包与 `login-demo.mbt.md` 逐字节一致（CRC32/zstd 路径）
2. **渲染**：`render-mbt-b64` 输出与 `login-demo.render.json` 对照（确定性：同输入两次渲染逐字节一致）
3. **协议边界**：CRLF 行、超长行（>默认缓冲）、畸形 JSON、stdin EOF 退出语义
4. **Gate 行为**：违规文档的 AgentGate Reject 载荷形状（画板/谓词/详情三段齐全）
5. **DDP 往返**：DDP2 往返 + 错密码失败路径（DDP1 认证失败错误码）
6. **资源上限**：8MB 明文、多画板、子进程内存占用曲线
7. **并发**：同机两个 CLI 进程并行批，互不串扰
8. **生命周期**：超时 kill 后无僵尸、重启即恢复
9. **版本握手**：banner 解析 + 主次版本比对逻辑

产出物：验证报告 + 已知问题清单 + go/no-go 决定。**未过电池，Phase 1 不开工。**

## 8. 分阶段路线

| 阶段 | 内容 | 出口判据 |
|---|---|---|
| **P0 验证周** | 上述验收电池；锁定引擎二进制版本 | 验证报告全绿或问题清单闭环 |
| **P1 桥接周** | `packages/moonviz-bridge` + `vendor:moonviz` + CI 黄金重放（DeepOrca CI 里跑同一套电池） | 桥接包单测全绿，无 UI |
| **P2 替换周** | `prototype.moonviz_*` 三动作 + SVG 预览；**同一次变更内删除全部 OpenUI 生成路径** | 内部构建可从一句话生成三画板可交互原型；代码库已无 openui 引用 |
| **P3 闭环** | DDP2 导出 + 交互预览 + 流转图 | 日常使用完整走 moonviz 栈 |

**回滚**：不做运行时开关。若 P2 后发现引擎阻断性问题，回滚 = git revert 替换提交（P0 电池的意义就是把这种概率压到最低）。

**一次性切割的代价（已知并接受）**：替换提交合入后，所有存量 OpenUI 工件立即不可用；建议合入前跑一次 `.deeporca/designs/` 存量清单确认无需保留的，需要留样的手工导出。

## 9. 待决问题（开工前需要拍板）

1. **Windows 优先级**：DDP 解析原型（examples 包）已在做 Windows 渲染层验证——若 Windows 是一等公民，P0 电池需含 Windows 二进制验收，排期前移。
2. **DDP1 密码 UX**：加密导出的密码输入/存管交互（DeepOrca 有无既有密钥环？）。
3. **模板扩展**：引擎 8 套模板是否覆盖 DeepOrca 目标场景，缺口模板由 moonviz 仓库排期（引擎侧迭代，不属于本接入）。
4. **A2UI 画布能力**：SVG 直接嵌入是否满足交互预览（节点点击），还是需要预览层做节点拾取封装。

---

*引擎侧对接材料：`moonviz/examples/`（DDP2 样本 + 黄金参照）、`moonviz/sdk/node`（桥接依赖）、`moonviz/docs/10-render-pipeline.md`（管线）、官网 docs（协议/环境变量）。*
