# DeepOrca 代码与功能深度审查 — Issues 清单

> 审查日期：2026-08-05
> 审查范围：`perf/native-optimizations` 分支相对 `master`（commit `daf3135..f62b9c3`）
> 审查基线：commit `daf3135`（审查时的远端 HEAD）
> 修复提交：见每条记录

本文档记录一次全量代码与功能深度审查发现的所有问题，按严重级别（Critical / High / Medium）分组。每条包含：现象、根因、失败场景、修复方案、**当前状态**（已修复的标注修复提交与验收证据；未修复的标注边界理由）。

---

## 状态图例

- ✅ **已修复** — 已落地代码 + 验收门通过
- ⚠️ **有意保留/部分修复** — 已记录决策，未做完整实现（附理由）
- ❌ **未修复** — 暂未处理

---

# Critical

## C1. Electron 主窗口导航可暴露完整 preload 权限 ✅

- **现象**：主窗口无 `will-navigate` 守卫、无 `setWindowOpenHandler`、IPC handler 不校验 sender；模型输出的 Markdown 链接被点击后，窗口可能导航到远程页面，而 preload 仍暴露文件读写、设置、Git、MCP、prompt 执行、索引删除等特权能力。
- **根因**：`contextIsolation:true` 不能解决——preload API 本就是显式暴露给页面的；`sandbox:false` 进一步削弱隔离。
- **修复**：主窗口加 `will-navigate`（仅允许 packaged renderer / `file://`，外部 http(s) 走 `shell.openExternal`）+ `setWindowOpenHandler`（deny）；新增 `handlePrivileged()` 包装，破坏性通道（settings/git/MCP/reindex/editor-write/prompt 等）校验 `event.sender === mainWindow.webContents` 且 sender URL 属于主 renderer。
- **markdown sanitizer**：`renderMarkdown` 原仅 `replace(/javascript:/gi,"")` → 改为 allowlist sanitizer（剥离 script/iframe/form/event-handler/style，强制 `<a target=_blank rel=noopener>`）。
- **提交**：`34508b8`
- **验收**：typecheck + desktop 31/31 + lint 0 errors + format

## C2. memory capture 实际记录 0 条消息（L0 永远空）✅

- **现象**：`MemoryManager.capture` 硬编码 `messages: []`；L0 recorder 只从 `messages[]` 提取，不消费 `userText/assistantText`。结果：每轮 capture 调用了、scheduler 计数增加，但 L0 不写任何消息，L1 无输入，recall 永久为空。
- **根因**：core 的 `maybeCaptureMemory` 只传 `userText/assistantText`，不传结构化 messages；memory 端又硬编码 `[]`。
- **修复**：core 传最后一条 user + assistant 的 `{role, content, id, timestamp}`（ISO→epoch-ms）+ `sessionId`；`MemoryProvider.capture` 接收 `messages`；`MemoryManager.capture` 优先用传入 messages，回退到从 userText/assistantText 合成两条；scheduler 仅在写入 ≥1 条时 `notifyConversation`。
- **提交**：`34508b8`
- **验收**：新增 `packages/memory/src/tests/capture.test.ts`（recordConversation 持久化 user+assistant 到 L0 JSONL）✅

## C3. 召回的 L1 memory 被丢弃 ✅

- **现象**：TDAI 把查询相关 L1 记忆放 `prependContext`，但 core `MemoryProvider.recall` 只声明 `appendSystemContext/strategy`，`getMemoryPrompt` 只消费它们——`prependContext` 与 `recallStrategy` 被静默丢弃。
- **修复**：`MemoryProvider.recall` 返回类型对齐 `RecallResult`（`prependContext` + `recallStrategy`）；`getMemoryPrompt` 渲染 `prependContext`（置于稳定 system 块前）+ 用 `recallStrategy` 替换 `strategy`；persona 已内联在 `appendSystemContext`，不再重复包装。
- **提交**：`34508b8`

## C4. 发布包不包含 `@deeporca/memory` ✅

- **现象**：desktop main 动态 `import("@deeporca/memory")`，但 `package-desktop.js` staging 只复制 `@deeporca/core`，不复制 memory 也不合并其 deps。开发环境可用，正式包 `module not found`。
- **修复**：staging dependencies 合并 `memoryPkg.dependencies`（sqlite-vec/@node-rs/jieba/tcvdb-text/js-tiktoken/json5/yaml/zod）+ 复制 built memory dist；staged core 跑 ESM import 重写（`DIST_DIR` 环境变量）；新增 `--smoke`（从 staged node_modules import+init+destroy memory）。
- **说明**：sqlite-vec 是 SQLite 可加载扩展（非 Node 原生插件），按 node:sqlite 内嵌 SQLite 编译，不适用 electron-rebuild；用 smoke 验证而非盲目 rebuild。
- **提交**：`34508b8`
- **验收**：`node scripts/package-desktop.js --smoke` 成功 import+init+destroy ✅

## C5. CodeGraph npm 集成无法命中 ✅

- **现象**：`require.resolve("@colbymchenry/codegraph/npm-shim.js")` 因 exports map（只暴露 `.`/`./package.json`）抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`，静默退化到 vendored/npx。
- **修复**：改解析 `package.json`（已导出）→ `dirname` → 拼 `npm-shim.js`；staging dependencies 加入 `@colbymchenry/codegraph`。
- **提交**：`34508b8`

## C6. OpenWiki vendor 复制路径错误但仍写成功 marker ✅

- **现象**：`cpSync` 源路径 off-by-one（多一层 `..`），`dist/cli.js` 通常缺失，但脚本仅 warning 后仍写版本 marker，后续构建因 marker 跳过、ship 破损 vendor。
- **修复**：修正 cpSync 源路径（直接 `join(npmPkgDir, item)`）；`dist/cli.js` 缺失即 throw，不再 warning+写 marker。
- **提交**：`34508b8`
- **验收**：`vendor-openwiki.js --force` 实测 `dist/cli.js` 存在 ✅

## C7. Windows desktop:build 失败 ✅

- **现象**：`build.mjs` 用 `execFileSync(node, [".bin/tsc"])`，Windows 下 `.bin/tsc` 是 POSIX shell shim，被当 JS 执行报 `SyntaxError: missing )`。
- **修复**：镜像 `scripts/build.js` 成功模式——`spawnSync("npm", ["run","build","--workspace=..."], {shell:true})`。
- **提交**：`34508b8`
- **验收**：Windows `npm run desktop:build` 退出 0 ✅

## C8. PrototypeWindow 用完整 preload（暴露全部特权）✅

- **现象**：prototype 窗口用 `preload.cjs`（文件/设置/Git/MCP/prompt），原型页面若加载不可信内容即获完整能力。
- **修复**：新增最小 `prototype.cjs`（仅 A2UI payload/update/action + close）；窗口 `sandbox:true` + 导航守卫；build.mjs 产出 `prototype.cjs` bundle。
- **提交**：`34508b8`
- **验收**：`prototype.cjs` 3.6kb 构建成功 ✅

---

# High

## H1. EndpointConfig.models 类型对齐（typecheck 报错根因）✅

- **现象**：source `EndpointConfig` 已有 `models?`，typecheck 报错是 dist 陈旧导致。
- **修复**：root `check` 改为先 `npm run build` 再 typecheck；CI 加 clean-check lane（删 dist/buildinfo → build → typecheck）。
- **提交**：`11af5e0`
- **验收**：CI clean-check 覆盖 ✅

## H2. Fresh install 无法在 Settings UI 创建 endpoint ✅

- **现象**：`getEditableSettings` 对 fresh install 返回 `endpoints: []`；`updateEndpoint`/`addModel` 只 map 现有条目，输入 API key / Add model 无变化。
- **修复**：`updateEndpoint`/`addModel` 在 id 不存在时从 `ENDPOINT_PRESETS` 物化 preset 条目。
- **提交**：`11af5e0`

## H3. 选择模型不会同步切换 endpoint（可能请求到错误服务商）✅

- **现象**：UI 内部用 `endpointId/modelId` key，但 onChange 又拆成 bare modelId 存储，`primaryEndpointId` 不变 → `provider-b/model-x` 被发往 provider-a 的 baseURL/key。
- **修复**：`ModelConfigSelection` 加 `endpointId?`；TopBar 用完整 key 作选择值，onChange 原子写 `{model, endpointId, primaryEndpointId}`，不再按 bare modelId 去重；`applyModelConfigSelection` 写 `primaryEndpointId`。
- **提交**：`11af5e0`
- **验收**：`applyModelConfigSelection writes primaryEndpointId` 测试 ✅

## H4. 切换模型后可能向不支持 thinking 的模型发 thinking ✅

- **现象**：模型切换时直接保留旧 `thinkingEnabled`，覆盖 capability 推导。
- **修复**：`applyModelConfigSelection` 按新 `(endpointId, modelId)` 解析 capability，不支持时强制 `thinkingEnabled=false`；TopBar onChange 同样解析；core 权威校验不信任 renderer。
- **提交**：`11af5e0`
- **验收**：`applyModelConfigSelection forces thinking off` 测试 ✅

## H5. `DEEPORCA_BASE_URL` 不再覆盖已配置 endpoint（与 API_KEY 不对称）✅

- **现象**：env API_KEY 用 `??`（覆盖），env BASE_URL 只作 `||` fallback，已配置 endpoint 的 baseURL 会忽略 env → 凭证可能发往错误网关。
- **修复**：区分"显式 env BASE_URL"与默认值；`primaryBaseURL = explicitEnvBaseURL ?? primaryEndpoint?.baseURL ?? resolvedBaseURL`，与 API_KEY 同级优先。
- **提交**：`11af5e0`
- **验收**：`env BASE_URL overrides configured endpoint` + `BASE_URL absent keeps configured` 测试 ✅

## H6. capability 按裸 model ID 跨 endpoint 解析 ✅

- **现象**：`resolveSettingsSources` 的 thinkingEnabled fallback 与 `resolveModelCapability` 按 bare model ID 扫描所有 endpoint，返回首个匹配（可能是别的 provider 声明）。
- **修复**：提前解析 `primaryEndpointId`；fallback 先查 PRIMARY endpoint 的注册，再退化到扫描；bare-ID fallback 仅用于一次性 legacy 迁移。
- **提交**：`11af5e0`

## H7. memory 启用设置没有作用 ✅

- **现象**：Settings checkbox 只改 draft，保存只跑 generic `updateSettings`，不 start/stop manager；启动也不看 `settings.memory.enabled`。
- **修复**：新增 `reconcileMemory()`（幂等按 `memory.enabled` start/stop）；启动 `whenReady` + 保存后 + 项目切换后调用。
- **提交**：`b011fd2`

## H8. 保存设置或切换项目静默断开 memory provider ✅

- **现象**：reload/switch 重建 `SessionManager`，provider 只挂旧 manager；新 manager `memoryProvider=null`，全局 manager 仍报 healthy。
- **修复**：`SessionBridge` 持有 provider，`createManager`/`reload`/`setProjectRoot` 末尾自动 `rebindMemoryProvider()`。
- **提交**：`b011fd2`

## H9. memory 跨项目数据泄漏 ✅

- **现象**：所有项目共用 `~/.deeporca/memory`，L1 schema / recall 无 project namespace；项目 A 的机密/事实可被召回到项目 B。
- **修复**：`startMemory` dataDir 改 `memory/<projectCode>`；切项目时 stop 旧 manager（flush 项目态）→ reconcile 开新 manager。
- **提交**：`b011fd2`

## H10. `MemoryManager` 绕过配置解析（unsafe cast）✅

- **现象**：手建 partial config + `as unknown as MemoryTdaiConfig`，pipeline/store 读取 undefined 字段（timeouts→NaN、dimensions 等）。
- **修复**：改用 `parseConfig({...overrides})`，删 unsafe cast。
- **提交**：`34508b8`
- **验收**：`parseConfig returns fully-populated config` 测试 ✅

## H11. L1 积压 >50 时永久跳过旧消息 ✅

- **现象**：SQLite/JSONL 选最新 50（DESC / slice(-limit)），cursor 推到最大值；积压 100 时处理 51-100，1-50 永久滞留 cursor 之后。
- **修复**：改 oldest-first（ASC / slice(0, limit)），cursor 只前进到本页最大值。
- **提交**：`b011fd2`
- **验收**：`L1 JSONL reader returns OLDEST page` 测试 ✅

## H12. 崩溃恢复保留计数器但丢失 pending L1 工作 ✅

- **现象**：恢复只 arm L2（读 L1），L0 已持久化但未跑 L1 的会话永久 raw-only。
- **修复**：`recoverPendingSessions` 对有未处理 L0 的会话 enqueue L1（读持久化 L0）而非只 arm L2。
- **提交**：`b011fd2`

## H13. 应用退出不 destroy memory 管线 ✅

- **现象**：`before-quit` 只 kill helper 进程，不 drain memory（SQLite/checkpoint/提取 pending）。
- **修复**：`before-quit` 改异步 gate——`preventDefault` → `await stopMemory()` + bridge dispose → `app.quit()`。
- **提交**：`b011fd2`

## H14. Vendor 刷新失败先删可用缓存 ✅

- **现象**：codegraph/openwiki/uv/browser-skill 均 `rmSync(targetDir)` 后下载；catch 的"保留旧版本"检查的是已删除的二进制，瞬时故障毁掉可用缓存。
- **修复**：新增 `scripts/vendor-fs.js` 的 `withAtomicSwap(targetDir, {build, verify, preserve})`——build 到 sibling staging，verify 通过才 rename 进位，失败时 live target 字节不变；4 个高危脚本全部改用。
- **提交**：`4b43922`
- **验收**：`scripts/tests/vendor-fs.test.mjs`（5 测试：成功 swap / build 失败保留 / verify 失败保留+throw / preserve / 首装）+ openwiki --force 实测 ✅

## H15. CodeGraph checksum mismatch 被当"跳过校验" ✅

- **现象**：checksum mismatch 抛错被同一 catch 捕获、log "verification skipped"，继续解压 ship 不可信 archive。
- **修复**：区分"SHA256SUMS 服务不可用"（非致命）与"present-but-mismatch / 缺 asset 行"（throw → 走 npm fallback 或保留旧 cache，绝不 ship bad archive）。
- **提交**：`562231b`

## H16. MCP reconnect 泄漏旧 client/process ✅

- **现象**：`reconnect()` 不关现有 client 直接 `connectServer()`；`pruneDisconnectedClients` 因 server name 仍 in `connectedServers` 保留旧 client；旧连接晚到的 onclose 可能标记新连接失败。
- **修复**：reconnect 前先 `silentlyClose` 该 server 所有旧 client + 移除其 tools/prompts/resources + 从 `connectedServers` 删除，再建唯一替代。
- **提交**：`a40a443`

## H17. 内置 MCP disable 状态不完整（A2UI）✅

- **现象**：`initMcp()` 只同步 codegraph/crg/serena/skillspector，不同步 A2UI → UI 禁用后 reload 仍重连。
- **修复**：`initMcp()` 增加 `setA2uiDisabled`。
- **提交**：`a40a443`
- **Activity Frames**：无需代码修改。常规 toggle 列表已过滤 builtin MCP，详情页对 builtin 显示锁定状态且不渲染 switch，因此它在 UI 中已是 display-only，不存在“可切换但禁用不生效”的误导。保持 always-on，避免增加虚假 disable gate。

## H18. Editor 异步读取竞态可能把 A 内容保存到 B ✅

- **现象**：快速打开 A 再 B，两 read 并发；A 晚返回则安装 A 内容但 `filePath=B`，保存写错文件。
- **修复**：引入 `loadReqIdRef`（每 load 自增，仅提交最新）+ `loadedPathRef`（load 开始置 null，保存前校验 `loadedPath === filePath`）。
- **提交**：`a40a443`

## H19. 长运行 index/wiki/review 操作无 operationId/root 过滤 ✅

- **现象**：CodeGraph completion 不校验 `event.root === projectRoot`；另一操作 completion 可能提前推进顺序工作流到 wiki；wiki flash fallback 切项目后可能在新项目执行；事件全局广播互相串。
- **修复**：IndexLibraryPanel 的 codegraph/wiki 完成 handler 加 `event.root === projectRoot` 过滤；`WikiProgressEvent` 加 `root` 字段，`runWikiAgent` 捕获并携带 root。
- **提交**：`a40a443`
- **说明**：完整的 per-operation ID + main 端 active-op 串行化未做（root 过滤已覆盖报告的核心失败模式）。

## H20. PrototypeWindow payload 仍有订阅竞态 ✅

- **现象**：push-on-`did-finish-load` 可能在 React 订阅前触发，窗口卡在 "Waiting for prototype data…"。
- **修复**：改为 pull handshake——`getPrototypePayload(token)`，renderer mount 主动按 URL 中的 token 拉取；main 按 token 存 payload，消费/关窗删除；push 保留为 back-compat。
- **提交**：`a40a443`

## H21. 破坏性 index IPC 接受 renderer 任意 root ✅

- **现象**：`codegraphReindex(root)`/`crgReindex(root)` 信任 renderer 字符串，递归删除其下 `.codegraph`/`.code-review-graph`，被攻破的 renderer 可指向任意目录。
- **修复**：忽略 renderer root，main 从 `getBridge().projectRoot` 推导。
- **提交**：`a40a443`

---

# Medium

## M1. 统一索引工作流失败/超时仍当成功 ✅

- **现象**：reindex reject 被 swallow，非零退出 completion 仍 resolve；5 分钟 renderer timeout 未终止后端却被当成功 → 可能推进到 wiki。
- **修复**：顺序工作流改以 `codegraphReindex` / `wikiInit` / `wikiUpdate` 的结构化 `{ok,error}` IPC 返回作为唯一完成与成功依据；任一阶段失败立即停止并显示具体错误，不再由 progress completion 或未取消后端的本地 timeout 推进。增加同步 active-run guard、卸载/run generation 防陈旧更新，只有两阶段均成功才显示 100%。
- **边界**：真正的强制超时/取消仍需 main 端持有子进程并引入 operationId；当前不再把 renderer 超时误报为成功，也不会在超时后错误启用重试。
- **验收**：typecheck + desktop 37/37。

## M2. A2UI "GC" 保留已删组件的后代 ✅

- **现象**：`gcUnreachableComponents` 把 parentId 指向缺失组件的当作 root 保留，删父后子树被提升到根。
- **修复**：root 仅限无 parentId 者；parentId 指向缺失的孤儿 + 其子树一并删除；`reachable` 集合保证 BFS 抗环，不可达环被剪除。
- **提交**：`04348a4`
- **验收**：`a2ui-processor.test.ts`（6 测试）✅

## M3. A2UI 表单不返回用户输入值 ✅

- **现象**：input/checkbox/select 为 uncontrolled，button action 只发 `{ componentId }`，email/password/checkbox/选择值丢失。
- **修复**：改为 controlled，per-surface `formValues` 收集；button action 携带 `formState: {...formValues}`。
- **提交**：`04348a4`
- **验收**：含在 desktop 37/37（+6 GC 测试）✅

## M4. A2UI action 失败被 IPC 当成功 ✅

- **现象**：缺/禁用 MCP、stale surface、tool 错误被 catch 只 log，IPC 返回 `void`，用户无反馈。
- **修复**：返回 `{ok, error}`；`a2uiAction` 契约（ipc.ts/preload）同步更新。
- **提交**：`a40a443`

## M5. A2UI 主 PrototypePanel 按钮不工作 ✅

- **现象**：`PrototypePanel` 渲染 `A2uiSurface` 不传 `onAction`，按钮静默无效。
- **修复**：传 `handleA2uiAction` 调 `api.a2uiAction`。
- **提交**：`a40a443`

## M6. Secondary model UI 已暴露但功能未接线 ✅（隐藏）

- **现象**：`createSecondaryClient` 无生产调用者；compaction/skill-matching/prompt-enhance 仍用主 client + 硬编码 flash。
- **修复**：SettingsPanel secondary endpoint/model 控件置灰 + "P1 计划中"提示（i18n key 加全 locale）；保留字段定义与 `createSecondaryClient`，指向 roadmap §十。
- **提交**：`11af5e0`

## M7. 第三方许可证缺失 ⚠️→✅

- **现象**：vendor 二进制 archive 多只含二进制无 LICENSE；installer 经 extraResources 分发却无统一 attribution。
- **修复**：`scripts/vendor-notice.js` 维护 9 组件 manifest（source/SPDX/notes），生成 `ThirdPartyNotices.txt`；`--check`/`CI_RELEASE=1` 校验存在+非空+覆盖全组件。
- **提交**：`ab118d8`

## M8. Release 打包允许 silently incomplete built-ins ✅

- **现象**：vendor 失败仅 warning，staging 只 log 缺目录；release 可 ship 缺失/破损 vendor。
- **修复**：`package-desktop.js` 加 `--required`/`CI_RELEASE=1`，按 host platform/arch 推导各 vendor 真实 entry（非仅目录），缺失即 throw + notice 校验；`release.yml` 设 `CI_RELEASE=1`。
- **提交**：`ab118d8`

## M9. Vendor 输入 mutable latest 且无哈希校验 ⚠️（部分覆盖）

- **现象**：clean build 解析 "latest"，同 commit 不同日构建可能 ship 不同二进制；uv/browser-skill/openwiki/tailwind 无哈希校验。
- **当前**：env override（`*_VERSION`）+ pinned 硬编码 fallback（API 不可达时）已就绪；codegraph 有 SHA256SUMS fail-closed（H15）；uv/browser-skill 无可验证 per-asset manifest，未单独建哈希注册表。
- **状态**：⚠️ 有意保留——无 manifest 的组件无法可靠 pin 哈希；codegraph 已有 checksum gate；其余组件用 pinned 版本 fallback 作为弱保证。建议后续为有 manifest 的 release 加 pin。

## M10. SkillSpector provisioning 在 Windows 路径不安全 ✅

- **现象**：`execSync` 拼接 `uvBinary` + 版本字符串建 shell 命令；路径含空格（`C:\Program Files\...`）未加引号，单引号在 cmd.exe 非引用字符；version 进 shell 命令。
- **修复**：全部 provisioning 与 PATH discovery 改为 `execFileSync(executable, argv, ...)`，wheel/git spec 作为单个 argv 元素；版本 marker 使用严格 allowlist，存在但非法或不可读时 fail closed；wheel URL 按 marker 版本构造，git fallback 固定到同一 release tag，不回退 mutable `main`。
- **验收**：新增 `skill-spector.test.ts`，覆盖含空格/元字符的 Windows 路径、wheel→git argv fallback、非法 marker 零执行、非默认 marker 的 wheel URL；4/4 通过。

## M11. Builtin package discovery 无聚焦回归测试 ⚠️

- **现象**：新布局有 3 个独立 scanner（package skills / nested plugin manifests / package prompt docs）+ source/dist 路径启发；现有测试仅间接断言。
- **状态**：⚠️ 有意延期——完整 fixture 需要跨 core/desktop 重构 package template 路径与 scanner 注入，投入明显超出本轮安全/正确性修复；现有 session/desktop IPC 测试保留间接覆盖。后续应单独做 source/dist、优先级、重复名、malformed frontmatter、traversal 与 `npm pack --dry-run` 产物测试。

## M12. API-key 设置文件无强制私有权限 ✅

- **现象**：`writeSettingsFile` 用普通 `writeFileSync`，POSIX 宽 umask 下新建文件可能 group/world-readable；endpoint 模型增加凭证数量。
- **修复**：用户级与项目级设置统一改为同目录唯一临时文件（PID + UUID）写入后原子 rename；创建时直接指定 `0o600`，POSIX rename 前再次 chmod；写入/rename 失败时清理临时文件并保留原始异常。Windows 跳过 chmod，沿用用户 ACL。
- **验收**：新增原子替换/无 temp 残留测试；POSIX 新建与覆盖 permissive 文件的 `0600` 测试（Windows 环境按平台跳过）。

## M13. Plugin group detail 有 stale-response 竞态 ✅

- **现象**：`cancelled` 置位但 `reload()` 不读，快速选 A→B 时 A 可能晚返回覆盖 B。
- **修复**：fetch 移入 effect 并检查 `cancelled`；`groupId` 变更立即清空 group。
- **提交**：`a40a443`

## M14. "Smart review" 绕过 App prompt 生命周期 ✅

- **现象**：按钮直接 `api.sendPrompt`，绕过 `runPrompt`（无 busy/optimistic/result/error/refresh，可启第二轮）。
- **修复**：`CodeReviewPanel` 加 `onSmartReview` prop，App 传入 `runPrompt`。
- **提交**：`a40a443`

## M15. Degraded SQLite store 泄漏打开的 DB 句柄 ✅

- **现象**：degraded 时把 `vectorStore` 置 `undefined`，但 DB 句柄已开；destroy 只关 retained 引用；Windows 上锁文件阻塞后续 rebuild。
- **修复**：degraded 丢弃前先 `bundle.store.close()`。
- **提交**：`b011fd2`

## M16. Corrupt/unreadable checkpoint 被静默替换为默认 ✅

- **现象**：read/parse 错误统一 catch 返回默认，下次 mutation 用默认覆盖文件 → 毁 cursor/persona 计数。
- **修复**：区分 missing-file（静默默认）与 read/parse 错误（log + 重命名坏文件为 `.corrupt-<ts>` 隔离）；missing-file 仍静默。
- **提交**：`b011fd2`
- **验收**：`CheckpointManager quarantines corrupt checkpoint` + `missing file silent` 测试 ✅

## M17. Lint warnings（20）⚠️

- **现象**：20 个 lint warnings（memory 包的 unused imports / `import()` type 注解 / FileMentionMenu ref cleanup）。
- **当前**：0 errors（构建/CI 不阻断）；warnings 数在整个修复过程保持基线不变（未引入新 warning）。
- **状态**：⚠️ 有意保留——非阻断，属代码整洁度，建议批量清理时单独 PR。

---

# 验收基线

整个修复链每阶段后均运行验收门，最终全量验证（模拟 CI clean-build）：

| 项                                                                           | 结果                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------ |
| `npm run clean` → `install` → `npm run check`（build+typecheck+lint+format） | ✅ 通过                                    |
| `npm test --workspace @deeporca/memory`                                      | ✅ 7/7                                     |
| `npm test --workspace @deeporca/desktop`                                     | ✅ 37/37（含 6 A2UI GC）                   |
| `node --test scripts/tests/vendor-fs.test.mjs`                               | ✅ 5/5                                     |
| settings + codegraph 单测（直接 tsx）                                        | ✅ 42 pass                                 |
| `npm run desktop:build`（Windows）                                           | ✅ 退出 0                                  |
| `node scripts/package-desktop.js --smoke`                                    | ✅ memory+core 从 staged 解析+init+destroy |
| 本轮 M10/M12 聚焦 core 测试（直接 tsx）                                      | ✅ 39 pass / 2 Windows 平台跳过            |
| lint                                                                         | ✅ 0 errors（20 warnings = 基线）          |

---

# 未修复/延期项汇总（建议后续 issue）

- **M9** uv/browser-skill/openwiki/tailwind 哈希 pin（无 manifest，受限）
- **M11** Builtin package discovery fixture 回归测试（跨层测试重构，单独实施）
- **M17** 批量清理 lint warnings（第三方派生 TDAI 为主，单独 PR）
- **完整 per-operation ID + main 端 active-op 串行化/取消**（H19/M1 的增量增强）
