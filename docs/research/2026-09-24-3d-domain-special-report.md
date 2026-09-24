# 专题深化：3D 能力域 —— 从「建模两段」到「六段全景」（CozyClay 补入预演/运动/镜头段）

> 日期：2026-09-24 · 分支：`feat/modern-ui-redesign` · 性质：专题深化报告（纯留档，无代码变更）
> 对象：[NomaDamas/CozyClay](https://github.com/NomaDamas/CozyClay)（AGPL-3.0-or-later，717★，2026-09-24 时点）+ 既有 3D 调研线索合并
> 前序调研：[2026-08-13-text-to-cad-img2threejs.md](./2026-08-13-text-to-cad-img2threejs.md)（3D 第一轮：建模/重建两段）、[specs/next-version/cad-3d-generation/design.md](../../specs/next-version/cad-3d-generation/design.md)（承接 spec，规划中）、[gameStudio/gamefactory3a 预研](./gameStudio/gamefactory3a/2026-09-15-gamefactory3a-prestudy.md)（3D 资产层）、[gameStudio 第二轮专题报告](./gameStudio/2026-09-24-game-dev-round2-special-report.md)（threejs-game-skills 的 3D 生成技能）
> **总口径：调研仅供参考，正式实现一律以 `specs/` 为准。本文不另立 spec、不启动代码。**

---

## §1 定位声明（先读这个）

本仓的「3D」调研此前只有一条线：**2026-08-13 的 text-to-cad + img2threejs 评估**，
它回答的是「**怎么把形状造出来**」——参数化 B-rep（text-to-cad → STEP）与
图像→代码重建（img2threejs → Three.js 工厂函数），并由
`specs/next-version/cad-3d-generation/`（C1–C6，P0–P2，规划中）承接为
「3D 与制造」功能域。

**CozyClay 揭示的是这条线之外的三段**。它是一个浏览器 3D **预演（previs）工作室**：
搭场景（block a scene）→ 给角色摆姿势（pose the cast）→ 编排多阶段动作与镜头
移动/切换（author camera moves and cuts）→ **把同一组镜头喂给 AI 视频模型**
（take the same shots to an AI video model）。它**不做任何建模**——不生成 mesh、
不雕刻、不重建；它消费模型、编排场景、产出镜头。

因此本轮 3D 专题的任务不是再评估一个建模工具，而是：**把 3D 能力域从「两段」
重画成「六段」**，检查每段的外部供给与本仓覆盖，并回答两个对位问题：
①cad-3d spec 的六项能力（C1–C6）在六段全景里处于什么位置？
②CozyClay 补入的 ④⑤⑥ 三段，与本仓既有的「内容→视频」线（code2video-remotion、
tmem-hyperframes 预研）是什么关系？

### 调研材料（全部一手）

| 类别   | 材料                                                                                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 入口   | `README.md` 全文（zread）                                                                                                                                            |
| 许可   | `LICENSING.md` 全文（GPL-3.0 → AGPL-3.0 迁移细节）+ GitHub API                                                                                                       |
| MCP    | `mcp/README.md` 全文（24 工具目录、双模式、live 协议、设计章节）                                                                                                     |
| 架构   | 仓库结构全量（zread）：`src/` 60+ 模块、`mcp/` 20+ verify 脚本、`test/` 60+ verify 脚本、`docs/`（asset-system-redesign / unity-reference / guest-first-experiment） |
| 元数据 | GitHub API（717★ / 79 forks / 0 open issues / created 2026-07-28 / pushed 2026-09-23）                                                                               |

---

## §2 TL;DR

**判定：CozyClay 不是建模工具，是 3D 能力域里本仓从未调研过的「编排→运动→镜头」
三段的唯一开源参照；它的机制层价值（单一实现共享、穷举验证、双模式 MCP、
确定性修正层）大于它的领域能力；AGPL-3.0 是硬红线——不可 vendor、不可拷贝任何
代码，只可借鉴机制。**

| 段                        | 供给方                                                                                                        | 本仓覆盖                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| ① 几何生成（造形）        | text-to-cad（B-rep）/ img2threejs（代码重建）/ Tripo·Meshy（云 mesh）/ TRELLIS.2（本地）                      | cad-3d spec C1/C3（规划中）+ 游戏专题三方证据 |
| ② 确定性校验（验形）      | Divine Eye（IoU/pHash/SSIM）/ text-to-cad 几何校验 / GameFactory 视觉 QA 定义 / **CozyClay 420 组合穷举验证** | spec C1 修复回路（规划中）                    |
| ③ 资产工程化（用形）      | Tripo auto-rig + GLB/FBX、threejs-3d-generator 集成、（2D 侧 Aseprite 图集）                                  | spec C2 预览器（规划中）                      |
| ④ 场景编排/预演（布景）   | **CozyClay（本段唯一开源参照）**                                                                              | **零覆盖**                                    |
| ⑤ 运动生成（动起来）      | **CozyClay**（Kimodo/ARDY + prompt blocks + sparse IK）+ GameFactory motion skill                             | **零覆盖**                                    |
| ⑥ 镜头语言/出片（拍出来） | **CozyClay**（film vocabulary + render_prompt → AI 视频 prompt + MP4/OTIO/USD 出口）                          | **零覆盖**（与内容→视频线接壤）               |

三条速记：

1. **六段全景是本轮最大的地图级发现**：第一轮 3D 调研（08-13）只画了 ①②③；
   cad-3d spec 的 C1–C6 也全部落在 ①②③。④⑤⑥ 三段在 CozyClay 出现前，
   本仓没有可名状的外部参照——这三段恰好是「3D 内容走向成片/交付」的必经之路。
2. **「生成 + 确定性修正」哲学的第三次独立出现**：Sprite Studio（2D）说
   "AI 只画源画，绑定与动画必须确定性渲染"；img2threejs（3D 重建）说
   "Scripts enforce, the model judges"；CozyClay（3D 运动）用 **sparse IK 修正**
   生成动作中需要修的部分——三个域、三套实现、同一条纪律。
3. **AGPL-3.0 红线**：2026-08-21 从 GPL-3.0 迁移而来，网络服务条款 §13 生效
   （官方构建用 `VITE_SOURCE_CODE_URL` 在页脚挂源码链接合规）。对本仓：
   **不 vendor、不拷贝、不修补分发**；唯一干净边界是「用户自装外部工具」姿态
   （同 Aseprite「探测用户已装副本」先例）——而这一点在本轮结论下也**没有必要**，
   因为可借鉴的全在机制层。

---

## §3 CozyClay 深潜

### 3.1 基本盘

| 维度   | 事实（一手核证）                                                                                                                                                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 出品   | NomaDamas（维护者 Doyun/HaD0Yun），个人项目；创建 2026-07-28，pushed 2026-09-23（活跃中），0 open issues                                                                    |
| 定位   | 浏览器 3D 预演工作室（"Block a scene, pose the cast, cut the camera — in a browser tab"）                                                                                   |
| 技术栈 | Three.js + **React Three Fiber** + React + Vite；Node ≥22；Chromium 系浏览器                                                                                                |
| 分发   | npm `cozyclay`（`npx cozyclay` 即全部安装——**发布预构建 dist，不装依赖树**；运行时库全部在 devDependencies，这是一个刻意的工程决策）；全局命令 `cclay`；本地 127.0.0.1:5180 |
| 许可   | **AGPL-3.0-or-later**（2026-08-21 起接受贡献；此前 GPL-3.0-or-later，旧贡献保留原许可，AGPLv3 §13 允许两者组合）                                                            |
| 热度   | 717★ / 79 forks，仓库 51.9MB（含 demo/文档资源）                                                                                                                            |

**产品闭环**（README 五行能力表逐字核对）：搭景（图元+套装件，W/E/R gizmo，
Ctrl 反转网格吸附，**鸟瞰 plan view 驱动角色路径的 2D 根 waypoints**）→
飞行相机（右拖飞行/WASD 行走/Q/E 升降/Alt 环绕/F 取景，「3D 编辑器肌肉记忆」）→
**全可撤销**（所有场景变更走单一 history store；一次拖拽/一次 scrub/一次面板编辑
= 恰好一条 undo 记录；Esc 取消进行中的拖拽并恢复拖前变换）→
生成动作（摆姿势+导出 pose；多阶段动作用 **Prompt Blocks** 排在可缩放时间线上；
送 Kimodo 生成；回放时用 **sparse IK 修正**生成动作中需要修的部分）→
AI 导演（MCP："put a detective and a courier in an alley, give me a low wide
profile shot, then make her stand up from the chair, sprint, and trip"——
AI 布置演员、取景、生成多阶段动作，viewport 在你眼前动起来）。

### 3.2 出口管线：previs 的「交付物」是什么

这是理解 CozyClay 价值的关键——它的交付物**不是渲染图，是"镜头"**，且有四条出口：

| 出口               | 实现（src/ 模块证据）                                                                                                                                              | 意义                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **AI 视频 prompt** | `render_prompt`：把当前镜头几何转成携带真实取景的图像/视频生成 prompt（"so the generated frame matches the blocking instead of drifting off into a generic shot"） | **3D 场景的几何真值 → 文生视频模型的镜头语言**——这是「预演→AI 成片」的桥 |
| **MP4 导出**       | `mp4-muxer.js` + `offscreen-export.js` + `verify-mp4-duration/record-mp4-source`                                                                                   | 离屏确定性导出成片（浏览器内 mux）                                       |
| **剪辑交换**       | `otio.js`（OpenTimelineIO）+ `cuts.js` + `speed-envelope.js` + `sample-at.js`                                                                                      | 镜头序列以行业标准剪辑格式交换（进 Premiere/Resolve 等）                 |
| **DCC/引擎交接**   | `usd-camera.js`（**USD 相机导出**）+ `docs/unity-reference.md`（Unity 交接参考）+ `multimodel-ingest.js`（多来源模型摄入）                                         | 预演相机/场景进真实制作管线（USD 是 Pixar 起的 3D 交换事实标准）         |

**对照**：text-to-cad 的哲学是「交付 STEP 给工厂」（工程下游事实标准）；
CozyClay 是「交付镜头给视频模型/剪辑线/DCC」（内容下游事实标准）。
**"生成物必须能进下游事实标准"是两者共同的铁律**——cad-3d spec 的
「GLB 始终导出一份」条款是同一原则在本仓的实例。

### 3.3 MCP 双模式：一份工具目录，两种运行形态

`mcp/README.md` 全文核证，24 个工具：

- **Editor open**：工具调用实时驱动可见 viewport（相机/演员/布景/动作/时间线
  prompt blocks）——"**the screen you are looking at is the source of truth**"。
- **No editor**：场景/相机/prompt/工程文件工具**无浏览器、无 GPU、无构建**地在
  内存里跑；四个工具（`capture_frame` / `set_prompt_blocks` / `generate_motion` /
  `apply_batch`）**显式要求 live editor**，缺席时返回明确错误或可读说明。
- 传输：stdio MCP + 自托管 `ws://127.0.0.1:5184/live`（live 协议 16 命令，
  `LIVE-PROTOCOL.md` 单独成文）；另有 `--http 5183` Streamable HTTP 模式
  （每客户端一个隔离会话；**live 端口只被一个会话持有，其余会话有意降级为
  memory-only**）。
- **验证面**：`npm run verify` 驱动无编辑器兜底路径全量自测；`npm run verify:live`
  对着**假编辑器**测 live 协议；`verify-live-*` 系列 9 个脚本覆盖
  P0/批量/捕获/编辑器模型/运动任务/端口/路由/场景一致性/协议版本——
  加上 `test/` 下 60+ verify 脚本，**测试以"verify 脚本"为主要形态**。

### 3.4 shot.js 单一实现哲学（机制层最有价值的一条）

mcp/README.md「Design」节原文：

> "This server owns no geometry, no film vocabulary and no prompt text. Every
> answer is computed by the same modules the studio renders with, imported
> straight from the working tree…
> **The studio and the MCP server cannot disagree about what a 35mm medium shot
> is, because there is only one implementation of it.**"

MCP server 不拥有任何领域逻辑——`shot.js`（几何→镜头语言→prompt）、`scenes.js`、
`scene-objects.js`、`camera-move.js`、`project.js` 全部直接 import 渲染器同款模块。
改 `shot.js` 里一个景别分档，MCP 下次启动自动说新话，**无需发布安装**。

配套两条硬工程：

1. **`frame_shot` 是唯一反解点**：按意图（size/view/level/side）解出能产生该
   取景的相机位——即对 `shot.js` 求逆。**`npm run verify` 穷举 schema 接受的
   全部 420 种组合**：正反解一致性进 CI，"retune 一个分档会在这里大声失败，
   而不是悄悄错帧"。
2. **取景冲突的裁决策略**：景别是更强请求——" overhead 镜头下的极特写对广角
   镜头几何不可实现（相机会钻进主体）"，于是**服务端自动换更长焦距并明说**，
   "the way a crew swaps glass rather than abandoning the close-up"
   （像剧组换镜头而不是放弃特写）。

### 3.5 运动生成：Prompt Blocks + 生成 + sparse IK 修正

- 输入是**自然语言阶段序列 + 时长**：`phases: ["seated on a chair, slowly
stands up", "breaks into a sprint", "trips and falls hard to the ground"],
seconds: 10`。
- 管线：阶段**平铺**成连续 ARDY 段 → 经本地桥（127.0.0.1:5181，`npm run dev`
  启动）流式生成 → 编辑器在线时把结果装到活动角色并以 prompt blocks 上时间线；
  超长的阶段自动拆成连续多块；可传 `motion_url` 复用旧片段不重生成。
- 回放侧用 **sparse IK 修正**（`test/ik/`、`verify-bvh-cskel27.mjs`、
  `pose-extract/`、`pose-thumbs.js`——BVH 与 cskel27 骨架证据）修生成动作的
  接触/漂移问题。
- 依赖：**SSH 可达的 NVIDIA 机器跑 Kimodo**（`CCLAY_KIMODO_HOST`，
  `npm run kimodo:setup` 首次下载 checkpoint + 文本编码器栈）；托管 demo 的
  GPU 盒可用 NVIDIA ARDY 运行时（第三方，不在仓库内）。
  ——**运动生成是全仓唯一硬 GPU 依赖**，与本仓「本地优先」有张力。

### 3.6 安全与运维面（外部印证本仓哲学）

- **工程文件路径安全包络**：工具限定 `COZYCLAY_PROJECT_ROOT`；只收直接子级
  `.cclayproject`；相对路径锚定到**保留的项目根 inode**；拒绝符号链接逃逸；
  终名以 `O_NOFOLLOW` 打开；覆盖既有文件必须 `overwrite: true`；并诚实声明
  该边界依赖「目录仅受信用户可写」的权限前提。**与本仓 IPC workspace-root
  pinning（`resolveRegisteredRoot()`/`isKnownRoot`）是同一套威胁模型与解法**，
  可互为外部印证。
- **托管 demo 队列策略单源**：全部配额规则（每账号 1 并发/每日 2 次/全局等待
  上限 200/租约 15min+心跳 60s+硬停 20min/重试 2 次/结果保留 30 天）只在
  `workers/api/src/policy.js` 一处，"nothing else carries a copy"；GPU 盒轮询器
  **只出站连接、绝不监听**。
- **遥测透明**：PostHog 匿名、无 cookie、可关（`cclay telemetry off`）；
  npm 官方包带签名、重打包不启用遥测。

### 3.7 许可红线（结论性判定）

- **不可 vendor / 不可拷贝任何代码**：AGPL-3.0 对闭源/专有宿主是比 GPL 更强的
  传染（网络交互也触发 §13 源码义务）。本仓先例：MemBrain 因无 LICENSE 文件
  禁止拷贝代码（08-17 预研）；CozyClay 是**有 LICENSE 且明确 AGPL**——同样禁止，
  且更重。机制借鉴（本文 §5）不涉代码，干净。
- 「用户自装 `npx cozyclay` 作为外部工具」在 AGPL 下对**未修改副本**是可行边界
  （同 Aseprite「探测用户已装副本」姿态）；但本仓没有任何消费场景，**不建立
  该集成**，仅留档此判定供未来避免误议。

---

## §4 3D 能力域六段全景（合并全部来源的地图）

```
①几何生成 ──→ ②确定性校验 ──→ ③资产工程化 ──→ ④场景编排/预演 ──→ ⑤运动生成 ──→ ⑥镜头语言/出片
   造形           验形              用形              布景              动起来          拍出来
─────────────────────────────────────────────────────────────────────────────────────────────
text-to-cad   Divine Eye       Tripo auto-rig      CozyClay          CozyClay        CozyClay
 (B-rep STEP) (IoU/pHash/SSIM) GLB/FBX 导入        blocking/gizmo    Kimodo/ARDY     film vocabulary
img2threejs   几何校验脚本     threejs-3d-gen      planview 路点     prompt blocks   render_prompt
 (代码重建)   GameFactory      （游戏技能集成）    history 单store   sparse IK       MP4/OTIO/USD
Tripo/Meshy   视觉QA定义       Aseprite（2D 侧）   组/装配          GameFactory     出口四件套
TRELLIS.2     CozyClay 420                          （唯一开源参照）  motion skill
（本地）      组合穷举
─────────────────────────────────────────────────────────────────────────────────────────────
本仓覆盖：cad-3d spec C1–C6 全部落在 ①②③（且为「规划中」）；④⑤⑥ 零覆盖
```

三点地图级判读：

1. **cad-3d spec 的六项能力在全景里的位置**：C1（CAD 生成）C3（img→three.js）
   在①；C1 的修复回路与 Divine Eye 在②；C2（预览器）在③；C4（DXF）/C5（标准件）
   /C6（URDF）是①③的制造/机器人分支。**spec 不需要因 CozyClay 改写**——
   它服务的是「制造」下游（STEP 给工厂），与 CozyClay 的「内容」下游（镜头给
   视频模型）是两条不同的出海口，共享①②③供给。
2. **④⑤⑥ 与「内容→视频」线的关系**：code2video-remotion 预研（React→视频）与
   tmem-hyperframes 预研（HTML→视频）解决的是**排版层**；CozyClay 的
   `render_prompt` 解决的是**镜头层**——用场景几何真值（机位/景别/水平角/焦距/
   距离，"the subject fills 40% of frame height, 4.39m"）约束视频生成 prompt，
   防"drifting off into a generic shot"。两者正交：前者管画面里有什么，
   后者管摄像机在哪。**若未来内容→视频线立项，镜头语言是缺失的一轴**。
3. **「生成 + 确定性修正」三域收敛**（§2 速记 2 的展开）：2D 精灵（Sprite
   Studio：rig 确定性渲染帧）、3D 重建（img2threejs：脚本硬门禁）、3D 运动
   （CozyClay：sparse IK 修接触）——**生成模型出大形，确定性层保关键不变量**
   （身份/几何/接触）。cad-3d spec 的「确定性门禁（脚本侧，零 token）→ VLM
   层降级为用户确认卡」正是同一哲学在 CAD 域的第四个实例。

---

## §5 对照本仓：机制映射与差距

### 5.1 机制层映射（CozyClay → 本仓既有物）

| CozyClay 机制                                                                               | 本仓对应物                                                                              | 判定                                                                                                                          |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **单一实现共享**（MCP import 渲染器同款模块，"only one implementation"）                    | desktop 工具（gitmcp/a2ui）复用 core seam；`design.audit` 确定性零 LLM                  | **本仓已同构**；CozyClay 是外部印证——"UI 与工具面共享领域模块"值得作为 lint 级原则显性化                                      |
| **穷举验证**（420 组合正反解一致性进 CI）                                                   | 测试体系（node:test/dom-harness）                                                       | 形态差异：本仓按行为写用例；**「对参数→语义模块穷举 schema 全组合」是可补的测试形态**（如 dd 编译器、taste 轴、选项映射 DSL） |
| **双模式工具面**（live/headless 一目录；live-only 四工具枚举；"screen is source of truth"） | A2UI 全域动态 UI + offscreen Chromium（WebFetch 专用）                                  | 本仓两件是分离的；「一份契约、两种运行、能力差异显式枚举」的目录设计可参照                                                    |
| **apply_batch = 一次用户可见 undo 事务**（≤100 变更）                                       | file-history（轻量 git undo）+ 任务树快照                                               | 本仓有 undo 底座；**「批量操作折叠为单条撤销记录」的交互语义**是增量                                                          |
| **路径安全包络**（root 钉定/O_NOFOLLOW/符号链接拒绝/overwrite 显式）                        | IPC workspace-root pinning（`resolveRegisteredRoot()`/`isKnownRoot`，未注册根降级为空） | **同一威胁模型与解法的外部互证**；`O_NOFOLLOW` 与 inode 锚定两招是本仓未用的加固项                                            |
| **队列策略单源文件**（policy.js 唯一副本）                                                  | settings 单源 + 规格治理                                                                | 模式印证：「配额/策略只活在一处」                                                                                             |
| **预构建 dist 发布**（运行时依赖全进 devDependencies，`npx` 不装依赖树）                    | desktop esbuild 产物                                                                    | 分发决策互证（本仓安装器同理不装源码依赖）                                                                                    |

### 5.2 差距与建议姿态（不给落地方案）

- **④⑤⑥ 三段零覆盖是事实，但不是缺口必须马上补**——取决于本仓是否做
  「3D 内容/成片」方向。当前唯一活跃的 3D 线（cad-3d spec）服务制造下游，
  不需要 ④⑤⑥。
- **若内容→视频线重启**（tmem-hyperframes 已把 Remotion 许可红线拆掉一半），
  CozyClay 的贡献是**镜头语言轴**：`render_prompt` 示范了「几何真值 → 生成
  prompt」的桥怎么搭（尺寸=主体占画幅百分比、水平角、焦距、距离——全部可从
  场景状态计算，不靠自由文本祈祷）。
- **运动生成段的重依赖**（SSH NVIDIA 机 + Kimodo checkpoint）与本仓本地优先
  相悖；若未来涉及，姿态应是 provider 抽象 + 用户自备 GPU，而非内置。

---

## §6 可借鉴清单（全部 ∥ 观察记账）

> 集成深度标度：L0 = 知识/提示词层；L1 = 用户可选外挂；L2 = 内置能力；L3 = 源码级继承。
> **AGPL 红线：以下全部为机制/知识层借鉴，不涉任何代码。**

| #   | 发现                                                                                                                   | 深度       | 为什么值得记                                                                                             | 证据                             |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | **3D 能力域六段地图**（生成→校验→工程化→编排→运动→出片），cad-3d spec 只占前三段                                       | L0         | 地图级发现：任何 3D 立项讨论先在这张图上定位；④⑤⑥ 是内容向 3D 的必经段                                   | 本报告 §4（多源合成）            |
| 2   | **「生成物必须进下游事实标准」双案例**：text-to-cad→STEP（制造）/ CozyClay→AI video prompt + OTIO + USD 相机（内容）   | L0         | cad-3d spec「GLB 永远导出一份」的同源铁律；未来任何生成物管线先回答"下游认什么格式"                      | 两项目对照                       |
| 3   | **shot.js 单一实现哲学**："UI 与 MCP 不可能对 35mm 中景有分歧，因为实现只有一个"                                       | L0/L3 观念 | 领域语义模块被 UI 与工具面共享 import——对 A2UI/designer/dd 编译器的长期一致性是结构性保险                | mcp/README.md Design 节          |
| 4   | **穷举组合验证**：参数→语义模块（含正反解）按 schema 接受的全组合进 CI（420 组合）                                     | L1         | 对 dd 编译器 / taste 轴 / 选项映射 DSL 这类"枚举空间有限"的模块可低成本补一层穷举测试                    | `mcp verify`                     |
| 5   | **几何真值 → 生成 prompt 的桥**：`render_prompt` 把机位/景别/水平角/焦距/距离算进视频生成 prompt，防 generic shot 漂移 | L0         | 内容→视频线重启时的镜头语言轴；「prompt 从确定性场景状态推导」对 designer 线的图片生成 prompt 同样适用   | mcp/README.md                    |
| 6   | **取景冲突的"换镜头"策略**：更强请求优先，几何不可行时自动换焦距并明说，而非放弃请求                                   | L0         | 任何"参数约束互相冲突"的工具面（布局/排版/调参）的裁决模式                                               | 同上 Framing conflicts           |
| 7   | **双模式 MCP 目录**：live/headless 一份契约；live-only 能力显式枚举并在缺席时返回可读说明；"屏幕即真值"                | L0/L1      | 对本仓 browser/a2ui 类工具面的目录设计参照                                                               | mcp/README.md                    |
| 8   | **批量操作 = 单条用户可见 undo 事务**（≤100 变更一次 apply_batch）                                                     | L0         | 批量编辑类 action 的交互语义（撤销粒度对齐用户意图而非操作次数）                                         | mcp 工具表                       |
| 9   | **sparse IK 确定性修正层**：生成动作的接触/漂移用 IK 修正而非重生成                                                    | L0         | 「生成+确定性修正」三域收敛（2D 精灵/3D 重建/3D 运动）的第三实例；任何生成管线的"关键不变量保底"设计模式 | README Generate motion           |
| 10  | **Prompt Blocks 时间线**：多阶段动作 = 可缩放时间线块；超长阶段自动拆块；片段可 URL 复用                               | L0         | 时序内容的作者面抽象（对动画/演示/视频线的编辑面参照）                                                   | 同上                             |
| 11  | **路径安全包络**（root 钉定 + inode 锚定 + `O_NOFOLLOW` + 符号链接拒绝 + `overwrite:true` 显式）                       | L0         | IPC root pinning 的外部互证 + 两个未用加固项                                                             | mcp/README.md Project file tools |
| 12  | **队列策略单源**（配额/租约/保留期全部只在一个 policy 文件）+ 轮询器只出站不监听                                       | L0         | 未来任何托管/队列特征的形态红线                                                                          | README Hosted demo               |
| 13  | **AGPL 合规示范**：网络服务版页脚挂 `VITE_SOURCE_CODE_URL` 源码链接                                                    | L0         | 若本仓未来 AGPL 组件（理论上）需网络部署时的合规参照；更实际的是**避免引入 AGPL 依赖**的负面教材         | LICENSING.md                     |
| 14  | **预构建 dist 发布**（运行时依赖全在 devDependencies，npx 零依赖树安装）                                               | L1         | 分发决策互证：本仓 vendored/预构建路线的同路人                                                           | README Contributing              |

---

## §7 风险与不跟进

### 7.1 风险

- **AGPL-3.0**：见 §3.7 结论性判定——机制借鉴干净，任何代码层接触都不行。
- **单维护者 + 2 个月项目龄**（2026-07 创建）+ 51.9MB 仓库：演化快、_bus factor_
  为 1；测试形态是 ad-hoc verify 脚本而非框架，质量信号靠数量与 live 协议单文档
  支撑。717★ 对 previs 垂类已算高，但绝对值低。
- **运动生成硬 GPU 依赖**（Kimodo SSH 机/checkpoint 下载；ARDY 为 NVIDIA 第三方
  项目）：开箱不可用，与本地优先相悖。
- **不是建模工具**：无雕刻/网格编辑/UV——若误当 Blender 替代会错判其价值。
- **previs 是窄垂直**：其价值兑现依赖「AI 视频模型吃结构化镜头 prompt」这条
  假设的成熟度（当前视频模型对镜头语言 prompt 的服从度仍在快速变化）。

### 7.2 明确不跟进

- **任何形式的 vendor / 代码拷贝 / 修补分发**（AGPL 红线，先例：MemBrain）。
- **内置 Kimodo/ARDY 集成或 GPU 依赖引入**（本地优先相悖）。
- **在 cad-3d spec 里加 ④⑤⑥ 能力**：该 spec 的边界（制造下游）清晰且成立；
  编排/运动/镜头属于另一条（内容向）线的事，若立项应另立 spec。
- **预演工作室类 UI 的产品化讨论**：本仓无此产品方向，本轮仅留机制参照。

---

## §8 结论

**CozyClay 把本仓的 3D 地图从两段扩成六段**：第一轮调研与 cad-3d spec 覆盖的
「造形/验形/用形」（①②③）服务制造下游；CozyClay 独家示范的「布景/动起来/
拍出来」（④⑤⑥）服务内容下游——**两条出海口共享前三段供给，互不替代**。

对本仓的即期价值排序：①**六段地图本身**（任何 3D 讨论的定位框架）；
②**机制层五条**（单一实现共享 / 穷举验证 / 几何真值→生成 prompt / 双模式工具
目录 / 批量=单 undo 事务）——全部 L0/L1，与本仓既有哲学（确定性审计、root
pinning、预构建分发）互证且带增量；③**领域知识**（镜头语言词汇表：景别-视角-
水平角-焦距-距离的机器可算表示）——留档供内容→视频线重启时取用。

**红线一条**：AGPL-3.0，机制借鉴之外零接触。

**处置**：纯留档，登记于 research 索引（消费状态 ⬜），不排期、不建 spec。
与 [gameStudio 第二轮专题报告](./gameStudio/2026-09-24-game-dev-round2-special-report.md)
（同日）互为姊妹篇：那边回答「游戏生成三种形态」，这边回答「3D 能力域六段」。

## §9 参考链接

- CozyClay：[GitHub](https://github.com/NomaDamas/CozyClay) · [cozyclay.org](https://cozyclay.org/) · [mcp/README.md](https://github.com/NomaDamas/CozyClay/blob/main/mcp/README.md) · [LIVE-PROTOCOL.md](https://github.com/NomaDamas/CozyClay/blob/main/mcp/LIVE-PROTOCOL.md)
- 本仓既有线：[2026-08-13-text-to-cad-img2threejs.md](./2026-08-13-text-to-cad-img2threejs.md) · [cad-3d-generation spec](../../specs/next-version/cad-3d-generation/design.md) · [GameFactory-3A 预研](./gameStudio/gamefactory3a/2026-09-15-gamefactory3a-prestudy.md) · [Sprite Studio 预研](./gameStudio/sprite-maker/2026-09-15-sprite-maker-prestudy.md)（确定性渲染哲学）· [tmem-hyperframes 预研](./2026-09-14-tmem-hyperframes-prestudy.md)（内容→视频线）
