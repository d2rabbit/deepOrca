# 全域深度代码审查与漏洞审查报告 — 2026-08-15（第二轮）

> 方法：三个并行审查通道（IPC/preload/渲染层、core 工具与权限与 MCP、密钥/日志/信任边界），全部发现均经人工复核代码后处置。
> 前置：[security-audit-2026-08-15-followup.md](security-audit-2026-08-15-followup.md)（第一轮整改）。
> 验证：全仓测试全绿（core 418 / desktop 150 / memory 14 / embedding 10，+8 本轮新测试）；`npm run check` 0 error、11 warnings（低于 12 的存量基线）。

## 一、发现与处置总表

| #     | 严重度   | 发现                                                                                                                                             | 处置                                                                                                                                                                                                                                                                                                          |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1    | **HIGH** | `debug-logger.ts` 全量未脱敏写盘：完整 LLM 请求（含用户代码/工具结果）、SDK 错误栈（常内嵌 `Authorization: Bearer sk-…`）；文件 0644、无容量上限 | ✅ 已修：复用 error-logger 的 `redactSensitiveKeys`（敏感键任意深度掩蔽 + content 截断 + 自由文本正则）；目录 0700/文件 0600；20MB 容量上限（超限截断重写）。注：脱敏会截断消息 content 至 100 字符预览——结构可诊断性保留，全量载荷不再落盘                                                                   |
| A1    | MED      | design-store `id` 未校验直达 `path.join`：被 compromise 的渲染层可用 `../../` 读任意 meta/内容、**递归删除任意目录**（`rmSync recursive`）       | ✅ 已修：`resolveArtifactDir` 包含校验（UUID-ish token 白名单 + resolve 复核），read/delete/formState/meta 四入口全守卫；+ 穿越/绝对/分隔符回归测试                                                                                                                                                           |
| B1    | **HIGH** | bash 副作用推断可绕过：`find -delete`（词边界盲区）、`python -c`/`node -e` 解释器载荷、`dd`/`truncate`、`base64 -d \| sh` 均返回 `[]` 直接过     | ✅ 已扩充：`-delete` 旗标、解释器 `-c/-e/--eval` 内联代码、解码管道、块设备/截断工具 → 一律归 `delete-out-cwd + write-out-cwd`；+5 组回归测试（含良性命令无回归断言）。**遗留产品决策**：`defaultMode: allowAll` 首装默认下 `unknown` 不触发询问——分类器扩充对 askAll/显式 ask 策略生效，是否改默认需产品拍板 |
| B2    | **HIGH** | MCP stdio 传输无消息大小上限（SDK ReadBuffer 无界）——恶意服务器可在 initialize 期间 OOM 主进程                                                   | ⚠️ 部分缓解：SDK 内部行为无法在不 fork 的前提下修补；已在上层补 tools/list 守卫（B5 同批）——工具数 ≤500/服务器、单工具 schema ≤256KB、单结果 ≤512KB。传输层无界行增长列为已接受风险（需上游 SDK issue），记录于遗留                                                                                           |
| B3    | MED      | `isPathInProject` 纯词法解析：项目内 symlink 指向 /etc 时按 in-project 归类（常为预允许域）                                                      | ✅ 已修：两端 realpath 优先判定（realpath 明确越界时信任之），不存在时回退词法（保留新建文件行为）                                                                                                                                                                                                            |
| B4    | MED      | read 工具先整读后分页：多 GB 文件全量入内存；图片再 base64 膨胀 ~33%                                                                             | ✅ 已修：`MAX_READ_FILE_BYTES = 128MB` 前置 stat 守卫（文本/PDF/图片三路）                                                                                                                                                                                                                                    |
| B5    | MED      | MCP 工具结果无界进会话历史与下一轮 LLM 请求；tools/list 单页可塞超巨 schema                                                                      | ✅ 已修（见 B2 批）：结果 512KB 截断 + 工具数/schema 上限                                                                                                                                                                                                                                                     |
| B6    | MED      | `runSubagent` 无递归上限（代码注释自认）——互递归技能对可无界嵌套 LLM 循环                                                                        | ✅ 已修：`MAX_SUBAGENT_DEPTH = 4`（finally 归零）；+ 深度测试                                                                                                                                                                                                                                                 |
| B7    | LOW      | WebSearch 默认端点结果无上限（脚本路径有 MAX_OUTPUT_CHARS，此路径漏了）；machineId 含主机名外发                                                  | ✅ 已修：结果对齐 MAX_OUTPUT_CHARS 截断；machineId 改 `dc-${uuid}` 随机（去主机名），文件 0600                                                                                                                                                                                                                |
| B8    | LOW      | 旧会话消息缺 permissions meta 时 resume 默认 allow                                                                                               | 📋 记录：fail-open 为兼容旧会话的设计取舍，改动会破坏存量会话恢复；观察项                                                                                                                                                                                                                                     |
| A2/A3 | LOW      | PluginReadSkillDoc 路径仅 core 侧词法校验（symlink 可逃）；git checkout 分支名可带前导 `-` 被解析为选项                                          | A3 ✅ 已修（拒绝前导 `-`，两处）；A2 记录（只读 + 主渲染层限定，低危）                                                                                                                                                                                                                                        |
| C2    | MED      | 会话 JSONL（明文对话+工具参数）默认 umask 权限                                                                                                   | ✅ 已修：写路径 0600                                                                                                                                                                                                                                                                                          |
| C5    | INFO     | `env.API_KEY` 可能随 project settings 写进仓库目录（有 0600 但位置共享/可提交）                                                                  | 📋 记录：代码注释已自认此设计；改动影响现有流程，列为产品讨论项                                                                                                                                                                                                                                               |
| A4    | INFO     | 主窗口 `sandbox: false`（preload 仅用 electron API，理论上可开）                                                                                 | 📋 记录：需回归验证 preload 无 Node 依赖后开启；单独立项                                                                                                                                                                                                                                                      |

## 二、经核验为安全的面（摘录）

- **IPC 分层**：全部 18 个 registrar 只经 handle（主渲染层断言）/handlePrivileged（+审计）/handleShared（主+原型窗口）三个入口，无裸 `ipcMain.handle`；`ipc-contract.test.ts` 锁定通道与层级一致性；CrgReindex 刻意忽略渲染层传入的 root 由服务端派生。
- **原型窗口隔离**：prototype preload 仅暴露 5 函数/3 通道；主 preload 只挂主窗口；sender 策略三重验证（webContents id + 主帧引用相等 + pathToFileURL 精确匹配，缺信息 fail-closed）。
- **渲染层 XSS**：markdown 经 DOMPurify 严格白名单 + CSP `script-src 'self'`；.dd 预览 iframe `sandbox="allow-scripts allow-modals"`（无 allow-same-origin，不可触 parent/文件系统）+ 编译器剥离 script/事件处理器/javascript: URL；A2UI/OpenUI 为 React 组件渲染，无 innerHTML/eval。
- **bash 执行链**：无 TOCTOU（分类与执行同一解析对象）；输出 10MB 捕获/30K 返回上限；PWD 标记随机化防伪造；edit 的 snippet 契约（范围钳制 + mtime 新鲜度）与 write 的先读后写守卫完好。
- **MCP 命名**：`mcp__` 命名空间正则净化 + 长度上限 + 哈希兜底，内置工具名不可被服务器伪造。
- **error-logger**：敏感键任意深度掩蔽 + content 截断 + 轮转（本轮将其 redaction 管道导出复用到 debug-logger）。
- **memory sqlite**：全程参数化 + 表名白名单；JSON.parse 无原型污染路径（spread 为 CreateDataProperty）。

## 三、遗留（按优先级）

1. **B2 传输层**：向 MCP SDK 上游报告 stdio ReadBuffer 无界问题；评估 fork/包装。
2. **B1 产品决策**：首装默认 `allowAll` 是否改为对 `unknown`/解释器执行类命令询问。
3. A4 主窗口 `sandbox: true` 试点（需 preload Node 依赖审计）。
4. B8 旧会话 permissions 缺失的 fail-open 是否收紧为按当前 settings 重判。
5. C5 env key 落 project settings 的位置策略。
