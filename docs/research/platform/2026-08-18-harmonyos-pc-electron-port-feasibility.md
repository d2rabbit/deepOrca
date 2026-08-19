# 鸿蒙 PC 适配可行性调研 — ohos_electron_hap 路线

> 状态：⬜ 纯调研（2026-08-18 拍板"先不做"，本文仅为决策留档）
> 定位：DeepOrca **桌面端自身运行在鸿蒙 PC 上**的可行性结论与证据。
> 反向命题勿混淆：[`specs/harmonyos-dev-kit/`](../../../specs/harmonyos-dev-kit/design.md) 是"用 DeepOrca **开发**鸿蒙应用"（DevEco CLI 线），本文是"DeepOrca **跑在**鸿蒙 PC 上"。
> 结论一句话：**有条件可行，可行性高**——以 [ohosvscode/ohos_electron_hap](https://github.com/ohosvscode/ohos_electron_hap) HAP 模板打包，跑 2in1（PC/二合一）形态；剩余硬点集中在 Node 版本、子进程边界与三个原生依赖的交叉编译。

---

## 1. 背景

项目所有者提出：开发环境正转向 Windows + 鸿蒙（见同日 `test` 基线分支的 Windows 测试修复），希望评估 DeepOrca 桌面端能否适配**鸿蒙 PC 端**（明确不是移动端）。此前判断为"整机不可行（Electron 无鸿蒙端口）"，本项目所有者提供 ohos_electron_hap 仓库推翻了该前提。

## 2. 外部证据：ohos_electron_hap 是什么

| 事实                                                                                                                                                                                                                                  | 证据                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **HAP 模板项目**：把任意 Electron 应用产物放进 `web_engine/src/main/resources/resfile/resources/app/` 即可打包                                                                                                                        | README / QUICKSTART                                          |
| 开发方为**海泰方圆**（公司背书，ohosvscode 组织 = VS Code 鸿蒙移植线），2025-08 仍活跃产出文档                                                                                                                                        | docs 图片时间戳、搜索概述                                    |
| **目标设备形态就是 PC 系**：`deviceTypes: ["tablet", "2in1"]`                                                                                                                                                                         | `electron/src/main/module.json5`                             |
| **目标 SDK 为 HarmonyOS 5.0.3（API Level 15）**——NEXT 时代当前版本，非旧版兼容路线                                                                                                                                                    | `build-profile.json5`（`compatibleSdkVersion: "5.0.3(15)"`） |
| 已移植 **Electron 25.3.2 与 34.0.2** 两个运行时（完整 ELF，arm64-v8a）                                                                                                                                                                | addon 文档 `--target` 说明                                   |
| **原生 addon 可交叉编译并在端内加载**：node-sqlite3 5.1.7 用 OHOS LLVM 工具链（`--target=aarch64-linux-ohos`，musl，`-D__MUSL__=1`）+ [electron-ohos-napi-shim](https://github.com/ohosvscode/electron-ohos-napi-shim) 编出并加载成功 | `docs/鸿蒙平台Electron加载addon（基于node-sqlite3）.md`      |
| 多进程架构复刻（渲染进程独立子进程）、50+ 平台适配器（窗口/剪贴板/通知/权限）、`childProcess.ets` 存在                                                                                                                                | 搜索概述、`web_engine/childProcess.ets`                      |
| 声称**不要求修改现有 Electron 应用源码**；平台识别为 `process.platform === 'ohos'`                                                                                                                                                    | README 常见问题                                              |

两个关键推论：

1. **模板 ≠ 版本无关**。脚手架可复用，但移植版 Electron 运行时是稀缺资产，目前实证到 34（Node 20.18）。"最新 Electron 能不能"取决于移植团队的跟进节奏（34 为 2025-01 版本，团队 2025-08 仍活跃，跟进是现实预期）。
2. **鸿蒙"类 Unix"只在 native 层成立**：Linux 内核 + musl libc，交叉编译体验接近"编一个 musl ARM64 Linux"（这就是 node-sqlite3 能编过去的原因）。但应用层仍是 HAP 沙箱 + ArkTS 生命周期 + `platform='ohos'`——类 Unix **不自动**给应用 spawn 工具链的能力。

## 3. 本仓耦合面事实（2026-08-18 代码核实）

| 耦合点            | 事实                                                                                                                                                                                               | 对鸿蒙适配的含义                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 渲染层            | 零 Electron 耦合：全 renderer 仅经 `window.deeporca`（`renderer/api.ts:9`），无任何 `electron`/`node:` 直引                                                                                        | 模板"不改应用源码"对 renderer 成立                                 |
| IPC 契约          | `shared/ipc.ts` 零依赖设计，`DesktopApi` = 106 请求方法 + 15 事件订阅（2026-08-18 复核更正：初稿误记 102）                                                                                         | 传输可换（WS/ArkWeb 桥），契约不动                                 |
| core 引擎         | 纯 JS 无原生依赖，但 `fs` 63 文件、`child_process` 11+ 处（bash/MCP/git/uv/通知/sandbox/web-search）                                                                                               | 沙箱内 fs 可用；spawn 见 §4-2                                      |
| `node:sqlite`     | core 直接使用：`actions/crg-query.ts`、`common/sqlite-runtime.ts`（本就是"探测可用 SQLite 运行时"的抽象层）、`memory/tdai/core/store/sqlite.ts:141`（动态 require，sqlite-vec/jieba 均有降级路径） | Node 22 缺位时的改造点集中且已有抽象承接                           |
| 原生依赖三件      | `onnxruntime-node`（embedding，经 transformers.js 动态 import，**无 wasm 回退配置**）、`sqlite-vec`（有 degraded 模式）、`@node-rs/jieba`（有 Unicode 正则回退）                                   | musl-ohos 交叉编译机制已被对方验证；embedding 也可切 wasm 后端绕开 |
| 语义路由          | fail-open 设计，embedding 缺位即回退全量候选                                                                                                                                                       | 原生依赖缺位不阻塞运行                                             |
| vendor 体量       | ~228MB：granite-embedding 118MB、uv 69MB、dembrandt 26MB、browser-skill 14MB                                                                                                                       | granite 改按需下载；uv/dembrandt/browser-skill 端内放弃            |
| MCP 形态          | 已有 in-process 先例（CodeGraph SDK、Activity-Frames、A2UI）                                                                                                                                       | 端内保留 in-process 系、砍进程系（npx/uvx/python）是自然切法       |
| Electron 深耦合点 | WebFetch 渲染引擎用离屏 Chromium（`session-bridge.ts:277-283`）、dembrandt CDP 浏览器                                                                                                              | 端内降级为静态 fetch / 放弃 dembrandt                              |

## 4. 阻塞点与缓解（按硬度排序）

1. **Node 版本天花板 20**（Electron 34 = Node 20.18），而本仓要求 Node ≥22 的全部理由是 `node:sqlite`。
   - 首选：等/推移植到 **Electron ≥35**（35 起内嵌 Node 22），阻塞点自动消失；
   - 退路 A：`node:sqlite` 调用点 addon 化——对方文档已手把手验证 node-sqlite3 可用；
   - 退路 B：走 `sqlite-runtime.ts` 既有探测抽象换后端；
   - 双保险策略：addon 化本来就是解耦改造，值得先行。
2. **子进程边界待实测**（头号未知）：应用能否 spawn 系统二进制（git/命令行）决定 bash 工具、git 面板、进程型 MCP 的存留。框架层有 `childProcess.ets` 与多进程复刻，但用户代码 spawn 任意命令的能力需真机验证。
3. **三个原生依赖交叉编译**：机制已验证，工作量为 musl-Linux 级；onnxruntime-node 最大，或切 transformers.js wasm 后端绕开。
4. **`process.platform === 'ohos'` 分支**：shell 探测（bash 工具的 `setShellIfWindows` 类逻辑）、路径体系（映射 `el2/base` 沙箱 + 目录授权 API `requestDirectoryPermission`）、sandbox 后端走既有 noop。
5. **包体裁剪**：granite 118MB 按需下载；HAP 大小限制需确认。
6. **架构对口**：现有移植仅 arm64-v8a，与当前鸿蒙 PC（麒麟 ARM）对口；若出现 x86 鸿蒙 PC 需另编。

## 5. 替代路线与关系

**无头 WS 服务端 + ArkWeb 壳**（把 core 抬到传输中立层，鸿蒙侧只做 webview 壳）依然成立：不依赖该社区项目生存状态，且解锁远程/浏览器访问。两路线共用第一步——**抬平宿主语义（`main/index.ts` 各 `registerXxxIpc` → 传输中立层）**，该步对两条路线都是子集工程。若 HAP 路线验证受阻，替代路线自动成为回退。

## 6. 行动清单（日后启动时的验证 POC 顺序）

1. 鸿蒙 PC 真机/模拟器跑通 ohos_electron_hap 官方 demo（确认 2in1 形态 + 5.0.3 表现）；
2. 用其工具链试编**一个**本仓原生依赖（建议先 `@node-rs/jieba` 最小，再 onnxruntime-node）；
3. `node:sqlite` 调用点审计（crg-query / sqlite-runtime / memory 三处，标注各自降级行为）；
4. spawn 边界实测（child_process.spawn 一个系统命令，定 bash/git/进程型 MCP 去留）；
5. HAP 包大小限制与 118MB 模型分发策略（内置 vs 按需下载）；
6. 评估移植团队跟进节奏与 Electron ≥35 概率，决定"等版本"还是"addon 化先行"。

**观望条件**：在 1、4 两项有真机结论之前，不启动任何正式实现（遵守 research 总口径：正式实现以 `specs/` 为准，届时另立 spec）。

## 7. 调研方法说明

外部事实来自 ohos_electron_hap 仓库的 README/QUICKSTART/addon 文档/代码结构（zread 索引 + web reader，GitHub API 因本地 TLS 证书问题未取到 star/commit 数据，成熟度评估以文档时间戳与开发方背书替代，**未完全核实**）；本仓耦合面数据来自同日代码走读（file:line 均可复核）。
