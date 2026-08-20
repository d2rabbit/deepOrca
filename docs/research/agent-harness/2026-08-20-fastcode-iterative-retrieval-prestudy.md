# FastCode 预研 — 多级索引与置信度驱动迭代检索（HKUDS/FastCode）

> 日期：2026-08-20 · 状态：**⬜ 未消费（结论型调研：整体不引入，借鉴"检索预算显式化"与"粒度感知上下文选择"两思想，落地为自研 spec）**
> 产物去向：[`specs/index-knowledge-boost/design.md`](../../../specs/index-knowledge-boost/design.md)（K2 轨道）；repo overview 路由思想记入 doc-wiki spec 对照
> 仓库：`github.com/HKUDS/FastCode`（港大 HKUDS，配论文；Python 包 + API + `mcp_server.py` + Web UI，捆绑 nanobot agent 框架）
> 立场口径：**不引入、不 vendor、不拷贝代码**（MIT 虽可借鉴，但与既有 CodeGraph/Serena/routing 栈全面重叠，引入即重复建设）。

---

## 1. 一句话定位

FastCode 是面向"代码问答/理解"的检索层：把仓库按 **file / class / function / doc 四级粒度**建立向量 + BM25 混合索引，再用迭代 agent 做多轮检索——每轮 LLM 自评置信度、决定下一步工具调用、按预算筛选上下文，直到置信度达标或预算耗尽。它不是 agent harness，是给 agent 供上下文的检索服务。

## 2. 核心机制（`indexer.py` / `iterative_agent.py` 源码走读）

1. **四级粒度索引**：每文件产出 file/class/function/doc 四类 CodeElement（签名、docstring、行区间、复杂度、imports）；每仓库另生成 repo overview（摘要 + 结构 + README）单独入向量库，支持多仓库路由。
2. **迭代检索循环**：Round 1 只给目录树不给代码，LLM 输出置信度（0–100）+ 查询复杂度 + 查询改写 + 工具调用计划；每轮 = 混合检索（语义 + BM25 + 伪代码语义）→ 图扩展（2 跳）→ LLM 按粒度筛选保留元素（可显式丢弃上轮内容）→ 重评置信度。
3. **自适应预算与停止条件**：迭代上限（2–6）、置信度阈值（90–95）、行数预算（6k–20k 行）随查询复杂度与仓库规模动态调整；停止原因四分（置信达标 / 迭代上限 / 预算超限 / **边际收益递减**——连续两轮置信增益 <5）；每轮计算 ROI = 置信增益 / 新增行数。
4. **LLM 粒度选择**：候选文件带 class/function 清单给 LLM，按问题粒度决定给 file 级还是 function 级上下文（"问函数别给全文件"）。

## 3. 与本仓栈对照

| FastCode 能力 | 本仓等价物 | 判断 |
| --- | --- | --- |
| tree-sitter 多级索引 | CodeGraph（node:sqlite 持久图）+ Serena 符号（40+ 语言） | 已覆盖，图更全（CALLS/依赖边/社区） |
| 混合检索（向量+BM25） | `core/routing/`（Granite embedding + tcvdb BM25） | 已覆盖，但**只路由 skill/tool，不检索代码上下文** |
| 置信度驱动迭代 + 预算/ROI 停止 | 无——session 循环读代码无预算，compaction 只事后压缩 | **未覆盖，独有思想** |
| LLM 粒度选择（函数级 vs 文件级） | read 工具 snippet 是被动粒度 | 部分覆盖，prompt 设计可借 |
| 多仓库 overview 路由 | 无；与 doc-wiki"知识编译"同族 | 半空白，已在 doc-wiki spec 邻域 |

## 4. 处置结论（2026-08-20 定稿）

- ❌ **整体引入不做**（含 MCP 形态 `mcp_server.py`）：索引与检索能力与 CodeGraph + Serena + routing 全面重叠，再挂一个 Python 检索服务是重复建设，且违反 vendor 体系 Node-first 形态。
- ✅ **借鉴一（K2a）检索预算显式化**：把"行数预算随任务复杂度自适应 + 边际收益递减即停 + 每轮 ROI 观测"搬进 session 的上下文记账——本仓 LLM 读代码目前无预算，直到 compaction 才兜底；这套度量核心只是记账 + 停止判断，实现成本低，对 DeepSeek 长会话成本控制有实际意义。
- ✅ **借鉴二（K2b）粒度感知上下文选择**：file/class/function 三档 + "问函数别给全文件"策略，作为未来上下文组装器（与 CodeGraph 符号对接）的 prompt 设计参考；不引入任何代码。
- 📌 **repo overview 仓库级路由**：与 doc-wiki 知识编译同族，记入 doc-wiki spec 作对照工作，不在本预研落地范围。

## 5. 未核验项

- 其论文指标（token 削减率等）未独立复现；K2a 的收益以本仓会话 token 统计（`usage` 记账已有）实测为准。
