# open-code-review

通过 `ocr` CLI（阿里巴巴 Open Code Review）进行 AI 驱动的代码审查。它读取 Git diff，将变更文件通过具备工具调用能力的 Agent 发送至可配置的 LLM，生成具有行级精度的结构化审查意见。

## 适用场景

- 提交前审查工作区未提交的变更
- 开 PR 前对比分支差异（`--from main --to feature`）
- 审查特定提交（`--commit <hash>`）
- 对整个文件/目录进行全量审计（无需 diff）
- 获取代码质量、安全性、正确性的第二意见

## 不适用场景

- 非代码文件（图片、二进制、锁文件）
- 纯格式化的琐碎变更
- 用户只想要解释而非正式审查时

## 前置条件

1. **内置** — `ocr` 已随 DeepOrca 内置，通过 Electron 的 Node 运行，无需手动安装。
2. 已配置 LLM 端点（自动使用 DeepOrca 的模型设置）
3. Git 仓库（ocr 从工作树读取 diff）

## 命令

| 命令 | 用途 |
|------|------|
| `ocr review` | 审查所有未提交变更（暂存 + 未暂存 + 未跟踪） |
| `ocr review --from <base> --to <head>` | 审查两个引用之间的差异 |
| `ocr review --commit <hash>` | 审查单个提交 |
| `ocr review --format json` | 机器可读的 JSON 输出 |
| `ocr review --audience agent` | 面向 CI/Agent 的精简摘要 |
| `ocr scan <path>` | 全文件审计（无需 diff） |
| `ocr config set llm.url <url>` | 配置 LLM 端点 |
| `ocr llm test` | 验证 LLM 连通性 |

## 工作流

1. 确认工作区是 Git 仓库且有待审查的变更（或指定引用）。
2. 运行 `ocr review --format json` 获取结构化结果。
3. 解析 JSON 输出：每条评论包含 `file`、`line`、`severity`、`message`。
4. 按严重程度分组展示（critical → warning → info）。
5. 如用户同意，主动修复高置信度问题。

## 输出格式（JSON）

```json
{
  "comments": [
    {
      "file": "src/auth.ts",
      "line": 42,
      "severity": "warning",
      "message": "user.token 存在潜在空引用",
      "suggestion": "在访问 token 前添加空值检查"
    }
  ],
  "summary": "3 个文件中共 2 个警告、1 个提示"
}
```

## 提示

- OCR 会自动读取 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_MODEL` 环境变量。
- 使用 `--concurrency 4` 限制大型 diff 的并行子任务数。
- 使用 `--timeout 600`（秒）应对超大变更集。
- `--audience agent` 标志可减少输出 token 以便程序化使用。
