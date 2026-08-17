# Mimosa 深度安全扫描复核报告 — 2026-08-12

> 本文记录 Mimosa 对当前分支的静态扫描结果及人工复核结论，供后续安全整改与误报豁免审查使用。
>
> **注意：** 本文不是“项目安全”结论。扫描结果为静态分析，且调用图覆盖不完整；列为“可豁免”仅表示当前证据下该条告警不构成对应类型的可利用问题，不代表相关代码永远无需维护。

## 1. 扫描信息

- **分支**：`fix/stabilize-data-loss-and-test-suite`
- **扫描深度**：`deep`
- **Scan ID**：`scan-2026-08-12T08-23-26.625Z-b1bf6661a423`
- **Seal**：`sha256:8a526fb693351076abd05e837716d72124d78275d51b5e4b658430e61c2e2742`
- **运行状态**：`inconclusive`
- **发现数量**：42（High 40，Medium 2）
- **扫描边界**：静态分析，未执行项目代码
- **覆盖缺口**：动态派发和跨文件调用图部分不完整
- **依赖扫描**：扫描 620 个包，命中 8 个包、14 条离线 advisory；本轮报告未展开具体包名和版本，需另行核对

提交前 Hook 曾报告 51 个 High、2 个 Medium。两次数字不同，可能来自扫描范围、扫描版本或缓存差异；不能把本轮 42 项视为全部历史告警。

## 2. 结论摘要

### 2.1 建议优先修复

1. `packages/core/templates/plugins/meta-skills/skills/skill-digester/scripts/find-skill.js:16`：从 `process.cwd()` 优先解析并 `require("gray-matter")`，不可信项目可借依赖解析执行恶意 Node 模块。
2. `packages/memory/src/tdai/core/profile/profile-sync.ts:139-140`：远程 `record.filename` 未做 containment 校验即写入临时目录，存在远程文件名路径穿越/越界写入风险。
3. 构建 vendoring 脚本中将环境变量或上游 release/tag 数据拼入 shell 字符串的路径，至少应改为 argv 调用并校验版本、URL 和路径。
4. `packages/core/src/activity-frames/collectors/git-collector.ts:44`：通用 helper 接收 shell 片段；当前调用链输入受控，但实现应改为 `execFileSync` 参数数组。

### 2.2 当前证据下可直接豁免/降级

下列告警有明确的类型误报、固定输入、设计允许的任意路径或仅来自本地目录枚举，可在扫描器中记录带理由的 suppression：

- 测试文件中的假凭据字符串（见 §3.1）
- SQLite 类型声明被识别为命令执行
- 固定的 `where` / `which` 查找命令
- 注释行被识别为命令执行
- 已进行 shell quoting 且当前调用参数固定的 prompt 辅助函数
- 已校验 Git slug 的 GitMCP 路径告警
- 设计上支持用户指定绝对路径的 skill discovery
- 从本地目录枚举并过滤出的日期/Markdown/JSONL 文件名
- `package-desktop.js` 两项 SSRF 告警
- 旧 Tailwind 字符串生成残留
- 当前只使用固定 Git/npm 参数的 `scripts/version.js`

豁免应绑定到具体 finding、文件和行号，并保留本文的理由；不要用全局规则关闭 `command-injection`、`path-traversal` 或 `credential` 检测。

## 3. 可直接豁免的告警

### 3.1 `settings-and-notify.test.ts` 中的硬编码凭据

提交前扫描列出 `packages/core/src/tests/settings-and-notify.test.ts` 多处“硬编码凭据”。人工查看测试用途后，这些值是设置解析和优先级测试夹具，不来自秘密文件，也没有网络调用或真实凭据用途。

可豁免的典型值包括：

```text
sk-private
sk-test
user-key
project-key
file-key
env-key
user-global
project-global
system-global
```

`API key not found` 也是错误消息夹具，不是凭据。后续可选地把占位符改成更明显的 `test-placeholder-not-a-secret`，但不要为了消除扫描告警而把测试改动混入无关提交。

### 3.2 Core 中的命令注入误报

| 位置                                         | 复核结论                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/core/src/activity-frames/db.ts:50` | `exec(sql: string)` 是 SQLite 类型声明，非 `child_process.exec`；实际执行的是固定 SQL。 |
| `packages/core/src/gitmcp/store.ts:68`       | SQLite 接口类型声明，非 OS 命令执行。                                                   |
| `packages/core/src/common/codegraph.ts:269`  | 只在两个固定字符串 `where node` / `which -a node` 中选择。                              |
| `packages/core/src/common/codegraph.ts:365`  | 命中的是注释，非执行语句；实际版本探测使用参数数组。                                    |
| `packages/core/src/common/crg.ts:118`        | 固定 `where uv` / `which uv` 查找。                                                     |
| `packages/core/src/common/serena-mcp.ts:110` | 固定 `where uv` / `which uv` 查找，输出仅用于可用性判断。                               |
| `packages/core/src/prompt.ts:449`            | 私有 helper 当前仅由固定的 `rg`、`jq` 调用。                                            |
| `packages/core/src/prompt.ts:492`            | command/args 逐 token 做 shell 单引号转义，当前调用参数固定。                           |

这些可按“固定命令/类型声明/注释/已转义参数”分别豁免，避免建立过宽的全局忽略。

### 3.3 Core 与 memory 的路径告警

| 位置                                                                                              | 复核结论                                                                                        |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/core/src/gitmcp/server.ts:104`                                                          | `argv[0]` 先经过严格的 `owner/repo` slug 校验；数据库路径固定在用户配置目录，不是路径穿越。     |
| `packages/core/templates/plugins/meta-skills/skills/skill-digester/scripts/find-skill.js:179,197` | 工具设计上支持显式绝对路径和用户目录；此处只发现/输出匹配，不按该输入写文件。属于设计允许行为。 |
| `packages/core/src/common/serena-mcp.ts:180`                                                      | 路径由配置根目录与固定文件名 `serena_config.yml` 构成。                                         |
| `packages/memory/src/tdai/core/conversation/l0-recorder.ts:346`                                   | 文件名来自目录枚举，并严格匹配 `YYYY-MM-DD.jsonl`。                                             |
| `packages/memory/src/tdai/core/profile/profile-sync.ts:75`                                        | 文件名来自本地目录枚举，只处理 `.md`；不是外部请求参数。                                        |
| `packages/memory/src/tdai/core/record/l1-reader.ts:175`                                           | 文件名来自 `readdir()`；正常会话读取路径还有日期格式过滤。                                      |

`scene-extractor.ts:267` 同样主要使用目录枚举出的 `.md` 文件名，当前不是直接外部输入；但符号链接可能造成越界读取，见 §5。

### 3.4 构建脚本中的明显误报

| 位置                                                    | 复核结论                                                                                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/version.js:44,56`                              | 当前调用为固定的 `git describe ...` 与 `npm install --package-lock-only` 参数；用户版本值不流入子进程。可豁免，但应删除不必要的 `shell: true`。 |
| `scripts/package-desktop.js:138,219`                    | 调用固定的本地 `process.execPath` 和仓库内脚本，使用 `execFileSync`；没有 URL、socket 或网络目的地，不是 SSRF。                                 |
| `packages/desktop/src/renderer/dd/tailwind-script.ts:2` | 扫描命中的是导出的字符串内容；该路径是被忽略的旧生成残留，当前构建使用 generated 文件。不是该行的 OS 命令注入。                                 |
| `scripts/vendor-codegraph.js:155,161,163,169,171,192`   | 当前这些命令的 OS/架构及 staging 路径主要由固定映射和内部生成目录组成，可暂时豁免；仍建议统一改成 argv。                                        |
| `scripts/vendor-browser-skill.js:139`                   | `chmod` 目标由内部 staging 目录和固定二进制名生成，可豁免。                                                                                     |

## 4. 不应直接豁免的命令/下载告警

这些告警大多属于构建期风险，普通桌面用户不能直接触发，但构建环境变量、上游 release 元数据或下载代理一旦被控制，可能变成命令执行或供应链问题。

| 位置                                          | 判断与建议                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `scripts/vendor-browser-skill.js:125,128,130` | `BSK_VERSION` 或上游 `tag_name` 进入 archive 路径并拼入 shell；校验版本语法，改用 argv，补强 checksum。 |
| `scripts/vendor-codegraph.js:183`             | `CODEGRAPH_VERSION` 未校验即进入 `npm install` shell 命令；改用 argv 并校验版本。                       |
| `scripts/vendor-download.js:41`               | 共享 helper 将 URL 和目标路径拼入 shell；优先改为 `execFileSync("curl", args)` 或原生 HTTP。            |
| `scripts/vendor-granite.js:101,139`           | `HF_ENDPOINT`、repo、tag 影响 URL、路径和 shell；解析 URL、限制协议、校验 repo/tag、拒绝路径穿越。      |
| `scripts/vendor-openwiki.js:79`               | `OPENWIKI_VERSION` 未校验即进入 npm shell 命令；改用 argv。                                             |
| `scripts/vendor-uv.js:96,135,137`             | `UV_VERSION` 或上游 tag 进入解压路径和 shell；校验版本、改用 argv、补 checksum。                        |

建议修复顺序：`vendor-download.js` → 各 vendor 版本/URL 校验 → 强制 checksum → 删除不必要的 shell。

## 5. 需要修复的真实路径问题

### 5.1 远程 profile 文件名路径穿越（最高优先级）

**位置：** `packages/memory/src/tdai/core/profile/profile-sync.ts:139-140`

`pullProfilesToLocal()` 直接把远程 `ProfileRecord.filename` 拼入临时目录：

```ts
path.join(tempBlocksDir, record.filename);
```

远程数据或跨租户返回值若能影响 `filename`，`../`、路径分隔符或绝对路径可能使写入目标越出 `tempBlocksDir`。后续临时目录会整体 rename 到 live `scene_blocks`，所以这不是单纯的读取告警。MD5 只验证内容，不验证路径。

**建议：**

- 对不同 profile 类型只允许预期 basename 格式；
- `path.resolve()` 后确认目标仍位于 `tempBlocksDir` 内；
- 拒绝 `..`、路径分隔符、绝对路径和重复文件名；
- 写入前拒绝符号链接/非普通文件；
- 增加恶意 filename 的回归测试。

### 5.2 Scene extractor 符号链接防御（加固项）

**位置：** `packages/memory/src/tdai/core/scene/scene-extractor.ts:267`

文件名来自 `readdir()` 且只筛选 `.md`，当前没有普通用户输入直接进入。但本地攻击者可在 `scene_blocks` 中放置符号链接，使 `readFile` 读取目录外文件。

可增加 `lstat()`、拒绝 symlink、`realpath()` containment 和普通文件检查。当前证据不足以把它认定为远程可利用漏洞。

### 5.3 L1 reader 符号链接防御（加固项）

**位置：** `packages/memory/src/tdai/core/record/l1-reader.ts:175`

文件名来自 `readdir()`，不能由 `../` 直接注入；但 `readAllMemoryRecords()` 对任意 `.jsonl` 目录项的处理可考虑增加 symlink/realpath 防护，并复用更严格的文件名过滤。

## 6. Skill digester 动态依赖加载

**位置：** `packages/core/templates/plugins/meta-skills/skills/skill-digester/scripts/find-skill.js:16`

脚本优先从 `process.cwd()` 解析 `gray-matter`：

```js
for (const base of [process.cwd(), __dirname]) {
  const resolved = require.resolve("gray-matter", { paths: [base] });
  return require(resolved);
}
```

如果当前工作区提供恶意 `node_modules/gray-matter`，`require()` 会执行其顶层代码。该代码不是简单静态字符串解析，而是跨越“项目目录 → 主进程依赖执行”的信任边界。

**建议：** 只从技能自身可信目录解析依赖，或直接固定使用随产品分发的 parser；增加不可信 workspace 依赖的回归测试/文档说明。

## 7. 后续审查清单

- [ ] 审查并修复 `find-skill.js:16` 动态 `require`。
- [ ] 修复 `profile-sync.ts:139-140` 远程 filename containment。
- [ ] 将 `vendor-download.js` 和各 vendor 脚本改为 argv 调用。
- [ ] 对 vendor 版本、repo、tag、URL 做语法/协议/路径校验。
- [ ] 对所有下载 artifact 强制 checksum 或签名校验。
- [ ] 评估 scene extractor 与 L1 reader 的 symlink 防护。
- [ ] 删除 `scripts/version.js` 中不必要的 `shell: true`。
- [ ] 为明确误报建立逐条 suppression，并保留文件、行号、理由。
- [ ] 补充并核对本轮依赖扫描命中的 8 个包/14 条 advisory。
- [ ] 修复后重新运行 Mimosa deep scan；不得将本轮 `inconclusive` 结果当作安全封印。

## 8. 可豁免项总表

以下项目在当前证据下可记录为逐条豁免：

- `packages/core/src/tests/settings-and-notify.test.ts` 的测试 key/token 夹具；
- `packages/core/src/activity-frames/db.ts:50`、`packages/core/src/gitmcp/store.ts:68` 的 SQLite 类型声明；
- `codegraph.ts:269,365`、`crg.ts:118`、`serena-mcp.ts:110` 的固定命令/注释；
- `prompt.ts:449,492` 的固定、已转义命令调用；
- `gitmcp/server.ts:104` 的已校验 slug；
- skill-digester 的显式路径发现行为（`find-skill.js:179,197`）；
- Serena 固定配置路径（`serena-mcp.ts:180`）；
- memory 中由严格目录枚举产生的日期/Markdown/JSONL 文件名；
- `scripts/version.js:44,56` 的固定 Git/npm 调用；
- `scripts/package-desktop.js:138,219` 的本地 Node 脚本调用；
- 旧 Tailwind 字符串残留；
- CodeGraph vendor 固定 OS/架构 staging 命令及 BrowserSkill 固定 staging `chmod`。

**复核结论：** 可以清理/豁免上述误报，但不能以“忽略告警”替代对 §4–§6 所列真实或潜在风险的整改。
