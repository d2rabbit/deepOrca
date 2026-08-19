# 调研：text-to-cad + img2threejs —— 3D/CAD 能力接入评估

> 日期：2026-08-13 · 分支：fix/stabilize-data-loss-and-test-suite
> 对象：[earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad)（[texttocad.dev](https://www.texttocad.dev/)）、[img2threejs/img2threejs](https://github.com/img2threejs/img2threejs)
> 结论先行：**两个项目都是 agent-agnostic 的 SKILL.md 技能包（提示词工作流 + 确定性脚本），不是单体 ML 服务**——这与 DeepOrca 的 Skills 生态天然同构，可低成本接入，为 Studio 补上「3D / CAD / 制造」能力域。

---

## 一、项目底细

### 1. earthtojake/text-to-cad ⭐13.4k · MIT · 活跃（develop 分支，780+ commits）

**本质**：一套 CAD/CAE/CAM  agent 技能库（"A library of agent skills for CAD, CAE and CAM"）。无单体应用、无 API，每个技能 = `SKILL.md` 工作流定义 + Python 脚本 + references 知识文档，由宿主 agent（Claude Code / Codex / 任意兼容 Skills 的 harness）执行。

| 技能 | 能力 | 技术依赖 |
| --- | --- | --- |
| **cad** | 自然语言/图片 → 工程级 3D 模型，**STEP 为主输出**，兼出 STL/3MF/GLB；10 步确定性管线 + 几何校验 + 修复回路 | **build123d**（B-rep 内核，非玩具 mesh）+ ezdxf + numpy + trimesh + vtk |
| **render** | CAD/机器人文件本地浏览器预览（CAD Explorer）+ 无头快照 | Vite + React + Three.js + Playwright；MoveIt2 可选 |
| **step-parts** | 标准件选型（螺丝/轴承/电机/连接器） | 网络 API |
| **dxf** | 2D 工程图（型材/垫片/切割排版） | ezdxf |
| **urdf / srdf / sdf** | 机器人描述、MoveIt 规划配置、带物理与传感器的仿真世界 | 文本生成 + 校验脚本 |
| **sendcutsend** | 钣金加工上传前预检报告 | 复用 $cad 检查能力 |
| **gcode / bambu** | mesh → 切片（真实 slicer CLI）→ Bambu 本地打印任务 | 外部 slicer/打印机（可选） |
| **sdf** | 实验性：GLSL 符号距离场浏览器内建模 | 浏览器原生 |

安装方式：`npx skills install earthtojake/text-to-cad`，或 Claude Code / Codex 插件市场。**模型无关**——技能本身不含模型，能力来自宿主 agent。

### 2. img2threejs/img2threejs ⭐11.5k · Apache-2.0 · 活跃（v1.5， roadmap 至 v2.0）

**本质**：单个精英技能——**把一张参考图重建为"纯代码"程序化 Three.js 模型**。输出是 TypeScript 工厂函数（返回 `THREE.Group`，带 pivots/sockets/colliders 的动画就绪层级）+ JSON sculpt spec，**不是 mesh、不是摄影测量、不是神经重建**。

工作方式（"Scripts enforce, the model judges"）：

- **宿主 agent 的视觉**负责看图、判断、写代码；**确定性 Python 脚本**负责门禁与校验
- 四阶段管线 `forge/`：stage1 intake（图像分析/细节清单/相机姿态/去光照）→ stage2 spec（质量契约 + sculpt spec）→ stage3 build（pass 锁定的代码生成：blockout→结构→形态→材质→光照→交互→优化）→ stage4 review（参考图 vs 渲染对比）
- **Divine Eye**：零 token 确定性渲染评估集成（IoU/比例/pHash/SSIM 硬门禁），VLM 仅作最后兜底层；多角度防"平面假体积"；**有界纠正回路**（保证终止，防 token 空转）
- **纯 Python 3.10+ stdlib，零 pip 依赖**（PNG 都用 struct/zlib 手写）
- 诚实边界：单图无法看到背面，输出是风格化/近似重建，角色为风格化胸像而非换脸

---

## 二、对 DeepOrca 的能力增量

### 现状契合点（为什么接入成本低）

1. **同构的 Skills 体系**：DeepOrca 已有 183 个 SKILL.md 技能 + 语义路由（SkillRouter top-K 召回）。两个项目都是标准 SKILL.md 包，挂载即被发现、被路由。
2. **多模态图片输入已有**：会话支持图片粘贴/拖拽 → img2threejs 的参考图、text-to-cad 的图片建模请求直接有输入通道。
3. **预览渲染设施已有**：DesignPreview（iframe srcDoc）+ 原型独立窗口 + browser-skill（真实 Chrome 操控）——正好覆盖两个项目的"渲染截图 → 视觉评审"回路需求（img2threejs stage4、text-to-cad render skill 都依赖浏览器截图）。
4. **Python 依赖有 vendored uv 先例**：Serena（Python 3.13 + uv）、CRG（vendored uv）已验证路径。img2threejs 零依赖可直接 vendor；text-to-cad 的 build123d/vtk 较重，走 uv 虚拟环境按需安装。
5. **Actions 多表面**：`defineAction` 可把 `cad.generate` / `model.from-image` 一次定义为 LLM 工具 + 桌面面板 + 组合工作流。
6. **SkillSpector 安装闸门**：第三方技能引入前过安全扫描，正是插件中心已规划的能力。
7. **许可证兼容**：MIT + Apache-2.0，vendored 无障碍（NOTICE 留存）。

### 能让 Studio 做什么（用户场景）

| 场景 | 链路 | 价值 |
| --- | --- | --- |
| **硬件产品从需求到打样** | 一句话需求 → PM-Design 管线 → 外观原型（A2UI/DeepDesign）→ **结构 CAD（STEP）→ 标准件选型 → DXF/切片 → 3D 打印或 SendCutSend 钣金** | Studio 从"数字原型"延伸到"物理产品"，PM/硬件创业者闭环 |
| **工程零件生成** | "帮我画一个 M4 螺丝的电机安装座" → build123d 参数化建模 → 几何校验 → Three.js 预览 → 导出 STEP/STL | 真实 B-rep 工程模型，非玩具 mesh；参数化源码可迭代 |
| **图片 → 网页 3D 展示模型** | 产品照片 → 程序化 Three.js 模型 → 嵌入生成的落地页/原型（现有 preview 管线直接渲染） | 电商/营销页 3D 展示、产品演示，代码可 diff 可维护 |
| **游戏/互动原型道具** | 参考图 → 动画就绪（pivots/sockets）的 3D 道具 → 放进 A2UI 可交互原型 | 原型设计能力从 2D 升到 3D |
| **机器人描述与仿真** | 自然语言 → URDF/SRDF/SDF + MoveIt 配置 + 物理仿真世界 | 面向机器人开发者的独特卖点 |

### 与路线图的关系

建议新增 **§十八「3D 与制造」功能域**（或拆为"3D 生成"+"CAD/制造"两域）：

- 与 §六设计生成（DeepDesign/A2UI）互补：设计稿管"看起来"，CAD 管"做得出"
- 是 PM-Design V2 需求具现化的**第四条管线**（原型/设计稿/代码之外 +硬件）
- img2threejs 的 Divine Eye 评审门禁思想与 CRG/ocr 的"脚本强制 + 模型判断"哲学一致，可互相借鉴

---

## 三、风险与边界（诚实评估）

| 风险 | 程度 | 缓解 |
| --- | --- | --- |
| text-to-cad Python 依赖重（build123d/vtk 二进制 wheel，平台差异） | 中 | vendored uv 按需装；cad 核心先行，gcode/bambu 等外设技能可选 |
| 技能包质量取决于宿主模型 —— 视觉看图、build123d API 熟练度 | 中 | DeepSeek 专项调优（HarnessBank 结论 "gains are model-specific" 支持此策略）；先从纯文本→CAD 路径验证（不依赖视觉） |
| img2threejs 评审回路 token 消耗 | 低 | 自带 Divine Eye 零 token 硬门禁 + 有界纠正回路 |
| 单图重建的天然上限（背面不可见、风格化） | 固有 | 技能本身已内置诚实声明规范；UI 上传递"近似/风格化"预期 |
| CS2 武器等垂直内容与 Studio 定位无关 | 低 | 只取通用管线，裁剪 cs2 专用模块 |
| G-code/Bambu/SendCutSend 依赖外部硬件与服务 | 低 | 作为可选技能，不作核心承诺 |

## 四、建议接入节奏

- **P0（验证）**：img2threejs 通用管线 vendored 为内置技能（零依赖、Apache-2.0）→ 打通"图片粘贴 → 3D 代码 → DesignPreview 渲染 → 截图评审"回路，验证 DeepSeek 适配度
- **P1（核心）**：text-to-cad 的 `cad` + `render` 两技能经 uv 环境接入 → "文本 → STEP → 浏览器预览"最小闭环；`defineAction` 包装为 `cad.generate` Action
- **P2（扩展）**：step-parts 选型、dxf 图纸、urdf/sdf 机器人描述；gcode/bambu/sendcutsend 按用户需求决定是否引入
- **全程**：SkillSpector 扫描后再挂载；NOTICE 留存许可证；裁剪 CS2 垂直内容

## 参考

- text-to-cad: <https://github.com/earthtojake/text-to-cad> · <https://www.texttocad.dev/>
- img2threejs: <https://github.com/img2threejs/img2threejs>
- DeepOrca 侧：`specs/pm-design-v2/design.md`（管线路由）、`docs/builtin-inventory.md`、`specs/skill-routing/design.md`、`scripts/vendor-*.js`（uv vendoring 先例）

---

## 附录：kkFileView 作为 CAD 预览组件的评估（2026-08-13）

> 对象：[kekingcn/kkFileView](https://github.com/kekingcn/kkFileView) v5.0.0（Java 21 + Spring Boot 3.5.6）
> 问题：能否用于 text-to-cad 产出物（STEP/STL/3MF/GLB/DXF）的预览？能否商业化使用？

### CAD 预览能力：能，且分两条技术路径

| 路径 | 覆盖格式 | 实现 | 商业风险 |
| --- | --- | --- | --- |
| **3D 模型预览** | obj, 3ds, stl, ply, gltf, glb, off, 3dm, fbx, dae, wrl, 3mf, ifc, brep, **step**, iges, fcstd, bim | **Three.js 前端查看器**（纯开源） | ✅ 无 |
| **2D CAD 工程图** | dwg, dxf, dwf, dwt, plt, cf2, dwfx, dng | 服务端转 PDF/SVG/TIF，双后端：模块 1 = **Aspose-CAD 25.10**（内置、默认）；模块 3 = 外部 CADViewer 二进制 | ⚠️ 见下 |

text-to-cad 的主输出（**STEP / STL / 3MF / GLB**）全部落在 Three.js 3D 路径上——这条路径干净可用。**DXF**（2D 图纸）落在 Aspose 路径上。已知缺陷：dwg 在 IDE 内可预览但打包后失效（issue #725，原生库缺失）；STEP 可查看但无法从查看器导出（#669）。

### 商业化使用：kkFileView 本体 ✅，但 CAD 2D 路径有商业组件陷阱 ⚠️

1. **kkFileView 本体 = Apache-2.0**（LICENSE 为原文 Apache-2.0；README/官网无商用限制条款，仅有赞助入口）→ 商用合法，保留 LICENSE/NOTICE 即可。
2. **⚠️ 默认 CAD 引擎 Aspose-CAD 是闭源商业库**：无付费授权即运行在评估模式（输出带水印/功能受限）。kkFileView 源码里甚至有 `RemoveSvgAdSimple.removeSvgAdFromFile()`（`CadToPdfService.java:176`，默认注释掉）用于剥离 Aspose 评估水印——**启用它规避评估标记涉嫌违反 Aspose EULA，不可用于商业产品**。商用 DWG/DXF 预览须购买 Aspose.CAD（或 CADViewer）授权。
3. Three.js（MIT）3D 路径无此问题。

### 对 DeepOrca 的建议：不整体接入，借鉴其前端 3D 方案

> **决策（2026-08-13，用户拍板）：不引入 kkFileView 的任何组件。** CAD/3D 预览采用纯前端方案：Three.js loaders（STL/GLTF/3MF）+ occt-import-js（STEP/BREP）+ ezdxf/dxf-parser（DXF），与 text-to-cad 自带 render 技能（CAD Explorer）同思路。若未来做服务端部署再重新评估通用文档预览需求。

- **架构错配**：kkFileView 是 Java 21 服务端应用；DeepOrca 是 Electron 桌面端，工程原则是"零外部运行时依赖"。捆绑 JVM 服务代价过大。
- **正解**：text-to-cad 自带的 `render` 技能已是同思路实现（Vite + React + Three.js 的 CAD Explorer）。DeepOrca 侧在 DesignPreview/原型窗口里直接用 **Three.js loaders（STL/GLTF/3MF）+ occt-import-js（STEP/BREP 的 WASM OpenCascade）** 即可覆盖主输出格式，纯前端、零授权风险。
- **DXF**：用 ezdxf（已在 text-to-cad 依赖中）服务端转 SVG，或前端 dxf-parser + Three.js 渲染，绕开 Aspose。
- **何时再考虑 kkFileView**：若未来做服务端/远程接入（路线图 §十三）需要"任意文档在线预览"（Office/PDF/压缩包/医学影像等 200+ 格式），kkFileView 是成熟的自托管选项，但 DWG/DXF 商用预览需另购 Aspose/CADViewer 授权。
