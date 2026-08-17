# UI 风格目录 — DeepDesign 设计风格提示词

> 来源：[NameThatUI/styles](https://namethatui.com/styles)（14 个 UI 设计风格 + Agent 提示词）
> 用途：DeepDesign 生成 HTML 时，根据用户描述的风格选择对应提示词。每个提示词包含定义信号、CSS 值、颜色指南、排版指令和无障碍约束。
> 搭配使用：推荐配合 Tailwind CSS CDN（`<script src="https://cdn.tailwindcss.com"></script>`）实现，utility classes 比手写 CSS 更一致。

---

## 风格选择速查

| 用户可能说的词 | 对应风格 |
|---------------|----------|
| "逼真材质"、"仿真"、"皮革/木纹" | Skeuomorphism |
| "柔和"、"软 UI"、"从背景挤出" | Neumorphism |
| "磨砂玻璃"、"毛玻璃"、"半透明卡片" | Glassmorphism |
| "Apple 新设计"、"水滴"、"液态玻璃" | Liquid Glass |
| "原始 HTML"、"极简到丑"、"无样式" | Web Brutalism |
| "黑边亮色"、"硬阴影"、"涂鸦风" | Neobrutalism |
| "千禧年"、"铬色"、"Y2K"、"赛博泡泡" | Y2K Digital |
| "Frutiger Aero"、"水滴草地"、"Windows Vista 自然" | Frutiger Aero |
| "扁平化"、"无阴影"、"Material" | Flat Design |
| "极简主义"、"大量留白"、"几乎空白" | Minimalism |
| "橡皮泥"、"黏土"、"蓬松 3D" | Claymorphism |
| "复古网页"、"GeoCities"、"90 年代" | Vernacular Web |
| "Mac OS X 经典"、"蓝糖果按钮"、"Aqua" | Aqua |
| "Windows 7"、"透明窗框"、"毛玻璃边框" | Windows Aero |

---

## 1. Skeuomorphism（拟物化）

> "看起来像真皮笔记本"

**提示词**：
> Create the surface using skeuomorphism. Defining signals: controls rendered as simulated physical materials (e.g. leather, paper, brushed metal) with visible texture; a consistent lighting model — gloss highlights on raised elements, inner shadows on recessed fields; real-object metaphors for whole surfaces (a notepad drawn as ruled paper); crafted physical details like stitching or embossed text. Keep the specific material palette and density flexible. Use layered gradients with specular highlights, inset box-shadows for recessed fields, and subtle texture images or noise. Do not drift into neumorphism: the decisive difference is that skeuomorphic surfaces imitate real nameable materials, not one uniform soft-extruded surface. Preserve readable text contrast on textured backgrounds, visible controls and focus states, and reduced-motion support.

**CSS 关键值**：layered gradients + specular highlights, inset box-shadows, texture/noise
**Tailwind 实现思路**：`bg-gradient-to-b from-amber-800 to-amber-950 shadow-inner` + texture via inline background-image

---

## 2. Neumorphism（新拟物化 / Soft UI）

> "从背景里挤出的软按钮"

**提示词**：
> Create the surface using neumorphism (Soft UI). Defining signals: controls share the background's exact matte color; raised elements get dual soft shadows (light top-left, dark bottom-right); pressed/input states invert the shadows inward (inset); no borders anywhere; generous rounded corners. Keep the base hue flexible (classically a pale grey-blue like #e0e5ec) and allow one saturated accent for the primary action. Use CSS box-shadow pairs, e.g. raised: box-shadow: -6px -6px 12px rgba(255,255,255,.85), 6px 6px 12px rgba(163,177,198,.6); pressed: the same pair with inset. Do not drift into skeuomorphism; the decisive difference is that neumorphic surfaces are one uniform material-less matte — no textures, gloss, or imitated materials. Preserve readable text contrast, a visible non-shadow cue for focus and states (WCAG non-text contrast will fail on shadows alone), and reduced-motion support.

**CSS 关键值**：`box-shadow: -6px -6px 12px rgba(255,255,255,.85), 6px 6px 12px rgba(163,177,198,.6)`（凸起）; 同值 `inset`（按下）
**Tailwind 实现思路**：`shadow-[(-6px_-6px_12px_rgba(255,255,255,0.85)),(6px_6px_12px_rgba(163,177,198,0.6))] rounded-2xl bg-[#e0e5ec]`

---

## 3. Glassmorphism（玻璃拟物化）

> "彩色壁纸上的磨砂卡片"

**提示词**：
> Create the surface using glassmorphism. Defining signals: semi-transparent panels with a strong backdrop blur; a vivid gradient or photographic backdrop whose color bleeds through every panel; a thin 1px semi-transparent white border on each panel edge; layered floating depth with soft wide shadows. Keep the backdrop's specific colors and imagery flexible. Use CSS backdrop-filter: blur(16px) with background: rgba(255,255,255,0.12) (or a dark equivalent) and border: 1px solid rgba(255,255,255,0.25). Do not drift into Apple's Liquid Glass; the decisive difference is that glassmorphism is a decorative skin for any surface including content cards, while Liquid Glass reserves glass for the floating control layer above content. Preserve readable text over every region the backdrop can produce (add a contrast scrim if needed), visible controls and focus states, and reduced-motion/reduced-transparency fallbacks.

**CSS 关键值**：`backdrop-filter: blur(16px); background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.25)`
**Tailwind 实现思路**：`backdrop-blur-xl bg-white/10 border border-white/25 shadow-2xl`

---

## 4. Liquid Glass（液态玻璃 — Apple 2025）

> "Apple 新设计，按钮像水滴"

**提示词**：
> Create the surface in the spirit of Apple's Liquid Glass. Defining signals: glass is reserved for the floating control layer — toolbars, tab bars, sheets, and buttons — that floats above opaque content; the material lenses and tints whatever sits behind it, so controls adapt their tint to stay legible; capsule shapes with concentric corner radii; specular edge highlights that read as a real glass surface catching light. Keep the underlying app's palette and imagery flexible. Use the real SwiftUI APIs on Apple platforms (.glassEffect()); on the web, approximate with backdrop-filter: blur + saturate, layered inner highlights, and capsule radii. Do not drift into generic glassmorphism — content never becomes glass, only controls float as glass above it. Preserve legibility (the adaptive tint does the work — don't override it), visible focus states, and honor Reduce Transparency / Reduce Motion.

**CSS 关键值**：`backdrop-filter: blur + saturate`, layered inner highlights, capsule radii（胶囊圆角）
**注意**：仅控制层（工具栏/标签栏/按钮）是玻璃，内容区不透明——这是与 Glassmorphism 的关键区别

---

## 5. Web Brutalism（网页粗野主义）

> "丑陋的原始 HTML 网站"

**提示词**：
> Create the page using strict Web Brutalism. Defining signals: browser-default materials (Times/system serif or monospace, default-blue underlined links); exposed document structure — headings, lists, tables, horizontal rules in source order; zero decorative rendering (no shadows, gradients, or rounded corners; at most 1px solid borders on a plain ground); utility-first density that loads instantly. Keep monospace vs serif and all-caps accents flexible. Use semantic HTML with minimal CSS — default UA styles are the design; resist resets that soften them. Do not drift into Neobrutalism; the decisive difference is that nothing here is styled to look raw — saturated blocks, thick designed borders, and offset shadows would make it a graphic costume. Preserve readable text sizes, focus visibility, and honest link affordances (underlines stay).

**CSS 关键值**：几乎零 CSS——浏览器默认 UA 样式即设计。最多 `border: 1px solid`
**注意**：与 Neobrutalism 的区别——粗野主义是"真的没样式"，新粗野主义是"精心设计的粗犷"

---

## 6. Neobrutalism（新粗野主义）

> "亮色块 + 黑边 + 硬阴影"

**提示词**：
> Create the surface using Neobrutalism. Defining signals: a uniform 2–3px solid black border on every element; hard offset shadows — solid black, displaced ~4px down-right, zero blur (box-shadow: 4px 4px 0 #000); flat saturated color blocks (e.g. yellow, hot pink, lime) on a cream or white ground with no gradients; bold chunky display type for headings. Keep the specific palette and any sticker doodads flexible. Active states translate the element into its shadow (transform: translate(4px,4px) with the shadow removed). Do not drift into Web Brutalism; the decisive difference is that this look is heavily styled — removing the borders, shadows, and color in favor of browser defaults would make it brutalist proper. Preserve 4.5:1 text contrast on every colored block (black text on saturated fills usually passes; white on yellow never does), visible focus indicators distinct from the decorative borders, and reduced-motion support for press animations.

**CSS 关键值**：`border: 2-3px solid #000; box-shadow: 4px 4px 0 #000; transform: translate(4px,4px)`（按下态）
**Tailwind 实现思路**：`border-2 border-black shadow-[4px_4px_0_#000] bg-yellow-400 font-bold hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all`

---

## 7. Y2K Digital Aesthetic（千禧年数字美学）

> "铬色泡泡糖千禧界面"

**提示词**：
> Create the piece using the Y2K digital aesthetic. Defining signals: liquid-chrome/metallic surfaces (silver gradient fills with mirror highlights); glossy translucent gel buttons and blobs with strong specular top highlights; an iridescent electric-blue/silver/white palette with occasional holographic cyan-magenta shifts; wide techno display type (Eurostile-flavored, often italic or chromed). Supporting garnish to use sparingly: rendered orbs, globes, wireframe grids, lens flares, tiny pixel-font labels. Keep the exact palette temperature and garnish density flexible. Use layered CSS gradients for chrome (alternating light/dark stops), radial-gradient highlights for gel, and background-clip: text for chromed type. Do not drift into Frutiger Aero; the decisive difference is that Y2K's optimism is synthetic — no grass, water, sky, or nature photography. Preserve readable text (chrome type needs a dark backing or outline to hit 4.5:1), visible focus states, and reduced-motion support for any shine sweeps.

**CSS 关键值**：layered gradients (alternating light/dark stops), radial-gradient highlights, `background-clip: text`
**色板**：electric-blue / silver / white + holographic cyan-magenta

---

## 8. Frutiger Aero

> "光泽草地气泡 Windows 未来"

**提示词**：
> Create the piece using Frutiger Aero. Defining signals: nature imagery fused with technology (blue sky, water, grass, bubbles, light rays) as the ambient backdrop; glossy translucent 'aqua' surfaces with curved specular highlights; a luminous sky-blue and grass-green palette full of white light; clean humanist sans-serif type (Frutiger/Segoe flavor). Supporting: bokeh circles, sun rays, diagonal sheen sweeps. Keep the specific slice of nature (underwater, meadow, droplets) flexible. Use layered radial/linear gradients for the sky and gloss caps, rgba white overlays for sheen, and generous rounded panels. Do not drift into Y2K; the decisive difference is nature — if chrome, techno type, or cyber grids replace the skies and grass, you've crossed over. Preserve 4.5:1 text contrast over photographic backgrounds (back text with a panel), visible focus states, and reduced-motion support for sheen and bubble effects.

**色板**：sky-blue / grass-green / white light
**CSS 关键值**：layered radial/linear gradients, rgba white overlays, generous rounded panels

---

## 9. Flat Design（扁平化设计）

> "纯色无阴影"

**提示词**：
> Create the surface using flat design. Defining signals: every surface a solid single-color fill — zero gradients, gloss, or texture; no simulated depth — no drop shadows, bevels, or specular highlights, edges drawn by color change alone; icons as simple one-color geometric glyphs; hierarchy carried by color blocks, size, and clean sans-serif type. Keep the palette and density flexible — flat can be sparse or dense. In CSS this means background-color instead of background-image gradients, border: none or 1px solid, box-shadow: none. Do not drift into skeuomorphism: the decisive difference is that nothing imitates a lit physical material. Preserve 4.5:1 text contrast, and make interactive elements identifiable without shadows — clear color affordance, visible hover/pressed states, and visible focus rings.

**CSS 关键值**：`background-color`（非 gradient）, `border: none`, `box-shadow: none`
**Tailwind 实现思路**：`bg-blue-500 text-white p-4 rounded-lg hover:bg-blue-600`（无 shadow）

---

## 10. Minimalism（极简主义）

> "几乎空白的页面"

**提示词**：
> Create the surface using minimalism. Defining signals: the fewest elements that still do the job — one navigation, one message, one primary action, decoration deleted; generous negative space around everything (think 40 to 60 percent of the viewport empty); a limited palette — near-monochrome with at most one accent color; one dramatic typographic moment, an oversized headline that is the loudest thing on screen. Rendering is flexible — flat fills or subtle shadows both fit. Do not confuse this with flat design: minimalism constrains content and layout, not rendering — if you add content back until the page is busy, it stops being minimalist no matter how flat it is. Preserve discoverability: core actions must stay visible, never hidden behind mystery-meat icons to keep the page empty, and text keeps 4.5:1 contrast even in grey-on-white palettes.

**核心**：40-60% 留白，近乎单色 + 一个强调色，超大标题是画面中最响亮的元素
**注意**：极简主义约束的是内容量和布局，不是渲染技术

---

## 11. Claymorphism（黏土拟物化）

> "像橡皮泥的蓬松 3D 按钮"

**提示词**：
> Create the surface using claymorphism. Defining signals: the clay shadow recipe on cards and buttons — two inner shadows (light at top, darker at bottom) plus one soft outer drop shadow, e.g. box-shadow: 0 24px 40px rgba(x,.18), inset 0 -8px 16px rgba(x,.15), inset 0 8px 16px rgba(255,255,255,.55); oversized corner radii (border-radius roughly 26px on a 56px control); each element independently colored in light pastels, clearly floating above a soft tinted background; chunky friendly type. Keep the exact hues and illustration flexible. Do not drift into neumorphism: the decisive difference is that clay objects have their own color and a visible drop shadow — never the background's color with shadows alone implying shape. Preserve 4.5:1 text contrast on pastel fills, pressed/hover states that deepen the inner shadows rather than removing them, and visible focus rings.

**CSS 关键值**：`box-shadow: 0 24px 40px rgba(x,.18), inset 0 -8px 16px rgba(x,.15), inset 0 8px 16px rgba(255,255,255,.55); border-radius: 26px`
**色板**：light pastels（浅色柔和色）

---

## 12. Vernacular Web（民俗网络 — 90 年代 GeoCities）

> "老 Geocities 闪烁 GIF 页面"

**提示词**：
> Create the surface in the Vernacular Web style — a sincere 90s GeoCities-era personal homepage, not a parody. Defining signals: a tiled repeating background image (starry sky reads instantly); animated GIF-style ornaments — twinkling sparkles, a striped under-construction badge; a centered single column of system serif type with a rainbow-gradient horizontal rule between sections; the collected-participation footer — visitor counter in green LED digits on black, 'sign my guestbook' link, webring badge, 'best viewed at 800x600' line. Loud colored or blinking emphasis text is period-correct. Keep the specific ornaments flexible — the mood is a proud amateur's decorated scrapbook. Do not drift into web brutalism: this page is ornamented with love, never stripped bare as a statement. Preserve legibility (solid or high-contrast panels behind text over busy wallpaper), respect prefers-reduced-motion by pausing blinks and twinkles, and keep counters and badges decorative, not functional claims.

**核心元素**：tiled background, animated GIF ornaments, visitor counter, guestbook link, webring badge, rainbow `<hr>`

---

## 13. Aqua（Apple Mac OS X 经典）

> "Mac 蓝糖果按钮"

**提示词**：
> Create the surface using Apple's original Aqua (early Mac OS X) design language. Defining signals: candy-gel controls — luminous water-blue fills with a bright specular highlight across the top half and an inner glow, e.g. layered radial-gradient highlight over linear-gradient(#5f9ff5, #1862d8); fine pinstriped window surfaces (repeating-linear-gradient, ~1px stripes at low contrast); gumdrop red/yellow/green window controls as glossy spheres, top-left; the default button gently pulsing (a slow glow loop, disabled under prefers-reduced-motion); soft deep window shadows. Keep layout and density flexible — this is chrome and controls, not a layout system. Do not drift into generic glassmorphism: Aqua's material is glossy opaque gel on pinstripes, not blurred frosted panels. Preserve 4.5:1 text contrast on gel fills (white text with a subtle down-shadow is period-correct), full keyboard focus states, and reduced-motion alternatives for the pulse.

**CSS 关键值**：`linear-gradient(#5f9ff5, #1862d8)` + radial-gradient highlight; `repeating-linear-gradient`（条纹表面 ~1px）

---

## 14. Windows Aero（Vista/7 毛玻璃）

> "Win7 透明窗框"

**提示词**：
> Create the surface using Windows Aero (Vista/7) styling. Defining signals: the window frame as transparent blurred glass — title bar and border show the scene behind them (backdrop-filter: blur(12px) saturate(1.3) on a rgba white/blue tint) while the content area stays opaque; diagonal specular light sweeps across the glass (a rotated linear-gradient white streak at low opacity); caption buttons that GLOW on hover — close floods red with a soft outer halo; luminous gradients for accents, like the shimmering green progress bar (gradient + a slow-moving highlight); 1px bright inner edge lining every glass pane; softly rounded chrome corners. Keep wallpaper and layout flexible — the glass needs something colorful behind it to read. Do not drift into Frutiger Aero: no nature imagery is required — this is the chrome language, not the era's mood board. Preserve title text legibility over unpredictable wallpapers (Aero drew a soft glow behind window titles — replicate it), 4.5:1 contrast for content text, hover glows paired with visible focus states, and reduced-motion alternatives for shimmer and window animation.

**CSS 关键值**：`backdrop-filter: blur(12px) saturate(1.3)` + rgba white/blue tint; 1px bright inner edge; hover glow on caption buttons

---

## 使用方式

当用户请求特定风格的设计时：
1. 查找上方"风格选择速查"表匹配用户描述
2. 复制对应风格的完整提示词
3. 在 HTML `<head>` 中加入 `<script src="https://cdn.tailwindcss.com"></script>`
4. 按提示词的 CSS 关键值和 Tailwind 实现思路生成 HTML
5. 遵守提示词中的无障碍约束（4.5:1 对比度、focus 可见性、reduced-motion）
