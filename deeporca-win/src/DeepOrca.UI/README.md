# DeepOrca.UI（WinUI 3 三栏壳）— M9 占位

按 `specs/win-native-migration/design.md` §四：本目录承载 WinUI 3（Windows App SDK 2.x）
三栏壳（会话侧栏 / 对话流 / Inspector）+ WebView2 宿主（A2UI / 审查报告 / markdown）。

- csproj 自 **M9**（或引擎里程碑完成后）在 Windows 环境创建并加入 `DeepOrca.sln`——
  WinUI 3 工程无法在非 Windows 主机构建，本机（macOS）骨架阶段仅保留目录占位。
- 决策点 **D1**：M9 前若 WinAppSDK 2.x 出现阻塞性缺陷（渲染/打包/分发）→ 切 Avalonia
  （B 计划），引擎层（DeepOrca.Core）零改动。
- UI 事件一律经 `DispatcherQueue` 封送回 UI 线程；引擎事件经 Channel 批量泵
  （design §五 ObservableObject 行）。
