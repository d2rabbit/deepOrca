# design-md-collection — 需求（EARS）

> Phase 1 of spec-workflow。技术方案见 [design.md](./design.md)；任务分解见 [tasks.md](./tasks.md)。
> 立项依据：user 2026-09-11——"VoltAgent/awesome-design-md 是不是可以继续强化设计呢？尤其是 UI 设计的第二个模块，设计系统"。

## 背景与调研结论

[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)（MIT）收录 74 份按 Google Stitch DESIGN.md 规范整理的真实品牌设计系统（Stripe/Linear/Vercel/Claude…），每份 9-12 节：视觉主题/色板与语义角色/字体层级/组件状态/布局原则/阴影层级/Do's & Don'ts/响应式/迭代指南。实测 74 份全部 ≥3 个 `##` 节；64 份无 H1（YAML 元信息直接 `##` 起）。

现有设计系统模块缺口：9 套手作系统（闭合枚举）、无工作区级设计系统入口、无真实品牌参照——弱模型生成画布时视觉语言全靠那 9 套的描述密度。

## 范围

designSystemId 从闭合枚举升级为**三源解析**：
1. **bundled**——既有 9 套（契约测试基线，优先级最高）；
2. **project**——保留 id `"project"`，读工作区根 `DESIGN.md`（Stitch 生态约定：AGENTS.md 管怎么建、DESIGN.md 管长什么样；用户可从收藏集复制或手写）；
3. **vendor**——vendored 收藏集（desktop 构建期 vendor 74 份到 `vendor/design-md/<name>/DESIGN.md`，仅 markdown 不带 preview.html，宿主注入根）。

**不含**：自动按需求语义推荐设计系统、DESIGN.md 编辑器、收藏集在线浏览 UI（catalog 列表即全部界面）、我们自研 9 套的内容升级（另行立项）。

## 验收标准（EARS）

### S1 — 三源解析

1. When designSystemId 是 bundled id, the system shall 优先返回 bundled 内容（与 vendored 同名时 bundled 赢——契约测试基线不可被上游漂移）。
2. When designSystemId 为 `"project"`, the system shall 读取工作区根 `DESIGN.md` 并做结构校验（≥3 个 `##` 节——实测收藏集 74/74 通过、纯散文拒绝）；文件缺失或不成形时返回**可行动错误**（提示放置路径与格式来源）。
3. When designSystemId 形如收藏集目录名（小写/数字/点/连字符）, the system shall 从宿主注入的 vendored 根读取 `design-md/<id>/DESIGN.md`；路径形态不安全（大写/斜杠/点开头等）一律拒绝。
4. When 任何来源的设计系统文档超过 200K 字符, the system shall 截断后注入（载荷纪律，与套件大文本同规）。

### S2 — vendoring

5. When desktop 构建, the system shall 经 `scripts/vendor-design-md.js` 从上游收藏集落盘 DESIGN.md（git 跟踪 main + `.vendored-head` 哈希标记去重，`--force` 强制重拷；只取 markdown，preview.html 不进包）；网络/git 失败保留既有 vendored 副本（best-effort 同全部 vendor）。
6. When vendored 副本随安装分发, the system shall 经 electron-builder extraResources 携带，并进入 ThirdPartyNotices.txt（MIT 署名）。

### S3 — 宿主注入与目录

7. When 应用启动, the system shall 由 main 注入 vendored 根（与全部 vendor 根同纪律——core 不推导路径）；缺失时三源退化为 bundled + project。
8. When 渲染层请求设计系统目录, the system shall 返回 bundled + vendored + `"project"` 伪条目（伪条目无内容占位——被选中而文件缺失时由动作返回 S1.2 的可行动错误）。

### S4 — 兼容

9. When 旧调用传入 bundled id, the system shall 行为与升级前完全一致（提示词注入措辞按来源区分，bundled 分支字节不变）。
10. When designSystemId 传入未知值, the system shall 返回既有 `unknown or unavailable design system` 错误语义。

## 非目标

- 收藏集内容审校/精简（上游 MIT 原样）；
- designSystemId 语义推荐与自动选择；
- preview.html 的本地渲染；
- 项目 DESIGN.md 的创建向导。
