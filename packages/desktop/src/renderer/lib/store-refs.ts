/**
 * Store-reference parsing (five kinds, designs/chat-redesign V4 §五类引用):
 *   wiki   @…/.deeporca/deepwiki/…        （引用桥 / @-菜单注入；相对形态亦可）
 *   review @…/.deeporca/reviews/…         （引用桥 / @-菜单注入；相对形态亦可）
 *   file   @path/to/file.ext 或 @README.md（根级文件亦可）
 *   cmd    $ npm test                     （shell 提示符惯例）
 *   skill  @frontend-review               （小写连字符词）
 * 含空白的路径走引号包裹形态 @"path with spaces"（@-菜单/引用桥在路径含
 * 空白时写入——\S 芯片语法无法横跨空格，2026-09-06）。
 * Pure + UI-free — 供会话流芯片、输入框镜像层与 @-菜单抑制共用。
 */

const CHIP_SOURCE = [
  // ⓪ 引号包裹引用：@"含空白的路径"。菜单/引用桥写入的兜底形态——裸正则的
  //    \S 无法跨空格，路径含空白时整体退化纯文本，故按目录段归类语义。
  String.raw`@(?<quoted>"[^"\n]+")`,
  // ① deeporca 结构化引用（wiki 页 / 审查报告 JSON）—— 引用桥 / @-菜单写入，
  //    绝对与相对形态均识别（(?:…)? 可选前缀，2026-09-05 修复相对形态丢失语义）
  String.raw`@(?<deep>(?:\S*?[\\/])?\.deeporca[\\/](?:deepwiki|reviews)[\\/][^\s@]+(?:\.md|\.json)?)`,
  // ② 文件引用：@ + 带扩展名的路径（含路径分隔符或根级文件，如 @README.md——
  //    2026-09-05 放开根级）。2026-09-06 回归守卫：(?<![\w.]) 拒绝词中 @
  //    （someone@gmail.com 不再误判成文件芯片），\S{2,}? 拒绝 @e.g. 式
  //    单字符基名散文。
  String.raw`(?<![\w.])@(?<file>(?:\S*?[\\/])?\S{2,}?\.[A-Za-z0-9]{1,10})`,
  // ③ 命令引用：$ + 空格 + 命令（≤5 个 token，拒收 CJK 与 $ 歧义；首词合理性
  //    在 splitStoreRefSegments 里二次过滤——正则里塞停用词表会不可读）
  String.raw`\$(?<cmd> ?[a-zA-Z][\w./-]*(?:[ \t]+[\w./=-]+){0,4})`,
  // ④ 技能引用：@ + 小写连字符词（加载过的技能名）。前瞻放行句尾 ASCII 句点
  //    （"@frontend-review." 是句子，点号留在正文），但仍拒绝扩展名式延续
  //    （"@x.md" 归文件/不识别）与路径延续（"@x/…"）。
  String.raw`@(?<skill>[a-z][a-z0-9-]{1,31})(?![\w/-])(?!\.[A-Za-z0-9])`,
].join("|");

const CHIP_RE = new RegExp(CHIP_SOURCE, "g");

export type StoreRefKind = "wiki" | "review" | "file" | "cmd" | "skill";

export interface StoreRefToken {
  kind: StoreRefKind;
  raw: string;
  start: number;
  end: number;
  label: string;
}

export type StoreRefSegment = { kind: "text"; text: string } | { kind: "ref"; ref: StoreRefToken };

/** wiki vs review 由目录段（/reviews/）判定——文件名里恰好含 "reviews"
 *  （如 deepwiki/reviews-guide.md）不得改变归类。引号形态按内容里的目录段
 *  归类（wiki/review），否则视为普通文件。 */
function chipKind(group: string, text: string): StoreRefKind {
  if (group === "quoted") {
    if (/[\\/]reviews[\\/]/.test(text)) return "review";
    if (/[\\/]deepwiki[\\/]/.test(text)) return "wiki";
    return "file";
  }
  if (group === "deep") return /[\\/]reviews[\\/]/.test(text) ? "review" : "wiki";
  if (group === "file") return "file";
  if (group === "cmd") return "cmd";
  return "skill";
}

/** 英文虚词开头的 "$ …" 是散文（"it costs $ a month after the trial"），
 *  不是 shell 调用——首词命中停用表或单字符的一律不生成命令芯片。 */
const CMD_FIRST_TOKEN_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "i",
  "is",
  "it",
  "to",
  "of",
  "in",
  "for",
  "on",
  "and",
  "or",
  "if",
  "at",
  "as",
  "be",
  "by",
  "do",
  "go",
  "he",
  "she",
  "we",
  "me",
  "my",
  "no",
  "so",
  "up",
  "us",
]);

function isPlausibleCommand(cmdToken: string): boolean {
  const first = cmdToken.trimStart().split(/[ \t]/)[0] ?? "";
  return first.length >= 2 && !CMD_FIRST_TOKEN_STOPWORDS.has(first.toLowerCase());
}

function chipLabel(kind: StoreRefKind, token: string): string {
  // Quoted refs carry their wrapping quotes, and root-level files ("@README.md")
  // carry no separator so the leading @ survives the path split — normalize both
  // away first (2026-09-05 fix 3 / 2026-09-06 quoted form).
  const stripped = token.replace(/^@/, "").replace(/^"(.*)"$/, "$1");
  if (kind === "wiki") {
    const file = stripped.split(/[\\/]/).pop() ?? stripped;
    return file.replace(/\.md$/, "") || "wiki";
  }
  if (kind === "review") {
    const file = stripped.split(/[\\/]/).pop() ?? stripped;
    const mm = file.match(/review-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
    return mm ? `${mm[1]}/${mm[2]}/${mm[3]} ${mm[4]}:${mm[5]}` : file;
  }
  if (kind === "file") {
    return stripped.split(/[\\/]/).pop() ?? stripped;
  }
  if (kind === "cmd") {
    return token.replace(/^\$?\s*/, "");
  }
  return token;
}

/** Split text into plain-text and reference segments, in order. */
export function splitStoreRefSegments(text: string): StoreRefSegment[] {
  const segments: StoreRefSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(CHIP_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const group = m.groups ? (Object.keys(m.groups).find((k) => m.groups?.[k] !== undefined) ?? "deep") : "deep";
    // 命令芯片首词不合理（散文虚词/单字符）→ 整段退回纯文本：不推进 last，
    // 被拒的区间由后续的 text 切片自然覆盖。
    if (group === "cmd" && !isPlausibleCommand(m.groups?.cmd ?? "")) {
      continue;
    }
    if (start > last) segments.push({ kind: "text", text: text.slice(last, start) });
    const kind = chipKind(group, m.groups?.[group] ?? "");
    segments.push({ kind: "ref", ref: { kind, raw: m[0], start, end, label: chipLabel(kind, m[0]) } });
    last = end;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/** All references in the text, plus whether any exist. */
export function extractStoreReferences(text: string): { hasRefs: boolean; refs: StoreRefToken[] } {
  const refs = splitStoreRefSegments(text)
    .filter((s): s is Extract<StoreRefSegment, { kind: "ref" }> => s.kind === "ref")
    .map((s) => s.ref);
  return { hasRefs: refs.length > 0, refs };
}

const COMPLETE_CHIP_SOURCE = [
  String.raw`@(?<quoted>"[^"\n]+")`,
  String.raw`@(?<deep>(?:\S*?[\\/])?\.deeporca[\\/](?:deepwiki|reviews)[\\/][^\s@]+(?:\.md|\.json)?)`,
  String.raw`(?<![\w.])@(?<file>(?:\S*?[\\/])?\S{2,}?\.[A-Za-z0-9]{1,10})`,
  String.raw`@(?<skill>[a-z][a-z0-9-]{1,31})(?![\w/-])(?!\.[A-Za-z0-9])`,
].join("|");
const COMPLETE_CHIP_RE = new RegExp(`^(?:${COMPLETE_CHIP_SOURCE})$`);

/** True when the @token is an ALREADY-COMPLETE reference — the composer
 *  suppresses the file-mention menu for it (suggesting files over a finished
 *  reference just produces "no matching files" noise). 命令引用走 $ 前缀，
 *  不经过 @ 菜单，因此不在此列。 */
export function isCompleteStoreRef(token: string): boolean {
  return COMPLETE_CHIP_RE.test(token);
}

/** The path a reference token points at — @/$ prefix and wrapping quotes
 *  removed. Consumers that need to check the token against the filesystem or
 *  the live store lists (send-side dangling guard, 2026-09-06) must go through
 *  this instead of slicing the raw token themselves. */
export function storeRefPath(token: string): string {
  return token.replace(/^[@$]/, "").replace(/^"(.*)"$/, "$1");
}
