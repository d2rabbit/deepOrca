# Qwen-MM-Plugins 预研：为 DeepSeek 补充视觉能力

> **日期**：2026-08-11
> **状态**：预研完成，待决策
> **来源**：[QwenLM/Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins)（Apache-2.0）
> **动机**：DeepSeek（DeepOrca 的主力模型）是纯文本 LLM，无视觉能力。用户粘贴/拖拽图片后，DeepSeek 无法理解图片内容。Qwen-MM-Plugins 可作为"视觉代理"补齐这一短板。

---

## 一、Qwen-MM-Plugins 是什么

阿里通义千问团队开源的**多模态理解插件套件**，为任意 Agent Harness 提供"原生多模态能力"。核心特点：

- **Agent 无关**：标准 MCP over stdio，已适配 Claude Code / Codex / Qoder / Gemini CLI / Qwen Code 等
- **能力模块化**：每个"能力"（capability）= 一个 Skill（Markdown 指令）+ 一个可选 MCP Server（Python）
- **两种视觉路径**：
  - `core` 能力：本地工具（无 AI 模型），渲染/读取文件，返回**图片块**给多模态宿主
  - `api` 能力：云端 Qwen-VL，接收图片+文本提示，返回**文本描述**给任意宿主
- **OpenAI 兼容**：`api` 的后端是 DashScope OpenAI 兼容接口，`base_url`/`api_key`/`model` 可逐次覆盖到任意 OpenAI 兼容视觉端点

---

## 二、架构分析

### 2.1 能力清单

| 能力 | 定位 | 需要API Key | 对 DeepSeek 有用？ |
|---|---|---|---|
| **core** | 本地文件渲染/读取（PDF/Office/3D/视频帧/HTML截图） | ❌ | ⚠️ 间接有用（预处理），但返回图片块，DeepSeek 无法消费 |
| **api** | 云端 Qwen-VL 视觉理解（图片/视频/OCR/目标检测） | ✅ DashScope | ✅ **核心价值** — 返回文本，DeepSeek 可直接消费 |
| search | 联网搜索（Serper/Exa/Tavily） | ✅ | 与视觉无关 |
| video-memory | 长视频记忆（图嵌入+时间线） | ✅ | 未来可选 |
| video-edit | 视频编辑 | ❌ | 与视觉无关 |
| blender | Blender 3D 渲染 | ❌ | 与视觉无关 |
| freecad | FreeCAD CAD 建模 | ❌ | 与视觉无关 |
| edu-agent | 教育辅导 | ❌ | 与视觉无关 |

### 2.2 MCP Server 技术栈

- **语言**：Python（`uvx` 启动，官方 `mcp` SDK ≥ 1.0）
- **传输**：stdio JSON-RPC
- **依赖**：`openai`、`dashscope`、`requests`（api 能力）；`pillow`、`pypdfium2`、`resvg`（core 能力）
- **配置**：`~/.qwen-mm-plugins/config`（KEY=VALUE，chmod 600）
- **版本管理**：不可变 release tag，每次更新拉取精确版本

### 2.3 `core.read_image` 为什么对 DeepSeek 无用

`read_image` 返回两个 MCP 内容块：
```python
return [
    {"type": "text", "text": "Image: photo.jpg | 4000×3000 → 1024×1024"},  # 仅尺寸信息
    {"type": "image", "data": "<base64>", "mimeType": "image/png"}          # 图片像素
]
```

DeepSeek 是纯文本模型，**丢弃 image 块**，只收到一条无用的尺寸字符串。`core` 能力的本质是"为已有多模态模型预处理输入"——它不提供视觉理解，只是文件格式转换器。

### 2.4 `api.vision_chat` — DeepSeek 的视觉之眼

**这是关键原语。** 接收图片+文本提示，调用 Qwen-VL，返回纯文本：

```python
# 输入
VisionChatArgs(
    images=["/path/to/screenshot.png"],   # 本地路径 / URL / data:URL
    text="这个 UI 截图的布局有什么问题？",   # 任意视觉理解问题
    model="qwen3.7-plus",                  # 默认 Qwen-VL，可覆盖
)

# 输出（DeepSeek 直接消费的文本）
[{"type": "text", "text": "{\"content\": \"这个截图展示了一个登录页面...\"}"}]
```

**关键参数**：

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `model` | `str?` | `qwen3.7-plus` | 可换任意 OpenAI 兼容视觉模型 |
| `text` | `str` | `"Describe the visual content."` | 视觉理解提示词 |
| `images` | `list[str]?` | `None` | 本地路径 / URL / data:URL |
| `videos` | `list[str]?` | `None` | 本地视频（自动抽帧） |
| `base_url` | `str?` | DashScope | 可覆盖到自建 vLLM 等 |
| `api_key` | `str?` | DashScope | 可覆盖 |
| `max_tokens` | `int` | `2048` | |
| `video_max_frames` | `int` | `128` | 视频最大抽帧数 |

其他 api 工具（均返回文本）：`ocr`（文字识别）、`grounding`（目标检测+坐标）、`omni_asr`（音视频转录）等。

---

## 三、DeepOrca 现状：DeepSeek 的视觉盲区

### 3.1 当前图片处理流程

```
用户粘贴/拖拽图片 → 渲染器 Composer → IPC → core SessionManager
    → OpenAIMessageConverter 转为 OpenAI image_url content block
    → 发送给 DeepSeek API
    → DeepSeek 静默忽略（不支持视觉）
```

**结果**：用户粘贴图片后，DeepSeek 完全看不到，回复中不会提及图片内容。功能"存在"但无效。

### 3.2 为什么不能直接用 `core` 能力

如 §2.3 所述，`core.read_image` 返回图片块——这需要宿主模型本身是多模态的。DeepSeek 不是。

### 3.3 为什么 `api.vision_chat` 是正确路径

`vision_chat` 返回的是**文本**——DeepSeek 的母语。流程变为：

```
用户粘贴图片 → DeepSeek 发现上下文有图片但自己看不了
    → 调用 vision_chat MCP 工具（images=[路径], text="描述这张图"）
    → Qwen-VL 返回文本描述
    → DeepSeek 基于文本描述继续推理
```

DeepSeek 全程不接触像素，只接触 Qwen-VL 生成的文字。

---

## 四、集成方案

### 方案对比

| 维度 | 方案 A：MCP Server 接入 | 方案 B：直接 API 调用 | 方案 C：透明视觉代理 |
|---|---|---|---|
| **实现** | 通过 uvx 启动 Qwen-MM-Plugins MCP Server，注册到 DeepOrca MCP 配置 | Node 端直接调 DashScope OpenAI 兼容接口 | 在消息管线中自动拦截图片，调 Qwen-VL，将文本注入上下文 |
| **依赖** | Python + uvx + uv（已有） | 无额外依赖（Node fetch） | 无额外依赖 |
| **工具** | 获得 vision_chat / ocr / grounding / omni 等全部工具 | 仅视觉理解（等价 vision_chat） | 对 Agent 透明 |
| **Agent 感知** | Agent 需主动调用 vision_chat 工具 | Agent 需主动调用 | Agent 无需感知，图片自动转为文本 |
| **灵活性** | 高（全部 api 工具） | 中（仅视觉理解） | 低（自动拦截，不可控） |
| **维护** | 跟随上游更新 | 自维护 | 自维护 |
| **用户体验** | Agent 有时不会主动调用工具 | 同左 | 最佳（无感） |

### 推荐：方案 A + 方案 C 组合

**方案 C（透明代理）作为默认体验，方案 A（MCP Server）作为高级能力。**

#### 层次 1：透明视觉代理（方案 C 核心）

在 core 的消息管线中增加一个"视觉桥接"步骤：

```
用户消息含图片 → vision-bridge.ts 检测到 image content block
    → 自动调用 Qwen-VL（DashScope OpenAI 兼容接口）
    → 将图片替换为 [图片描述：Qwen-VL 返回的文本]
    → DeepSeek 收到的是纯文本消息（含图片描述）
```

**实现要点**：
- 配置项：`visionBridge.enabled`（默认 true）、`visionBridge.model`（默认 `qwen3.7-plus`）、`visionBridge.baseUrl`、`visionBridge.apiKey`
- 复用现有 `createOpenAIClient` 逻辑，调用 DashScope 兼容接口
- 仅在主模型不支持视觉时启用（检测 `MODEL` 是否为已知视觉模型，或用户显式配置）
- 可在 `session.ts` 的 `handleUserPrompt` 中、消息发送前拦截

**优势**：用户无感——粘贴图片后 DeepSeek 自然地"看到了"图片内容，无需手动调用工具。

#### 层次 2：显式 MCP 工具（方案 A 补充）

注册 Qwen-MM-Plugins 的 `api` 能力为 MCP Server，供 Agent 在需要更精细视觉操作时主动调用：

- `vision_chat`：多图对比、特定视觉问题
- `ocr`：高精度文字识别
- `grounding`：目标检测+坐标（如"找到截图中的按钮位置"）
- `omni_asr`：视频/音频转录

**配置**（`settings.json` 的 `mcpServers`）：
```json
{
  "qwen-mm-plugins-api": {
    "command": "uvx",
    "args": [
      "--from",
      "qwen-mm-plugins[api] @ git+https://github.com/QwenLM/Qwen-MM-Plugins.git@qwen-mm-plugins-api-v1.0.1",
      "qwen-mm-plugins-api"
    ],
    "env": {
      "DASHSCOPE_API_KEY": "sk-..."
    }
  }
}
```

**前提**：用户机器有 `uvx`（DeepOrca 已有 uv vendor，可复用）。

#### 层次 3：DeepOrca 专用 Skill

编写 `vision-bridge` Skill，教会 Agent 在透明代理不够时主动调用 MCP 工具：

```markdown
---
name: vision-bridge
description: >
  视觉桥接技能 — 当需要理解图片/截图/UI设计稿内容时，使用 vision_chat
  工具调用 Qwen-VL 获取文本描述。DeepSeek 本身不支持视觉，所有视觉理解
  均通过 Qwen-VL 代理完成。
---
```

---

## 五、与 DeepOrca 现有架构的契合

| DeepOrca 组件 | 关系 |
|---|---|
| **McpManager** | 方案 A 直接复用——注册 `qwen-mm-plugins-api` 为 MCP Server |
| **uv vendor** | DeepOrca 已 vendor 了 uv（Serena/SkillSpector/CRG 共用），`uvx` 可用 |
| **OpenAIMessageConverter** | 方案 C 的拦截点——在转换消息时检测 image block |
| **createOpenAIClient** | 方案 C 复用——创建指向 DashScope 的 OpenAI 兼容 client |
| **settings.json** | 新增 `visionBridge` 配置段 |
| **Skills 系统** | 方案 3 的 Skill 驱动 Agent 主动调用 |
| **A2UI / DeepDesign** | 设计预览截图可通过视觉代理让 DeepSeek "看到"并给出反馈 |

### 对 PM-Design 的增益

PM-Design V2 的"需求具现化"流程中，AI 生成原型/设计稿后，用户截图反馈"这里改一下"——透明视觉代理让 DeepSeek 能真正"看到"截图内容，实现视觉反馈闭环：

```
用户：「截图」这里布局不太好，卡片间距太挤了
    → 透明代理：Qwen-VL 描述截图内容
    → DeepSeek 基于描述理解"卡片间距太挤"
    → 调用 update_surface / update_design 调整间距
```

---

## 六、配置设计（草案）

```json
{
  "visionBridge": {
    "enabled": true,
    "model": "qwen3.7-plus",
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "apiKey": "sk-...",
    "maxTokens": 2048,
    "autoDescribe": true,
    "describePrompt": "详细描述这张图片的内容，包括布局、颜色、文字、UI元素等。"
  }
}
```

- `enabled`：是否启用透明视觉代理
- `autoDescribe`：是否自动为每张图片生成描述（false = 仅在 Agent 主动调用时描述）
- `describePrompt`：自动描述时使用的提示词

---

## 七、实施路线（建议）

| 阶段 | 内容 | 工作量 |
|---|---|---|
| **P0** | 方案 C 透明代理：`vision-bridge.ts` + 配置 + 消息管线拦截 | 中 |
| **P1** | 方案 A MCP Server：文档化配置，用户可手动启用 `api` 能力 | 小 |
| **P2** | 方案 3 Skill：`vision-bridge` Skill 驱动 Agent 主动调用 | 小 |
| **P3** | 扩展：OCR / grounding / 视频转录集成（按需） | 中 |

P0 可独立交付，立竿见影地解决"DeepSeek 看不到图片"的核心痛点。

---

## 八、风险与注意事项

| 风险 | 缓解 |
|---|---|
| DashScope API 费用 | vision_chat 默认 `max_tokens=2048`；可在配置中限制；用户需自备 DashScope API Key |
| 延迟（双次 API 调用） | 透明代理会增加 ~1-3s 延迟（先 Qwen-VL 再 DeepSeek）；可显示"正在分析图片…"提示 |
| 图片隐私 | 图片发送到 DashScope 云端；对隐私敏感场景可配置自建 Qwen-VL（vLLM，`baseUrl` 覆盖） |
| 非 Qwen 视觉模型 | `baseUrl`/`model` 可覆盖到任意 OpenAI 兼容视觉模型（GPT-4o / Claude / 自建） |
| uvx 依赖（方案 A） | DeepOrca 已 vendor uv，方案 C 无需 uvx |
| core 能力误用 | 文档明确：`core.read_image` 对 DeepSeek 无用，不要安装 `core` 能力 |

---

## 九、备选方案：非 Qwen-MM-Plugins 路径

如果不想引入 Qwen-MM-Plugins，方案 C（透明代理）可完全独立实现——仅需一个 Node 函数：

```ts
// vision-bridge.ts（概念伪码）
async function describeImage(imagePath: string, prompt: string, config: VisionBridgeConfig): Promise<string> {
  const client = createOpenAIClient({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });
  const base64 = readImageAsBase64(imagePath);
  const response = await client.chat.completions.create({
    model: config.model,
    max_tokens: config.maxTokens,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
        { type: "text", text: prompt },
      ],
    }],
  });
  return response.choices[0]?.message?.content ?? "";
}
```

这完全不依赖 Qwen-MM-Plugins，仅依赖 DashScope（或任意 OpenAI 兼容视觉模型）的 API。Qwen-MM-Plugins 的价值在于其 `api` MCP 工具集（ocr/grounding/omni 等），如果只需要"图片→文本"的基础能力，方案 C 独立实现更轻量。

---

## 十、结论

| 问题 | 答案 |
|---|---|
| Qwen-MM-Plugins 能给 DeepSeek 视觉能力吗？ | ✅ 能，但仅通过 `api` 能力的 `vision_chat` 工具（返回文本） |
| `core` 能力有用吗？ | ❌ 对 DeepSeek 无用——它返回图片块，需要多模态宿主 |
| 最佳集成方式？ | 方案 C（透明代理）做默认体验 + 方案 A（MCP Server）做高级工具 |
| 需要引入 Qwen-MM-Plugins 仓库吗？ | 方案 C 不需要（直接调 DashScope API）；方案 A 需要（uvx 拉取） |
| 核心价值 | DeepSeek 从"视觉盲区"变为"通过 Qwen-VL 代理看世界" |
| 对 PM-Design 的增益 | 用户可截图反馈原型/设计稿，DeepSeek 通过代理"看到"并响应 |
