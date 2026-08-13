# 3D 与制造：CAD 生成 + 图片转 3D — 详细设计

> 日期：2026-08-13 · 状态：规划中
>
> 灵感来源：[earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad)（MIT，⭐13.4k）、[img2threejs/img2threejs](https://github.com/img2threejs/img2threejs)（Apache-2.0，⭐11.5k）
> 前序调研：`docs/research/2026-08-13-text-to-cad-img2threejs.md`（含 kkFileView 评估附录）
> 关联路线：feature-roadmap §十八 3D 与制造（新增）、§六 设计生成、§十六 能力编排（defineAction）、§十二 插件中心（SkillSpector 闸门）、PM-Design V2 管线路由（`specs/pm-design-v2/design.md`）
>
> 设计约束：
>
> 1. **不引入 kkFileView 的任何组件**（2026-08-13 用户拍板）——CAD/3D 预览走纯前端：Three.js loaders（STL/GLTF/3MF）+ occt-import-js（STEP/IGES/BREP，WASM OpenCascade）+ ezdxf/dxf-parser（DXF）。不碰 Aspose-CAD / CADViewer 等商业组件。
> 2. **技能包 vendored 接入，不重写框架**——两个上游项目都是 agent-agnostic 的 SKILL.md + 确定性脚本，宿主换成 DeepOrca 自己的 agent loop（DeepSeek），与 183 个内置技能同构。
> 3. **严守 core 无 UI 铁律**——技能/脚本/校验落 core 与 vendored 工具层；一切渲染落 desktop renderer（iframe 隔离，同 DesignPreview 模式）。
> 4. **fail-open**——venv 装不上、校验失败、评审回路超时，都退化为"交付源码 + 文件 + 手动指引"，绝不让管线搞挂会话。
> 5. **先纯文本路径**——DeepSeek 视觉看图能力未验证前，CAD 生成走文本 brief 主路径；图片输入（参考图建模、渲染评审）作为增强层后置验证。
> 6. **零新外部服务依赖**——step-parts 等联网能力复用现有 network 权限声明；不引入第三方 SaaS。
> 7. **许可证合规**——MIT / Apache-2.0 vendored 留 NOTICE；第三方技能一律先过 SkillSpector 扫描再挂载（§十二 闸门）。

---

## 一、问题与定位

DeepOrca 的三大核心能力（原型设计 / UI 设计稿 / 智能编码）交付的都是**数字产物**。硬件 PM、创客、机器人开发者的场景在"看起来对"之后就断链了——没有通往"做得出"的路径：

- 外观原型（A2UI/DeepDesign）有了，结构件谁画？
- 产品照片想变成网页里的可交互 3D 展示，要写多少 Three.js？
- 生成的模型能不能直接 STEP 导出给工厂 / 切片打印？

两个上游项目恰好提供了经过社区验证的"**LLM 判断 + 脚本强制**"工作流，不必自研：

| 上游 | 提供 | 关键洞察 |
| --- | --- | --- |
| text-to-cad | 文本/图片 → build123d 参数化源码 → **STEP 主输出**（真实 B-rep，非玩具 mesh）；10 步确定性管线 + 几何校验 + 修复回路 | "生成源码而非裸 STEP"——agent 可迭代源码；脚本做校验，模型做判断 |
| img2threejs | 单张参考图 → **纯代码程序化 Three.js 模型**（TS 工厂，动画就绪层级）；四阶段 forge 管线 + Divine Eye 零 token 门禁 + 有界纠正回路 | 输出可 diff 的代码而非二进制 mesh；确定性门禁优先于 VLM |

**定位**：PM-Design V2 需求具现化的**第四条管线**（原型 / 设计稿 / 代码 → + 3D/制造），同时沉淀一套 3D/CAD 预览基础设施（§六 设计生成的下游延伸）。

---

## 二、能力范围

### 纳入

| # | 能力 | 上游来源 | 阶段 |
| --- | --- | --- | --- |
| C1 | **参数化 CAD 生成**：文本/图片 brief → build123d 源码 → STEP（主）+ STL/3MF/GLB（导出），含几何校验与修复回路 | text-to-cad `cad` 技能 | P1 |
| C2 | **3D/CAD 预览查看器**：自研前端组件（Three.js + occt-import-js + dxf-parser），iframe 隔离 | 自研（借鉴 kkFileView 前端路径与 text-to-cad CAD Explorer 思路） | P0 先行（STL/GLB/3MF）→ P1（STEP/DXF） |
| C3 | **图片 → 程序化 Three.js 模型**：forge 四阶段管线 + Divine Eye 门禁 + 有界纠正回路，**裁剪 CS2 垂直内容** | img2threejs | P0 |
| C4 | **DXF 2D 工程图**：型材/垫片/切割排版，预览走 ezdxf→SVG 或 dxf-parser | text-to-cad `dxf` 技能 | P1 |
| C5 | **标准件选型**：螺丝/轴承/电机/连接器检索与装配插入 | text-to-cad `step-parts` 技能 | P2（联网） |
| C6 | **机器人描述**：URDF/SRDF/SDF + MoveIt 配置 + 仿真世界 | text-to-cad `urdf`/`srdf` 技能 | P2 |

### 不纳入（及理由）

| 项 | 理由 |
| --- | --- |
| gcode / bambu / sendcutsend | 依赖外部 slicer CLI、打印机硬件、第三方制造服务——非核心承诺，待用户需求验证 |
| sdf（隐式建模） | 上游标注实验性 |
| img2threejs CS2 武器模块 | 游戏垂直内容与 Studio 定位无关，裁剪 |
| kkFileView 及其 Aspose-CAD / CADViewer 路径 | 商业组件授权风险 + Java 服务端架构错配（2026-08-13 决策，见调研附录） |

---

## 三、总体架构

```
用户（会话 / PM-Design 需求入口）
   │
   ▼
PM-Design V2 管线路由（新增第 4 条管线）或 SkillRouter 直接召回
   │
   ▼
vendored 技能包（SKILL.md + Python 脚本 + references）
   │  agent 按工作流写源码：build123d（CAD）/ TypeScript 工厂（3D）
   ▼
bash 工具执行（uv venv，write-in-cwd 权限审批）
   │
   ▼
产出物：cad/<name>/ 目录（brief.md + gen_step.py + model.step + exports/ + reviews/）
   │
   ▼
CADPreview 查看器（desktop renderer，iframe 隔离）
   │  固定评审视角 + orbit 两视角截图
   ▼
评审回路：确定性门禁（脚本）→ 用户确认卡（VLM 未验证前的降级）→ 有界纠正
   │
   ▼
交付：STEP（工厂）+ GLB（Web 预览）+ 源码（可迭代）——file-history 自动跟踪
```

---

## 四、详细设计

### 4.1 技能 vendoring 与裁剪

- **vendor 脚本**：新增 `scripts/vendor-text-to-cad.js` / `scripts/vendor-img2threejs.js`，沿用 vendor-* 家族约定（`vendor-src/` 持久 clone + `.vendored-head` 标记，HEAD 变化才重拷贝，`--force` 强制）。
- **落位**：`packages/core/templates/plugins/manufacture/skills/`（新增 manufacture 插件包分组，§十二 插件中心登记）：
  - `cad/`、`dxf/`、`step-parts/`、`urdf/`、`srdf/`（P2 两项可先进 vendor 不登记）
  - `img2threejs/`（裁剪：`docs/cs2*/`、`skills/cs2-*.md`、`forge/**/cs2_*` 全删；`detect_cs2` 调用点摘除）
- **裁剪公共规则**：删 `.claude-plugin/`、`.codex-plugin/`、`agents/openai.yaml` 等宿主绑定清单；保留 SKILL.md + scripts + references/grimoire。
- **路由可发现性**：SKILL.md frontmatter 的 `description` 保留英文原文，追加中文触发短语（零件/外壳/3D 打印/STEP/三维模型/参考图建模……），保证 SkillRouter 中文召回率。
- **NOTICE**：两个上游的 LICENSE 拷贝进对应目录，`vendor-notice.js` 汇总。

### 4.2 Python 运行时（uv）

- 复用 vendored uv（Serena/CRG 已验证路径），不引入系统 Python 依赖。
- **text-to-cad `cad`**：独立 venv（`vendor/text-to-cad/.venv`），依赖 build123d + ezdxf + numpy + trimesh + vtk，**首次使用懒装**，安装进度回流会话；装不上 → 退化为"交付 build123d 源码 + 手动安装指引"。
- **img2threejs**：纯 Python 3.10+ stdlib，uv 提供的 Python 直接跑，零安装。
- 预检脚本：`cad.doctor`（检查 uv / venv / 磁盘 / 平台 wheel 可用性），结果供 agent 决策走哪条降级路径。

### 4.3 CADPreview 查看器（desktop renderer，自研）

- **形态**：`packages/desktop/src/renderer/` 新组件，iframe srcDoc 隔离（与 DesignPreview 同模式），不走 `import electron`（browser bundle 铁律）。
- **加载器**：
  - STL / GLB / 3MF → three.js examples loaders（随 three 已 vendored 依赖走）；
  - STEP / IGES / BREP → **occt-import-js**（WASM 版 OpenCascade），vendor 进 `packages/desktop/vendor/occt/`，按需动态加载（不阻塞首屏）；
  - DXF → dxf-parser → three LineSegments（2D 视图，缩放/平移）。
- **评审接口**：暴露固定评审相机位 + orbit 两视角的 `captureReviewShots()`（canvas.toDataURL），供评审回路消费——renderer 内直读 canvas，**不需要** browser-skill 截图。
- **打开方式**：① agent 生成产出后自动弹出；② 工作区文件树中 `.step/.stl/.glb/.3mf/.dxf` 点击预览；③ 会话内 `/preview <path>`。

### 4.4 评审回路（确定性优先，VLM 降级为用户确认）

沿用上游"Scripts enforce, the model judges"原则，按 DeepSeek 能力现状调整：

1. **确定性门禁（脚本侧，零 token）**：img2threejs 的 Divine Eye（IoU/比例/pHash/SSIM 硬门禁）与 text-to-cad 的几何校验（inspect 脚本）原样保留——这部分与宿主模型无关，直接受益。
2. **VLM 层降级**：`vlm_gate` 与 render-review 的"AI 视觉评分"在 DeepSeek 视觉验证前，降级为 **AskUserQuestion 用户确认卡**（渲染图 + 门禁报告 + continue/refine/stop 选项）。DeepSeek 视觉验证通过后，配置项切回 VLM 自动评审。
3. **有界纠正回路**：沿用 `correction_loop.py` 的终止保证（success/repeated-defect/oscillation/plateau/hard-ceiling），防 token 空转；上限次数进 settings。

### 4.5 Actions 多表面（defineAction，§十六）

| Action | 输入 | 表面 |
| --- | --- | --- |
| `model.generateCad` | `{brief, image?, outDir?}` → STEP 路径 + 校验报告 | LLM 工具 + 会话命令 |
| `model.fromImage` | `{image, target?, complexity?}` → TS 工厂路径 | LLM 工具 + 会话命令 |
| `model.preview` | `{path}` → 打开 CADPreview | LLM 工具 + 文件树入口 |

schema 落 `shared/`，run 逻辑落 core，IPC/预览触发落 desktop——严守分层。桌面独立"制造面板"不在 MVP 范围（P2 再评估，预览窗口 + 会话已闭环）。

### 4.6 权限与安全

- 技能包挂载前过 **SkillSpector** 扫描（§十二 既有闸门）。
- bash 副作用声明：CAD/3D 生成 = `write-in-cwd`；step-parts 选型 = `network`；禁止 `delete-in-cwd`。
- agent 生成的 build123d/forge 脚本经 bash 执行，走现有权限审批链，不开后门。

### 4.7 文件与交付约定

```
cad/<name>/
├── brief.md            # 需求简报（design-brief-template）
├── gen_step.py         # build123d 参数化源码（可迭代的一等公民）
├── model.step          # 主交付（工厂/装配）
├── exports/            # model.stl / model.glb（Web 预览）/ model.3mf
└── reviews/            # 评审对比图 + append_review 记录
```

- 源码与 STEP 同存（"生成源码而非裸 STEP"），迭代 = 改源码重跑，file-history 自动跟踪全部产出。
- GLB 始终导出一份——它是 CADPreview 与 A2UI 原型内嵌 3D 的通用格式。

---

## 五、与 PM-Design V2 的管线路由整合

PM-Design V2 的统一路由（`specs/pm-design-v2/design.md`）新增第 4 条管线：

| 管线 | 触发信号 | 产出 |
| --- | --- | --- |
| 原型设计 | 看板/表单/流程/页面 | A2UI Surface |
| UI 设计稿 | 落地页/风格/设计稿 | .dd / HTML |
| 智能编码 | 实现/重构/修复 | 代码变更 |
| **3D 与制造（新）** | 零件/外壳/支架/3D 打印/STEP/装配/参考图建模 | STEP + GLB + 源码 / Three.js 工厂 |

组合交付示例："智能音箱立项" → 外观稿（DeepDesign 管线）+ 外壳结构（CAD 管线）+ 官网落地页内嵌 3D 模型（img2threejs 管线），三管线同一工作台持久化。

---

## 六、阶段规划与验收标准

### P0 — 图片转 3D MVP（验证 DeepSeek 适配度）

- vendor img2threejs（裁剪 CS2）+ SkillSpector 扫描 + 中文触发词
- CADPreview 组件先行版（STL/GLB/3MF，three loaders）
- **验收**：一张参考图 → forge 管线 → TS 工厂 → iframe 渲染成功；Divine Eye 硬门禁生效；评审降级为用户确认卡；纠正回路 ≤5 轮内终止。零 pip 依赖。

### P1 — CAD 核心闭环

- vendor text-to-cad `cad` + `dxf`；uv venv 懒装；`cad.doctor` 预检
- occt-import-js 接入 CADPreview（STEP/IGES）+ dxf-parser（DXF）
- defineAction 三件套 + 权限声明；PM-Design 第 4 管线路由规则
- **验收**："M4 电机安装座"纯文本 brief → build123d 源码 → 几何校验通过 → STEP 预览 → GLB 导出；校验失败修复回路 ≤3 轮收敛；venv 装不上时降级路径可用。

### P2 — 扩展能力

- step-parts（联网选型）、urdf/srdf（机器人描述）
- 制造面板 / PM-Design 工作台整合 / DeepSeek 视觉评审验证与切换
- **验收**：标准件检索→插入装配源码；URDF 校验脚本通过；视觉评审 A/B 对比用户确认卡的成本与质量。

---

## 七、风险与缓解

| 风险 | 程度 | 缓解 |
| --- | --- | --- |
| DeepSeek 对 build123d API 熟练度不足 | 中 | references/build123d-modeling.md 随技能注入；先纯文本路径验证；必要时沉淀 few-shot 样例进技能 |
| build123d/vtk wheel 平台差异、依赖体积 | 中 | uv 懒装 + `cad.doctor` 预检 + 降级交付源码；不阻塞会话 |
| DeepSeek 视觉能力未验证 | 中 | VLM 层默认降级用户确认卡；验证后配置切换 |
| occt-import-js WASM 体积 | 低 | vendor + 动态 import，不进首屏 |
| 评审回路 token 消耗 | 低 | 确定性门禁优先 + 有界纠正回路（上游内置） |
| 第三方技能安全 | 低 | SkillSpector 扫描后挂载；权限声明最小化 |
| 上游许可证 | 低 | MIT / Apache-2.0，NOTICE 留存；不碰 Aspose/CADViewer |

## 八、度量

- brief → STEP 一次通过率 / 修复回路平均轮次
- 图片 → 3D 的 Divine Eye 门禁通过率 / 用户确认平均轮次
- CADPreview 首渲耗时（STEP 10MB 基准）
- 单次生成 token 成本（DeepSeek cache-first 命中前后对比）
