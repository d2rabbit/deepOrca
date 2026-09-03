/**
 * Store-reference parsing (five kinds, designs/chat-redesign V4 §五类引用):
 *   wiki   @…/.deeporca/deepwiki/…        （引用桥写入）
 *   review @…/.deeporca/reviews/…         （引用桥写入）
 *   file   @path/to/file.ext              （@-菜单插入形态，需路径分隔符）
 *   cmd    $ npm test                     （shell 提示符惯例）
 *   skill  @frontend-review               （小写连字符词）
 * Pure + UI-free — 供会话流芯片、输入框镜像层与 @-菜单抑制共用。
 */

const CHIP_SOURCE = [
  // ① deeporca 结构化引用（wiki 页 / 审查报告 JSON）—— 引用桥写入，优先级最高
  String.raw`@(?<deep>\S*?[\\/]\.deeporca[\\/](?:deepwiki|reviews)[\\/][^\s@]+(?:\.md|\.json)?)`,
  // ② 文件引用：@ + 含路径分隔符、带扩展名的路径（@-菜单插入形态）
  String.raw`@(?<file>\S*?[\\/]\S+?\.[A-Za-z0-9]{1,10})`,
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
 *  （如 deepwiki/reviews-guide.md）不得改变归类。 */
function chipKind(group: string, text: string): StoreRefKind {
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
  if (kind === "wiki") {
    const file = token.split(/[\\/]/).pop() ?? token;
    return file.replace(/\.md$/, "") || "wiki";
  }
  if (kind === "review") {
    const file = token.split(/[\\/]/).pop() ?? token;
    const mm = file.match(/review-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
    return mm ? `${mm[1]}/${mm[2]}/${mm[3]} ${mm[4]}:${mm[5]}` : file;
  }
  if (kind === "file") {
    return token.split(/[\\/]/).pop() ?? token;
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
  String.raw`@(?<deep>\S*?[\\/]\.deeporca[\\/](?:deepwiki|reviews)[\\/][^\s@]+(?:\.md|\.json)?)`,
  String.raw`@(?<file>\S*?[\\/]\S+?\.[A-Za-z0-9]{1,10})`,
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
