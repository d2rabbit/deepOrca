# content-translation 任务清单 — M0 钉死风险 → M1 下载器与服务 + Apple 引擎 → M2 Argos 兜底 → M3 renderer 接入

> 日期：2026-08-28 · 状态：**规划（待启动）**
> 依据：[design.md](./design.md)（分发形态 §0/§4 / 引擎链 §3 / Apple helper §5 / Argos §6 / IPC §7 / 分段 §9 / 接入点 §10）
> 前置：无硬前置；M0 的 Argos 闭包实测与 Releases 管线可达性决定 M1/M2 走法，建议先行。
> **分发口径：引擎不入安装器**——wheel 闭包、语言模型、macOS helper 全部发布到 GitHub Releases，
> 首次使用按需下载到 `userData/translate-engine/`；安装器与 `vendor/` 零新增（`vendor/uv` 复用）。

## 实施口径

- **分层铁律**：全部实现在 `packages/desktop`（main 为主，core 零改动、i18n 现有键零改动）。
- **方向与语言**：仅 zh-Hans ↔ en；源语言 CJK 占比启发式（≥30% → zh）；`ja/ko` locale 下按钮禁用。
- **铁律**：fail-open——引擎未下载/任何失败返回明确状态 + 原文，绝不阻塞四个展示点；
  不产生 `*.zh.md` 变体文件。
- **下载安全（验收条件）**：仅 http/https；host 白名单 + 解析 IP 拒绝 localhost/环回/私有/
  保留地址（重定向逐跳复检）；sha256 端到端校验；`.staging/` 原子落盘，中断不污染已装组件。
- **许可**：Argos（MIT/CC0）与语言包按官方再分发条款归档 NOTICE（随 Releases 产物分发时
  在包内附带）；helper 与入口脚本自研。

## M0 风险钉死（设计开放问题 → 实测数据）

- [ ] M0-1 Argos 依赖闭包实测：`pip download` 枚举 wheel 清单（win/mac/linux × x64/arm64）、
  总体积（决定分包与下载提示文案）、Python 3.12 兼容矩阵；stanza 离线行为验证（禁用 env /
  内置分句回退）；结论回填 design.md §13.1，不达标则评估 transformers.js ONNX 备选
- [ ] M0-2 Argos en↔zh 质量评测：wiki 页 + 插件 README 各 5 篇人工对比；不达预期则
  在 M2 前决定引擎替换或标注"试验性"上线
- [ ] M0-3 Apple helper 最小验证：验证 `TranslationSession.init(installedSource:target:)`
  在 macOS 15 的无 UI 翻译 + `LanguageAvailability` 三态输出 + Intel/ARM universal2 编译通过
- [ ] M0-4 Releases 分发管线打通：CI 打包 job（macOS 出 helper、Linux 出引擎包×6）、产物
  上传、sha256 回填 manifest 流程；CN 网络下 Releases 可达性 + 代理回退域实测

## M1 下载器 + main 服务骨架 + Apple 引擎

- [ ] M1-1 `main/translate/engine-manifest.ts`：版本 + sha256 + 主源/回退域白名单
  （随发版更新）；组件化（引擎包 / 模型包 / helper 分离，升级互不重下）
- [ ] M1-2 `main/translate/downloader.ts`：https + host 白名单 + 解析 IP 拒绝
  localhost/环回/私有/保留地址（重定向逐跳复检，沿 web-fetch-provider 先例）；sha256 校验；
  `.staging/` 原子换名 + `manifest.json` 写入；按字节进度回调；串行任务、幂等 `prepare`、
  失败重试一次；单测覆盖 URL 拒绝矩阵与校验失败路径
- [ ] M1-3 `shared/ipc.ts`：`IpcRequest.TranslateStatus/TranslatePrepare/TranslateText`
  常量 + 契约类型 + `DesktopApi` 方法；`IpcEvent.TranslateProgress`；`preload/index.ts`
  三行 invoke + 事件订阅包装（照 EndpointQuota 四步）
- [ ] M1-4 `main/translate/types.ts` + `engine-chain.ts`：引擎接口、平台判定
  （`os.release()` ≥ 24 → macOS 15+）、artifact 就绪检查、链解析（apple → argos →
  need-download/原文）；单测覆盖三平台 × 已下载/未下载矩阵
- [ ] M1-5 `native/translate-helper/main.swift`：`check`（JSON 三态）/ `translate`
  （stdin→stdout，~512 字符分块、并发 ≤4 保序、缺语言包退出码 3）；自研实现（参考 trn
  行为，零代码继承）
- [ ] M1-6 `scripts/package-translate-helper.js`：swiftc universal2 编译 + zip +
  sha256 回填（release CI 用，非 macOS job 跳过）
- [ ] M1-7 `main/translate/apple-helper.ts`：spawn（helper 来自 userData 下载目录）、
  JSON/退出码映射、超时
- [ ] M1-8 `main/translate/cache.ts` + `service.ts` + `register-translate-ipc.ts`：
  LRU（sha1 key，200 条）、串行队列、256KB 上限、30s/120s 超时、取消（下载不随请求取消）；
  `main/index.ts` 装配
- [ ] M1-9 `main/translate/markdown-segments.ts`：分段/还原纯函数（frontmatter、fenced
  code、inline code、URL、HTML、图片不译；表格保结构、链接只译 label）；全分支单测

## M2 Argos 兜底引擎（全平台离线兜底，Releases 分发）

- [ ] M2-1 `scripts/package-translate-engine.js`：wheel 闭包 + `translate-en_zh`/
  `translate-zh_en` 官方索引下载（打包时固化 sha256）→ 平台引擎包/模型包 zip 上传
  Releases（vendor-serena 的 wheel 校验逻辑移植到 CI）；NOTICE 归档进包
- [ ] M2-2 `translate_entry.py`（随引擎包分发）：JSONL stdin/stdout、语言包
  `install_from_path` 到 userData 数据目录、禁网 env、句切分（≤150 token）
- [ ] M2-3 `main/translate/argos-engine.ts`：复用安装器 `vendor/uv`，`uv tool run` 指向
  userData 引擎目录**纯离线安装**后执行；JSONL 协议、批量与超时；组件未下载 →
  `need-download` 状态
- [ ] M2-4 冒烟测试脚本：下载后的 userData 目录断网跑通 en→zh / zh→en 各 1 篇
  markdown 全文；断网首次使用路径提示文案核验

## M3 renderer 接入 + 设置（收口四个展示点）

- [ ] M3-1 `useContentTranslation()` hook + `<TranslateButton>`（状态机：待翻译/翻译中/
  下载中 x%/已译/失败/引擎未下载/仅中英禁用），未下载时自动 `translate:prepare` 并订阅进度
- [ ] M3-2 接入点 ①wiki：`KnowledgePanel.tsx` wiki 阅读面译文走 `StreamdownView`
- [ ] M3-3 接入点 ②插件/skill 详情：`PluginDetail.tsx` 文档正文翻译
- [ ] M3-4 接入点 ③④：`PluginMcpPanel.tsx` 第三方 MCP 工具描述、skill 卡片描述
  （短文本同样走缓存，过短文本跳过）
- [ ] M3-5 设置：`EditableSettings` 增 `translation.enabled`（默认开）；
  SettingsPanel appearance tab 界面语言旁新增 section（总开关 + 引擎徽标 + 系统语言包
  三态引导 + 组件下载状态/磁盘占用/下载·移除操作 + "试验性"标注）
- [ ] M3-6 i18n 新增键补齐 `messages.ts` + `zh/zh-tw/zh-hk/ja/ko` 五 locale（现有键零改动）
- [ ] M3-7 端到端验收：按 design.md §14 清单逐项核验（含全新未下载、断网、语言包未装、
  Argos 未就绪、下载中断/校验失败、移除重下六种场景）；`npm run check && npm test` 全绿
