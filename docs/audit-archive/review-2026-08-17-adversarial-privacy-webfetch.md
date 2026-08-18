# 对抗式代码评审报告 — 4b52ae76..9911b194（隐私剔除+自研搜索 / WebFetch）

日期：2026-08-17 · 分支：`feat/sandbox-p0-path-gate` · 对象：两提交
（`1012a0a9` 剔除上游数据链路+自研搜索 · `9911b194` 内置 WebFetch，
35 文件 +1350/−792）· 无 PR（本地评审，同前轮形态）

> **处置：只评审不修复**（项目所有者指示，与前轮一致）。17 个去重候选经
> 独立打分代理按 0–100 置信度评级，**≥80 阻塞线：0 项通过**。75 分档 7 项
> 为已验证的真实问题，建议下批收敛；50 分档 7 项为已验证但低频/纯维护性；
> 其余 3 项低于 50（含 1 项判 0：denylist 绕过系上轮已拍板暂不修复的遗留，
> 本轮重构未改变其语义）。

## 评审管线

5 路并行对抗式评审（AGENTS.md 合规 / diff 浅扫 / git 历史上下文 / 过往评审
教训复用 / 代码注释契约），收敛 17 个去重候选；每项独立打分代理验证并按
标准 rubric 评级。合规面核证通过：core UI-free、零 console、host 注入 seam
形态正确、import/命名/测试约定全部合规、层方向仅 desktop→core。

## 一、75 分档（7 项，已验证真实，建议排期）

| # | 位置 | 问题 |
| --- | --- | --- |
| 1 | `core/tools/web-fetch-provider.ts`（desktop）`:121` | `did-fail-load` 处理器忽略第 5 参 `isMainFrame`：子帧（死 iframe/追踪器）失败先于主帧 `did-finish-load` 到达时，整页被判 "page load failed"——渲染正常的页面被误拒。Electron 文档明确该事件对子帧也触发，初始 HTML 内嵌死 src 的 iframe 很常见 |
| 2 | `core/tools/web-fetch-handler.ts:74` + `desktop .../web-fetch-provider.ts:147` | **SSRF 门只校验初始 URL**：静态路径 `redirect:"follow"`、渲染路径 Chromium 跟随重定向，最终 URL（response.url/getURL）均不复查。公开 URL 302 → `169.254.169.254`/`127.0.0.1` 会被取回正文——与文件头 "on BOTH engine paths"、prompt.ts 工具描述 "private/loopback addresses are rejected" 的承诺矛盾（A1/B3 validate-at-sink 教训类） |
| 3 | `core/tools/web-search-providers.ts:216` + `web-search-handler.ts:62` | **输出帽回归（B7 教训）**：Tavily 分支无 `.slice(0, MAX_HITS)`（Brave 有）；内置路径 `formatWebSearchHits` 无 30k 截断——被删的旧默认路径有显式 B7 帽（"compromised endpoint push an unbounded blob into session history"），新路径丢了；脚本路径的帽子仍在 |
| 4 | `core/common/public-url.ts:66` | **fd/fc 前缀误杀域名**：IPv6 ULA 正则 `/^(fc\|fd\|fe8...)/i` 跑在所有 hostname 上而非仅 IPv6 字面量——`fdroid.org`、`fda.gov`、`fcbayern.com` 被以 "refusing IPv6 ULA" 拒绝。逻辑为 dembrandt 原样转录（预先存在），但本批把它接成了 WebFetch 的共享门，误杀面从"品牌抽取目标"扩到"agent 抓的任何页面"，用户可感知 |
| 5 | `core/common/public-url.ts:48-66` | **IPv4 映射 IPv6 绕过**：`[::ffff:127.0.0.1]`/`[::ffff:10.x]`/`[::ffff:169.254.169.254]`/`[::]` 被 URL 规范化为十六进制后三项检查全漏，net.connect 实证可达环回监听——正是该门要拦的经典 SSRF 形态。同为转录遗留+面扩大 |
| 6 | `templates/plugins/meta-skills/.../deeporca-self-refer/references/configuration.md(_en)` `:34,52,154-161` | **随附技能内残留遥测文档**：剔除提交清理了根 docs/configuration.md，但漏了这两份冻结模板——捆绑技能的用户会读到"匿名上报默认开启 + 关闭方法"，而产品已删除全部上报。既陈旧又引发隐私误警 |
| 7 | `AGENTS.md:148` + `.deeporca/AGENTS.md:9,11` | **指导文件自相矛盾**：本批把 AGENTS.md 两处 7→8，但同文件 :148 仍写 "all **7** built-in handlers"，`.deeporca/AGENTS.md` 仍列 7 个旧工具——指导文档的事实漂移直接误导后续 agent |

## 二、50 分档（7 项，已验证、低频或纯维护性）

8. `web-fetch-provider.ts:147` — `void wc.loadURL()` 丢弃 promise：加载失败/超时 `wc.stop()` 产生未捕获拒绝。打分代理核实 **Electron 主进程对未捕获拒绝是记日志而非崩溃**（区别于 Node CLI 默认 throw），故为日志噪音+卫生项而非崩溃。
9. 超时未覆盖 body 读取（`web-fetch-handler.ts:79` clear-in-finally + `web-search-providers.ts` 三 provider 同型）：headers 到达即清 timer，`response.text()/json()` 无界——headers 后静默卡死可挂起工具。触发需罕见的半开连接场景；WebSearch 半边为预先存在的类（旧代码连 headers 阶段超时都没有）。
10. `settings.ts:20` — `TELEMETRY_ENABLED?: string` 死声明（读者已删，类型残留）。
11. 双源常量：core `MAX_OUTPUT_CHARS=30000` vs desktop `MAX_TEXT_CHARS=30_000`（+timeout/links），仅靠同步编辑维系；截断标记今日就报 core 常量而渲染路径实际帽是 desktop 的（RRF_K 双源类，feasible 修法：core 导出、desktop 引）。
12. 测试夹具凭证形字面量（"bsa-key"/"tvly-key"）vs `f0b7cf90` 夹具去敏约定——但该约定在同一提交内也只窄化应用（同类字面量当时即存留并通过门禁），判风格性。
13. UA 与隐私声明字面冲突：`"the query — and ONLY the query"` / `"no identifiers are attached"` vs 实发 UA 含 `DeepOrca` 产品标识（非机器标识；实质契约成立、字面过强；docs 两处与测试 docblock 同款措辞）。
14. `localhost.` 尾点绕过共享门（实证 `new URL("https://localhost./x").hostname → "localhost."` 过门、DNS 解析回环）——与上轮 denylist 尾点同类同标定（50），需对抗性输入才触发。

## 三、低于 50（3 项，记录在案）

15. `webSearchApiKey` 可存项目级 settings.json——扩大 C5（INFO/产品讨论级）既有模式；与 house style（apiKey 本身同样 project-first）完全一致，判 25。
16. dembrandt denylist 尾点/子域绕过随重构原样携带——**判 0**：上轮已拍板暂不修复的 pre-existing，本批重构未改变其语义（但注意：它与新 public-url 门共用"未归一化"缺陷类，修共享门时应一并处理）。
17. ~~空~~（17 项中另有 3 项 50 分已在二档列示，此处不重复）。

## 结论与排期建议

对抗式管线未发现达 80 分阻塞线的缺陷；**75 分档 7 项建议以一个 `fix(review)`
主题批收敛**，其中四项是十行级修复：#1 isMainFrame 过滤、#3 恢复 30k 帽+Tavily
slice、#4 ULA 正则加 IPv6 字面量前置判断（`: ` 存在才跑）、#6/7 文档清账；#2
（重定向复查）与 #5（映射 IPv6）属同一"归一化+validate-at-sink"主题，建议与
#14/16 合并为一次 public-url 加固（尾点 strip、mapped-IPv6 解包、重定向后复查）。
全部发现按指示**未做任何修复**。
