/**
 * Implementation-brief generator (specs/artifact-landing 链路 C) — turns a
 * spec document / openui prototype into a deterministic implementation brief
 * that a coding agent can execute without guessing. Pure + Electron-free.
 *
 * Method (m3e-canvas teardown, design.md 附录 D): every structural fact is
 * translated here, in code, into controlled natural language — geometric or
 * absolute coordinates never appear in the output, side-by-side items carry
 * explicit anti-collapse wording, components are named for stable reference,
 * navigation must close (gap check), and platform mapping + delivery rules
 * close the brief. The LLM that receives this brief performs the build; the
 * translation itself happened here, deterministically.
 *
 * Style note: list-item parsing uses startsWith/slice (no replace chains) and
 * lines are assembled with plain string concatenation.
 */

export interface ImplementationBriefInput {
  kind: "spec" | "openui";
  specMd?: string;
  openuiSource?: string;
  title: string;
  brief?: string;
  locale: string;
}

export interface ImplementationBriefResult {
  ok: boolean;
  briefMd?: string;
  /** Referenced-but-missing route targets (C14) — non-empty ⇒ no brief. */
  gaps?: string[];
}

type Pack = {
  docTitle: string;
  goal: string;
  goalDeliver: string;
  screens: string;
  screensCol: [string, string, string];
  noScreens: string;
  layout: string;
  layoutScreen: string;
  layoutTop: string;
  layoutItem: string;
  layoutAntiCollapse: string;
  behavior: string;
  behaviorItem: string;
  navClose: string;
  stack: string;
  stackIntro: string;
  stackComponents: string;
  stackColors: string;
  stackIcons: string;
  rules: string;
  rulesPersist: string;
  rulesFillBehavior: string;
  rulesUsability: string;
  rulesTodos: string;
  rulesDone: string;
  todos: string;
  noTodos: string;
  appendix: string;
};

const PACK_ZH: Pack = {
  docTitle: "实现简报",
  goal: "目标",
  goalDeliver: "交付口径：按本简报完成可运行的界面与交互，不做需求之外的发挥。",
  screens: "屏幕清单",
  screensCol: ["#", "屏幕", "说明"],
  noScreens: "单一界面（原文未划分多屏）。",
  layout: "逐屏布局",
  layoutScreen: "屏幕",
  layoutTop: "页面顶部",
  layoutItem: "内容条目",
  layoutAntiCollapse:
    "布局要求：正文单列自上而下排布；凡并排出现的元素必须保持在同一行并垂直居中（不要竖向堆叠或换行）；正文区域在页头与页脚之间滚动。",
  behavior: "行为与导航",
  behaviorItem: "行为条目",
  navClose: "导航闭环：每个可点击目标都必须有明确去处；「返回」回到来源屏幕并反向播放进入过渡；禁止悬空链接。",
  stack: "技术栈映射（DeepOrca openui 栈）",
  stackIntro: "使用项目内 openui 技术栈（React 函数组件 + 项目样式 token）实现以下映射：",
  stackComponents: "组件映射：按钮→Button、输入框→Input、列表→列表行组件、开关→Switch、对话框→Dialog。",
  stackColors: "颜色一律引用样式 token / 主题角色（primary、surface、on-surface），禁止硬编码十六进制色值。",
  stackIcons: "图标使用 Material Symbols Rounded 命名。",
  rules: "落地守则",
  rulesPersist: "使用真实持久化（IndexedDB 或等效本地存储）承载文档声明的数据，绝不交付虚设数据。",
  rulesFillBehavior: "按标签补全缺失行为：名称含义明确的操作（如“保存”“删除”）必须实现对应行为。",
  rulesUsability: "可用性优先于像素级还原：布局意图与交互完整比精确尺寸更重要。",
  rulesTodos: "逐条对照「待确认」清单；无法自行决定的事项在交付说明中列为待确认。",
  rulesDone: "完成定义：可运行构建 + 本简报逐条核对通过。",
  todos: "待确认（原文直录）",
  noTodos: "（无）",
  appendix: "源码附录（openui 原型未结构化部分，逐字保留）",
};

const PACK_EN: Pack = {
  docTitle: "Implementation Brief",
  goal: "Goal",
  goalDeliver: "Delivery bar: a runnable UI implementing exactly this brief — nothing beyond it.",
  screens: "Screens",
  screensCol: ["#", "Screen", "Notes"],
  noScreens: "Single screen (the source does not divide into multiple).",
  layout: "Per-screen layout",
  layoutScreen: "Screen",
  layoutTop: "Top of the page",
  layoutItem: "Content items",
  layoutAntiCollapse:
    "Layout rules: the body is one column, top to bottom; anything side by side must stay on ONE line, vertically centered (never stack or wrap it); the body scrolls between the header and the footer.",
  behavior: "Behavior & navigation",
  behaviorItem: "Behavior item",
  navClose:
    "Navigation closes: every tappable target has an explicit destination; “back” returns to the source screen with the reversed entry transition; no dangling links.",
  stack: "Stack mapping (DeepOrca openui stack)",
  stackIntro: "Implement with the in-repo openui stack (React function components + project style tokens):",
  stackComponents: "Components: button→Button, input→Input, list→list rows, switch→Switch, dialog→Dialog.",
  stackColors:
    "Colors always reference style tokens / theme roles (primary, surface, on-surface) — never hardcoded hex.",
  stackIcons: "Icons use Material Symbols Rounded names.",
  rules: "Delivery rules",
  rulesPersist:
    "Use real persistence (IndexedDB or equivalent local storage) for data the document declares — never fake data.",
  rulesFillBehavior:
    'Fill in missing behavior from labels: an action whose name is clear ("save", "delete") must actually do it.',
  rulesUsability:
    "Usability beats pixel-perfection: layout intent and complete interactions matter more than exact sizes.",
  rulesTodos: "Check every pending-confirmation item; anything undecidable goes into the delivery notes as open.",
  rulesDone: "Definition of done: a runnable build plus a pass over every line of this brief.",
  todos: "Pending confirmation (verbatim)",
  noTodos: "(none)",
  appendix: "Source appendix (unstructured openui prototype, verbatim)",
};

function pack(locale: string): Pack {
  return locale.startsWith("zh") ? PACK_ZH : PACK_EN;
}

/** One markdown list line — the only bullet builder in this module. */
function bullet(label: string, text: string): string {
  return text ? "- " + label + "：" + text : "- " + label;
}

/** One markdown table row from cells. */
function tableRow(cells: string[]): string {
  return "| " + cells.join(" | ") + " |";
}

/** A `## ` section heading line for a pack label. */
function sectionHeading(label: string): string {
  return "## " + label;
}

/** Screen display scope: 「名字」 in zh, plain quotes otherwise. */
function screenScope(pack0: Pack, name: string): string {
  return pack0 === PACK_ZH ? "「" + name + "」" : '"' + name + '"';
}

/** Strip fenced code blocks so heading scans never see their content. */
function outsideFences(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let inside = false;
  return lines
    .filter((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inside = !inside;
        return false;
      }
      return !inside;
    })
    .join("\n");
}

interface Screen {
  name: string;
  body: string;
  entries: string[];
}

/** A trimmed markdown list item ("- x" / "* x" / "- [x] x")? */
function isListItem(line: string): boolean {
  return line.startsWith("- ") || line.startsWith("* ") || /^- \[[ xX]\]/.test(line);
}

/** The text after the list marker ("- " is two characters; "- [x] " six). */
function listItemText(line: string): string {
  if (line.startsWith("- [")) {
    const close = line.indexOf("]");
    return close === -1 ? line.slice(2).trim() : line.slice(close + 1).trim();
  }
  return line.slice(2).trim();
}

/** `## ` sections are screens; list items inside them are behavior entries. */
function extractScreens(specMd: string): Screen[] {
  const scan = outsideFences(specMd).split(/\r?\n/);
  const screens: Screen[] = [];
  const flush = (name: string, body: string[]) => {
    const text = body.join("\n");
    const entries = body
      .map((line) => line.trim())
      .filter(isListItem)
      .map(listItemText)
      .filter(Boolean);
    const screen: Screen = { name: name || "-", body: text, entries };
    screens.push(screen);
  };
  let current = "";
  let body: string[] = [];
  for (const line of scan) {
    if (line.startsWith("## ")) {
      flush(current, body);
      current = line.slice(3).trim();
      body = [];
    } else {
      body.push(line);
    }
  }
  flush(current, body);
  return screens.filter((screen) => screen.name !== "-" || screen.body.trim());
}

/** 待确认 items — same convention the workspace spec tab already parses. */
function extractTodos(specMd: string): string[] {
  const lines = outsideFences(specMd).split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes("待确认"));
  if (start === -1) return [];
  return lines
    .slice(start + 1)
    .map((line) => line.trim())
    .filter(isListItem)
    .map(listItemText)
    .filter(Boolean);
}

/** Route targets: markdown anchors and quoted screen mentions that are NOT in
 *  the extracted screen set land in gaps (C14). */
function routeTargets(specMd: string): string[] {
  const targets: string[] = [];
  for (const match of specMd.matchAll(/\]\(#([^)]+)\)/g)) targets.push(match[1].trim());
  for (const match of specMd.matchAll(/「([^」]{1,24})」/g)) {
    if (/屏幕|页面|页/.test(match[0])) targets.push(match[1].trim());
  }
  return targets;
}

/** Interactive elements of an openui prototype — best effort; everything not
 *  captured degrades into the verbatim source appendix (C14, no guessing). */
function extractOpenuiOutline(source: string): { buttons: string[]; links: Array<{ label: string; to: string }> } {
  const buttons = [...source.matchAll(/<button[^>]*>([^<]{1,80})</g)].map((m) => m[1].trim()).filter(Boolean);
  const links: Array<{ label: string; to: string }> = [];
  for (const m of source.matchAll(/<a[^>]*href="#([^"]*)"[^>]*>([\s\S]{0,80}?)<\/a>/g)) {
    links.push({
      to: m[1].trim(),
      label: m[2]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    });
  }
  return { buttons, links };
}

export function buildImplementationBrief(input: ImplementationBriefInput): ImplementationBriefResult {
  const p = pack(input.locale);
  const out: string[] = [];
  /** The only writer — keeps line assembly out of the section code below. */
  const add = (...lines: string[]): void => {
    for (const line of lines) out.push(line);
  };
  const heading = (label: string): string => "### " + p.layoutScreen + "：" + label;
  const gaps: string[] = [];

  if (input.kind === "spec") {
    const spec = (input.specMd ?? "").trim();
    if (!spec) return { ok: false, gaps: ["spec empty"] };

    const screens = extractScreens(spec);
    const names = new Set(screens.map((s) => s.name));
    // Closure check (C14): anchors and quoted screen mentions must resolve.
    for (const target of routeTargets(spec)) {
      const hit = [...names].some((name) => name.includes(target) || target.includes(name));
      if (!hit && !gaps.includes(target)) gaps.push(target);
    }
    if (gaps.length > 0) return { ok: false, gaps };

    const todos = extractTodos(spec);
    const listed = screens.filter((s) => s.name !== "-");

    add("# " + p.docTitle + "：" + input.title, "");
    add(sectionHeading(p.goal), "", bullet(p.goal, input.brief || firstLine(spec)), bullet(p.goalDeliver, ""), "");
    add(sectionHeading(p.screens), "");
    add(tableRow(p.screensCol), tableRow(["---", "---", "---"]));
    if (listed.length === 0) {
      add(tableRow(["1", input.title, p.noScreens]));
    } else {
      listed.forEach((screen, i) => add(tableRow([String(i + 1), screen.name, firstLine(screen.body) || "-"])));
    }
    add("");

    add(sectionHeading(p.layout), "");
    if (listed.length === 0) {
      add(heading(input.title), "", bullet(p.layoutAntiCollapse, ""), "");
    } else {
      for (const screen of listed) {
        add(heading(screen.name), "");
        const first = firstLine(screen.body);
        if (first) add(bullet(p.layoutTop, first));
        add(bullet(p.layoutAntiCollapse, ""), "");
      }
    }

    // Behavior entries: built as their own list first (keeps the section
    // assembly a single spread — the format stays reviewable per line).
    const behaviorLines: string[] = [];
    for (const screen of screens) {
      const scope = screen.name === "-" ? p.layoutItem : p.layoutScreen + screenScope(p, screen.name);
      for (const entry of screen.entries) {
        behaviorLines.push(bullet(p.behaviorItem + " · " + scope, entry));
      }
    }
    if (behaviorLines.length === 0) behaviorLines.push(bullet(p.layoutItem, "—"));
    behaviorLines.push(bullet(p.navClose, ""));
    add(sectionHeading(p.behavior), "", ...behaviorLines, "");

    add(
      sectionHeading(p.stack),
      "",
      bullet(p.stackIntro, ""),
      bullet(p.stackComponents, ""),
      bullet(p.stackColors, ""),
      bullet(p.stackIcons, ""),
      ""
    );
    add(
      sectionHeading(p.rules),
      "",
      bullet(p.rulesPersist, ""),
      bullet(p.rulesFillBehavior, ""),
      bullet(p.rulesUsability, ""),
      bullet(p.rulesTodos, ""),
      bullet(p.rulesDone, ""),
      ""
    );
    add(sectionHeading(p.todos), "");
    if (todos.length > 0) for (const todo of todos) add(bullet(todo, ""));
    else add(p.noTodos);
    add("");

    return { ok: true, briefMd: out.join("\n") };
  }

  // ── openui prototype input ────────────────────────────────────────────────
  const source = (input.openuiSource ?? "").trim();
  if (!source) return { ok: false, gaps: ["openui source empty"] };
  const outline = extractOpenuiOutline(source);
  const screenName = input.title;

  add("# " + p.docTitle + "：" + input.title, "");
  add(sectionHeading(p.goal), "", bullet(p.goal, input.brief || p.noScreens), bullet(p.goalDeliver, ""), "");
  add(sectionHeading(p.screens), "");
  add(tableRow(p.screensCol), tableRow(["---", "---", "---"]));
  add(tableRow(["1", screenName, p.noScreens]), "");
  add(sectionHeading(p.layout), "", heading(screenName), "");
  if (outline.buttons.length > 0) {
    add(bullet(p.layoutItem, outline.buttons.map((b) => screenScope(p, b)).join("、")));
  }
  add(bullet(p.layoutAntiCollapse, ""), "");
  add(sectionHeading(p.behavior), "");
  if (outline.links.length > 0) {
    for (const link of outline.links) {
      add(bullet(p.behaviorItem + " " + screenScope(p, link.label || link.to), "→ " + link.to));
    }
  } else {
    add(bullet(p.behaviorItem, "—"));
  }
  add("", bullet(p.navClose, ""), "");
  add(
    sectionHeading(p.stack),
    "",
    bullet(p.stackIntro, ""),
    bullet(p.stackComponents, ""),
    bullet(p.stackColors, ""),
    bullet(p.stackIcons, ""),
    ""
  );
  add(
    sectionHeading(p.rules),
    "",
    bullet(p.rulesPersist, ""),
    bullet(p.rulesFillBehavior, ""),
    bullet(p.rulesUsability, ""),
    bullet(p.rulesDone, ""),
    ""
  );
  add(sectionHeading(p.todos), "", p.noTodos, "");
  add(sectionHeading(p.appendix), "", "```", source, "```", "");
  return { ok: true, briefMd: out.join("\n") };
}

function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("|") || /^[-*]\s/.test(trimmed)) continue;
    return trimmed;
  }
  return "";
}
