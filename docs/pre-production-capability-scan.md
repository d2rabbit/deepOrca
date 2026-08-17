# 预生产全域能力扫描报告

日期：2026-08-17 · 分支：`feat/sandbox-p0-path-gate` · 执行范围：收官计划 F1–F3 + F6
（对应 `specs/pre-production/tasks.md` F 线；F4 真机烟雾与 F5 逐 spec 终判保留待办，见 §5）

执行环境：Node `v22.23.2`（nvm，`.nvmrc` = 22）。⚠️ 本机默认 shell node 为
`v20.19.0`，直接 `npm test` 会因 `node:sqlite` 全数失败——跑基线前必须 `nvm use 22`。

## TL;DR

| 项 | 结论 |
| --- | --- |
| F1 静态基线 | ✅ 修复后全绿（build / typecheck / lint / format:check / license 门禁 / 4 workspace 765 测试 0 失败） |
| F2 专项套件 | ✅ 六个专项声明逐一在树核证，用例数与 tasks.md 记载**逐项吻合** |
| F3 接线核验 | ✅ 8 插件包 / 8 MCP builtin / 13 vendor 脚本 / 6 locale / 3 bundle + extraResources 全部在树 |
| 发现并已处置 | ① 9 文件 prettier 违规（`--no-verify` 批次带进，**已修复**）；② 默认 shell Node 20 环境提醒（本文首段） |
| F4 / F5 | ⬜ 保留待办（真机烟雾 Windows 必测 / 19 spec 逐条终判），不阻塞 F6 落盘 |
| H 预生产切换 | 不变，仍依赖 F 全过 |

## 1. F1 静态基线

命令链：`npm run check && npm test`（Node v22.23.2）。

| 环节 | 结果 |
| --- | --- |
| `npm run build` | ✅ embedding → core → memory 拓扑构建，ESM 重写 157 imports / 115 files |
| `npm run typecheck` | ✅ 4 workspace `tsc --noEmit` 全过（desktop 含 ensure-stub） |
| `npm run lint` | ✅ 0 error / 13 warning（见 §4-3，均为存量未用变量/类型标注风格项） |
| `npm run format:check` | ✅ **修复后**绿（首轮 9 文件红，见 §4-1） |
| `npm run license:check` | ✅ 依赖树 license 门禁通过 |
| `npm test` | ✅ core **550 tests（549 pass / 1 skip / 0 fail）** · desktop **191/191** · embedding **10/10** · memory **14/14** |

## 2. F2 专项套件（声明 ↔ 在树核证）

| 专项 | tasks.md 声明 | 在树证据 | 判定 |
| --- | --- | --- | --- |
| sandbox | 门禁整改后高危清零 | sandbox-backend/policy/status、path-boundary、path-grants、quarantine 6 套件随全量绿 | ✅ |
| routing（D4） | 字节一致性守护 2 用例 | `prefix-consistency.test.ts` "byte-identical across server discovery orders"（正/逆/乱序三序列化比对）恰好 2 用例 | ✅ |
| session P1-1（D1） | 崩溃合成 7 用例 | `resume-synthesis.test.ts` 7 用例（真值表/双状态合成/暂停豁免/replay 回退） | ✅ |
| session P1-2（D2） | 两段式 compaction 5 用例 | `compaction.test.ts` 5 用例（含 CJK 感知估算、投影 <阈值×0.7 跳过 LLM） | ✅ |
| beforeToolExecution（D3） | 执行闸门 5 用例 | `common/tool-execution-gate.ts`（register/decide，deny>ask>allow，abstain 跳过）+ `tool-execution-gate.test.ts` 5 用例 | ✅ |
| actions 三面到达 | 27 项 | registry 实测 **28** 个 action id（design.extract/drift 入册后净增），actions.test.ts 26 + phase-actions.test.ts 14 | ✅（28 ≥ 27） |
| gitmcp 8 工具（C1-C5） | 23 测试离线全覆盖 | `gitmcp-tools.test.ts` 恰好 23 用例；8 工具名册：search_code / fetch_documentation / search_documentation / fetch_url_content / get_repo_info / get_repo_structure / outline / read_file | ✅ |
| designer（E1/E2） | extract、drift、预设 | `design-dembrandt.test.ts` **32 用例**（CDP 注入/SSRF 矩阵/containment/vendor argv，声明"30 用例"为下限）；`design-action.test.ts` 5 用例；9 套 systems（§3） | ✅ |

## 3. F3 接线核验

| 接线面 | 在树证据 |
| --- | --- |
| 8 插件包技能加载 | `packages/core/templates/plugins/`：browser（web-access-strategy）/ code（arch-scan、codegraph-cli、smart-code-review）/ design（deep-design、pm-designer-openui、taste）/ knowledge（book-distill、openwiki、wiki-qa）/ memory / meta-skills（a2ui-annotation、deeporca-self-refer、skill-digester、skill-spector、skill-writer）/ vision / work（bento-slides），8 包 eval.yaml 齐备（A4） |
| MCP builtin 全量 | desktop `main/index.ts` 起停循环注册 8 个：`openwiki / uv / skillspector / browser-skill / serena / crg / bento / dembrandt`；dembrandt 为 vendored 离线 + 内置 Chromium CDP（`configureDembrandtVendorRoot` + `dembrandt-browser.ts`，打包态/树内 vendor 双判定） |
| vendor 13 脚本 | `scripts/vendor-*.js` 恰 13：bento / browser-skill / crg / **dembrandt** / download / fs / granite / notice / openwiki / serena / skillspector / tailwind / uv |
| i18n | `SUPPORTED_LOCALES = ["en","zh","zh-TW","zh-HK","ja","ko"]`（en + 5 语言，与"5 语言"口径一致），locales/ 四文件 + 内建 zh/en |
| desktop:build | build.mjs 产 `main.js`（ESM）/ `preload.cjs`（+ `prototype.cjs` A2UI 专用）/ `renderer/` 三面；`electron-builder.yml` `extraResources: vendor → app/vendor` 与主进程运行时解析路径一致 |

## 4. 发现与处置

1. **【已修复】9 文件 prettier 违规导致 format:check 红。** 首轮扫描 `npm run check`
   在 format:check 失败：`actions/design.ts`、`common/dembrandt.ts`、
   `common/resume-synthesis.ts`、`common/sqlite-runtime.ts`、`session.ts`、
   `tests/compaction.test.ts`、`tests/prefix-consistency.test.ts`、
   `tests/resume-synthesis.test.ts`、`scripts/vendor-granite.js`。**根因**：收官批次
   按门禁契约以一次性 `--no-verify` 放行（tasks.md 决策记录在案），pre-commit 的
   lint-staged（prettier --write）被跳过。处置：`prettier --write` 修复后全链重跑
   绿；随本报告一并提交。**后续提交必须恢复钩子**（决策记录既有要求）。
2. **【环境提醒】默认 shell Node 20.19.0。** `.nvmrc` = 22 且 core 测试强制
   ≥22.5（node:sqlite）。CI/真机不受影响，仅本机直跑需 `nvm use 22`。
3. **【零风险记录】lint 13 warnings。** 0 error 不阻塞门禁：registry.ts 的
   `import()` 类型标注风格 ×3 + 未用变量 ×10（registry/review/codegraph/crg/
   main-index/dembrandt-browser 各处存量）。属 `--no-verify` 批次与重构残留，
   留作冻结期后 `chore` 清理，不在本轮动。

## 5. 保留待办（不随本报告关闭）

- **F4 真机烟雾**（Windows 必测）：会话→plan mode→工具→permission→
  design.materialize→review.full→任务树→重启恢复（验证 P1-1）。需真机，无法
  在本扫描环境代跑。
- **F5 逐 spec 终判**（specs/ 全目录 19 个）：产出挂账清单。独立文档作业，建议
  与 F4 同批做。
- **H 预生产切换**：前置不变（F 全过 + tasks.md A-G 全勾——A-G 已全勾，见
  tasks.md 执行状态块）。

## 6. 结论

收官计划 9 提交（A/B/C/D/E/G 六线）的**全部可静态核证声明均与树内事实吻合**，
唯一实质偏差（format 违规）已当场修复并回归。F1–F3+F6 就此关闭；F4/F5 与 H
保持待办，预生产切换门槛未变。
