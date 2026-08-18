# 3D 与制造（CAD 生成 + 图片转 3D）— 任务指引（规划中）

> 日期：2026-08-18 文档整顿建立 · 状态：**规划中（P0 未开工，属冻结期外 `next/*` 范畴）**
> 阶段模型：**预研 → 设计 → 任务**，三层在当前树内可查（无外部仓库依赖）：
>
> | 层 | 文档 | 现状 |
> | --- | --- | --- |
> | 预研 | `docs/research/2026-08-13-text-to-cad-img2threejs.md`（两上游项目评估 + 否决项记录：kkFileView 不引入） | ✅ 完成 |
> | 设计 | [`design.md`](./design.md)（7 条设计约束 + 详细设计 §4.1–4.7 + 风险/度量） | ✅ 定稿 |
> | 任务 | **本文件**（2026-08-18 由 design.md §六 阶段规划抽离） | ⏳ 待开工 |

## 任务清单（自 design.md §六 抽离）

### P0 — 图片转 3D MVP（验证 DeepSeek 适配度）

- [ ] vendor img2threejs（裁剪 CS2）+ SkillSpector 扫描 + 中文触发词
- [ ] CADPreview 组件先行版（STL/GLB/3MF，three loaders）
- [ ] **验收**：一张参考图 → forge 管线 → TS 工厂 → iframe 渲染成功；Divine Eye 硬门禁生效；评审降级为用户确认卡；纠正回路 ≤5 轮内终止。零 pip 依赖。

### P1 — CAD 核心闭环

- [ ] vendor text-to-cad `cad` + `dxf`；uv venv 懒装；`cad.doctor` 预检
- [ ] occt-import-js 接入 CADPreview（STEP/IGES）+ dxf-parser（DXF）
- [ ] defineAction 三件套 + 权限声明；PM-Design 第 4 管线路由规则
- [ ] **验收**："M4 电机安装座"纯文本 brief → build123d 源码 → 几何校验通过 → STEP 预览 → GLB 导出；校验失败修复回路 ≤3 轮收敛；venv 装不上时降级路径可用。

### P2 — 扩展能力

- [ ] step-parts（联网选型）、urdf/srdf（机器人描述）
- [ ] 制造面板 / PM-Design 工作台整合 / DeepSeek 视觉评审验证与切换
- [ ] **验收**：标准件检索→插入装配源码；URDF 校验脚本通过；视觉评审 A/B 对比用户确认卡的成本与质量。

## 开工前置条件

- 预生产冻结解除或 `next/*` 立项；img2threejs 先行（P0 独立可验证 DeepSeek 适配度，design.md §六 已明序）。
- 约束继承：CAD/3D 预览纯前端自研（Three.js loaders + occt-import-js + dxf-parser）；**不引入 kkFileView**（用户拍板，预研文档已记录）。
