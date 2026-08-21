# TS 原生化迁移 — 任务清单（ts-native-migration）

> 对应 `design.md`（2026-08-21 立项）。每段出口标准以 design.md §五为准。
> 标记：⬜ 未启动 · 🔄 进行中 · ✅ 完成 · ⏸ 条件未触发

## P0-1 design 包抽离 ⬜

- [ ] 0. 依赖分析：对 `desktop/src/renderer/{openui,dd,a2ui}` + 设计组件 + `main/tools/{design-store,dd-package,dembrandt-browser,a2ui}` 跑 import 图，列出与 desktop 其余部分的所有交叉边；成环处先立贡献点/事件接缝
- [ ] 1. 新建 `packages/design/`（`@deeporca/design`，ESM、tsconfig 继承 base、references 接线）
- [ ] 2. 搬迁 renderer 三子系统（openui/dd/a2ui）+ 五个设计组件（DesignPanel/DesignPreview/PrototypePanel/PrototypeWindow/ComparisonMatrix），desktop 侧改为从 `@deeporca/design` 导入
- [ ] 3. 搬迁 main 侧四工具（design-store/dd-package/dembrandt-browser/a2ui server），IPC 处理函数注册点经 shell/desktop 的组合入口接入
- [ ] 4. 决策点 D1 执行：defineAction 能力盘点 → design/design-audit/bento 三 action 外挂化迁入（不足则降级留 core 并记档）
- [ ] 5. 搬迁 `core/templates/design/` 与 `core/templates/plugins/design/` 至 design 包插件形态，验证 core 技能/模板发现链路
- [ ] 6. vendor 脚本拆分（tailwind/bento/dembrandt/generate-openui-prompt）随 design 包走；`desktop:build` 不再直接引用
- [ ] 7. 依赖方向 lint 守护（design 不得 import desktop）+ 测试随迁全绿 + 真机烟雾

## P0-2 shell 包抽离 ⬜（前置：P0-1）

- [ ] 0. 新建 `packages/shell/`（`@deeporca/shell`）
- [ ] 1. 搬迁框架件：`main/index.ts` boot 与 `configure*Root` 注入、`ipc-security.ts`、`safe-path.ts`、`preload/`、`plugin-manager.ts` 框架部分、`web-fetch-provider.ts`
- [ ] 2. `shared/ipc.ts` 契约迁 shell（D3）；desktop/design/preload 三侧引用更新
- [ ] 3. desktop main 收敛为薄入口：组合 shell 框架 API + 产品服务（git-service/archive-store/editor-handlers/file-scanner/workspace-registry）
- [ ] 4. 打包基建迁 shell（D4）：electron-builder.yml、vendor 拷贝链路、package-desktop.js；`desktop:build` 改为组合构建
- [ ] 5. 构建拓扑验证：`npm run build` / `desktop:build` / `desktop:start` 全链路；rewrite-esm-imports 适配新包

## P1 tsgo 工具链 ⬜（并行，低风险）

- [ ] 0. 别名引入 TS 7（`typescript7: npm:typescript@^7` 或 `@typescript/native-preview`），保留 `typescript@^6.0.3` 供 eslint
- [ ] 1. 各包 tsconfig 显式化 `rootDir`（消除 TS7 默认值变更影响）
- [ ] 2. CI 非阻塞 job：`tsgo --noEmit --pretty false` vs `tsc --noEmit --pretty false` 双跑，收集诊断 diff 与计时，跑若干 PR
- [ ] 3. diff 清零后 tsgo 提升为 typecheck 准入；验证 emit 布局与 `rewrite-esm-imports.js` 假设
- [ ] 4. ⏸（等 TS 7.1 稳定 API）typescript-eslint 升级，移除 6.0 别名，单轨化

## P2 M0 内存止血 ⬜（并行）

- [ ] 0. offscreen Chromium（web-fetch-provider）用后即毁 / 空闲回收 / 导航回 about:blank
- [ ] 1. routing 与 memory 的 embedding 服务并单（消双份 Granite ~118MB）
- [ ] 2. 子进程懒启动 + 空闲退出（codegraph / gitmcp / 未用 MCP servers）
- [ ] 3. 活跃会话 LRU 落盘、prompt 装配复用、streaming 缓冲上界
- [ ] 4. 常驻内存前后实测读数回写至 08-19 报告

## P3 传输中立化 ⬜（前置：P0-2；与远程 C 线同一工程）

- [ ] 0. dispatch table 抽取（远程预研 M1 地基）
- [ ] 1. core 无头服务端（WS），会话全流程跑通
- [ ] 2. desktop 经同一协议消费 core（同进程函数调用路径下线或降级为 transport 之一）
- [ ] 3. 契约测试：协议面 freeze，双侧兼容性守护

## P4-a scriptc spike ⬜（只读，尽早）

- [ ] 0. 构建环境验证（Node 24+ / clang；与仓内 Node 22 基线隔离）
- [ ] 1. `scriptc coverage` 对 core 全量跑分 → 基线报告（SC 码分类计数、静态覆盖率）
- [ ] 2. 存亡项实测：最小 repro 验证原生目标 child_process / fetch(SSE) / dynamic import() 真实状态
- [ ] 3. memory 包跑分（node:sqlite / onnxruntime 依赖面）

## P4-b 接缝加固 ⬜（前置：P4-a）

- [ ] 0. 三条接缝审计：child_process 只经 spawn-spec 抽象点 / fetch 只经 provider 注入点 / dynamic import 只经加载器——列出所有越点调用并收编
- [ ] 1. 存亡项消缺设计（FFI 静态链接方案 / 协议化替代 / dynamic 层隔离）评审
- [ ] 2. 迁移卫生规则（08-21 预研 Part IV）落 lint：eqeqeq、Map/Set 键类型约束等可机检项

## P5 M2 core 原生化 ⏸（条件触发，见 design.md §五条件门）

- [ ] （触发后另立子计划：子系统四顺序 = 子进程/MCP 管理 → 权限/路径 → session loop/消息转换/压缩 → 持久化；每步 Node/原生双跑对拍）

## 回写义务

- [ ] P0 完成 → 本文件 + 08-21 预研消费状态回写
- [ ] P1 完成 → 08-21 预研 §2.4 回写实证计时
- [ ] P4-a 完成 → 08-21 预研 §1.4 存亡项状态以实测回写
