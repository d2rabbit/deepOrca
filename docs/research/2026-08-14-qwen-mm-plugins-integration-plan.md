# Qwen-MM-Plugins Core 集成规划（修订版）

> **日期**：2026-08-14（修订）
> **状态**：规划文档，待实施
> **范围**：仅集成 core capability（7 个本地工具），不含 api/omni/search 等

---

## 一、集成范围

### 只集成 core（7 个本地工具，零 LLM 依赖）

| 工具 | 功能 | 核心依赖 |
|---|---|---|
| `media_info` | 文件元数据（时长/分辨率/fps/编码/VFR 检测） | ffprobe |
| `read_image` | 动态分辨率图片读取（缩放到 token 预算） | Pillow |
| `read_video` | 视频抽帧（按帧数/时间间隔） | ffmpeg |
| `save_view` | 按时间戳保存视频帧为图片 | ffmpeg |
| `crop` | 图片区域裁剪 | Pillow |
| `draw_bbox` | 在图片上画检测框+标签 | Pillow |
| `visualize` | 万能格式渲染器（见下表） | 按格式不同 |

### `visualize` 格式支持与依赖策略

| 格式 | 扩展名 | 渲染方式 | 依赖 | 策略 |
|---|---|---|---|---|
| **PDF** | .pdf | pypdfium2 → 图片 | pypdfium2 | ✅ 打包 |
| **SVG** | .svg | resvg → PNG | resvg-py | ✅ 打包 |
| **Office** | .docx .pptx .vsdx | LibreOffice → PDF → 渲染 | LibreOffice | ⚠️ 用户安装 |
| **数据** | .csv .xlsx | 表格文本 + matplotlib 图表 | pandas, openpyxl, tabulate, matplotlib | ✅ 打包 |
| **代码** | .js .ts .py .go .rs .md | 语法高亮文本 | 无（纯文本输出） | ✅ 内置 |
| **纯文本** | .txt .log | fenced code block | 无 | ✅ 内置 |
| ~~网页~~ | ~~.html .htm~~ | ~~Chromium 截图~~ | ~~Playwright~~ | ❌ **屏蔽** |
| **图表** | .drawio | XML → SVG → PNG | lxml | ✅ 打包 |
| **字幕** | .srt .vtt | 带时间轴文本 | 无 | ✅ 内置 |
| **3D 模型** | .obj .stl .glb .gltf .fbx .ply .step | pyrender 渲染 | trimesh, pyrender, cascadio | ✅ 打包 |
| **GIS** | .geojson .kml .shp | matplotlib 地图 | geopandas, matplotlib | ✅ 打包 |
| **Notebook** | .ipynb | 文本 cell + 嵌入图片 | nbformat | ✅ 打包 |
| **LaTeX** | .tex | pdflatex → PDF → 渲染 | pdflatex | ⚠️ 用户安装 |

---

## 二、依赖打包策略

### 打包进 vendor（DeepOrca 随包发布，零联网）

| 组件 | 类型 | 体积估算 | vendor 方式 |
|---|---|---|---|
| **ffmpeg + ffprobe** | 原生二进制 | ~80MB | vendor/ffmpeg/<target>/ — 通过 vendor 脚本下载 LGPL 静态构建 |
| **Pillow** | Python 包 | ~5MB | 随 qwen-mm-plugins[core] wheel 安装（uv 自动） |
| **pypdfium2** | Python 包 | ~10MB | 同上 |
| **resvg-py** | Python 包 | ~3MB | 同上 |
| **lxml** | Python 包 | ~5MB | 同上 |
| **pandas + numpy** | Python 包 | ~40MB | 同上 |
| **matplotlib** | Python 包 | ~10MB | 同上 |
| **openpyxl + tabulate** | Python 包 | ~2MB | 同上 |
| **nbformat** | Python 包 | ~1MB | 同上 |
| **geopandas** | Python 包 | ~15MB | 同上 |
| **trimesh + pyrender + cascadio** | Python 包 | ~20MB | 同上 |
| **qwen-mm-plugins[core]** | Python 包 | ~1MB | vendor 脚本下载 wheel |

**总计估算**：~190MB（ffmpeg 80MB + Python 包 ~110MB）

### 用户自行安装（可选依赖，visualize 降级处理）

| 组件 | 安装方式 | 影响的格式 | 降级行为 |
|---|---|---|---|
| **LibreOffice** | 官方安装包 | .docx .pptx .vsdx | visualize 跳过 Office 格式，返回"请安装 LibreOffice" |
| **pdflatex** | TeX Live / MiKTeX | .tex | visualize 返回 LaTeX 源码文本 |

### 明确屏蔽（不安装、不支持）

| 组件 | 原因 |
|---|---|
| **Playwright/Chromium** | DeepOrca 本身基于 Electron（内置 Chromium），不需要额外的 Playwright。网页截图将由 DeepOrca 自己的方案实现。Qwen-MM-Plugins core 的 Playwright 路径在集成时屏蔽。 |

---

## 三、技术架构

### 方案 C：渐进增强

```
视觉模型未配置:
  → 不激活任何 vision 工具

视觉模型配置 + Qwen-MM-Plugins core 未安装:
  → 现有 vision MCP (vision_chat + ocr，2 个工具)

视觉模型配置 + Qwen-MM-Plugins core 安装:
  → 完整 core 工具集 (7 个本地工具) + 现有 vision MCP (2 个 LLM 工具)
  → core 工具负责"打开和呈现"文件
  → vision MCP 负责"理解和描述"文件内容
```

### 集成方式：controller-seam + uvx

```
core/mcp/qwen-mm-core-seam.ts          ← Interface + configure/get
desktop/tools/qwen-mm-core-cli.ts      ← Adapter (uvx 启动 + 版本 pin + wheel 离线)
scripts/vendor-qwen-mm-core.js         ← 下载 wheel + ffmpeg 二进制
desktop/index.ts                       ← boot 注入
core/templates/plugins/vision/         ← Skill 内容
```

### ffmpeg 集成：child_process + vendor 二进制

**不用任何 npm 库**（`@marcbachmann/ffprobe` 的 N-API 原生绑定引入 Electron rebuild 复杂度不值得；`ffmpeg-static` 是 GPL 二进制）。

```
core/common/ffmpeg.ts:
  resolveFfmpegBinary()    ← vendor/ffmpeg/<target>/ 优先, PATH fallback
  resolveFfprobeBinary()   ← 同上

desktop/vendor/ffmpeg/<target>/:
  ffmpeg                   ← LGPL-only 静态构建 (来源: BtbN/FFmpeg-Builds LGPL 变体)
  ffprobe                  ← 同上

desktop/tools/ffmpeg-cli.ts:
  getMediaInfo(file)       → spawn ffprobe -print_format json → JSON.parse
  extractFrame(file, ts)   → spawn ffmpeg -ss <ts> -frames:v 1
  extractFrames(file, fps) → spawn ffmpeg -vf fps=<fps> -frames:v <max>
```

LGPL 安全：child_process 调用独立进程 = "aggregate"（聚合使用）。项目全开源，LGPL 合规无风险。

### LibreOffice 集成：child_process + 用户安装

```
desktop/tools/libreoffice-cli.ts:
  resolveSofficeBinary()   ← 平台默认路径:
    macOS: /Applications/LibreOffice.app/Contents/MacOS/soffice
    Linux: /usr/bin/soffice, /usr/bin/libreoffice, /snap/bin/libreoffice
    Windows: C:\Program Files\LibreOffice\program\soffice.exe
  convertToPdf(input)      → spawn soffice --headless --convert-to pdf
```

**不打包 LibreOffice**——用户可选安装。设置面板显示"LibreOffice: 已安装/未安装"。visualize 在 LibreOffice 未安装时跳过 Office 格式，其他格式正常。

### Chromium/Playwright 屏蔽

Qwen-MM-Plugins core 的 `visualize` 工具对 `.html/.htm` 格式调用 Playwright 截图。集成时：

1. **不安装 Playwright**（pyproject.toml 中移除 playwright 依赖）
2. **修改 SKILL.md**：移除网页截图相关指引
3. **visualize 工具行为**：对 .html 格式返回"DeepOrca 基于 Electron，网页预览请使用内置浏览器"，或直接读取 HTML 源码文本

未来 DeepOrca 自己的网页截图方案：Electron 的 `webContents.capturePage()` 或 BrowserWindow + `loadURL()`。

---

## 四、vendor 脚本设计

### `scripts/vendor-qwen-mm-core.js`

```
1. 从 PyPI 查询 qwen-mm-plugins 最新 core 版本
2. 下载 wheel 到 vendor/qwen-mm-plugins/
3. 写 marker

可选: 自定义 pyproject.toml 覆盖（移除 playwright 依赖）
```

### `scripts/vendor-ffmpeg.js`

```
1. 从 BtbN/FFmpeg-Builds 下载 LGPL 静态构建
   - 地址: https://github.com/BtbN/FFmpeg-Builds/releases
   - 文件: ffmpeg-master-latest-linux64-lgpl.tar.xz (或对应平台)
2. 解压 ffmpeg + ffprobe 到 vendor/ffmpeg/<target>/
3. 写 marker
```

---

## 五、vision 插件组更新

### `plugins/vision/skill.plugin.md`

```yaml
---
name: vision
description: "视觉理解插件 — 本地多模态文件渲染 + 视觉 LLM 代理"
category: vision
icon: vision
mcp:
  - vision               # 内置轻量视觉 MCP (vision_chat + ocr)
  - qwen-mm-plugins-core # 本地文件渲染 MCP (可选，uv 安装)
---
```

### `plugins/vision/skills/qwen-mm-core/SKILL.md`

适配版 SKILL.md，移除 Playwright/网页截图，增加 DeepOrca 上下文。

---

## 六、离线保证

| 组件 | 来源 | 离线? |
|---|---|---|
| ffmpeg/ffprobe | vendor/ffmpeg/（vendor 脚本下载 LGPL 构建） | ✅ |
| qwen-mm-plugins[core] wheel | vendor/qwen-mm-plugins/（vendor 脚本下载） | ✅ |
| Pillow/pypdfium2/resvg 等 | uv 首次安装（从 wheel + PyPI 缓存） | ✅（wheel 本地后零联网） |
| LibreOffice | 用户安装 | ❌ 可选 |
| pdflatex | 用户安装 | ❌ 可选 |
| ~~Playwright/Chromium~~ | ~~不安装~~ | ❌ 屏蔽 |

---

## 七、执行优先级

| Phase | 内容 | 工作量 |
|---|---|---|
| **P0** | vendor-ffmpeg.js（LGPL 二进制下载）+ resolveFfmpegBinary() | 小 |
| **P1** | vendor-qwen-mm-core.js（wheel 下载）+ controller-seam 集成 | 中 |
| **P2** | SKILL.md 适配（移除 Playwright + DeepOrca 上下文） | 小 |
| **P3** | LibreOffice 检测（resolveSofficeBinary + 设置面板） | 小 |

---

## 不做

- **不集成 api/omni/search/video-memory/video-edit/blender/freecac/edu-agent** — 独立域
- **不打包 LibreOffice** — 用户可选安装
- **不安装 Playwright/Chromium** — 屏蔽，DeepOrca 有自己的 Chromium
- **不重新实现 core 工具** — 通过 uvx 安装使用
- **不内置视觉模型** — 概念层规划
