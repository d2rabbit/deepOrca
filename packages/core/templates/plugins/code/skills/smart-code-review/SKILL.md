---
name: smart-code-review
description: >-
  智能代码审查 — 通过 review.full action 一键编排 CRG 风险分析 + OCR 语义审查（委托模式：
  OCR 负责选文件与规则，审查由 DeepOrca 内置模型逐文件执行）。
  Use when the user asks to review changes, audit code quality, check for risks,
  or before committing/PR. Triggers: review, 审查, audit, code quality, risk,
  pre-commit, PR review, 代码审查, 风险分析.
---

# 智能代码审查

通过 `review.full` action 一键编排 CRG（结构风险分析）和 OCR（AI 语义审查，委托模式），输出带风险标注的统一审查报告。

## 何时使用

- 用户要求审查代码改动（提交前 / PR 前）
- 用户想了解变更的风险和影响
- 用户问 "这段代码有什么问题"
- 桌面端「代码审查」面板的一键审查按钮

## 工作流

### Step 1: 一键审查（推荐）

直接调用 `review.full` action——它会自动完成全部编排：

```
review.full
  → ① 检测 Git 变更文件
  → ② CRG 结构风险查询（Node.js 直读 SQLite，无需 MCP）
       · detectChanges → 识别变更函数
       · getRiskData → 获取风险评分
       · getTestGaps → 检测测试缺口
       · formatCrgContextForOcr → 构造 --background 上下文
  → ③ OCR 语义审查（委托模式，带 CRG 风险上下文）
       · ocr delegate preview → 可审查文件清单 + 模式元数据
       · ocr delegate rule    → 按组输出审查规则
       · 逐文件取 diff（range/commit/workspace 三种模式）
       · DeepOrca 内置模型逐文件审查（严重度策略：Critical/High 必报，
         Medium 视上下文，Low 丢弃）
  → ④ mergeReviewWithCrgRisk → 每条审查意见标注 CRG 风险等级
  → 输出：统一审查报告
```

**如果 CRG 图谱不存在**（`.code-review-graph/` 缺失），review.full 自动降级为纯 OCR 审查。

### Step 2: 快速审查（仅 OCR）

如果用户只需要快速语义检查，不需要结构风险分析：

```
review.run → 同样的委托管线（无 CRG 上下文）
```

### Step 3: 检查可用性

```
review.check-available
  → 检查 OCR CLI 是否可用
```

### Step 4: 可视化风险图谱（可选）

如果用户想直观了解代码的风险分布：

```
crg.visualize → 生成 D3.js 力导向图 HTML
```

## 报告解读

review.full 返回的报告中，每条审查意见包含：

- **路径 + 行号**：问题位置
- **CRG 风险等级**（如果有图谱）：高/中/低，基于调用方数量和影响半径
- **严重度前缀**：`[CRITICAL]` / `[HIGH]` / `[MEDIUM]`（委托契约下 Low 不落盘，
  已在意见的 content 前缀中标注）
- **修复建议**：审查生成的具体代码建议

## 注意事项

- CRG 分析需要预先构建图谱（`.code-review-graph/` 存在）。可用 `crg.reindex` 构建。
- OCR 为委托模式：OCR 侧只负责选文件与规则解析，语义审查由 DeepOrca 内置的
  模型逐文件执行，无需任何 OCR 侧 LLM 配置或 API key。
- 审查范围默认是未提交的工作区变更；也支持 range（--from/--to）与单提交模式。
- 对非代码文件（图片、二进制、锁文件），preview 阶段自动排除。
