---
name: vision
description: "视觉理解插件 — 为纯文本 LLM（如 DeepSeek）补充图片理解能力"
category: vision
icon: vision
mcp:
  - vision
---

# 视觉理解插件

为不具备原生视觉能力的 LLM（如 DeepSeek）提供图片理解代理。

## 包含能力

### MCP 服务器

- **vision** — 内置 in-process MCP 服务器。通过配置的视觉模型（Qwen-VL / GPT-4o / 自建 vLLM 等）代理执行图片理解：
  - **vision_chat** — 分析/描述图片内容，支持多图对比、本地路径/URL/base64
  - **vision_ocr** — 图片文字识别（OCR），提取截图/文档中的文本

仅在设置中配置视觉模型后激活。视觉模型独立于主模型/副模型——专为视觉任务配置，不影响对话流。
