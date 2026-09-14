# 内容→视频动态讲解（content-to-video）— 任务清单

> 对应设计：[design.md](./design.md)。2026-09-14 立稿，方案稿（未开工）。
> 上游调研：[docs/research/2026-09-14-tmem-hyperframes-prestudy.md](../../../docs/research/2026-09-14-tmem-hyperframes-prestudy.md) §3；管线方法论参照 [2026-09-11-code2video-remotion-prestudy.md](../../../docs/research/2026-09-11-code2video-remotion-prestudy.md)。
> 红线：不新增内置工具/MCP/IPC，主进程零新依赖（agent 经 bash 跑 CLI）；**用户显式触发，不自动生成**；动画限 CSS + GSAP 白名单；brief 经用户确认才生成；lint 不过不渲染；上游 LFS 基线（240MB mp4）绝不进安装器。

## P0 技能先行（在线 `npx` 流程）

- [ ] **P0.1** bundled skill `content-to-video`（router）：能力图 + 意图确认（时长/画幅/语气/素材清单）+ 路由到 explainer 工作流（SKILL.md + YAML frontmatter，随既有技能发现分发）
- [ ] **P0.2** bundled skill `video-explainer`（主工作流，源自上游 `/faceless-explainer` 改写）：三类输入（会话选区/文档片段/PR diff）→ brief 固定结构 → 用户确认 → 分镜 → HTML 合成 → lint → preview → render；内置 2–3 个场景模板（标题卡/要点列表/对比图示）
- [ ] **P0.3** bundled skill `video-hf-core`：合成契约（`data-*` 时间属性 / clip / tracks / 子合成 / 确定性规则）+ CSS+GSAP 白名单声明
- [ ] **P0.4** bundled skill `video-hf-cli`：`init/lint/check/preview/render` 命令纪律（非交互默认；产物落 `<workspace>/.deeporca/outputs/video/`）
- [ ] **P0.5** 内置 `frame.md` 风格基线：本仓设计 token 反转为镜头用规范（色板/字体/间距），对齐 vendor design-md 同族体系
- [ ] **P0.6** 验收走查：真实会话总结 → 30–60s 讲解视频成片；G1 lint 门拦截坏合成复现一次；产物通道与 reveal 降级路径走通；走查记录归档本目录

## P1 vendor 化（离线渲染）

- [ ] **P1.1** `scripts/vendor-hyperframes.js`：npm 精确 pin 装 `packages/desktop/vendor/hyperframes`（照 vendor-dembrandt 模式；只取运行时，LFS 基线排除）
- [ ] **P1.2** FFmpeg + chrome-headless-shell 静态二进制 vendor（照 vendor-download 下载模式，按平台 pinned + digest 复核）
- [ ] **P1.3** core seam + desktop `main/index.ts` 注入：vendor root 走 `configure*` 接缝（照 `configureDembrandtVendorRoot` 先例；core 仅存 seam 零实现）
- [ ] **P1.4** 技能命令改指注入的 vendor 路径；断网端到端渲染验证
- [ ] **P1.5** `electron-builder.yml` extraResources 增量 + **体积评审硬前置**（~230MB 增量 vs Granite 118MB 先例；不过则维持 P0 在线形态交付）；vendor pin 升级流程写入脚本头注

## P2 程序化（可选，不排期）

- [ ] **P2.1** `@hyperframes/producer` 受控子进程封装（仍不进主进程依赖）+ 后台任务徽标/进度/取消（复用既有 background-task 体系；i18n 键 ×6 locale）
- [ ] **P2.2** `@hyperframes/studio`/`player` 嵌入 renderer 做合成预览评估（ spike 结论落本目录，不直接实施）
