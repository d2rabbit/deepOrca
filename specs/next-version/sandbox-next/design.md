# Sandbox 延伸规划（sandbox-next）— 平台后端扩展与能力面收官

> **日期**：2026-09-03 立稿 · **状态**：规划（独立任务规划）
> **来源**：2026-09-03 拍板——[sandbox](../../archive/sandbox/design.md) spec 以 40/45 收官归档，其 5 项未决项整体延伸为本文，作为**独立任务规划**推进；原 spec 的设计内容（§4.1-R P0 方案、§六 平台能力矩阵、§九 WASI 评审、§十 quarantine）继续有效，本文不重复。

## 1. 范围（自原 spec 延伸的 5 项）

| # | 项 | 原出处 | 说明 |
| --- | --- | --- | --- |
| 1 | Linux 系统 bwrap 后端 | 原 sandbox 任务 17 | `--ro-bind / /` 起步、`--bind <projectRoot>` 可写、`--unshare-net` 按条款；设计见原 spec §三 |
| 2 | Windows WSL2 后端 | 原 sandbox 任务 18 | `wsl.exe` 探测 + 专用 distro（`wsl.conf` 关 interop）+ cwd 映射校验；未装 WSL 时诚实降级 |
| 3 | 平台能力矩阵逐格对账 | 原 sandbox §六 / tasks:110 | 矩阵逐格与实现对账（含 `detect.ts` 已登记降级记录）后方可对外宣称 |
| 4 | 项目级 `mcpServers` 变更强制确认 | 原 sandbox 任务 20（P4，独立立项） | T4 的最小可行改动 |
| 5 | WASM/WASI 工具 ABI 预研 | 原 sandbox 任务 21（P5） | `PathGrant` 已落地，即 WASI preopen 的直接输入；`node:wasi` 或 JCO 对比 |

## 2. 边界与依赖

- 原 spec 已拍"**建议不做**"bwrap/WSL2（2026-08-18 评估，未正式推翻）——本文立稿即视为**重新立项**，启动前按当时评审理由（AppArmor/userns 雷区、WSL2 需装 distro、收益窄）复核一次需求是否仍成立。
- 项 3（矩阵对账）与项 1/2 无依赖可先行；项 5 独立；项 4 依赖 desktop 设置/权限链路，体量最小。
- 完成一项即回写本文 tasks.md；全部完成后本 spec 按 2026-09-03 归档口径收敛。

## 3. 任务清单

见 [tasks.md](./tasks.md)。
