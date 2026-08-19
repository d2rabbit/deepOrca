# 远程接入调研与方案：向日葵式内外网映射（Remote Access via Sunlogin-style NAT Mapping）

> 日期：2026-08-15 · 分支：fix/stabilize-data-loss-and-test-suite
> 对应规划：`docs/features/feature-roadmap.md` §十三「远程接入」（本文将其 P2「用户自配隧道」升级为 P1「内置零配置映射」）
> 结论先行：**采用向日葵（Oray Sunlogin）式的"被控端主动外连 + 云端公网映射 + 识别码/验证码配对"模型，自建轻量 WSS 反向隧道（不 vendor frp/ngrok 二进制）；公网直连场景退化为中转参考方案里的直连模式，relay 只兜底 NAT 场景。**

---

## 〇、任务定位：roadmap §十三 读出了什么

roadmap §十三 已验证架构可行性，核心事实（本次复核代码确认，引用为当前行号）：

- **Renderer 是纯浏览器 bundle**：`renderer/api.ts:9` 只经 `window.deeporca` 与后端通信，零 Electron 导入。
- **IPC 契约 JSON-safe 且集中**：`shared/ipc.ts` 常量表共 **78 个 request channel**（`IpcRequest`，`ipc.ts:27-179`）+ **14 个 event channel**（`IpcEvent`，`ipc.ts:182-198`）；`DesktopApi` 是扁平的"一方法一 channel"映射（`ipc.ts:589` 起）。
- **Preload 是机械映射**：`preload/index.ts:15` 起每个方法就是 `ipcRenderer.invoke(IpcRequest.X, ...args)` —— 浏览器 shim 可以从同一份契约**机械生成**，把 `invoke` 换成 WS request/response 即可。
- **主进程 handler 已收口**：`main/index.ts` 的 `createIpcHelpers()`（`index.ts:621`）提供 `handle / handlePrivileged / handleShared` 三级注册器，是所有 `ipcMain.handle` 的唯一入口 —— 抽 dispatch table 只需改这一个工厂。
- **事件有单点**：module 级 `emit(channel, payload)`（`index.ts:380`）—— WS 广播只需给 emit 加一个 fan-out listener。
- **Renderer 产物已是静态站点**：`dist/renderer/index.html`（`index.ts:469` `loadFile` 加载），任何 HTTP server 可直接 serve。

roadmap 原方案的唯一留白：**隧道/公网映射推给用户自配**（蒲公英/ngrok/frp/Cloudflare Tunnel，P2 文档级）。这正是本方案要补的缺口 —— 用户要的是"向日葵那种"开箱即用：装完就有识别码，手机扫码即连，不碰路由器、不买域名、不懂 NAT。

## 一、方案选型：为什么是"向日葵式"而不是别的

### 1.1 向日葵模型拆解（我们要复制的本质）

向日葵（Oray Sunlogin）的内外网映射本质是四条：

1. **被控端主动外连**：内网设备上的客户端常驻，主动向云端服务器建立并保持长连接（outbound-only），穿透 NAT/防火墙，**无需公网 IP、无需端口映射**。
2. **云端公网映射**：云端为每台在线设备维护一个公网可达入口，把公网流量沿那条出站长连接"倒灌"回内网服务。
3. **识别码 + 验证码配对**：每台设备有唯一识别码，控制端凭识别码 + 短期验证码接入，零配置。
4. **数据面分级**：优先 P2P 打洞（UDP hole punching），失败降级云端中转（relay）。

### 1.2 候选方案对比

| 方案 | 零配置 | 流量路径 | 成本/依赖 | 判定 |
| --- | --- | --- | --- | --- |
| **自建 WSS 反向隧道（向日葵式）** | ✅ 扫码即连 | 中转（v1）→ 可演进 P2P | 一台 VPS/容器跑 relay；纯 npm `ws`，无二进制 | **采用** |
| vendor frp/rathole 二进制 + 官方 frps | ✅ 但配置在二进制里 | 中转 | 三平台二进制分发、frps 泛域名/子域配置笨重、升级通道外置 | 备选（协议冗余：我们只需 HTTP+WS，不需要通用 TCP 转发） |
| 用户自配 ngrok/Cloudflare Tunnel（roadmap 原 P2） | ❌ 注册账号/装客户端/配域名 | 中转 | 依赖第三方账号体系，免费档域名漂移 | 降级为"高级：自带隧道"附录 |
| 蒲公英/Tailscale 式 mesh VPN | ❌ 两端都要装客户端建虚拟网卡 | P2P 优先 | TUN 驱动、虚拟网卡权限，移动端体验差 | 否决（控制端是浏览器，装不了网卡） |
| 纯公网直连（RemoteServer 绑 0.0.0.0） | ✅ 但仅公网机器可用 | 直连 | 零 | 采用为**直连档**（见 1.3） |

**关键判断**：DeepOrca 远程流量的画像 = 一次性静态资源（~几百 KB）+ 持续 WS JSON 流（文本级带宽）。这种负载下 P2P 打洞的带宽收益≈零，**v1 纯中转即可**，打洞留作后期优化项 —— 这与向日葵"先中转可用、打洞只是加速"的演进顺序一致。

### 1.3 用户指令的落实："公网参考中转，映射走向日葵"

- **机器本身公网可达**（云主机/有公网 IP）：不绕 relay，RemoteServer 直接绑 `0.0.0.0` + token，即"中转参考方案"里的直连形态 —— 路径最短。
- **机器在 NAT 后**（绝大多数桌面场景）：TunnelClient 主动外连 relay，relay 提供公网映射 URL —— 向日葵式内外网映射。
- **同一局域网**：LAN 直连 `http://<lan-ip>:<port>/?token=…`，连 relay 都不碰。

三档共用同一个 RemoteServer 和同一份鉴权，只是入口地址不同 —— **自动选择，用户无感**。

## 二、总体架构

```
                        ┌─────────────────────────────── 控制端 ───────────────────────────────┐
                        │  手机/远程浏览器（同一份 dist/renderer，零改动）                      │
                        └───────┬──────────────────────────┬──────────────────────┬───────────┘
                   ① LAN 直连   │              ② 公网直连   │           ③ NAT 映射（向日葵式）│
   http://lan-ip:port/?token=…  │   https://host:port/?token │   https://relay/d/<code>/?pair=…
                                │                          │                      │ WSS 反向隧道
┌───────────────────────────────┴──────────────────────────┴──────────────────────┴───────────┐
│ DeepOrca Desktop（Electron 主进程，全部内置，无新进程）                                       │
│                                                                                             │
│  remote/tunnel-client.ts ──出站 WSS（仅 NAT 档激活）──▶ @deeporca/relay（公网，可自建）      │
│         │（NAT 档：把隧道帧转回本地回环）                                                      │
│         ▼                                                                                   │
│  remote/server.ts ── HTTP 静态服务（dist/renderer + shim）+ WS endpoint（同源）              │
│         │                                                                                   │
│  remote/ws-bridge.ts ── window.deeporca shim 的请求 → remote/dispatch.ts                     │
│         │                    （78 request 映射 / 14 event 广播）                             │
│         ▼                                                                                   │
│  remote/dispatch.ts ── 从 createIpcHelpers() 抽取的 handler 注册表                           │
│         │                    ipcMain.handle 只是其中一个 consumer，WS 是第二个                │
│         ▼                                                                                   │
│  SessionBridge → SessionManager（@deeporca/core，零改动）                                    │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

新增代码全部在 `packages/desktop/src/main/remote/`（约 4 个新文件）+ 新 monorepo 包 `packages/relay/`。**`@deeporca/core`、renderer 50+ 组件、SessionBridge 零改动**（沿用 roadmap 已验证结论）。

## 三、组件详细设计

### 3.1 dispatch table 抽取（一切的地基，改动最小化）

现状：`createIpcHelpers()` 的 `handle(channel, fn)` 直接调 `ipcMain.handle`。改为：

```ts
// main/remote/dispatch.ts（新建）
export type HandlerLevel = "main" | "privileged" | "shared";
export type DispatchFn = (args: unknown[], ctx: DispatchContext) => Promise<unknown>;
export type DispatchContext = { origin: "electron" | "remote"; remoteSessionId?: string };

const table = new Map<string, { fn: DispatchFn; level: HandlerLevel }>();
export function registerHandler(channel, fn, level) { table.set(channel, { fn, level }); }
export async function dispatch(channel, args, ctx) { /* 查表 + 级别校验 + 远程审计日志 */ }
export function listChannels(): Iterable<string>;
```

- `createIpcHelpers()` 的 `handle/handlePrivileged/handleShared` 改为调 `registerHandler(...)` 后再 `ipcMain.handle(channel, (e, ...args) => dispatch(channel, args, { origin: "electron" }))` —— Electron 侧现有 sender 校验（`assertMainRenderer` 等）原样保留在外层。
- 远程侧每个 channel 多一道 **远程允许清单**校验：`pickFolder`、`window:*`、`a2ui:openWindow` 等桌面 OS 语义 channel 对 `origin: "remote"` 返回结构化错误（renderer 已有错误 UI 兜底）；`handlePrivileged` 级 channel 远程同样放行但**追加审计日志**（时间戳 + channel + 参数摘要，写 `~/.deeporca/logs/remote-access.log`）。
- 事件侧：`emit()` 增加 `addEmitListener(fn)`，WS 桥注册一个 listener 广播 14 个 event channel。

### 3.2 RemoteServer（HTTP 静态 + WS，同源单端口）

`main/remote/server.ts`（Node `http` + `ws`，无框架）：

- **静态服务**：serve `dist/renderer/`；`index.html` 响应时在 `<script src="renderer.js">` 之前内联注入 `window.__DEEPORCA_REMOTE__ = { wsUrl, token }` 与 shim `<script src="/__shim/deeporca-ws.js">`。
- **WS endpoint**：`GET /ws` Upgrade。首条消息必须携带 token（30 秒未认证即断开）。认证后进入桥接循环。
- **安全头**：校验 `Host`/`Origin`（只允许 localhost/LAN/配置域，防 DNS rebinding）；`Content-Security-Policy` 同源自包含；`X-Content-Type-Options: nosniff`。
- **绑定策略**：LAN 直连档绑 `0.0.0.0`；纯 NAT 档可只绑 `127.0.0.1`（隧道客户端打回环即可，攻击面最小）。端口默认随机（`0`），设置里可固定。
- **Token**：每次"开启远程接入"生成 128-bit 随机 token，显示在完整 URL/QR 里；更换 token 即踢掉所有远端。

### 3.3 浏览器 shim（`window.deeporca` 的 WS 实现）

`main/remote/shim-template.ts` 生成一段自包含 JS（构建期也可预编译进 `dist/renderer/__shim/`）：

```js
// 逻辑骨架（契约来自 shared/ipc.ts，机械映射 preload/index.ts）
window.deeporca = new Proxy({}, {
  get: (_, method) => (...args) => wsRequest(METHOD_CHANNEL[method], args),
});
// 事件：deeporca.onXxx(cb) → 订阅表；收到 {t:"event", channel, payload} 时分发
```

- 消息格式：`{ t:"req", id, channel, args }` → `{ t:"res", id, ok, result | error }`；事件 `{ t:"evt", channel, payload }`。
- **类型保证**：`METHOD_CHANNEL` 映射表从 `IpcRequest` 常量 + `DesktopApi` 类型生成，加一个 desktop 单元测试断言"shim 映射表 ∪ 禁用清单 === IpcRequest 全集"，防止契约漂移。
- 断线：shim 指数退避重连 + renderer 顶部提示条（复用现有 McpStatus 断连 UI 模式）；pending request 超时 reject。

### 3.4 TunnelClient（向日葵式"主动外连"）

`main/remote/tunnel-client.ts`：

- **出站单连接**：`wss://<relay>/tunnel`（默认官方 relay，设置里可改自建地址）。一条 WSS 复用全部流量（类 frp mux，但协议是我们自己的薄帧格式）。
- **设备身份**：首次启动生成 Ed25519 密钥对 + deviceId（公钥指纹），持久化 `~/.deeporca/remote-device.json`（`chmod 600`）；注册时 relay 发挑战、client 签名应答 —— relay 无法伪造在线设备。
- **心跳/重连**：25s ping；断线指数退避（1s→2min 封顶，带 jitter），网络恢复事件（Electron `powerMonitor` / `online`）触发立即重连。
- **数据面**：收到 relay 的 `http-req` 帧 → 打到 `http://127.0.0.1:<remotePort>` → 回 `http-res` 帧；收到 `ws-open/ws-data/ws-close` 帧 → 维护到本地 `/ws` 的对应连接。即 TunnelClient 是"反向 HTTP/WS 代理"。

### 3.5 隧道协议（薄帧，JSON 控制 + 二进制数据）

控制帧（WS text，JSON）：

| 帧 | 方向 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `hello` | C→R | `{ deviceId, version }` | 建连首帧 |
| `challenge` / `auth` | R→C / C→R | nonce / 签名 | 设备身份校验 |
| `registered` | R→C | `{ code, publicUrl }` | 分配 8 位识别码与公网映射 URL |
| `pair-verify` / `pair-result` | R→C / C→R | 配对码校验请求/结果 | 配对时由设备端最终裁决 |
| `ping`/`pong` | 双向 | — | 心跳 |

数据帧（WS binary，4 字节 streamId 头 + 1 字节类型 + payload）：

| 类型 | 说明 |
| --- | --- |
| `http-req` / `http-res` | relay 把公网 HTTP 请求整体帧化（method/path/headers/body），client 本地执行后回传；body >64KB 分块 |
| `ws-open` / `ws-data` / `ws-close` | 每条远端浏览器↔引擎的 WS 对应一个 streamId，双向转发 |

设计要点：**relay 不需要懂 DeepOrca 的任何业务**，它只做"识别码 → 隧道连接"的路由 + 帧转发，因此 relay 极薄、可随便自建。

### 3.6 Relay（`packages/relay/`，新 monorepo 包）

公网服务，Node 22 + `ws`，单容器可跑：

- **入口**：HTTPS（前置 Caddy/Nginx 终结 TLS 或内嵌 `node:https` + ACME）。
- **URL 形态**：**路径式映射** `https://<relay-host>/d/<8位识别码>/...` —— 避免泛域名证书和 DNS 配置成本（ngrok 免费档漂移域名的痛点）；子域式 `<code>.relay.example.com` 留作后期可选。
- **职责**：设备注册表（内存 Map + 可选 Redis）、配对码校验转发、帧路由、速率限制（每设备并发流上限、每 IP 连接上限）、在线状态页。
- **运营**：v1 用户自建（一条 `npx @deeporca/relay` 或 docker run）；官方公共实例作为 Phase 2 默认地址，设备端永远允许 `--relay-url` 覆盖 —— 不锁死。
- **隐私边界**：v1 relay 终结 TLS，理论上可见明文（与向日葵/ngrok 同模型，需在文档明示）；Phase 3 可选端到端加密（配对时协商会话密钥，relay 只转密文）。

### 3.7 配对与鉴权（向日葵 UX 的复刻）

桌面端设置面板新增「远程接入」卡片：

```
远程接入  [━━━━ 开]
┌─────────────────────────────────────────────┐
│ 局域网直连   http://192.168.1.5:51773/      │  ← ① 同网段扫码即用
│              [QR]  token 已内含              │
│                                             │
│ 公网映射     KXRD-4821                       │  ← ② 向日葵式识别码
│              配对码 318 204（4:32 后过期）    │
│              [QR]  内容=完整URL+配对码        │
│                                             │
│ 已连接设备   iPhone Safari · 2 分钟前 [断开]  │
│              [全部断开]  [轮换配对码]         │
└─────────────────────────────────────────────┘
```

流程：手机扫 QR → 打开 relay 公网 URL → 输入（或 URL 已带）6 位配对码 → relay 经隧道向设备端 `pair-verify` → **设备端弹确认条**（显示来源 UA/IP，用户点"允许"，向日葵式最终裁决在设备主）→ relay 签发 HttpOnly session cookie（短期可续，绑定设备码）→ 进入完整 UI。

安全基线：

- token/配对码均高熵短期；配对码 5 分钟 TTL、试错 5 次即失效。
- 远程会话的权限询问（AskPermission）照旧走 UI —— 手机上一样要点"允许 bash"。
- 桌面端可一键断开全部远程会话；关闭远程接入即撤 token、断隧道。
- 全部远程调用审计日志（3.1）。

## 四、分阶段实施

| 阶段 | 内容 | 验收 | 依赖 |
| --- | --- | --- | --- |
| **M1 本地远程化** | dispatch table 抽取；RemoteServer + shim；LAN 直连档 + token；远程禁用清单；契约漂移测试 | 手机连同一 Wi-Fi 扫码打开完整 UI，发 prompt 收流式回复；`npm run check && npm test` 全绿 | 无新依赖（`ws` 一个） |
| **M2 隧道打通** | TunnelClient + `packages/relay` 最小实现（hello/auth/registered + 帧转发）；NAT 档端到端 | 4G 网络手机经 relay URL 访问家中电脑；断网重连自愈 | 一台 VPS/容器 |
| **M3 配对 UX** | 识别码/配对码/QR；设备端确认条；会话管理（断开/轮换）；relay 速率限制与审计 | 未授权访问被拒 + 审计可见；配对码过期/试错锁定生效 | M2 |
| **M4 可选优化** | WebRTC DataChannel 打洞（大数据面旁路 relay）；E2E 加密；mDNS `deeporca.local`；子域映射 | 打洞成功率遥测；relay 只见密文 | M3 |

**刻意不做**（v1）：移动端 UI 触摸/viewport 适配（独立功能域）、多用户多角色权限（远程端=设备主本人）、通用 TCP 转发（不是反向代理工具）。

## 五、对 roadmap §十三 的变更

- 原 P2「隧道配置文档（用户自配蒲公英/ngrok/frp）」→ 降级为附录「高级：自带隧道」（relay-url 指到用户自己的 frps/nginx 即可，协议公开）。
- 新增 P1：内置 TunnelClient + Relay（本方案 M2/M3）。
- 设计原则 1 修订：「DeepOrca 只提供服务端，隧道用户自配」→「DeepOrca 内置向日葵式零配置映射；公网直连与自带隧道作为高级档保留」。

## 六、风险与开放问题

| 风险 | 缓解 |
| --- | --- |
| renderer 中潜藏 Electron 语义调用（shell 打开外链、本地文件路径拖放、`showItemInFolder`） | M1 做一轮 renderer grep 审计，禁用清单 + shim 降级（外链改 `window.open`）；契约测试锁死 |
| 官方 relay 运营成本与合规 | v1 不自营默认实例，M2 先要求自建；M3 再评估官方实例（流量是纯文本，成本可控） |
| 远程与桌面同时操作同一会话 | 状态全在主进程、事件广播天然多端同步；同一会话两端同时发 prompt 由现有 SessionManager 串行化兜底 |
| 配对码被中间人截获（QR 内容即钥匙） | 配对码短 TTL + 设备端二次确认；E2E 加密（M4）彻底解 |
| Electron 主进程阻塞放大到远端 | RemoteServer/隧道帧处理全部异步无阻塞；大 body 分块流转 |

## 附：关键文件落点一览

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `packages/desktop/src/main/remote/dispatch.ts` | 新建 | handler 注册表 + 远程分发 + 审计 |
| `packages/desktop/src/main/remote/server.ts` | 新建 | HTTP 静态 + WS endpoint + 安全头 |
| `packages/desktop/src/main/remote/shim-template.ts` | 新建 | `window.deeporca` WS shim 生成 |
| `packages/desktop/src/main/remote/tunnel-client.ts` | 新建 | 出站 WSS 反向隧道客户端 |
| `packages/desktop/src/main/index.ts` | 改 | `createIpcHelpers()` 走 dispatch；`emit` 加 listener；启动时按设置拉起 remote |
| `packages/desktop/src/shared/ipc.ts` | 改（仅追加） | 远程禁用 channel 清单常量 |
| `packages/relay/` | 新建包 | 公网映射服务（独立部署） |
| `packages/desktop/src/tests/remote-contract.test.ts` | 新建 | shim 映射表 === IpcRequest 全集的漂移测试 |
