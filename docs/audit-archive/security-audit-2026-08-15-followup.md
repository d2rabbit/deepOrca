# 全域代码分析与安全整改跟进报告 — 2026-08-15

> 前置：[security-audit-2026-08-12.md](security-audit-2026-08-12.md)（Mimosa 深度扫描 + 人工复核）
> 本文记录对其 §2.1/§4/§5/§6/§7 整改清单的执行结果，外加本轮全域自查的新发现。
> 验证：全仓测试首次全绿（core 412 / desktop 149 / memory 14 / embedding 10）；`npm run check` 0 error。

## 一、2026-08-12 审计清单执行结果

| 审计项                                                                                | 处置      | 说明                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §6 `find-skill.js:16` cwd 优先解析 `gray-matter`（不可信工作区可执行恶意模块）        | ✅ 已修   | 只从技能自身目录解析；缺依赖时回落本地极简解析器                                                                                                                                                                     |
| §5.1 `profile-sync.ts` 远程 filename 路径穿越（写入会被 rename 进 live scene_blocks） | ✅ 已修   | `safeBlockFilename`：仅接受纯 basename（拒绝 `..`/分隔符/反斜杠/绝对路径/重复名）+ `path.resolve` containment；恶意文件名跳过并记日志；**+2 回归测试**（穿越/绝对路径/分隔符/重复名/空名全部拒写，哨兵文件未被创建） |
| §2.1 `git-collector.ts` shell 片段 helper                                             | ✅ 已修   | `execSync("git " + args)` → `execFileSync("git", argv[])`，全部调用点改参数数组                                                                                                                                      |
| §4 `vendor-download.js` URL/路径入 shell                                              | ✅ 已修   | `execFileSync("curl", argv)` + **强制 https**（非 https URL 拒绝下载）；新增共享 `assertSafeVersion()`                                                                                                               |
| §4 openwiki `OPENWIKI_VERSION` 入 npm shell                                           | ✅ 已修   | 版本校验（`^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$`）+ `npm install` argv 化                                                                                                                                              |
| §4 uv：`UV_VERSION`/上游 tag 入 tar 路径与 shell                                      | ✅ 已修   | env 版本与 GitHub tag 均过 `assertSafeVersion`；tar/powershell 全部 argv 化                                                                                                                                          |
| §4 browser-skill：`BSK_VERSION`/tag 入 shell                                          | ✅ 已修   | 同上（含 `chmod` argv 化）                                                                                                                                                                                           |
| §4 granite：`HF_ENDPOINT`/repo/tag 影响 URL 与 shell                                  | ✅ 已修   | `HF_ENDPOINT` 仅接受 https origin（拒绝 userinfo/路径）；`GRANITE_MODEL_TAG` 语法校验；curl argv 化                                                                                                                  |
| §4 codegraph vendor 版本入 npm shell                                                  | ⛔ 过期   | `vendor-codegraph.js` 已随 0d25064a（npm 路径统一）删除，告警对象不存在                                                                                                                                              |
| §3.4 `scripts/version.js` 不必要 `shell: true`                                        | ✅ 已移除 | 两处（args 本就是数组）                                                                                                                                                                                              |
| §5.2 scene-extractor symlink 防御                                                     | ✅ 已加固 | 读取前 `lstat` 拒绝非普通文件                                                                                                                                                                                        |
| §5.3 l1-reader symlink 防御                                                           | ✅ 已加固 | 同上（`isRegularFile` 守卫）                                                                                                                                                                                         |
| §4 下载 artifact 强制 checksum                                                        | ⏸ 未做    | 需上游发布 checksum 清单，单独立项（见"遗留"）                                                                                                                                                                       |
| §7 依赖 advisory 核对（8 包/14 条）                                                   | ⏸ 未做    | 需 `npm audit` + 逐条核对，单独立项                                                                                                                                                                                  |

### 附带加固（审计豁免项的顺手收紧）

- `prompt.ts` 三处 POSIX shell helper（`command -v`/版本探测/`uname`）：从"固定输入 + 字符串 shell"收紧为 `execFileSync(shell, ["-c", quoted])`——与 win32 分支同构，`execSync` 在 core 内清零。

## 二、本轮全域自查新发现与处置

| #   | 发现                                                                                                                                                                                               | 处置                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | **ipc-security 5 个存量失败**：测试硬编码 `D:\others\deepOrca\...` Windows 路径并手工拼 URL，POSIX 上 `pathToFileURL` 对反斜杠编码不一致 → 安全边界测试套件在非 Windows 全红数月（安全网形同虚设） | ✅ 已修：`PROD_URL` 改由 `pathToFileURL` 派生（与 policy 同一变换）；"Windows 路径匹配"用例改为跨平台的编码 round-trip 不变量测试（含空格路径）。**26/26 全绿**——该测试文件恢复为可信安全网 |
| N2  | 全仓 `shell: true` 残留仅 3 处：mcp/spawn-spec.ts（Windows PATHEXT 解析，带注释的设计决策）、其测试、scripts/build.js（待后续）                                                                    | 记录，不紧急                                                                                                                                                                                |
| N3  | editor 读写路径                                                                                                                                                                                    | 核查通过：`safePath` containment + 独立测试覆盖                                                                                                                                             |

## 三、验证

- `npm run check`：0 error（12 个警告全部为存量：未用变量/既有 hook 依赖豁免）。
- 测试：core 412（411 pass + 1 环境 skip）、**desktop 149/149（历史首次全绿）**、memory 14/14（+2 安全回归）、embedding 10/10。
- 所有改动的 vendor 脚本过 `node --check` 语法校验。

## 四、遗留（按优先级）

1. **下载 checksum 强制**：vendor 下载链路补 checksum/签名校验（需上游发布清单）。
2. **依赖 advisory 核对**：`npm audit` 逐条核对 2026-08-12 报告提到的 8 包/14 条离线 advisory。
3. `scripts/build.js` 的 `shell: true` 评估移除。
4. 审计 §8 建议的逐条 suppression 机制（绑定 finding/文件/行号），避免全局忽略。
5. 修复后重跑 Mimosa deep scan 复核（不得将本轮结论当作长期封印）。
