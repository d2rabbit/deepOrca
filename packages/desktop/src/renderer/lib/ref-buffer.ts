/**
 * ref-buffer — 聊天框引用缓冲层（两种展现形式的中间层）。
 *
 * 展示形态（输入框/指令条内）：紧凑令牌 `@wiki/<slug>`、`@review/<slug>`、
 *   `@design/<slug>`、`@prototype/<slug>` —— 短、单行、不含空白，芯片镜像层
 *   永远盖得齐（旧方案把绝对路径整段塞进草稿，路径一换行镜像层就错位，
 *   用户报告 2026-09-15 的"时间戳芯片 + 空白块"即此类）。
 * 传输形态（对外发送）：发送时由本层把令牌展开成真实绝对路径，并把被引用
 *   工件的真实内容内联为 <reference> 块（带上限、超时 fail-open）——模型不再
 *   依赖 read 工具能否命中一个可能已过期的路径。
 *
 * 注册表（RefEntry）由 App 在引用桥/@-菜单插入时登记：真实路径 + 真实标题 +
 * 所属 root。令牌是注册表的键；无登记的令牌按悬空处理（Composer 首次发送
 * 拦截，与既有悬空守卫同一 UX）。
 *
 * Pure + UI-free —— 供 App、Composer 与测试共用。
 */

import { splitStoreRefSegments } from "./store-refs";

/** 缓冲层登记的引用类别（file/cmd/skill 不进缓冲层——它们本身就是真实路径/正文）。 */
export type RefBufferKind = "wiki" | "review" | "design" | "prototype";

export interface RefEntry {
  /** 草稿内的紧凑令牌（注册表键），如 "@wiki/架构设计"。 */
  token: string;
  kind: RefBufferKind;
  /** 真实人类标题（wiki 页标题 / 报告时间戳 / suite 标题）。 */
  label: string;
  /** 真实绝对路径（传输形态指向的工件）。 */
  path: string;
  /** 登记该引用的面板所属工作区 root（内容解析按它走，与当前激活 root 无关）。 */
  root: string;
}

/** 设计工作面 → 聊天桥的结构化引用载荷（替代旧的整段 JSON dump）。 */
export interface DesignRefQuote {
  type: "ref";
  kind: RefBufferKind;
  root: string;
  path: string;
  label: string;
  /** 可选引导语（如"请基于这份验收报告…"），插在令牌行之前。 */
  leadIn?: string;
}

/** 引用桥的兜底形态：没有真实工件的载荷（如纯文本 brief）仍走整段文本。 */
export interface TextRefQuote {
  type: "text";
  text: string;
}

export type ChatRefQuote = DesignRefQuote | TextRefQuote;

/** 传输形态里被内联的引用块元数据（会话回放时的折叠展示用）。 */
export interface RefBlockMeta {
  kind: string;
  path: string;
  title: string;
}

const REF_BLOCK_RE = /<reference kind="([^"]*)" path="((?:[^&]|&(?!quot;))*)" title="([^"]*)">[\s\S]*?<\/reference>/g;

/** 会话回放显示形态：把传输形态里的 <reference> 内容块折叠出去，只留元数据
 *  ——持久化的是传输文本，但指令条不应把整块引用内容重绘进历史气泡。
 *  属性值里的 &quot; 在读取侧还原为引号。 */
export function splitReferenceBlocks(text: string): { text: string; blocks: RefBlockMeta[] } {
  const blocks: RefBlockMeta[] = [];
  const stripped = text.replace(REF_BLOCK_RE, (_m, kind: string, path: string, title: string) => {
    blocks.push({
      kind,
      path: path.replace(/&quot;/g, '"'),
      title: title.replace(/&quot;/g, '"'),
    });
    return "";
  });
  return { text: stripped.replace(/\n{3,}/g, "\n\n").trimEnd(), blocks };
}

const TOKEN_KINDS = ["wiki", "review", "design", "prototype"] as const;

/** 前缀 → 类别（与 store-refs 的 store 组语法保持一致）。 */
export function refKindFromToken(token: string): RefBufferKind | null {
  for (const kind of TOKEN_KINDS) {
    if (token.startsWith(`@${kind}/`)) return kind;
  }
  return null;
}

/** 标题 → 令牌 slug：空白与句读折叠成 `-`，剔除令牌语法不能安全承载的
 *  字符（@、引号、路径分隔符）；CJK 原样保留（\S 语法天然承载）。 */
export function refTokenSlug(label: string, maxLen = 48): string {
  const slug = label
    .replace(/[\s@"'/\\[\]():。，、；：！？…「」『』（）]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen)
    .replace(/-$/g, "");
  return slug.length > 0 ? slug : "ref";
}

/** 生成不与现有令牌冲突的唯一令牌（碰撞追加 -2/-3…）。 */
export function buildRefToken(kind: RefBufferKind, label: string, taken: ReadonlySet<string>): string {
  const base = `@${kind}/${refTokenSlug(label)}`;
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/** 引用桥的统一插入约定：已有正文时空两行接在后面，令牌独占一行。 */
export function appendDraftToken(current: string, leadIn: string, token: string): string {
  const prefix = current.trim().length > 0 ? `${current.trimEnd()}\n\n` : "";
  const lead = leadIn.trim().length > 0 ? `${leadIn.trim()}\n` : "";
  return `${prefix}${lead}${token}\n`;
}

/** 传输形态的路径令牌：含空白的路径走引号包裹（芯片 \S 语法无法跨空白）。 */
function transportToken(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

const DEFAULT_PER_REF_TIMEOUT_MS = 1500;
const DEFAULT_MAX_PER_REF_CHARS = 24_000;
const DEFAULT_MAX_TOTAL_CHARS = 96_000;
/** 总额度剩余低于此值时不再切内容碎屑——只传路径（残片块对模型毫无价值）。 */
const MIN_TOTAL_REMAINING_CHARS = 200;

export interface ExpandRefsOptions {
  /** 内容解析器（App 注入 editorReadFile 按真实路径读取）。null = 读取失败。 */
  resolveContent: (entry: RefEntry) => Promise<string | null>;
  /** 单个引用的内容读取超时；超时按"仅路径"降级，绝不阻塞发送。 */
  perRefTimeoutMs?: number;
  maxPerRefChars?: number;
  maxTotalChars?: number;
  /** 总额度剩余低于此值时不再切内容碎屑（默认 200；测试可调小）。 */
  minTotalRemainingChars?: number;
}

export interface ExpandRefsResult {
  /** 传输形态全文（真实路径 + 已内联的 <reference> 内容块）。 */
  text: string;
  /** 无登记的紧凑令牌（原样保留；内部解析器已把未登记令牌降级为纯文本，
   *  该字段当前恒为空——保留给未来把解析器外置的场景）。 */
  unresolved: string[];
  /** 成功内联内容的引用数。 */
  attached: number;
  /** 内容读取失败/超时、只携带路径的引用数。 */
  pathOnly: number;
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T | null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise.catch(() => null), deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function referenceBlock(entry: RefEntry, content: string, truncated: boolean): string {
  // 属性值转义：路径/标题含引号时不得破坏属性边界（否则回放折叠失配）。
  const esc = (value: string): string => value.replace(/"/g, "&quot;").replace(/&(?!(?:quot|amp|lt|gt);)/g, "&amp;");
  const title = esc(entry.label);
  const path = esc(entry.path);
  const note = truncated ? "\n…(content truncated)" : "";
  return `<reference kind="${entry.kind}" path="${path}" title="${title}">\n${content}${note}\n</reference>`;
}

/**
 * 展示形态 → 传输形态：把草稿里的紧凑令牌替换为真实绝对路径，并把每个
 * 已登记引用的真实内容（并行读取、单引用截断、总量截断、超时 fail-open）
 * 以 <reference> 块追加在正文之后。未登记的令牌原样保留并列入 unresolved。
 */
export async function expandDraftRefs(
  draft: string,
  entries: ReadonlyMap<string, RefEntry>,
  options: ExpandRefsOptions
): Promise<ExpandRefsResult> {
  const perRefTimeoutMs = options.perRefTimeoutMs ?? DEFAULT_PER_REF_TIMEOUT_MS;
  const maxPerRefChars = options.maxPerRefChars ?? DEFAULT_MAX_PER_REF_CHARS;
  const maxTotalChars = options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  const minTotalRemainingChars = options.minTotalRemainingChars ?? MIN_TOTAL_REMAINING_CHARS;

  const unresolved: string[] = [];
  const ordered: RefEntry[] = [];
  const seen = new Set<string>();
  const parts: string[] = [];
  // 注册表解析器：贪婪令牌在 CJK 无空格跟打/句尾标点下会多吃字符——
  // 最长前缀命中的键才算引用，剩余字符留作正文（2026-09-15 审查修复）。
  const resolveStoreToken = (raw: string): string | null => {
    if (entries.has(raw)) return raw;
    let best: string | null = null;
    for (const key of entries.keys()) {
      if (raw.startsWith(key) && (best === null || key.length > best.length)) best = key;
    }
    return best;
  };
  for (const seg of splitStoreRefSegments(draft, undefined, resolveStoreToken)) {
    if (seg.kind !== "ref" || !seg.ref.compact) {
      parts.push(seg.kind === "text" ? seg.text : seg.ref.raw);
      continue;
    }
    const entry = entries.get(seg.ref.raw);
    if (!entry) {
      unresolved.push(seg.ref.raw);
      parts.push(seg.ref.raw);
      continue;
    }
    parts.push(transportToken(entry.path));
    if (!seen.has(entry.token)) {
      seen.add(entry.token);
      ordered.push(entry);
    }
  }

  let text = parts.join("");
  if (ordered.length === 0) {
    return { text, unresolved, attached: 0, pathOnly: 0 };
  }

  // 并行读取；单个失败/超时 → null（仅路径降级），绝不拖住整体。
  const contents = await Promise.all(
    ordered.map((entry) => withDeadline(options.resolveContent(entry), perRefTimeoutMs))
  );

  const blocks: string[] = [];
  let total = 0;
  let attached = 0;
  let pathOnly = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    const entry = ordered[i]!;
    const raw = contents[i];
    if (!raw || raw.trim().length === 0) {
      pathOnly += 1;
      continue;
    }
    const remaining = maxTotalChars - total;
    if (remaining < minTotalRemainingChars) {
      pathOnly += 1;
      continue;
    }
    const budget = Math.min(maxPerRefChars, remaining);
    const truncated = raw.length > budget;
    const content = truncated ? raw.slice(0, budget) : raw;
    total += content.length;
    blocks.push(referenceBlock(entry, content, truncated));
    attached += 1;
  }
  if (blocks.length > 0) {
    text = `${text.replace(/\s*$/, "")}\n\n${blocks.join("\n\n")}`;
  }
  return { text, unresolved, attached, pathOnly };
}
