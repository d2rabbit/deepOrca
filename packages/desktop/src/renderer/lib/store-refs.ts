/**
 * Store-reference parsing (八类, designs/chat-redesign V4 §五类引用
 * + ref-buffer 紧凑令牌/目录引用 2026-09-15):
 *   wiki      @…/.deeporca/deepwiki/…        （引用桥 / @-菜单注入；相对形态亦可）
 *   review    @…/.deeporca/reviews/…         （引用桥 / @-菜单注入；相对形态亦可）
 *   file      @path/to/file.ext 或 @README.md（根级文件亦可）
 *   dir       @path/to/dir/                  （尾斜杠 = 目录，@-菜单选目录写入）
 *   cmd       $ npm test                     （shell 提示符惯例）
 *   skill     @frontend-review               （小写连字符词）
 *   design    @design/<slug>                 （ref-buffer 紧凑令牌，UI 设计 .dd）
 *   prototype @prototype/<slug>              （ref-buffer 紧凑令牌，PM 原型）
 * 紧凑令牌是注册表（lib/ref-buffer.ts）的键：短、单行、不含空白，发送时由
 * 缓冲层展开成真实路径+内容。含空白的绝对路径仍走引号包裹形态
 * @"path with spaces"（\S 芯片语法无法横跨空格，2026-09-06）。
 * Pure + UI-free — 供会话流芯片、输入框镜像层与 @-菜单抑制共用。
 */

const CHIP_SOURCE = [
  // ⓪ ref-buffer 紧凑令牌（注册表键）——必须先于 file/skill 组：@wiki/x.md
  //    会被 file 组的扩展名语法抢走。前缀直接给出语义类别，无需目录段推断。
  //    (?<![\w.]) 词中 @ 守卫对齐 4c68ccee。"斜杠+扩展名"形状的归属在
  //    splitStoreRefSegments 里语义裁决（有注册表走键解析，无注册表按文件
  //    芯片兜底）——不能放正则层：尾部 lookbehind 会诱发回溯残片
  //    （@review/notes.md → @review/notes.，2026-09-15 审查实测）。
  String.raw`(?<![\w.])@(?<store>(?:wiki|review|design|prototype)/[^\s@]+)`,
  // ① 引号包裹引用：@"含空白的路径"。菜单/引用桥写入的兜底形态——裸正则的
  //    \S 无法跨空格，路径含空白时整体退化纯文本，故按目录段归类语义。
  String.raw`@(?<quoted>"[^"\n]+")`,
  // ② deeporca 结构化引用（wiki 页 / 审查报告 JSON / 设计套件版本快照）——
  //    引用桥 / @-菜单写入，绝对与相对形态均识别（(?:…)? 可选前缀，
  //    2026-09-05 修复相对形态丢失语义）。designs 纳入 2026-09-15：否则
  //    回放气泡的 file 组会把 @…/.deeporca/designs/... 截断成 .deeporca 芯片
  //    （懒惰匹配把 .deeporca 当作扩展名）。
  String.raw`@(?<deep>(?:\S*?[\\/])?\.deeporca[\\/](?:deepwiki|reviews|designs)[\\/][^\s@]+(?:\.md|\.json)?)`,
  // ③ 目录引用：@ + 以分隔符结尾的路径（@-菜单选目录写入尾斜杠）。目录没有
  //    扩展名，file 组语法盖不住——此前整段退化为纯文本（用户 2026-09-15
  //    指出文件/目录引用缺少与 store 引用同等的展示优化）。放在 file 组之前：
  //    dir 要求"分隔符后紧跟空白/结尾"，文件路径永远不满足，因此绝不抢 file；
  //    而 `@src/v2.5/` 这类含点目录反而能被 dir 正确整体收录（file 组会截断
  //    在版本号处）。先行否定：排除紧凑令牌前缀（@wiki/ 是输入中的查询，
  //    不得当作目录关掉 @ 菜单）；lookbehind 排除词中@与 URL 尾段 /@bob/
  //    （2026-09-15 审查：/(?!…) 前的斜杠同样提示这是路径中段而非引用起点）。
  String.raw`(?<![\w./])@(?!wiki/|review/|design/|prototype/)(?<dir>\S+?[\\/])(?=\s|$)`,
  // ④ 文件引用：@ + 带扩展名的路径（含路径分隔符或根级文件，如 @README.md——
  //    2026-09-05 放开根级）。2026-09-06 回归守卫：(?<![\w.]) 拒绝词中 @
  //    （someone@gmail.com 不再误判成文件芯片），\S{2,}? 拒绝 @e.g. 式
  //    单字符基名散文。
  String.raw`(?<![\w.])@(?<file>(?:\S*?[\\/])?\S{2,}?\.[A-Za-z0-9]{1,10})`,
  // ⑤ 命令引用：$ + 空格 + 命令（≤5 个 token，拒收 CJK 与 $ 歧义；首词合理性
  //    在 splitStoreRefSegments 里二次过滤——正则里塞停用词表会不可读）
  String.raw`\$(?<cmd> ?[a-zA-Z][\w./-]*(?:[ \t]+[\w./=-]+){0,4})`,
  // ⑥ 技能引用：@ + 小写连字符词（加载过的技能名）。前瞻放行句尾 ASCII 句点
  //    （"@frontend-review." 是句子，点号留在正文），但仍拒绝扩展名式延续
  //    （"@x.md" 归文件/不识别）与路径延续（"@x/…"）。
  String.raw`@(?<skill>[a-z][a-z0-9-]{1,31})(?![\w/-])(?!\.[A-Za-z0-9])`,
].join("|");

const CHIP_RE = new RegExp(CHIP_SOURCE, "g");

export type StoreRefKind = "wiki" | "review" | "file" | "dir" | "cmd" | "skill" | "design" | "prototype";

export interface StoreRefToken {
  kind: StoreRefKind;
  raw: string;
  start: number;
  end: number;
  label: string;
  /** True for ref-buffer compact tokens ("@wiki/<slug>") — these resolve
   *  through the registry at send time (lib/ref-buffer.ts), not by path. */
  compact?: boolean;
}

export type StoreRefSegment = { kind: "text"; text: string } | { kind: "ref"; ref: StoreRefToken };

/** wiki vs review 由目录段（/reviews/）判定——文件名里恰好含 "reviews"
 *  （如 deepwiki/reviews-guide.md）不得改变归类。引号形态按内容里的目录段
 *  归类（wiki/review），否则视为普通文件。紧凑令牌的前缀即类别。 */
function chipKind(group: string, text: string): StoreRefKind {
  if (group === "store") {
    if (text.startsWith("review/")) return "review";
    if (text.startsWith("design/")) return "design";
    if (text.startsWith("prototype/")) return "prototype";
    return "wiki";
  }
  if (group === "dir") return "dir";
  if (group === "quoted") {
    if (/[\\/]reviews[\\/]/.test(text)) return "review";
    if (/[\\/]deepwiki[\\/]/.test(text)) return "wiki";
    return "file";
  }
  if (group === "deep") {
    if (/[\\/]reviews[\\/]/.test(text)) return "review";
    // 设计套件版本快照——原型与 UI 共用 designs 目录，路径上无法二分，按文件
    // 芯片兜底（真实标题由 <reference> 回放块芯片携带）。
    if (/[\\/]designs[\\/]/.test(text)) return "file";
    return "wiki";
  }
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
  // 目录引用：末段目录名 + 尾斜杠——斜杠本身是"这是目录"的视觉信号。
  if (kind === "dir") {
    const withoutSlash = stripped.replace(/[\\/]+$/, "");
    const segs = withoutSlash.split(/[\\/]/).filter(Boolean);
    return `${segs[segs.length - 1] ?? withoutSlash}/`;
  }
  if (kind === "file") {
    // 多级路径的文件带上一级父目录（用户 2026-09-15：同名文件的消歧展示），
    // 根级文件保持裸名。
    const segs = stripped.split(/[\\/]/).filter(Boolean);
    if (segs.length >= 2) return `${segs[segs.length - 2]}/${segs[segs.length - 1]}`;
    return segs[segs.length - 1] ?? stripped;
  }
  // 紧凑令牌：类别前缀后的 slug 即标签（真实标题由注册表覆盖——见
  // splitStoreRefSegments 的 resolveLabel；此处是语法层兜底）。
  if (kind === "design" || kind === "prototype") {
    const slug = stripped.split("/").slice(1).join("/");
    return slug.length > 0 ? slug : kind;
  }
  if (kind === "cmd") {
    return token.replace(/^\$?\s*/, "");
  }
  return token;
}

/** Split text into plain-text and reference segments, in order.
 *  `resolveLabel`（可选）让调用方用注册表里的真实标题覆盖语法层兜底标签
 *  （Composer 传 ref-buffer 的 entries；返回 null/空串则保留兜底）。
 *  `resolveStoreToken`（可选）是紧凑令牌的注册表解析器：贪婪令牌在 CJK 无
 *  空格跟打/句尾标点场景会多吃正文字符（2026-09-15 审查），解析器返回令牌
 *  对应的注册表键（最长前缀命中），返回 null 则整段降级纯文本——键不存在
 *  的令牌不再生成芯片、不再触发悬空拦截。 */
export function splitStoreRefSegments(
  text: string,
  resolveLabel?: (token: string, kind: StoreRefKind) => string | null,
  resolveStoreToken?: (raw: string) => string | null
): StoreRefSegment[] {
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
    if (group === "store") {
      // "斜杠+扩展名"结尾 = 更像真实文件路径：无注册表佐证时按 file 芯片兜底
      //（回放气泡无注册表；扩展名识别沿用旧语义），而不是生成必然悬空的
      // 紧凑令牌。
      const fileLike = /\.[A-Za-z0-9]{1,10}$/.test(m[0].slice(1));
      if (resolveStoreToken) {
        const canonical = resolveStoreToken(m[0]);
        if (!canonical) {
          if (fileLike) {
            segments.push({
              kind: "ref",
              ref: { kind: "file", raw: m[0], start, end, label: chipLabel("file", m[0]) },
            });
            last = end;
          }
          continue; // 未登记：纯文本，不生成芯片、不触发悬空拦截
        }
        if (canonical.length < m[0].length) {
          // 最长前缀命中：芯片只盖键本身，句尾标点/跟打的正文留在外面
          const kind = chipKind("store", canonical.slice(1));
          const label = resolveLabel?.(canonical, kind) || chipLabel(kind, canonical);
          segments.push({
            kind: "ref",
            ref: { kind, raw: canonical, start, end: start + canonical.length, label, compact: true },
          });
          last = start + canonical.length;
          continue;
        }
        // canonical === m[0]：落入末尾的通用 push（compact）
      } else if (fileLike) {
        segments.push({
          kind: "ref",
          ref: { kind: "file", raw: m[0], start, end, label: chipLabel("file", m[0]) },
        });
        last = end;
        continue;
      }
    }
    if (start > last) segments.push({ kind: "text", text: text.slice(last, start) });
    const kind = chipKind(group, m.groups?.[group] ?? "");
    const compact = group === "store";
    const fallback = chipLabel(kind, m[0]);
    const label = (compact && resolveLabel?.(m[0], kind)) || fallback;
    segments.push({
      kind: "ref",
      ref: { kind, raw: m[0], start, end, label, ...(compact ? { compact: true } : {}) },
    });
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
  String.raw`(?<![\w.])@(?<store>(?:wiki|review|design|prototype)/[^\s@]+)`,
  String.raw`@(?<quoted>"[^"\n]+")`,
  String.raw`@(?<deep>(?:\S*?[\\/])?\.deeporca[\\/](?:deepwiki|reviews)[\\/][^\s@]+(?:\.md|\.json)?)`,
  String.raw`(?<![\w.])@(?!wiki/|review/|design/|prototype/)(?<dir>\S+?[\\/])(?=\s|$)`,
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
