# Qwen-MM-Plugins 集成规划：本地能力 + 视觉 LLM 劫持

> **日期**：2026-08-14
> **状态**：规划文档
> **前置**：vision MCP 已内置（vision_chat + vision_ocr），支持任意 OpenAI 兼容视觉端点

---

## 一、集成定位

DeepOrca **不重新实现** Qwen-MM-Plugins 的工具。我们的角色：

1. **视觉模型提供者**：通过 `visionModel` 配置劫持 VL 工具的 API 端点（不走 DashScope）
2. **MCP 宿主**：像 Serena/CRG 一样，通过 uv 安装运行 Qwen-MM-Plugins 作为内置 MCP server
3. **本地依赖管理者**：ffmpeg 已 vendor，其他依赖（Pillow/pypdfium2）由 uv 自动安装

---

## 二、能力清单与实施分期

### Phase 0：已实现（现有 vision MCP）

| 工具 | 功能 | 端点 | 状态 |
|---|---|---|---|
| `vision_chat` | 图片/视频问答、描述 | 用户配置的视觉模型 | ✅ 已实现 |
| `vision_ocr` | 图片文字识别 | 用户配置的视觉模型 | ✅ 已实现 |

### Phase 1：本地能力集成（无需 LLM）

这些工具纯靠系统依赖（ffmpeg/Pillow），不需要任何 API key。通过 uvx 安装 Qwen-MM-Plugins core capability 即可获得。

| 工具 | 功能 | 系统依赖 | DeepOrca 价值 | 优先级 |
|---|---|---|---|---|
| `media_info` | 文件元数据（时长/分辨率/fps/编码） | ffprobe（已 vendor） | UI 回归视频分析前先看元数据 | P0 |
| `read_image` | 动态分辨率图片读取（缩放到 token 预算） | Pillow | 优化大图传输给视觉模型 | P0 |
| `read_video` | 视频抽帧（按帧数/间隔） | ffmpeg（已 vendor） | 录屏 → 抽帧 → 逐帧分析 | P0 |
| `save_view` | 按时间戳保存视频帧为图片 | ffmpeg | 保存关键帧供后续分析 | P1 |
| `crop` | 图片区域裁剪 | Pillow | 截图局部放大分析 | P1 |
| `draw_bbox` | 在图片上画边界框 | Pillow | 配合 grounding 输出可视化标注 | P1 |
| `visualize` | 万能格式渲染器 | 按格式不同（见下表） | **核心价值**——让 DeepSeek 看懂任何文件 | P2 |

#### `visualize` 子能力详细依赖

| 格式 | 渲染方式 | 额外依赖 | DeepOrca 场景 |
|---|---|---|---|
| PDF (.pdf) | pypdfium2 渲染为图片 | pypdfium2（uv 自动装） | 设计稿审查、文档理解 |
| SVG (.svg) | resvg 渲染为 PNG | resvg（uv 自动装） | UI 设计稿 |
| Office (.docx/.pptx) | LibreOffice 转 PDF → 渲染 | LibreOffice（需安装） | PR 文档审查 |
| HTML/网页 | Chromium 截图 | Playwright（需安装） | 网页设计审查 |
| 代码/文本 | 语法高亮 → 图片 | Pygments（uv 自动装） | 代码截图分享 |
| 数据 (.csv/.xlsx) | 表格可视化 | openpyxl（uv 自动装） | 数据分析 |
| 3D (.obj/.glb/.stl) | 渲染为图片 | Blender 或 pyrender | 3D 设计审查 |
| Notebook (.ipynb) | 渲染为 HTML | nbconvert（uv 自动装） | 数据科学 |
| LaTeX | 编译为 PDF → 渲染 | pdflatex（需安装） | 论文/公式 |
| 图表 (.drawio/Mermaid) | 渲染为图片 | 各自渲染器 | 架构图审查 |
| GIS/GeoJSON/KML | 地图可视化 | matplotlib（uv 自动装） | 地理数据 |

**关键结论**：大部分格式的依赖（pypdfium2/resvg/Pygments/openpyxl/matplotlib）由 uv 自动安装。只有 LibreOffice、Playwright/Chromium、Blender、pdflatex 需要用户额外安装。

### Phase 2：视觉 LLM 能力扩展（劫持端点）

这些工具需要视觉模型，通过我们的 `visionModel` 配置劫持，不走 DashScope。

| 工具 | 功能 | 模型要求 | 实现方式 | 优先级 |
|---|---|---|---|---|
| `grounding` | 目标检测 + 返回边界框坐标（normalized 0-1000） | 视觉模型（需支持 grounding 格式输出） | uvx + 劫持 base_url/api_key | P1 |
| `ocr`（增强版） | 高精度 OCR，保持原始排版 | 视觉模型 | 替代现有 vision_ocr | P1 |
| `vision_chat`（增强版） | 多图对比、视频帧序列分析、高分辨率模式 | 视觉模型 | 替代现有 vision_chat | P1 |

**grounding 输出格式**：
```json
{
  "bboxes": [
    { "bbox_pixel": [x1, y1, x2, y2], "bbox_normalized": [n1, n2, n3, n4], "label": "button" }
  ],
  "image_annotated": "<base64>" // 可选，带标注的图片
}
```

配合 `draw_bbox` 工具可以在原图上画出检测框——完整的"看图 → 定位 → 标注"链路。

### Phase 3：音视频理解（需 Omni 模型）

| 工具 | 功能 | 模型要求 | 优先级 |
|---|---|---|---|
| `omni_asr` | 语音转文字 | Qwen-Omni 或兼容端点 | P3 |
| `omni_asr_timestamped` | 带时间戳的语音转文字 | Qwen-Omni | P3 |
| `omni_multi_speaker_asr` | 多说话人分离 | Qwen-Omni | P3 |
| `omni_av_caption` | 视频内容时间戳描述 | Qwen-Omni | P3 |
| `omni_av_grounding` | 时序定位 | Qwen-Omni | P3 |
| `omni_av_counting` | 视频事件计数 | Qwen-Omni | P3 |
| `omni_music_caption` | 音乐分析 | Qwen-Omni | P3 |

**说明**：Omni 模型目前主要是 DashScope 的 `qwen3.5-omni-plus`。如果有自建端点也可以劫持。低优先级——DeepOrca 当前不涉及音视频场景。

### Phase 4：专用模型（非通用 LLM）

| 工具 | 功能 | 依赖 | 优先级 |
|---|---|---|---|
| `transcribe_audio` | 快速长音频转录 | Qwen3-ASR 服务（专用 API） | P4 |
| `segmentation` | 图像分割（生成 mask） | SAM3 本地服务器 | P4 |

---

## 三、集成架构

```
DeepOrca settings.json:
  visionModel: "qwen-vl-plus"
  visionEndpointId: "dashscope"
  → visionApiKey + visionBaseURL 从 endpoint 池解析

Boot 时:
  1. uvx 安装 Qwen-MM-Plugins (core + api capability)
  2. 写入 ~/.qwen-mm-plugins/config:
     DASHSCOPE_BASE_URL = {我们的视觉端点}     ← 劫持
     DASHSCOPE_API_KEY  = {我们的视觉 key}      ← 劫持
  3. 启动为 stdio MCP server (同 Serena/CRG 模式)
  4. session.ts connectInProcessServer 或 augmentMcpServersWithBuiltins

Agent 看到的工具:
  mcp__qwen-mm-plugins__media_info      ← 本地，无需 API
  mpc__qwen-mm-plugins__read_image      ← 本地
  mcp__qwen-mm-plugins__read_video      ← 本地
  mcp__qwen-mm-plugins__visualize       ← 本地
  mpc__qwen-mm-plugins__crop            ← 本地
  mcp__qwen-mm-plugins__draw_bbox       ← 本地
  mcp__qwen-mm-plugins__save_view       ← 本地
  mcp__qwen-mm-plugins__vision_chat     ← 走我们的视觉端点
  mpc__qwen-mm-plugins__ocr             ← 走我们的视觉端点
  mpc__qwen-mm-plugins__grounding       ← 走我们的视觉端点
```

### 与现有 vision MCP 的关系

```
方案 A（替换）: 删除现有 vision-mcp.ts → 全部由 Qwen-MM-Plugins 提供
方案 B（共存）: 保留现有 vision MCP（vision_chat/ocr 作为轻量级）
              + 额外注册 Qwen-MM-Plugins（完整工具集）
方案 C（推荐）: 现有 vision MCP 作为 fallback（无 Qwen-MM-Plugins 时用）
              + Qwen-MM-Plugins 可用时自动接管（更丰富的工具集）
```

**推荐方案 C**——渐进增强：
- 视觉模型未配置 → 两者都不激活
- 视觉模型配置但 Qwen-MM-Plugins 未安装 → 用现有 vision MCP（2 个工具）
- 视觉模型配置 + Qwen-MM-Plugins 安装 → 完整 10+ 工具

---

## 四、vendor 离线方案

同 Serena/CRG 的离线嵌入模式：

| 组件 | vendor 方式 | 离线? |
|---|---|---|
| Qwen-MM-Plugins | PyPI wheel 下载到 vendor/qwen-mm-plugins/ | ✅（Phase 1 实施 uv 离线后） |
| ffmpeg/ffprobe | 已 vendor | ✅ |
| Pillow/pypdfium2/resvg | uv 自动安装（首次联网） | ❌ 首次联网（uv 缓存后离线） |
| LibreOffice | 用户安装 | ❌ |
| Playwright/Chromium | 用户安装 | ❌ |
| Blender | 用户安装 | ❌ |

---

## 五、vision 插件组更新

更新 `plugins/vision/skill.plugin.md` 反映完整能力集：

```yaml
---
name: vision
description: "视觉理解插件 — 多模态文件理解 + 视觉 LLM 代理（基于 Qwen-MM-Plugins）"
category: vision
icon: vision
mcp:
  - vision               # 内置轻量视觉 MCP（fallback）
  - qwen-mm-plugins      # 完整多模态工具集（可选，uv 安装）
---
```

---

## 六、执行优先级

| Phase | 内容 | 工作量 | 收益 |
|---|---|---|---|
| **P0** | 现有 vision MCP 已就绪 | ✅ 完成 | 基础视觉理解 |
| **P1** | Qwen-MM-Plugins core+api 通过 uvx 集成 + 端点劫持 | 中 | 本地文件渲染 + 增强视觉 |
| **P2** | visualize 高级格式（Office/3D/HTML）支持 | 大 | 万能文件查看器 |
| **P3** | Omni 音视频理解（需 Omni 模型） | 大 | 音视频场景 |
| **P4** | SAM3 分割 + Qwen3-ASR | 大 | 专用场景 |

---

## 不做

- **不重新实现** Qwen-MM-Plugins 的任何工具——通过 uvx 安装使用
- **不绑定 DashScope**——通过 `visionModel` 配置劫持端点
- **不内置视觉模型**——概念层规划，不列入方案
- **不集成独立域**（blender/freecad/video-edit/edu-agent）——各自独立
