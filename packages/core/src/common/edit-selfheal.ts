/**
 * read→edit 失败自愈层（specs/model-vendor-profiles P2.5 —
 * MiniMax edit-line-number-retry + Step Unicode 归一 + ZCode 行号剥离的
 * 零依赖融合）。
 *
 * 问题：模型把 read 输出的「行号前缀」或排版级 Unicode 变体抄进
 * edit 的 oldString，得到 "oldString not found" 且无恢复路径——直接
 * 打断核心 read→edit 回路。与 DeepOrca 的 snippet_id 强约束互补：
 * 那是协议级预防，这是失败驱动的最后一道宽松自愈。
 *
 * 约束（MiniMax 原文精神）：仅当块内**每一条非空行**都是前缀形状才
 * 剥离；只重试一次；二次失败重抛原始错误（模型必须看到它真正发送的
 * 文本的失败）。
 */

/** 判定一行是否是「行号前缀」形状（`123:` / `123→tab` / `    123 |`）。 */
const LINE_NUMBER_PREFIX = /^\s*\d+\s*[:→|]\s?/;

/**
 * Unicode 排版归一（Step edit-diff normalizeForFuzzyMatch）：
 * NFKC（全角→半角等）+ 智能引号→ASCII + 7 种连字符/破折号→`-` +
 * 9 种特殊空格→普通空格 + 行尾空白剥离。模型抄写文件时输出的排版级
 * 变体经此归一后可与原文精确匹配。
 */
export function normalizeForEditMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}

/** 块内每一条非空行都是行号前缀形状（MiniMoM「全前缀形状才剥离」）。 */
export function isLineNumberPrefixedBlock(text: string): boolean {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return false;
  return lines.every((line) => LINE_NUMBER_PREFIX.test(line));
}

/** 剥离行号前缀（每行一个）。 */
export function stripLineNumberPrefixes(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(LINE_NUMBER_PREFIX, ""))
    .join("\n");
}

export type EditSelfHealResult =
  | { healed: false; reason: "not-found-shape" | "not-prefix-block" }
  | {
      healed: true;
      oldString: string;
      newString: string;
      strategy: "strip-line-numbers" | "unicode-normalize" | "both";
    };

/**
 * 失败驱动的一次性自愈：给定「未命中」的 (oldString, newString) 与文件
 * 内容，产出一个可重试的修正对；不可修正时返回 healed:false（调用方
 * 重抛原始错误——绝不静默吞掉）。
 *
 * 尝试顺序：① 行号前缀剥离（仅当全块为前缀形状）② Unicode 归一
 * （oldString 归一后须真的能在文件里命中，否则不算修复）③ 两者叠加。
 */
export function healEditStrings(oldString: string, newString: string, fileContent: string): EditSelfHealResult {
  // ① 行号前缀剥离。
  if (isLineNumberPrefixedBlock(oldString)) {
    const strippedOld = stripLineNumberPrefixes(oldString);
    const strippedNew = stripLineNumberPrefixes(newString);
    if (fileContent.includes(strippedOld)) {
      return {
        healed: true,
        oldString: strippedOld,
        newString: strippedNew,
        strategy: "strip-line-numbers",
      };
    }
  }
  // ② Unicode 排版归一（oldString 归一后必须命中——归了也不在文件里
  // 说明不是排版问题，不强行修复）。
  const normalizedOld = normalizeForEditMatch(oldString);
  if (normalizedOld !== oldString && fileContent.includes(normalizedOld)) {
    return {
      healed: true,
      oldString: normalizedOld,
      newString: normalizeForEditMatch(newString),
      strategy: "unicode-normalize",
    };
  }
  // ③ 叠加：前缀块归一后再剥。
  if (isLineNumberPrefixedBlock(normalizedOld)) {
    const bothOld = stripLineNumberPrefixes(normalizedOld);
    if (fileContent.includes(bothOld)) {
      return {
        healed: true,
        oldString: bothOld,
        newString: stripLineNumberPrefixes(normalizeForEditMatch(newString)),
        strategy: "both",
      };
    }
  }
  return { healed: false, reason: isLineNumberPrefixedBlock(oldString) ? "not-found-shape" : "not-prefix-block" };
}
