---
name: vision
description: "视觉理解插件 — 本地多模态文件渲染 + 视觉 LLM 代理"
category: vision
icon: vision
mcp:
  - vision
  - qwen-mm-plugins-core
---

# 视觉理解插件

让纯文本 LLM（如 DeepSeek）获得"看"的能力。两层分工：本地工具负责"打开和呈现"，视觉 LLM 负责理解和描述。

## 包含能力

### MCP 服务器

- **vision** — 内置轻量视觉 MCP。通过配置的视觉模型代理执行图片理解：
  - `vision_chat` — 图片分析/描述，支持多图对比、本地路径/URL/base64
  - `vision_ocr` — 图片文字识别（OCR）
  - 仅在设置中配置视觉模型后激活

- **qwen-mm-plugins-core** — 本地多模态文件渲染 MCP（基于 Qwen-MM-Plugins core，Apache-2.0）。**零 LLM 依赖，纯本地处理**：
  - `media_info` — 视频/音频元数据（时长/分辨率/fps/编码/VFR 检测）
  - `read_image` — 动态分辨率图片读取
  - `read_video` — 视频抽帧
  - `save_view` — 按时间戳保存视频帧
  - `crop` — 图片裁剪
  - `draw_bbox` — 图片标注框
  - `visualize` — 万能格式渲染器（PDF/SVG/Office/数据/3D/GIS/Notebook/LaTeX）

### 依赖说明

**随 DeepOrca 打包（零安装）**：
- ffmpeg/ffprobe — 视频处理（已 vendor，LGPL 构建）
- Pillow/pypdfium2/resvg/pandas/matplotlib 等 — Python 渲染依赖（uv 自动安装）

**用户可选安装**：
- **LibreOffice** — 渲染 .docx/.pptx/.vsdx（未安装时 visualize 跳过 Office 格式）
- **pdflatex** — 渲染 .tex（未安装时返回 LaTeX 源码）

**不支持**：
- ~~网页截图~~ — DeepOrca 基于 Electron（内置 Chromium），网页操作由专属方案实现
- ~~Playwright~~ — 不安装，不依赖
