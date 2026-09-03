# specs/next-version — 第二阶段（下一版）规划区

> **口径（2026-09-03 立）**：冻结期后随 `next/*` 分支启动的 spec 集中本区——**不是废弃**，是"设计定稿、待启动"的 staging 区。开工时 `git mv` 回 `specs/<name>/` 转为活跃 spec。主线项的启动顺序、分期与前置见 [`docs/features/next-version-plan.md`](../../docs/features/next-version-plan.md)（A–E 五主线）；**储备项**（非主线，2026-09-03 对齐增补）不裁撤、立项时点随各自功能域规划。
> 本区引用归档件用 `../archive/<name>/`，引用活 spec 用 `../../<name>/`。

## 主线 spec（A–E 路线承接）

| spec | 主线 | 分期 |
| --- | --- | --- |
| [module-system](./module-system/design.md) | B：action → Studio 基座（超大版本） | B1 冷插拔（P0）+ B2 热激活/隔离（P1）；B3-B5 紧随其后一版 |
| [doc-wiki](./doc-wiki/design.md) | D：知识编译 | D0 零基建 → D1 编译层 MVP → D2 检索/图谱/研究闭环 |
| [zg-semantic-search](./zg-semantic-search/design.md) | E：工作区语义检索（zvec-grep） | M0 P0 Windows 验证门槛（一票否决）→ M1 core → M2 desktop → M3 产品面 |

## 储备 spec（非主线，详见计划文档储备章节）

| spec | 一句话 | 状态 |
| --- | --- | --- |
| [android-dev-kit](./android-dev-kit/design.md) | 内核驱动的安卓开发套件 | ⬜ 设计稿（移动域重启向） |
| [cad-3d-generation](./cad-3d-generation/design.md) | text-to-cad / img2threejs 三阶段 | ⬜ 规划中 |
| [content-translation](./content-translation/design.md) | 第三方内容翻译引擎 | ⬜ 设计定稿待实现 |
| [desktop-pet](./desktop-pet/design.md) | 桌宠小助手 P1–P10 | ⬜ 调研定稿（P1 另立项） |
| [harmonyos-dev-kit](./harmonyos-dev-kit/design.md) | 鸿蒙开发套件 | ❌ 曾落地后下线；重启属 `next/*` |
| [in-process-multi-driver](./in-process-multi-driver/design.md) | 进程内多驱动并行（agent-relay） | ⬜ 立稿未实施 |
| [model-fleet-adaptation](./model-fleet-adaptation/design.md) | GLM/Kimi/MiniMax/Qwen 收官适配 | 🟡 G0+S0 落地（16/34） |
| [sandbox-next](./sandbox-next/design.md) | 沙箱延伸（bwrap/WSL2/矩阵/WASI） | ⬜ 独立任务规划 |
