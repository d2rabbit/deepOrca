# design-md-collection — 任务分解

## WP0 规格三件套

- [x] requirements.md / design.md / tasks.md。

## WP1 core 三源解析

- [x] `actions/design-systems.ts`：resolveDesignSystem / readProjectDesignSystem / listVendoredDesignSystems / looksLikeDesignSystemDoc / 宿主注入 configureDesignSystemsVendorRoot / 200K 截断 / id 安全形态；
- [x] design.ts 接线（枚举开放 + 可行动错误 + 按来源措辞注入）；
- [x] actions barrel + core 根导出。

## WP2 vendoring

- [x] `scripts/vendor-design-md.js`（blobless 克隆 + ls-tree 枚举 + withAtomicSwap + .vendored-head 幂等 + best-effort 失败语义）；
- [x] build.mjs 第 14 个 ensureVendored 接线；
- [x] vendor-notice MANIFEST 补条目（MIT）+ ThirdPartyNotices.txt 再生成（14 组件）；
- [x] 实跑验证：74 套落盘 2.2MB。

## WP3 desktop

- [x] main/index.ts boot 注入 vendored 根（existsSync 守卫）；
- [x] design-ipc 目录扩展（bundled + vendored + project 伪条目）。

## WP5 复刻整合（S5，user ask 2026-09-11）

- [x] readProjectDesignSystem 双路径（根优先 → .deeporca/DESIGN.md）+ 测试；
- [x] design.extract 指示升级（Stitch 形态 + 结构下限 + 链路说明）；
- [x] project 错误文案/catalog 描述/deep-design Step 0 双读点说明。

## WP4 测试与收尾

- [x] `design-md-collection.test.ts`（7 项：三源优先级/project 校验/路径安全/截断/动作错误文案/vendored 端到端）；
- [x] `npm run check` + 全量测试（core 984 / desktop 714）+ mutation check ×1（project 校验破坏→2 测试失败，还原全绿）；
- [x] 提交推送（ec0c63c37）。
