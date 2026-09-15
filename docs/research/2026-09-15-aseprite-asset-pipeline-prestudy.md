# Aseprite 预研：游戏素材自动化流水线第一步可行性

> 日期：2026-09-15 · 状态：调研完成（纯留档，无代码变更；总口径：调研仅供参考，正式实现一律以 `specs/` 为准）
> 来源：[aseprite/aseprite](https://github.com/aseprite/aseprite)（Igara Studio；源码可用 + 自定义 EULA，付费版 $19.99 起）
> 取证方式：官方文档（[CLI](https://www.aseprite.org/cli/) / [FAQ](https://www.aseprite.org/faq/)）+ 官方博客 + GitHub issues + CI/社区实践与第三方报道交叉核对（2026-09-15 时点）。本文为文档级调研，未做源码一手取证。
> 目的：回答「游戏层第一步——素材自动化流水线——能否由 Aseprite 完整补齐」。承接 09-03 游戏层全景预研（[VibeGame](./2026-09-03-vibegame-prestudy.md) 的 Python 美术管线是同一问题的另一条路线）。**用户定调：落地研究文档即可。**

---

## §1 结论摘要（TL;DR）

**判定：不能「完整」补齐，但能补齐其中最有价值的一段。** Aseprite 是像素素材「加工 → 导出」环节的**事实标准**，自动化能力是官方一等公民；但整条「素材自动化流水线」里，**素材生产、二进制分发合规、引擎导入胶水**三段不在它的能力或许可范围内。反过来，若把第一步明确定义为「`.aseprite` 源文件目录 → 引擎就绪的图集 / 动画元数据 / 批量变换」，则 **Aseprite CLI 可以 100% 补齐这一段**。

| 流水线段 | Aseprite 覆盖 | 判定 |
| --- | --- | --- |
| 素材生产（创作/生成） | ❌ 编辑器不是生成器；LLM 写 Lua 程序化绘制质量有限（有实验佐证，§4.1） | 真空白，需另立调研（图像生成 + 像素化后处理） |
| 加工/批处理（缩放/换色/trim/调色板/tileset） | ✅ CLI 全覆盖，无头可跑（§3） | **本报告主结论：完整补齐** |
| 导出/打包（图集 + JSON 元数据 + 动画序列拆分） | ✅ 业界事实标准（§3） | 同上 |
| 分发（随 DeepOrca 安装包 vendor） | ❌ EULA 明文禁止再分发编译二进制（§2.2/§4.2） | **红线**：不可进 `vendor/` 体系 |
| 引擎导入（Godot/Unity 消费导出物） | 🟡 导出 JSON 为自有格式；社区插件在，成「流水线」需自写编排胶水 | 纯工程量，无许可/技术风险 |

三条速记：

1. **CLI `-b` 无头批处理是官方一等公民，不是社区外挂**：图集 + JSON 元数据一条命令产出；按动画标签/图层/切片拆分导出；换色、缩放、trim、tileset（1.3+）；`--list-layers/tags/slices` 结构探查天然适合 agent「先探测再决策」；`--script` + `--script-param` 让 Lua 脚本可参数化复用。对编码 agent 的最小集成形态就是**一份 SKILL.md + bash 直调**，零新增内置工具。
2. **许可证是最大工程约束**：2016-08（v1.1.8）起从 GPLv2 改为自定义 EULA——源码仍可免费自编译、可商用，但**禁止再分发编译二进制**。结论：Aseprite **不能像 uv/serena 那样进 `packages/desktop/vendor/` 随安装器分发**；默认集成路径只能是「探测用户已购安装的副本，缺席时引导购买/自编译」。
3. **素材生产段是真空白**：Aseprite 回答「素材怎么加工」，不回答「素材从哪来」。生产段需另行调研「图像生成模型 + 像素化后处理」——而缩小、调色板量化、抖动恰好又落回 Aseprite CLI。它的终局定位更像流水线的**后处理端点**，不是生产引擎。

---

## §2 项目概况与许可证现状

### 2.1 项目与活跃度

- **定位**：像素画 + 动画精灵编辑器（animated sprite editor & pixel art tool），游戏行业像素素材的事实标准工具；Igara Studio 出品，付费版 $19.99 起（含 Steam key / 签名安装包 / 更新至 v1.9），同时源码公开、可免费自编译。
- **活跃度**：持续开发中，2025-12-10 仍在发 v1.3.17-beta1；1.3 线新增 tilemap/tileset 支持（`--export-tileset` 自 1.3-beta21）。
- **生态位**：`.aseprite`/`.ase` 格式有公开规范，三方解析库成体系（§4.2）；社区动画工作流（tag/layer/slice 组织）已是各引擎导入插件的通用交换层。

### 2.2 许可证（红线出处，FAQ 一手取证）

- **许可证变迁**：≤v1.1.7 为 GPLv2；**2016-08-26（v1.1.8）起改为自定义 Aseprite EULA**（[官方公告](https://dev.aseprite.org/2016/09/01/new-source-code-license/)）。部分 Linux 发行版（如 Guix）因此冻结在 1.1.7。
- **FAQ 原文口径**：「We have replaced the General Public License (GPLv2) with the new Aseprite EULA」；「you cannot redistribute Aseprite to third parties」；「From August 2016 you cannot redistribute compiled versions of Aseprite」（唯一例外：教育许可）。
- **允许的事**：自编译源码并商用（「You can still compile the source code, and use the program to create your assets for commercial games」）；用 Aseprite 创作的素材可任意商用；个人可多机拷贝，公司需每开发者一许可。
- **对本仓的含义**：与 uv（MIT 类）、Serena 等 vendor 家族**本质不同**——**不存在任何可捆绑分发的官方二进制**。任何「DeepOrca 内置 Aseprite」的产品化说法在 EULA 下不成立，只能做「用户侧自备 + 深度自动化」。

---

## §3 自动化能力盘点（集成底气所在）

### 3.1 CLI 批处理全景（`aseprite -b`，无 UI 跑完即退）

| 分组 | 关键 flag | 说明 |
| --- | --- | --- |
| 批处理/运行控制 | `-b/--batch`、`--shell`（Lua REPL）、`-p/--preview`（dry-run 只打印）、`--noinapp`（不连 Steam） | `-b` 官方明示 "specially useful … to automate sprite sheet exports"；无需显示器 / X server |
| 图集导出 | `--sheet`、`--data`（`--data=""` 可写 stdout）、`--format json-hash / json-array`、`--sheet-type horizontal/vertical/rows/columns/packed`、`--sheet-width/height/columns/rows`、`--border-padding/--shape-padding/--inner-padding`、`--merge-duplicates`、`--ignore-empty`、`--extrude` | 纹理 + 坐标元数据一条命令产出；`--data` JSON 即引擎导入侧的通用交换格式 |
| 动画/图层/切片导出 | `--save-as`（`frame001.png` 序列帧模式）、`--frame-range from,to`、`--tag/--frame-tag`、`--split-tags/--split-layers/--split-slices/--split-grid`、`--layer/--import-layer/--all-layers/--ignore-layer`、`--slice`、`--oneframe` | 按动画标签/图层/切片批量拆分，配合 `--filename-format` 占位符（`{layer}/{tag}/{frame}` 等）控制命名 |
| 变换/颜色 | `--scale`、`--palette`（换调色板）、`--color-mode rgb/grayscale/indexed`、`--dithering-algorithm none/ordered/old`、`--dithering-matrix bayer8x8…`、`--trim/--trim-sprite/--trim-by-grid/--crop` | 「像素化后处理」端点能力：缩放、调色板量化、抖动 |
| tilemap/tileset | `--export-tileset`（1.3-beta21+） | 从可见 tilemap 图层导出 tileset |
| 脚本/探查 | `--script <f>`、`--script-param name=value`（脚本内经 `app.params` 读取）、`--list-layers/--list-layer-hierarchy/--list-tags/--list-slices`、`--filename-format/--tagname-format` | 探查类 flag 让 agent 先拿到结构化的 sprite 结构再决策导出方案——对 LLM 循环极友好 |

### 3.2 Lua 脚本 API

- 编辑器内 File > Scripts 与 CLI `--script` 同一套 API（`app` / `Sprite` / `Image` / `Palette` / `Dialog` 等；`app.command.*` 覆盖编辑器命令、含图集导出）；`--shell` 提供 REPL。
- 能力面：程序化创建/修改精灵与像素、图层/帧/标签管理、调色板操作、批量导出、UI 对话框（无头模式下 UI 部分不可用）。
- 对 agent 的用法：**生成一次性 Lua 脚本做程序化绘制/批处理**（简单 tile、程序化贴图、批量换色、批量改标签等），复杂度可控；角色级美术创作不现实（§4.1）。

### 3.3 无头/CI 实践与已知的坑

- CI 先例成熟：GitHub Marketplace 的 setup-aseprite-cli-action（runner 上自编译安装）、docker-aseprite-headless 等容器镜像——侧面再次印证**自编译是社区默认的分发替代**（官方二进制不可再分发）。
- **坑**：headless 模式行为依赖参数顺序（[issue #2673](https://github.com/aseprite/aseprite/issues/2673)，如 `--frame-tag`/`--sheet` 与文件名的相对位置）——技能文档中必须写死正确调用模板；个别 CLI 能力与 GUI 不完全对齐（历史上 sheet 导出 × scale 组合有过 bug 报告）。
- 排障：`-v` 写 `aseprite.log`（Windows 在 `%AppData%\Aseprite\`）。

---

## §4 三个缺口

### 4.1 素材生产段：编辑器不是生成器

- Aseprite 不含任何生成式能力；「AI 自动生成像素素材」不在其射程内。
- LLM 写 Lua 程序化绘制可行但质量有限：ljvmiranda921 的实验（tool-calling LLM 逐工具画像素画，[“Draw me a swordsman”](https://ljvmiranda921.github.io/notebook/2025/07/20/draw-me-a-swordsman/)）结论冷静——简单形状/程序化纹理可以，角色级美术不行。
- 可行路线（另立调研）：图像生成模型出图 → **像素化后处理**（降采样 + 调色板量化 + 抖动/清理）→ 后处理恰好可用 Aseprite CLI（`--scale` / `--palette` / `--color-mode` / `--dithering-*`）兜底。即：生产段另有引擎，Aseprite 是流水线中段与后段的可靠中间件。

### 4.2 分发合规段：EULA 红线与四条路径

结论先行：**不可 vendor、不可随安装器捆绑任何 Aseprite 二进制**。可行路径对比：

| 路径 | 许可 | 代价/限制 | 判定 |
| --- | --- | --- | --- |
| 探测用户已装副本（Steam/官网购买版）+ 引导购买 | 干净（用户自己的许可） | 体验取决于用户是否购买（$19.99） | **默认推荐** |
| 引导用户自编译（CMake + Skia，免费） | 干净 | 构建门槛高，桌面用户不现实；CI/重度用户可选 | 辅助选项 |
| LibreSprite（[GPL-2.0 fork](https://libresprite.github.io/)，可自由分发） | 可捆绑 | 基线停留在 2016 年 v1.1.7：无 tilemap/tileset 等 1.3 特性，CLI 同代 | 备胎，能力打折 |
| 三方格式库只读解析（npm `@suchipi/ase-parser`、PyPI `aseprite-reader`、Go decoder 等） | 各库自查（多为 MIT） | **只读**；写 `.aseprite` 的成熟库稀缺；无加工/导出能力 | 仅「读档/校验」类轻场景 |

### 4.3 引擎导入段：可控的胶水工程

- CLI 导出的 JSON（json-hash/json-array）是 Aseprite 自有 schema；Godot（社区 Aseprite importer 插件）与 Unity（Asset Store 导入器）均有消费先例，但「流水线化」需自定目录约定 + 导出编排（哪些 tag 出图集、命名规范、增量重导出触发）。
- 这一段是纯本仓工作量（约定 + 技能文档/脚本），无许可与技术风险；设计时可对齐 game-studio 技能组的 Godot/Unity/Unreal 三目的地。

---

## §5 与本仓的映射

### 5.1 集成形态评估（若立项）

| 形态 | 评估 |
| --- | --- |
| **技能（SKILL.md）+ bash 直调 CLI**（探测已装副本 → `aseprite -b …`） | **推荐最小形态**：零新增内置工具；权限走既有 sideEffects 分析；agent 生成 Lua 脚本 + 参数化调用即可程序化批处理 |
| MCP server 封装（参考 [diivi/aseprite-mcp](https://github.com/diivi/aseprite-mcp)，Python，104 工具/17 类） | 第二阶段可选，价值主要是工具面划分参考；第一阶段 bash 直调已足够，且更贴近本仓「skills 优于 MCP」的近期判断（Remotion 弃 MCP 转 skills 同向印证） |
| vendor 捆绑分发 | ❌ **红线不可行**（EULA）；LibreSprite 替代基线过旧 |
| 三方只读解析库进 renderer/main | 仅「读档/预览/校验」轻场景考虑（npm `@suchipi/ase-parser` 零依赖） |

### 5.2 已装副本探测建议（若立项）

探测顺序：`PATH` 中的 `aseprite` → Windows：`C:\Program Files\Aseprite\Aseprite.exe`、Steam 库 `steamapps\common\Aseprite\` → macOS：`/Applications/Aseprite.app/Contents/MacOS/aseprite` → 均未命中时输出引导（购买 Steam/itch 或自编译，附 LibreSprite 免费替代说明）。本仓 bash 工具在 Windows 走 Git Bash，调用 `.exe` 无障碍；探测逻辑放技能文档层即可，不必进 core。

### 5.3 架构对应

- core 不受影响：调用发生在我方 bash 工具内（用户工作区进程），core 依旧 UI-free、零新依赖。
- 技能落点：`packages/core/templates/plugins/`（bundled skill）或用户侧 `~/.deeporca/skills/`——与其他外部工具技能（bento-slides 等）同族。
- 与 `scripts/vendor-*.js` 家族无关：**不新增 vendor 脚本**（红线）。

### 5.4 游戏层链位置

- 承接 09-03 [VibeGame 预研](./2026-09-03-vibegame-prestudy.md)：该预研中 VibeGame 的「Python 美术管线」是「素材自动化」的另一条路线（程序化生成向）；本文确立的是「编辑器加工向」——两条不互斥，生产段调研（§4.1）时应合并对账。
- 素材格式上，「`.aseprite` 源文件 + tag/layer 组织 + CLI 导出」可作为未来游戏层 spec 的「素材源格式」候选事实标准。

---

## §6 结论与建议

1. **本期处置：纯留档，零代码。** 登记于本索引，消费状态 ⬜；不排期、不建 spec、不写代码。
2. **第一步边界建议**：把「素材自动化流水线」第一步定义为**「`.aseprite` 源文件目录 → 引擎就绪图集 / 动画元数据 / 批量变换」**——此边界内 Aseprite CLI 100% 补齐且是业界标准做法，值得立项；立项以 `specs/` 为准，集成形态取 §5.1 第一行。
3. **两条红线带进任何后续 spec**：a) 不分发、不捆绑 Aseprite 二进制（EULA）；b) 不因 Aseprite 在 core 引入任何依赖（技能层 + bash 即可）。
4. **生产段另立调研**：图像生成 + 像素化后处理路线（后处理端点即 Aseprite CLI），与 VibeGame Python 美术管线合并对账后再定。

---

## §7 参考链接

- 官方：[CLI 文档](https://www.aseprite.org/cli/) · [GitHub docs 镜像 cli.md](https://github.com/aseprite/docs/blob/main/cli.md) · [FAQ（许可条款）](https://www.aseprite.org/faq/) · [2016 许可证变更公告](https://dev.aseprite.org/2016/09/01/new-source-code-license/) · [relicense 讨论 issue #1666](https://github.com/aseprite/aseprite/issues/1666)
- 无头/CI：[setup-aseprite-cli-action](https://github.com/marketplace/actions/setup-aseprite-cli-action) · [headless 参数顺序 issue #2673](https://github.com/aseprite/aseprite/issues/2673) · [Run Aseprite as part of a GitHub Action（社区）](https://community.aseprite.org/t/run-aseprite-as-part-of-a-github-action/9949)
- 替代品：[LibreSprite](https://libresprite.github.io/)（GPL-2.0，fork 自 v1.1.7）
- Agent 生态：[diivi/aseprite-mcp](https://github.com/diivi/aseprite-mcp) · [MCP Market 条目](https://mcpmarket.com/server/aseprite) · [LLM 画像素画实验 "Draw me a swordsman"](https://ljvmiranda921.github.io/notebook/2025/07/20/draw-me-a-swordsman/)
- 格式与三方库：[file format spec](https://www.aseprite.org/docs/files/) · [@suchipi/ase-parser（npm，零依赖只读）](https://www.npmjs.com/package/@suchipi/ase-parser) · [aseprite-reader（PyPI）](https://pypi.org/project/aseprite-reader/)
