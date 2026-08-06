# 文本向量嵌入方案（Embedding Proposal）

> 日期：2026-08-06 · 状态：方案（未实施）
> 关联：`specs/skill-routing/design.md` §3/§8（路由与共享基建）、`docs/research/2026-08-06-skillweaver-skill-routing-integration.md`
>
> 本方案只回答一个问题：**DeepOrca 用哪个文本向量模型、以什么运行时形态、怎么下载与兜底、给谁用**。
> 路由/工具门控的上层用法见 skill-routing 设计，本文不重复。

---

## 0. 结论速览

| 决策点   | 选择                                                                    | 理由                                                                                   |
| -------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 主模型   | **`ibm-granite/granite-embedding-97m-multilingual-r2`**（ONNX，384 维） | Apache 2.0；200+ 语言含中文；32K 上下文；<100M 档 MTEB 检索最高（60.3）；官方随附 ONNX |
| 回退模型 | `BAAI/bge-base-zh-v1.5`（768 维）→ `Bekko a8m`                          | 中文专精 → 极端轻量兜底                                                                |
| 运行时   | **transformers.js（`@huggingface/transformers`）+ onnxruntime-node**    | 纯 JS 调用、预构建原生二进制、无自导出                                                 |
| 模型来源 | 运行时下载到 userData；**hf-mirror.com 兜底**（主站被墙）               | 已实测：huggingface.co 不可达、hf-mirror 可达                                          |
| 加载策略 | 懒加载 + fail-open                                                      | 模型未就绪/加载失败 → 返回 null，上层回退全量                                          |
| 消费方   | 技能/工具路由（进程内）+ TDAI 向量召回（回环 shim 或注入口子）          | 一套基建两处用                                                                         |

---

## 1. 已验证的环境事实（2026-08-06 实测）

| 项                        | 结果                      | 含义                                                                |
| ------------------------- | ------------------------- | ------------------------------------------------------------------- |
| npm 注册表                | 可达                      | `@huggingface/transformers@4.2.0`、`onnxruntime-node@1.27.0` 可安装 |
| onnxruntime-node 原生加载 | darwin/arm64 **加载成功** | 目标桌面平台无需自编译                                              |
| huggingface.co            | **不可达（000）**         | 直连下载模型不可行                                                  |
| hf-mirror.com             | **可达（200）**           | 作为模型下载兜底源                                                  |

→ 下载层必须带 mirror 回退；运行时必须 fail-open。

---

## 2. 模型选型

### 2.1 候选对比（<100MB 档）

| 模型                                          | 大小   | 维度    | 语言        | 许可       | ONNX      | 结论          |
| --------------------------------------------- | ------ | ------- | ----------- | ---------- | --------- | ------------- |
| **Granite 97M R2**                            | <100MB | 384     | 200+ 含中文 | Apache 2.0 | 官方随附  | ✅ 主选       |
| bge-base-zh-v1.5                              | ~100MB | 768     | 中文专精    | MIT        | 社区有    | ✅ 回退       |
| Bekko a25m / a8m                              | <100MB | 384     | 100+        | MIT        | 未验证    | 兜底          |
| all-MiniLM-L6-v2 / BGE-en / paraphrase-MiniLM | —      | 384/768 | 英文        | —          | 有        | ❌ 中文掉点   |
| Potion / Ogma / FastTextEmbed                 | —      | —       | —           | —          | 无/不匹配 | ❌ 运行时不符 |

### 2.2 查询/文档前缀

- Granite：`"query: "` / `"passage: "` 任务前缀（模型卡约定）。
- BGE 回退路径：查询加 `"为这个句子生成表示以用于检索相关文章："`，文档不加。
- 前缀由模型配置驱动，可关。

---

## 3. 运行时架构

```
packages/core/src/routing/
├── types.ts             — EmbeddingService / VectorIndex 接口
├── embedding-service.ts — transformers.js 封装（懒加载、fail-open、mirror）
├── vector-index.ts      — 纯内存余弦索引 + 磁盘缓存（可独立单测）
└── model-download.ts    — 下载（HF 主站 → hf-mirror 回退）+ 版本标记
```

### 3.1 接口

```ts
export interface EmbeddingService {
  /** 模型未就绪/加载失败返回 null（调用方 fail-open）。 */
  embed(texts: string[]): Promise<Float32Array[] | null>;
  isReady(): boolean;
  readonly dimensions: number;
  warmup(): void; // 后台下载+加载，绝不阻塞
}

export interface VectorIndex {
  rebuild(entries: Array<{ id: string; text: string }>): Promise<boolean>;
  query(text: string, topK: number): Array<{ id: string; score: number }>;
  readonly size: number;
}
```

### 3.2 transformers.js 配置要点

- `env.allowLocalModels = false`（禁用本地模型探测，只用我们下载的目录）。
- `env.localModelPath = <userData>/models/<model>/`（指向下载目录）。
- `env.remoteHost` 默认 HF；下载失败时切 `https://hf-mirror.com` 重试。
- 量化档：优先 `onnx/model_quantized.onnx`（int8，≈100MB→更小）；内存敏感选 q4。

### 3.3 加载与失败语义

- 首次 `embed()` 触发加载；加载中返回 null。
- 加载/下载失败：记录原因，30 分钟内不重试，持续 fail-open。
- 文本预处理：截断 256 token；批量 encode（batch=16）。

---

## 4. 下载与缓存

- 目录：`getUserConfigRoot()/models/granite-embedding-97m-multilingual-r2/`（userData 级，不进 git/vendor 产物）。
- 文件：`model_quantized.onnx`（或 fp16）+ tokenizer 等 4–6 个文件。
- 回退链：HF resolve → hf-mirror resolve → 保持未就绪。
- 断点续传 + `.model-version` 标记；校验失败重下。
- 首用 UX：设置页「路由模型：未下载 / 下载中 x% / 就绪」；仅由启用开关或空闲预热触发。

---

## 5. 消费方接线（概要，细节见 skill-routing）

1. **技能路由 G1**：`identifyMatchingSkillNames` 前加 top-K 短名单（已挂载技能直通）。
2. **工具路由 G2**：MCP 工具 schema 按服务器召回注入（内置 7 工具全量、阈值放行、pin 保底）。
3. **TDAI 向量召回**：共享同一 EmbeddingService——回环 OpenAI 兼容 shim（零侵入）或给 TdaiCore 注入口子；`dimensions` 对齐 384（当前关闭、无存量索引，无迁移负担）。

---

## 6. 依赖策略（需拍板）

| 方案                           | 说明                                        | 取舍                                               |
| ------------------------------ | ------------------------------------------- | -------------------------------------------------- |
| A. core 常规依赖               | `@huggingface/transformers` 进 dependencies | 最简；但每次 npm install 拉 onnxruntime 原生二进制 |
| B. optional/peer + 动态 import | 基础安装轻量，装了才启用                    | 安装更稳；真实能力需用户另装                       |

产品为桌面端（目标平台 darwin/win/linux 均有 ORT 预构建），**推荐 A**，运行时仍 fail-open；若担心安装体积/稳定性改 B。

---

## 7. 验证计划

1. **VectorIndex 单测**（纯数学，不依赖模型）：余弦排序、topK、空索引回退。
2. **EmbeddingService fail-open 单测**：无模型/加载失败 → embed 返回 null。
3. **真实模型冒烟**（gated，`DEEPORCA_TEST_EMBEDDING=1`，CI 默认不跑）：经 hf-mirror 下载并 encode，断言维度=384、相似文本余弦 > 不相似文本。
4. **中文抽查**：50 条中文查询 × 技能池，top-8 命中率 ≥ 90%（不达标切 bge-base-zh-v1.5）。

---

## 8. 风险与开放问题

1. **安装体积**：onnxruntime-node 原生二进制 + 运行时模型 ≈ 百 MB 级；需接受或改方案 B。
2. **网络**：模型下载依赖 hf-mirror 可用性；离线首用不可用（fail-open 保底）。
3. **中文质量**：Granite 多语言中文需抽查验证，未达标走回退链。
4. **打包**：desktop 构建需确认 ORT 原生二进制被正确随包（extraResources / asar.unpack）。
