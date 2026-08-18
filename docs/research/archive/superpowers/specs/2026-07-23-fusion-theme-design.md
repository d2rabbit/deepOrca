# Fusion 主题设计

**日期**: 2026-07-23
**状态**: 已确认，待实现
**目标平台**: Windows（win32）

## 一、概述

为桌面应用（`packages/desktop`）新增第 4 个主题 **`fusion`**，融合 **Win8 磁贴的多彩感** 与 **Win11 的玻璃呼吸感 + 磁铁按钮质感**，提升 Windows 平台的视觉多彩度与"活着"的呼吸感。

**铁律：纯新增，不改动任何现有主题。** 现有的 `aqua` / `metro` / `glass` 三个主题的 CSS 文件、默认值、切换逻辑一字不改。

## 二、设计决策（来自 brainstorming）

| # | 决策 | 说明 |
|---|---|---|
| 1 | **结构：一个融合新主题** | 不是两个独立主题，也不是替换 metro。是第 4 个可选项 `fusion`。 |
| 2 | **玻璃质感 + 呼吸感强度** | 已在 mockup 中定稿：边缘高光、内阴影、`blur(28px) saturate(1.5)`、多色径向背景透出玻璃。 |
| 3 | **配色：融合混搭（C 方案）** | 主蓝 `#1f6fc7` + 青 `#0099bc` + 紫 `#7b61ff` + 绿 `#3e8e3e` + 橙 `#f0a30a` + 红 `#e81123`/品红 `#e3008c`。 |
| 4 | **玻璃呼吸色** | 玻璃卡片背景色在 蓝→青→紫 间 8s 周期缓慢流转，不同卡片错峰 delay，辉光同步呼吸。 |
| 5 | **磁铁按钮** | 三态物理模拟：默认（渐变凸面+顶光+厚度暗角+外影）/ 悬停（浮起+辉光）/ 按下（下沉+内凹）。`cubic-bezier(.2,.8,.2,1)`。 |
| 6 | **平台主题映射** | 主题是平台相关的。Windows 只有 `metro` + `fusion`；mac 是 `aqua` + `glass`；linux 是 `glass`。 |
| 7 | **切换 UI：设置面板的"常规"Tab** | 主题选择放进 `SettingsPanel` 的 language Tab，并把该 Tab 改名为"常规"（General），里面同时管语言和主题。 |

## 三、平台主题映射

新增一个平台感知的辅助逻辑。主题不再对全部平台开放：

| 平台 | 可选主题 | 默认（不变） |
|---|---|---|
| `win32` | `metro`, `fusion` | `metro` |
| `darwin` | `aqua`, `glass` | `aqua` |
| `linux` | `glass` | `glass` |

**不改动** `defaultTheme()` / `baseTheme()` —— 各平台默认值保持现状，不影响现有用户。

## 四、三大视觉特征

### A. 玻璃呼吸色（核心特征）
- 玻璃卡片（消息气泡、TopBar、侧栏、输入框、模态）**不是中性灰**，而是半透明的彩色玻璃。
- 背景色在 `蓝 #1f6fc7 → 青 #0099bc → 紫 #7b61ff` 之间以 **8 秒为周期**缓慢流转。
- 不同卡片带不同 `animation-delay`（如 `-2s`、`-4s`），形成**错峰、此起彼伏**的呼吸，而非整齐划一地闪。
- 外发光（`box-shadow`）同步呼吸——色浓时辉光增强。
- `backdrop-filter: blur(28px) saturate(1.5)`，配合页面底层多色径向渐变背景，玻璃质感才"看得见"。

### B. 多彩磁贴点缀
- 状态徽章（model / tokens）、工具标签（read/write/bash）、图标磁贴用 C 方案的饱和纯色。
- 每个磁贴带 `inset 0 1px 0 rgba(255,255,255,0.2)`（顶部受光高光）+ 外投影，打破单一蓝调。

### C. 磁铁按钮
按钮三态物理模拟，全部用 `cubic-bezier(.2,.8,.2,1)` 过渡（约 120ms）：

| 态 | 视觉 | 实现 |
|---|---|---|
| 默认 | 受光凸面，有厚度，悬浮离地 | 顶→底线性渐变 + `inset 顶部高光` + `inset 底部内阴影`（厚度暗角）+ 外投影 |
| 悬停 | 磁力吸引浮起，辉光增强 | `translateY(-1px)` + `filter: brightness(1.1)` + 外辉光 `0 0 18px accent` |
| 按下 | 磁力吸附下沉，被压扁 | `translateY(1px)` + `filter: brightness(0.92)` + 顶部变 `inset 内凹阴影` |

次级按钮用半透明玻璃底（`magnet-ghost`），同样有厚度和按压物理感。

## 五、配色规格

### 原子色板（fusion 专用变量，定义在 styles-fusion.css 内）
```
--fusion-primary:  #1f6fc7   /* 主蓝（磁贴沉稳蓝，白字可读）*/
--fusion-info:     #0099bc   /* 青 */
--fusion-accent:   #7b61ff   /* 紫（Win11 Fluent 标志色）*/
--fusion-success:  #3e8e3e   /* 绿 */
--fusion-warning:  #f0a30a   /* 橙 */
--fusion-danger:   #e81123   /* 红 */
--fusion-magenta:  #e3008c   /* 品红（tokens 徽章等）*/
--fusion-bg:       #161618   /* 基底（比 metro #1d1d1d 更深，让玻璃更通透）*/
```

### `--ui-*` token 绑定（深色，默认）
绑定现有语义 token 词汇表（与 metro/glass 同构），让 `ui.css` 结构层零改动：
```
--ui-bg:             var(--fusion-bg)
--ui-surface:        rgba(43,45,52,0.45)        /* 玻璃卡片底 */
--ui-surface-raised: rgba(255,255,255,0.08)
--ui-text:           #ffffff
--ui-text-dim:       #c7c7c7
--ui-text-on-accent: #ffffff
--ui-accent:         var(--fusion-primary)
--ui-accent-soft:    rgba(31,111,199,0.24)
--ui-focus-ring:     var(--fusion-primary)
--ui-border:         rgba(255,255,255,0.14)
--ui-success/danger/warning/info: 对应原子色
```

### 浅色变体（`:root[data-appearance="light"]`）
- `--fusion-bg: #f3f3f3`
- `--ui-surface: rgba(255,255,255,0.6)`（玻璃在浅底上半透明）
- `--ui-text: #1b1b1b`，`--ui-border: rgba(0,0,0,0.14)`
- accent 色保持不变（多彩感在浅色下也要体现）

## 六、CSS 动效规格

全部动画用 `ease-in-out`，且必须包裹在 `@media (prefers-reduced-motion: no-preference)` 内（尊重无障碍）：

```css
/* 玻璃背景色流转 */
@keyframes fusion-glass-hue {
  0%   { background-color: rgba(31,111,199,0.10); }
  33%  { background-color: rgba(0,153,188,0.12); }
  66%  { background-color: rgba(123,97,255,0.11); }
  100% { background-color: rgba(31,111,199,0.10); }
}
/* 玻璃辉光呼吸 */
@keyframes fusion-glass-glow {
  0%,100% { box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.3), 0 8px 32px rgba(0,0,0,0.4); }
  50%     { box-shadow: inset 0 1px 0 rgba(255,255,255,0.20), inset 0 -1px 0 rgba(0,0,0,0.3), 0 0 28px 2px rgba(0,188,242,0.18); }
}
/* 磁贴 shimmer */
@keyframes fusion-accent-shimmer {
  0%,100% { filter: brightness(1); }
  50%     { filter: brightness(1.15) saturate(1.2); }
}
```

## 七、涉及文件（只增不改 / 仅扩展）

| 操作 | 文件 | 改动 |
|---|---|---|
| **新增** | `packages/desktop/src/renderer/styles-fusion.css` | 新主题样式（约 300 行，镜像 styles-metro.css 结构 + fusion 特有的动效/磁铁按钮章节） |
| **扩展** | `packages/desktop/src/renderer/lib/appearance.ts` | ① `Theme` 类型加 `"fusion"`；② `THEME_STYLESHEETS` 加 `fusion → ./styles-fusion.css`；③ `getStoredTheme` 校验白名单加 `"fusion"`；④ **新增** `availableThemes(platform): Theme[]`（win32→[metro,fusion]，darwin→[aqua,glass]，linux→[glass]） |
| **扩展** | `packages/desktop/src/renderer/components/SettingsPanel.tsx` | ① language Tab 改名"常规"（改 `labelKey`/标题文案）；② 在该 Tab 内新增主题选择区（radio/segmented，选项来自 `availableThemes(platform)`），选 fusion 调 `setTheme` |
| **扩展** | `packages/desktop/src/renderer/i18n/messages.ts` + 4 locale（`locales/ja.ts, ko.ts, zh-hk.ts, zh-tw.ts`） | ① `settings.language` 值改"常规"/"General"；② 新增 `settings.theme`（"主题"/"Theme"）、`theme.metro`（"Metro（原生）"）、`theme.fusion`（"Fusion（磁贴·玻璃）"） |

### 明确不动的东西
- `defaultTheme()` / `baseTheme()` —— 各平台默认值不变。
- `styles-metro.css` / `styles-glass.css` / `styles.css` —— 现有三主题文件一字不改。
- `ui.css` —— 结构层不动，fusion 通过绑定 `--ui-*` 复用。
- `App.tsx` 现有 ❖ rail 按钮（mac/linux 的 glass toggle）—— 不动；Windows 上该按钮保持隐藏（`platform !== "win32"`），Windows 用户走设置面板。

## 八、主题切换交互（设置面板"常规"Tab）

1. 用户点左侧 Rail 的 ⚙ 打开设置面板。
2. 选"常规"Tab（原 language Tab），看到语言选择 + **新增的主题选择区**。
3. 主题选择用 segmented/radio 控件，选项由 `availableThemes(platform)` 决定：
   - Windows 显示：Metro（原生） / Fusion（磁贴·玻璃）
   - mac 显示：Aqua（原生） / Glass（毛玻璃）
4. 选中即调 `setTheme(theme)`（已存在，会同时换 stylesheet link + 持久化到 localStorage），无需新增持久化逻辑。
5. 明暗（light/dark）切换仍走现有 rail 按钮，本次不迁移。

## 九、验收标准

- [ ] Windows 上打开设置 → 常规 Tab，能看到 Metro / Fusion 两个主题选项。
- [ ] 选 Fusion，应用立即变为玻璃呼吸色 + 多彩磁贴 + 磁铁按钮观感，无刷新。
- [ ] 选 Metro，完全回到原样（现有 metro 文件未被改动）。
- [ ] 切到浅色外观，Fusion 玻璃在浅底上仍可辨识，多彩感保留。
- [ ] 浏览器/devtools 关闭"动画"（reduced-motion）后，所有呼吸/shimmer 动效停止，静态观感仍正常可用。
- [ ] `npm run typecheck` 通过（`Theme` 类型扩展不破坏现有引用）。
- [ ] `npm run check` 通过。
- [ ] 现有 metro/glass/aqua 三个主题切换行为完全不变。

## 十、风险与边界

- **风险 1：`backdrop-filter` 兼容性**。Electron 用 Chromium，`backdrop-filter` 完全支持，无风险。但 dev 环境若关硬件加速可能无模糊——可接受降级（半透明色仍在）。
- **风险 2：动效性能**。多个卡片同时跑 `backdrop-filter` + 背景色动画可能耗 GPU。缓解：流转周期 8s 足够慢；仅 surface 类元素参与；reduced-motion 时关闭。
- **风险 3：磁铁按钮 `transform` 与现有布局**。`translateY` 是视觉变换不触发布局，安全。磁铁按钮通过 `styles-fusion.css` 里的 CSS 选择器（定位现有按钮的 class/元素，如 `.ui-btn`、`button` 等）覆盖 `background-image`/`box-shadow`/`transition` 实现，**不新增组件、不改组件 props、不加 `.fusion-*` 类到 JSX**——仅靠"当前加载的是 fusion 样式表"这一事实生效（与 metro/glass 覆盖 `.ui-btn` 的方式一致）。实现前需先读 `ui/inputs.tsx` 确认按钮的实际 class 名。
- **不在本次范围**：运行时 accent 色拾色器、主题市场/导入、mac/linux 新增 Windows 风格主题。
