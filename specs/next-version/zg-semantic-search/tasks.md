# zvec-grep（zg）语义工作区检索集成 — 实施计划

> 前置门槛：M0 P0 验证全部通过。设计详见同目录 `design.md`（下称 DD，引用格式 _DD §x_）。

## M0 验证 spike（不写仓库代码）

- [ ] 1. Windows 全链路验证（DD §8 清单）
  - 安装/索引/stdio 桥/daemon 稳定性/原生依赖加载/模糊查询召回对比/断网全本地
  - 产出：结论回写本文件与本 design.md 状态行；不通过则整个 spec 归档
  - _DD §0.3, §8_

## M1 core：薄壳 + seam + 注入

- [ ] 2. `packages/core/src/common/zg.ts`
  - `ZG_MCP_SERVER_NAME = "zvec-grep"`；`hasZgProject()`（探测 `<root>/.zvec-grep/`）
  - per-root disable flag（`setZgDisabled`/`isZgDisabled`）
  - core `index.ts` 导出
  - _DD §3.1_

- [ ] 3. `packages/core/src/actions/zg-controller.ts`
  - `ZgController` 接口：`buildMcpServerConfig(root): McpServerConfig | null`、
    `indexProject/rebuild/drop/status`
  - `configureZgController`/`getZgController` seam（照 serena-controller.ts）
  - _DD §3.1_

- [ ] 4. `augmentMcpServersWithBuiltins` 注入块（`session-manager-mcp.ts`）
  - 门槛：`hasZgProject && !isZgDisabled && 用户无同名配置 && controller 配置非 null`
  - 与 Serena 块同构；不满足则完全不注册
  - _DD §2, §3.1, §4.5_

- [ ] 5. G2 hint（`session-mcp-hints.ts`）
  - `ZG_TOOL_HINTS.zvec_grep_search`，文案见 DD §3.1
  - _DD §3.1, §5_

- [ ] 6. core 单测（`packages/core/src/tests/zg.test.ts`）
  - 门槛组合：有/无标记、禁用、用户同名配置优先、controller null
  - （仿 codegraph.test.ts）
  - _DD §3.1, §7_

## M2 desktop：adapter + 索引生命周期

- [ ] 7. 依赖与 vendor
  - `packages/desktop/package.json` 加 `"@zvec/zvec-grep": "0.2.1"`（钉死）
  - `scripts/vendor-zg-model.js`：预置 potion-code-16m-v2 → `vendor/zg/` + 版本标记
  - 确认 optionalDependencies（node-llama-cpp）不进产物
  - _DD §3.2, §4.2, §4.6_

- [ ] 8. `packages/desktop/src/main/tools/zg-cli.ts`（`ZgCliController`）
  - spawn 三级兜底：npm resolve → 系统 Node 22（`resolveModernNode`）→ npx
  - env 注入：`ZVEC_GREP_HOME`（app dirs）/`ZVEC_GREP_MODEL_CACHE`（vendor 模型）/
    `ZVEC_GREP_EMBEDDING=local/potion-code-16m-v2`/`ZVEC_GREP_MCP_TOOLSET=agent`/`ZVEC_GREP_DEVICE=cpu`
  - index/rebuild/drop（direct 模式 + 进度回报）；`zg server status --check-ready` 就绪探测
  - _DD §3.2, §4.1, §4.4_

- [ ] 9. 宿主接线（`main/index.ts`）
  - `configureZgController(new ZgCliController({...}))`（vendor/模型根 host 注入）
  - app quit 钩子 `zg server off` 防 daemon 泄漏
  - _DD §3.2, §6_

- [ ] 10. IPC 契约 + bridge
  - `shared/ipc.ts`：`ZgStatusEntry` + `ZgIndex/ZgReindex/ZgDrop/ZgStatus`（仿 Codegraph\* 系列）
  - `session-bridge.ts`：四方法 + `pluginUpdateMcpDisabled` 接 `setZgDisabled`
  - `main/index.ts` 注册 handler
  - _DD §3.3_

## M3 产品面 + 收尾

- [ ] 11. MCP 页签与设置
  - `plugin-mcp-view.ts` builtin 列表加 `zvec-grep` 条目（照 Serena 条目模式）
  - 知识库 tab `KnowledgeSourceStatus` 加 zg 状态卡（`zg status --json` 解析：
    索引状态/fragment 数/truncated_fragments/freshness）
  - _DD §3.3, §3.4_

- [ ] 12. i18n + license + 仓库卫生
  - `messages.ts` + ja/ko/zh-hk/zh-tw 字符串
  - `scripts/check-licenses.js` / `ThirdPartyNotices.txt` 补 Apache-2.0
  - 文档提示用户项目 `.gitignore` 加 `.zvec-grep/`；file-history 排除该目录
  - _DD §3.4, §6_

- [ ] 13. 回归与验收（DD §7 清单）
  - `npm run check && npm test` 全绿
  - 断网全本地索引+检索、退出后无残留 daemon、未索引项目无感
  - `desktop:start` 人工手测清单：索引触发 → 状态卡 → 会话内模糊查询 → 关闭开关 → 卸载路径
  - _DD §7_

## M4 观察项（不进首版，另行评估）

- [ ] 14. 远程 embedding elicitation 授权流（承接 AskUserQuestion）——当前不配 provider，路径不存在
- [ ] 15. `full` toolset / managed rg 工具（与 bash+rg 重复，默认不做）
- [ ] 16. 与 Granite routing 的 tool-level 联动排序；四层工具选择的会话轨迹复盘后调 hint 文案
