# Sandbox 延伸规划 — 任务清单

> 对应 [design.md](./design.md)；延伸自 [sandbox](../archive/sandbox/design.md)（2026-09-03 收官归档时移交的 5 项未决项）。

## 后端扩展（启动前先复核 2026-08-18"建议不做"评审理由是否仍成立）

- [ ] 1. Linux 系统 bwrap 后端（原任务 17）：`--ro-bind / /` 起步、`--bind <projectRoot>` 可写、`--unshare-net` 按网络条款；detect 接入与诚实降级
- [ ] 2. Windows WSL2 后端（原任务 18）：`wsl.exe` 探测 + 专用 distro（`wsl.conf` 关 interop）+ cwd 映射校验；未装 WSL 诚实降级
- [ ] 3. 平台能力矩阵（原 sandbox §六）逐格与实现对账后对外宣称（对账对象含 `detect.ts` 已登记降级记录）

## 独立项

- [ ] 4. 项目级 `mcpServers` 变更强制确认（原任务 20，P4 独立立项）——独立立项，T4 的最小可行改动
- [ ] 5. WASM/WASI 工具 ABI 预研（原任务 21，P5）——`node:wasi` 或 JCO 对比，产出预研报告；`PathGrant` 落地后即为 WASI preopen 的直接输入
