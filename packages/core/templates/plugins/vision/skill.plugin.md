---
name: vision
description: "视觉理解插件 — 为纯文本 LLM 补充图片理解能力（可禁用）"
category: vision
icon: vision
mcp:
  - vision
---

# 视觉理解插件

为不具备原生视觉能力的 LLM（如 DeepSeek）提供图片理解代理。

> **此插件可被禁用。** 当使用原生支持视觉的多模态模型时，可以关闭此插件——视觉 MCP 不再需要代理。

## 包含能力

### MCP 服务器

- **vision** — 内置 in-process MCP 服务器。通过配置的视觉模型（任意 OpenAI 兼容视觉端点）代理执行图片理解：
  - `vision_chat` — 图片分析/描述，支持多图对比、本地路径/URL/base64
  - `vision_ocr` — 图片文字识别（OCR）

仅在设置中配置视觉模型后激活。视觉模型独立于主模型/副模型——专为视觉任务配置，不影响对话流。

### 不包含

- ~~万能渲染器~~ — 不需要。DeepOrca 内置 Monaco 编辑器和 `read` 工具已覆盖文件查看需求。
- ~~Qwen-MM-Plugins~~ — 不集成。渲染是给人看的，Agent 通过 `read` 工具读取文本/元数据即可。
- ~~ffmpeg/LibreOffice~~ — 不打包。编码 Studio 不需要文档渲染能力。
