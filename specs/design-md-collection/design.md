# design-md-collection — 技术方案

> 需求见 [requirements.md](./requirements.md)。改动：core `actions/design-systems.ts`（新）、`actions/design.ts`、根/桶导出；desktop `main/index.ts`（注入）、`main/design-ipc.ts`（目录）；`scripts/vendor-design-md.js`（新）+ `build.mjs` + `vendor-notice.js`。

## 1. 三源解析（core/actions/design-systems.ts）

```
resolveDesignSystem(id, projectRoot)
  ├─ id === "project" → readProjectDesignSystem(projectRoot)   // <root>/DESIGN.md，looksLikeDesignSystemDoc 校验
  └─ readBundled(id) ?? readVendored(id)
       ├─ bundled：BUNDLED_DESIGN_SYSTEM_IDS 闭合集 + templates/design/systems/<id>.md
       └─ vendored：宿主注入根（configureDesignSystemsVendorRoot）+ design-md/<id>/DESIGN.md
                    id 安全形态 ^[a-z0-9][a-z0-9.-]{0,63}$（收藏集目录名）
```

- 校验 `looksLikeDesignSystemDoc`：≥3 个 `##` 节（不要求 H1——64/74 收藏集文件无 H1）；仅 project 源启用（bundled 是契约基线、vendored 是上游既成事实，不重复审）。
- 200K 字符截断（与套件大文本载荷钳制同规）。
- 宿主注入纪律：core 永不推导 vendor 路径（AGENTS.md 既有裁决——semantic routing 曾因 core 内推导路径指向不存在的目录而静默失效）。

## 2. design.ts 接线

- `readDesignSystem` 闭包删除，换 `resolveDesignSystem(designSystemId, ctx.projectRoot)`。
- 动作 schema：`enum` → 自由 `string` + 来源说明（bundled/vendored 品牌名/"project"）；运行期解析即校验。
- 错误分层：`"project"` 缺失 → 可行动错误（放置路径 + 格式来源 + 结构下限）；其它未知 id → 既有 `unknown or unavailable` 语义。
- 提示词注入按来源措辞：bundled = "Use this bundled design system exactly"（字节不变）；project/vendor = "Use this DESIGN.md design system exactly (source: …)"。

## 3. vendoring（scripts/vendor-design-md.js）

- git 型 vendor（vendor-src/awesome-design-md 持久 blobless 克隆）；跟踪 origin/main，`.vendored-head` 记录精确哈希做幂等（纯文档不执行，跟踪 main + 哈希记录即钉扎；`DESIGN_MD_REF` 覆盖做一次性测试）。
- `git ls-tree -r` 枚举 `design-md/*/DESIGN.md` → `withAtomicSwap` 原子落 `packages/desktop/vendor/design-md/<name>/DESIGN.md`（只 markdown，preview.html 不进包——74 份共 2.2MB）。
- 失败语义：已有 vendored 副本时任何失败保留现状；首次失败抛错（build.mjs 的 ensureVendored 兜底提示）。
- build.mjs `ensureVendored("design-md", [".vendored-head"], …)` 接入第 14 个 vendor；NOTICE manifest 补条目（MIT）。

## 4. desktop

- boot 注入：main/index.ts 在 a2ui 注入点后 `configureDesignSystemsVendorRoot(dist/../vendor/design-md)`，existsSync 守卫（未 vendor/离线退化）。
- 目录：`readDesignSystemCatalog` = bundled（目录列举，原逻辑）+ vendored（core `listVendoredDesignSystems()` + 注入根读文件，单文件损坏跳过）+ `"project"` 伪条目（无内容；选中而文件缺失时动作给可行动错误）。渲染层选择器目录驱动，零 UI 改动；palettes.ts 对未知 id 已有 null 回退。

## 5. 测试策略

- 纯函数：三源解析优先级/project 校验（成节 vs 散文）/截断/路径安全（大写、`../`、点开头拒绝）。
- 动作级：`designSystemId: "project"` 缺文件 → 可行动错误文案；vendored id 经注入根走通 materialize（mock ctx）。
- 注入状态隔离：每个用例后 `configureDesignSystemsVendorRoot(null)` 复位。
