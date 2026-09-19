# X 线遗留集成缺陷 — 第 3 项修复设计方案（已审查批准，同日实施）

> 2026-09-17 立稿。对应 bug-hunt-swarm 集成探查的 P2 遗留三项：D1 记忆配置热重载、D2 编辑器数字体取消、D3 vision/edit-handler 纳入实验 flag。
> **2026-09-17 实施状态：D1/D2/D3 全部落地**（D1 指纹纯函数 `main/tools/memory-fingerprint.ts` + reconcile 对比重建 + 单测 3 例；D2 单飞行 controller + `EditorAgentCancel` IPC 全链（shared/preload/registrar/bridge），renderer 取消按钮留 UI 迭代；D3 `runStandaloneChatCompletion`（core 导出，flag 自读 resolved settings）+ edit-handler×2/vision-mcp 迁移 + 双通道单测 2 例；vision 多模态真机验证与 B4/B7 同批待排期）。门禁全绿（check/test/lint/desktop:build）。
> 同批已落地（不在本文范围）：StepFun `reasoning_effort` 重映射（回归测试锁定）、记忆 adapter `requestExtras` thinking 信封 + secondary 端点凭证修正。
> 原则：方案取「改动面最小 × 语义最完整 × 可回滚」；全部不新增依赖。

---

## D1. 记忆配置热重载（配置指纹 + 温和重建）

**现状**：`reconcileMemory()`（desktop/main/index.ts）只对齐 enabled 位。副模型/端点/key/embedding/retention 变更后，运行中的 MemoryManager 仍用旧凭证与旧模型，直到应用重启或手动关-开。

**方案**：配置指纹对比 → 指纹变化即温和重建。

1. 抽纯函数 `extractMemoryFingerprint(settings): string`（desktop main）：`JSON.stringify([secondaryBaseURL, secondaryApiKey, secondaryModel || model, requestExtras, memory.embedding, memory.retentionDays, memory.everyNConversations])`。
2. `startMemory` 成功后记录 `memoryRuntimeFingerprint`；`reconcileMemory` 在 `wantEnabled && isRunning` 时对比指纹——不一致 → `await stopMemory(); await startMemory();`（现有对称函数，数据目录不变，SQLite 打开幂等，无数据迁移）。
3. `SettingsUpdate` 已调 `reconcileMemory`，无需新接线。

**改动面**：仅 `desktop/main/index.ts`（+纯函数、+指纹变量）。**测试**：指纹函数单测（变更任一字段 → 指纹变化；无关字段如 notify → 不变）；真机验证：改副模型后 generation-log 出现新模型名。**风险**：低——重建走既有 start/stop 路径；失败时 stopMemory 清理语义不变（返回 ok:false 与今天一致）。**回滚**：revert 单文件。

**备选（否决）**：给 MemoryManager 加 `updateConfig()` 热更新——需在 adapter/管线内处理凭证替换的中间态，改动深入 memory 包，违反"最小改动面"。

## D2. 编辑器数字体取消（单飞行 AbortController + 取消 IPC）

**现状**：`session-bridge.ts:912` `runBackgroundLlmTask({skill:"editor-agent", …})` 不传 signal，且无取消通道——一次编辑器运行不可中断，直到 80 轮上限。任务侧基础设施已就绪（`opts.signal` → loop-top `throwIfAborted` → executor `shouldStop`）。

**方案**：单飞行 controller（"最新请求获胜"语义——编辑器同时只应有一个运行）。

1. `session-bridge.ts`：bridge 字段 `editorAgentController: AbortController | null`。`runEditorAgent()`（现 :912 处）创建 controller → 传 `signal` 进 opts → 存字段；若已有运行中的旧 controller，先 `abort()`（旧运行以取消收场，用户意图总是最新一次）。
2. 新 IPC：`IpcRequest.EditorAgentCancel = "editor:agentCancel"` → main handler → `getBridge().cancelEditorAgent()`（abort + 置 null；无运行时静默 ok）。preload/api 同步三行。
3. renderer：编辑器 agent 运行指示处接取消按钮（或复用面板关闭动作触发 cancel）——UI 接线在实施时与现有 editor-agent 事件面对齐，不新增事件类型（复用既有 error/interrupted 事件呈现终止）。

**改动面**：shared/ipc.ts（1 通道）、preload、api、session-bridge（controller 管理 + cancel 方法）、main handler 一行。**测试**：cancel 方法单测（abort 后 runBackgroundLlmTask 的 promise 以中断/错误收场——用现有 background-task 测试基座注入短超时任务）；真机：运行中点取消 → 进度停止、无残留轮次。**风险**：低——abort 语义任务侧已验证（X2.5/B5 与 abort part 链路）；"最新获胜"是编辑器场景的自然语义。**回滚**：不接取消按钮即回到现状。

**备选（否决）**：per-run Map<runId, controller>——编辑器场景不存在并行运行，Map 徒增生命周期管理。

## D3. vision / edit-handler 纳入实验 flag（core 级独立补全辅助）

**现状**：三处非流式 LLM 直连绕过咽喉点与 flag——`core/tools/edit-handler.ts:677/756`（old_string 修复器 + escape 校正器，`context.createOpenAIClient` 直连、catch→null 静默）、`desktop/main/tools/vision-mcp.ts:104`（vision_chat/vision_ocr，`createVisionClient` 直连）。flag ON 时它们仍走 legacy openai SDK。

**方案**：core 新增独立非流式辅助 `runStandaloneChatCompletion`，三处迁移。

1. core 新导出（放 `common/ai-sdk-transport.ts` 或新 `common/standalone-completion.ts`）：

   ```ts
   runStandaloneChatCompletion(input: {
     client: OpenAI;                    // 已配置的 legacy 客户端（凭证来源）
     request: Record<string, unknown>;  // 非 stream 形状（与今天三处构造一致）
     options?: { signal?: AbortSignal };
     experimentalSdkTransport: boolean;
   }): Promise<{ message: Record<string, unknown>; usage: ModelUsage | null }>
   ```

   内部：flag OFF → `client.chat.completions.create(request)` 取 `choices[0].message`（与今天完全一致）；flag ON → 复用 `runAiSdkChatCompletionStream` + 合成流经同一归约出单条 message（非流式语义由调用方不消费流保证）。凭证经 `readOpenAIClientEndpoint`。

2. 三处调用点各改 ~10 行：请求构造不动，发送换成新辅助；edit-handler 的 catch→null 静默语义、vision 的错误面全部保留。

**改动面**：core 新函数（~60 行）+ edit-handler 两处 + vision-mcp 一处。**测试**：新辅助单测（双通道同 fixture 归约一致——复用 transport 测试基座）；edit/vision 行为由现有真机面覆盖。**附带收益**：edit-handler 两处进入 usage-ledger 计量（今天漏计）；flag 语义升级为「全部 LLM 流量」。**风险**：低-中——vision 是图像多模态请求，需电池确认 openai-compatible 对 image_url 的转换（与 B1 已锁定的 ImagePart 映射同路径，风险可控）；实施时先 edit-handler（纯文本）后 vision（多模态真机验证）。

**备选（否决）**：B"文档化为例外"——flag 语义残缺且 edit/vision 恰是 DeepSeek 网关兼容性问题的常见受害者，与引入实验通道的动机相悖。

## 实施顺序与工作量

| 项 | 改动面 | 估时 |
|---|---|---|
| D1 指纹热重载 | desktop/main 1 文件 | 0.5 天（含单测） |
| D2 编辑器取消 | shared/preload/api/bridge/handler + 可选 UI | 0.5–1 天 |
| D3 独立补全辅助 | core 1 函数 + 3 调用点 | 1 天（vision 真机另计） |

三项相互独立，可独立实施/回滚。审查通过后按 D1 → D2 → D3 顺序执行。
