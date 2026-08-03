---
name: smart-code-review
description: >-
  智能代码审查 — 编排 CRG 风险分析 + OCR 语义审查，输出统一的审查报告。
  Use when the user asks to review changes, audit code quality, check for risks,
  or before committing/PR. Triggers: review, 审查, audit, code quality, risk,
  pre-commit, PR review, 代码审查, 风险分析.
---

# 智能代码审查

编排 CRG（结构风险分析）和 OCR（AI 语义审查）进行联合代码审查，输出结构化、有上下文的审查报告。

## 何时使用

- 用户要求审查代码改动（提交前 / PR 前）
- 用户想了解变更的风险和影响
- 用户问 "这段代码有什么问题"

## 工作流

### Step 1: 识别变更范围

```bash
git diff --stat HEAD
```

如果没有未提交的变更，提示用户指定要审查的 commit 或分支。

### Step 2: CRG 结构风险分析（如果图谱已构建）

使用 CRG MCP 工具分析变更影响：

```
mcp__code-review-graph__detect_changes_tool  → 识别哪些已变更节点受影响
mcp__code-review-graph__get_impact_radius_tool  → 计算每个变更的影响半径
```

将变更文件按影响半径排序：
- **高风险**：影响半径 > 10（枢纽函数/类，大量下游依赖）
- **中风险**：影响半径 3-10（局部核心逻辑）
- **低风险**：影响半径 < 3（叶子节点，独立工具函数）

**注意**：如果项目没有构建 CRG 图谱（`.code-review-graph/` 不存在），跳过此步骤，仅做语义审查。

### Step 3: OCR 语义审查

```bash
ocr review --format json
```

解析 JSON 输出，每条评论包含 `file`、`line`、`severity`、`message`、`suggestion`。

如果指定了特定 commit/分支：
```bash
ocr review --from <base> --to <head> --format json
```

### Step 4: 交叉引用 + 生成统一报告

将 CRG 结构风险 × OCR 语义发现合并：

1. **高危项**（CRG 高风险文件中的 OCR critical/warning）
   - 标注影响半径和下游依赖数
   - 优先展示

2. **中危项**（中风险文件中的 OCR 发现，或高风险文件中的 info）
   - 提供修复建议

3. **低危项**（低风险文件中的发现）
   - 简要列出

4. **结构风险**（仅 CRG 检测到但 OCR 未报的）
   - 例如：修改了被 47 处调用的公共接口，即使 OCR 没发现问题

### Step 5: 主动修复

对高置信度的问题，询问用户是否同意修复。修复后重新运行 OCR 验证。

## 输出格式

```markdown
## 代码审查报告

### 🔴 高危（2 项）

**`src/auth/token.ts:42`** — 空指针解引用风险
- 影响半径：**47 个下游调用方**（CRG）
- 严重程度：**critical**（OCR）
- 建议：在访问 token 前添加空值检查

**`src/db/connection.ts:15`** — 连接池未关闭
- 影响半径：**12 个服务**（CRG）
- 严重程度：**warning**（OCR）

### 🟡 中危（1 项）
...

### 🟢 低危（3 项）
...

### 📊 统计
- 变更文件：5 个
- OCR 发现：6 条（1 critical, 3 warning, 2 info）
- CRG 高风险节点：2 个
- 总影响半径：73
```

## 注意事项

- CRG 分析需要预先构建图谱（`.code-review-graph/` 存在）。如果不存在，引导用户先构建。
- OCR 需要 LLM 端点配置。使用 DeepOrca 内置的模型设置。
- 审查范围默认是未提交的工作区变更。可用 `--from`/`--to` 审查特定分支差异。
- 对非代码文件（图片、二进制、锁文件），OCR 和 CRG 都应跳过。
