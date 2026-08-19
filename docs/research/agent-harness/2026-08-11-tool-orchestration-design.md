# 四工具协调联动设计：Serena × CodeGraph × OpenWiki × 内置工具

> **日期**：2026-08-11
> **状态**：设计文档（P0 已实施，P1-P4 待实施）
> **前置**：Serena 迁移完成（controller-seam 模式）

---

## §1 能力矩阵与重叠分析

### 完整能力矩阵

| 能力 | 内置工具 | Serena (LSP 实时) | CodeGraph (图谱快照) | OpenWiki |
|---|---|---|---|---|
| 读文件文本 | `read` ✅ | 禁用 (ide-assistant) | — | 读 wiki |
| 全文搜索 | `bash`+`rg` | 禁用 | — | — |
| 文本编辑 | `edit` (snippet 级) | — | — | — |
| **符号级编辑** | — | `replace_symbol_body` ✅独有 | — | — |
| **跨文件重命名** | — | `rename_symbol` ✅独有 | — | — |
| 找符号定义 | — | `find_symbol` (实时 LSP) | `codegraph_search` (图谱) | — |
| 找引用/调用方 | — | `find_referencing_symbols` (实时) | `codegraph_callers` (图谱) | — |
| **调用图/影响面** | — | — | `codegraph_impact` ✅独有 | — |
| **实时诊断** | — | `get_diagnostics_for_file` ✅独有 | — | — |
| 项目文档 | — | — | 消费为数据源 | 生成 wiki ✅ |

### 重叠点

1. **Serena `find_symbol` vs CodeGraph `codegraph_search`** — 回答"X 在哪定义"
   - Serena：实时 LSP，逐符号精准，反映最新代码状态
   - CodeGraph：预构建图谱，支持模糊搜索和批量查询，但可能是增量同步前的快照

2. **Serena `find_referencing_symbols` vs CodeGraph `codegraph_callers`** — 回答"谁调用了 X"
   - Serena：实时引用，LSP 级准确
   - CodeGraph：调用图遍历，支持深度/广度分析

3. **Serena `replace_symbol_body` vs 内置 `edit`** — 修改代码
   - Serena：LSP 语义级（整个函数/类替换），跨文件安全
   - edit：文本级（精确字符串匹配），单文件

### 互补点（不重叠的独有能力）

- **CodeGraph `codegraph_impact`**：影响面分析（"改这个函数会影响哪些文件"）—— Serena 和内置工具都做不到
- **Serena `get_diagnostics_for_file`**：实时 LSP 诊断（类型错误、语法错误）—— 全栈唯一来源
- **Serena `rename_symbol`**：跨文件原子重命名 —— 内置工具做不到
- **OpenWiki**：项目文档生成 —— 唯一能输出结构化 wiki 的工具

---

## §2 工具选择决策矩阵（System Prompt 增强）

### 设计

在 system prompt 中增加跨工具协调指南，教 Agent 在并行可用的工具间选择最优工具。

### 决策矩阵

```
## 代码工具选择指南

DeepOrca 提供多层代码工具，按场景选择最优工具：

### 编辑代码
| 场景 | 推荐工具 | 理由 |
|---|---|---|
| 简单文本替换（同一文件） | 内置 `edit` | snippet 级精准匹配，轻量 |
| 替换整个函数/方法/类 | Serena `replace_symbol_body` | LSP 语义级，不关心行号 |
| 跨文件重命名 | Serena `rename_symbol` | 原子操作，自动更新所有引用 |
| 在某符号前/后插入新代码 | Serena `insert_before/after_symbol` | 语义级定位 |

### 查找代码
| 场景 | 推荐工具 | 理由 |
|---|---|---|
| 找某符号的定义 | Serena `find_symbol` | 实时 LSP，最准确 |
| 找谁调用了某符号 | Serena `find_referencing_symbols` | 实时引用 |
| 分析修改某符号的影响面 | CodeGraph `codegraph_impact` | 全代码图谱影响分析 |
| 查看调用链（谁调用了谁） | CodeGraph `codegraph_callees`/`callers` | 图谱遍历 |
| 全文搜索（非符号级） | 内置 `bash` + `rg` | 正则全文搜索 |

### 编辑后验证
| 场景 | 推荐工具 | 理由 |
|---|---|---|
| 检查修改后的类型/语法错误 | Serena `get_diagnostics_for_file` | 全栈唯一的 LSP 诊断来源 |

### 心智模型
- **Serena = 手术刀**：实时、精准、单符号级操作（LSP 驱动）
- **CodeGraph = 全景图**：广度、影响面、调用链分析（图谱驱动）
- **内置工具 = 基础**：文本读写、shell 命令、搜索
```

### 实施

在 `packages/core/src/prompt.ts` 的 `getSystemPrompt()` 中，在 "# Available Tools" 块之前注入此指南。

---

## §3 Post-Edit 诊断反馈环

### 设计

在 `edit`/`write` 修改文件后，自动调用 Serena 的 `get_diagnostics_for_file` 检查语义错误。仅 error 级别的问题注入为 system 提示消息，让 Agent 有机会自动修复。

### 流程

```
edit/write 修改文件
    ↓
现有：CodeGraph + Wiki + CRG 增量索引同步 (session.ts:3285-3307)
    ↓ 新增（异步，非阻塞）
Serena get_diagnostics_for_file(修改的文件)
    ↓
筛选：仅 severity === "error" 的诊断
    ↓
有 error？
├── 是 → 注入 system 消息："⚠️ 刚修改的 <file> 存在以下错误：..."
│         Agent 可选择调用 edit/replace_symbol_body 修复
└── 否 → 静默（warning 不注入，避免噪音）
```

### 关键设计决策

- **非阻塞**：诊断检查异步执行，不阻塞 Agent 的工具调用循环
- **仅 error 级别**：warning/hint 不注入上下文，避免 token 浪费
- **单文件检查**：只检查刚被修改的文件，不做全项目诊断
- **需要 Serena 可用**：如果 Serena 未连接，跳过诊断（优雅降级）

### 实施位置

`packages/core/src/session.ts` 的 `recordFileMutationCheckpoint()` (L3272-3307) 之后，增加异步诊断检查。

---

## §4 Serena × CodeGraph 并行策略

### 原则

两者并存，由 AI 自行决定，不强制路由。G2 语义路由自然分流。

### 工具描述差异化

通过工具描述的差异引导 G2 路由分流：

| 工具 | 当前描述 | 增加后缀 |
|---|---|---|
| Serena `find_symbol` | "Find a symbol by name" | "（实时 LSP，适合精准单符号查询）" |
| Serena `find_referencing_symbols` | "Find references to a symbol" | "（实时 LSP 引用，反映最新代码）" |
| Serena `replace_symbol_body` | "Replace the body of a symbol" | "（LSP 语义级编辑，比文本替换更安全）" |
| CodeGraph `codegraph_search` | "Search the code graph" | "（全代码图谱，适合批量/模糊搜索）" |
| CodeGraph `codegraph_impact` | "Analyze impact of changes" | "（全代码图谱影响面分析，Serena 无法替代）" |
| CodeGraph `codegraph_callers` | "Find callers" | "（图谱级调用方分析，支持深度遍历）" |

### 为什么不强制互斥

- 不同场景需要不同工具：快速查一个符号用 Serena（实时精准），架构分析用 CodeGraph（全局影响面）
- 强制路由会丢失灵活性：有时 Agent 需要先用 CodeGraph 看全局，再用 Serena 精准定位
- G2 语义路由已经能根据查询语义自然分流（"找到 handleRequest" → Serena；"重构影响什么" → CodeGraph）

---

## §5 Serena → OpenWiki Connector

### 现状

OpenWiki 已通过 `WikiCliController.configureCodegraphConnector(root)` 连接 CodeGraph（`wiki-cli.ts:63-95`），生成 wiki 时消费调用图数据。

### 缺失

OpenWiki 不消费 Serena 的语义结构。

### 方案

增加 `WikiCliController.configureSerenaConnector(root)`，同 CodeGraph connector 模式：

```ts
// wiki-cli.ts 新增
configureSerenaConnector(root: string): void {
  const serenaDir = path.join(root, ".serena");
  if (!existsSync(serenaDir)) return;

  const connectorDir = path.join(homedir(), ".openwiki", "connectors", "serena-mcp");
  mkdirSync(connectorDir, { recursive: true });

  writeFileSync(
    path.join(connectorDir, "config.json"),
    JSON.stringify({
      enabled: true,
      mode: "mcp-stdio",
      transport: { command: "...", args: ["start-mcp-server", "--context", "ide-assistant"] },
      allowedTools: [
        "get_symbols_overview",  // 文件符号大纲 → wiki modules/*.md
        "find_symbol",           // 符号详情 → wiki 符号文档
        "find_referencing_symbols", // 符号引用 → wiki 依赖关系
      ],
    }),
  );
}
```

### 价值

- `get_symbols_overview` → wiki 的 `modules/*.md` 文件大纲更精准（LSP 级 vs tree-sitter 级）
- `find_referencing_symbols` → wiki 的模块间依赖关系补充 CodeGraph 的调用图
- OpenWiki 的 LangChain agent 同时消费两个 MCP 数据源，生成更全面的 wiki

### 条件触发

- `.serena/` 存在时才写入 connector（同 CodeGraph 的 `.codegraph/` 条件）
- 失败时非致命（wiki 无 Serena 数据仍可生成）

---

## §6 Serena Memory × DeepOrca Memory 协调

### 两套记忆系统

| | Serena Memory | DeepOrca Memory |
|---|---|---|
| 位置 | `.serena/memories/` (项目级) + `~/.serena/memories/global/` | L0-L3 流水线 (`@deeporca/memory`) |
| 内容 | 项目知识（架构、模块、构建方式） | 对话记忆、用户偏好 |
| 格式 | Markdown 文件 + `mem:` 引用 | sqlite-vec 向量 + BM25 |
| 共享 | 可提交 Git，跨用户/会话 | 进程内，跨会话 |

### 方案：不合并，交叉引用

- Serena onboarding 生成的项目概览（`.serena/memories/`）→ 可作为 `index.build-all` 的补充输入
- DeepOrca 的 OpenWiki wiki → 可补充 Serena 的项目记忆
- 两套系统定位不同，合并会引入复杂度，不值得

### 未来可选

- Serena Memory 的 `mem:` 引用语法 → 可在 DeepOrca 的 AGENTS.md 中引用 Serena 记忆
- Serena 的 onboarding 流程 → 可在 DeepOrca 首次打开项目时自动触发

---

## §7 实施优先级

| 优先级 | 内容 | 收益 | 工作量 | 状态 |
|---|---|---|---|---|
| **P0** | §2 工具选择决策矩阵 → system prompt | 立竿见影，Agent 知道何时用哪个工具 | 小 | ✅ 已实施 |
| **P1** | §4 工具描述差异化 | 帮助 G2 路由分流 | 小 | ✅ 已实施 |
| **P2** | §3 Post-Edit 诊断反馈环 | 编辑后自动检查错误，减少 bug | 中 | 待实施 |
| **P3** | §5 Serena → OpenWiki connector | wiki 生成质量提升 | 中 | 待实施 |
| **P4** | §6 Memory 交叉引用 | 长期价值 | 大 | 待实施 |
