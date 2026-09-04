# specs/ — 功能规格目录

> 结构定稿：2026-09-03（全量核对归档 + 目录重组落定）。上游权威口径：`docs/features/feature-roadmap.md` §0（逐 spec 终判）与 `docs/features/next-version-plan.md`（第二阶段路线）；本文只描述 specs/ 目录自身的组织方式与流转规则。

## 目录结构

| 位置 | 含义 | 现有内容 |
| --- | --- | --- |
| `specs/<name>/` | **活跃 spec**（当前版本实施中或待启动，不进第二阶段规划区） | [chat-redesign](./chat-redesign/design.md)（主会话重设计，实施中，含 `designs/` 视觉稿）· [design-systems-advance](./design-systems-advance/design.md)（设计系统进阶唯一方案；已并入 pm-design-v2 工件与 prototype-companion/ 子目录）· [lsp-diagnostics](./lsp-diagnostics/design.md)（LSP 类型级诊断桥，本阶段，P0+P1 已落地）· [depth-lane](./depth-lane/design.md)（复杂性路由双轨：P0+P1+P2.1/2.2+P2.3/2.4 公式已落地并经 GVGL 真机校准，X.* 桌面面待 enabled 开启；上游 `docs/research/2026-09-03-smart-gateway-dual-lane-adaptation.md`）· [sop-extraction](./sop-extraction/design.md)（SOP 萃取通道：memory-audit P3 延伸立项，memory.distill P0+P1 已落地） |
| `specs/next-version/` | **第二阶段规划区**：冻结期后随 `next/*` 启动的 spec（3 个主线上 + 10 个储备，路线见 `docs/features/next-version-plan.md`） | 主线：[module-system](./next-version/module-system/design.md)（B）· [doc-wiki](./next-version/doc-wiki/design.md)（D）· [zg-semantic-search](./next-version/zg-semantic-search/design.md)（E）。储备：ts-native-migration · android-dev-kit · cad-3d-generation · content-translation · depth-lane · desktop-pet · harmonyos-dev-kit · in-process-multi-driver · model-fleet-adaptation · sandbox-next（详见 [next-version/README.md](./next-version/README.md)） |
| `specs/review-ing/` | **审查归档**：主体落地但带待复核项，复核通过后移入 `archive/` 转正 | [task-tree-hub](./review-ing/task-tree-hub/design.md)（含 `screen-task-tree.html` 视觉稿）· [skill-eval](./review-ing/skill-eval/design.md) |
| `specs/branch-implemented/` | **分支实现归档**：已在未合并的 `next/*` 分支实现，合并后转正式归档 | [coord-chain](./branch-implemented/coord-chain/design.md)（OC1–OC2 @ `next/coord-chain`） |
| `specs/archive/` | **收官归档**：终判 ✅ 且无未决项，原样保留作为实现依据与历史记录 | 17 项（…前 15 项见 [archive/README.md](./archive/README.md)… · [cmb-adoption](./archive/cmb-adoption/design.md) 2026-09-04 四批次同日落地收官 · [memory-audit](./archive/memory-audit/design.md) 2026-09-04 P0+P1+P2 同日落地收官，P3 泛化另行立项），另有 [`deprecated/pre-production/`](./archive/deprecated/README.md)（❌ 出口门槛毙掉）。见 [archive/README.md](./archive/README.md) |

> **behavior-memory 已物理删除**（2026-09-03；❌ 2026-08-17 拍板作废，由 `@deeporca/memory` 承接，作废记录见 `docs/features/feature-roadmap.md` §0 与 `docs/spec-open-items-status.md` §五）。

## 流转口径（2026-09-02 立归档原则，2026-09-03 扩展）

1. **收官归档**（`archive/`）：终判 ✅ 且无未决项。人工走查类待办（真机手测 / 实机验证 / 打包实测）统一**移交预生产测试清单**后即可归档，不再挡归档。
2. **审查归档**（`review-ing/`）：主体落地但存在待复核项（收尾清单、真实 LLM 对拍、真机走查）→ 复核通过移入 `archive/` 转正，发现重大缺口移回 `specs/` 复工。
3. **分支实现归档**（`branch-implemented/`）：实现发生在未合并的 `next/*` 分支 → 分支合并主线后移入 `archive/` 转正。
4. **废弃归档**（`archive/deprecated/`）：拍板废弃 / 计划失效，保留溯源，不作为任何实现或出口依据。
5. **第二阶段规划区**（`next-version/`）：主线项随 `docs/features/next-version-plan.md` A–E 推进；储备项不裁撤、不在本计划内，立项时点随各自功能域规划。开工时 `git mv` 回 `specs/<name>/` 转为活跃 spec。
6. **延伸立项**：spec 主体收官但剩余项构成独立工作面时，剩余项移出新 spec，原 spec 收官归档（先例：sandbox → sandbox-next）。
7. **合并**：方向被后继方案吸收时以存续方为主，被并方文件作为工件保留在其目录内（先例：prototype-companion → design-systems-advance/prototype-companion/；pm-design-v2 → design-systems-advance/pm-design-v2-*.md）。
8. 移动一律 `git mv`，specs 内引用同步改写；引用约定：活 spec → 归档件 `../archive/<name>/`、→ 规划区 `../next-version/<name>/`；归档件引用活 spec 按层级回溯。

## 视觉稿 / 设计文件约定（2026-09-03 起）

仓库根的 `designs/` 目录已取消，视觉稿与交互稿**随所属 spec 归档**：

- `specs/chat-redesign/designs/` — 主会话重设计视觉稿（screen-chat / demo-flow / 全套预览截图）
- `specs/design-systems-advance/designs/` — 设计系统进阶工作台交互视觉稿（screen-design-workbench.html · 演示清单 D1-D12 · 预览截图 ×3）
- `specs/archive/review-module/screen-review.html` — 审查模块视觉稿
- `specs/review-ing/task-tree-hub/screen-task-tree.html` — 任务树 V2 视觉稿

代码注释中出现的 `designs/chat-redesign` 等字样为历史设计版本标识，现对应 `specs/chat-redesign/`。
