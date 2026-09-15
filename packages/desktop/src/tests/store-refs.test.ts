// Store-reference chip parsing (renderer/lib/store-refs.ts) — regression
// pins for the 2026-09 review findings: "reviews" substring must not flip a
// wiki page to a review chip; a sentence period after a skill reference must
// not kill the chip; "$ …" prose must not become a command chip. Pure lib —
// no DOM or api stub needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractStoreReferences,
  isCompleteStoreRef,
  splitStoreRefSegments,
  storeRefPath,
} from "../renderer/lib/store-refs";

test("deepwiki page whose filename contains 'reviews' stays a wiki chip", () => {
  const text = "see @D:\\repo\\.deeporca\\deepwiki\\reviews-guide.md for context";
  const { refs } = extractStoreReferences(text);
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "wiki");
  assert.equal(refs[0]?.label, "reviews-guide");
});

test("reports under the reviews DIRECTORY keep the review chip + timestamp label", () => {
  const text = "报告 @D:\\repo\\.deeporca\\reviews\\review-2026-08-30T10-30-abc.json 已生成";
  const { refs } = extractStoreReferences(text);
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "review");
  assert.equal(refs[0]?.label, "2026/08/30 10:30");
});

test("a skill reference followed by an ASCII sentence period still chips", () => {
  const text = "try @frontend-review. then report back";
  const segments = splitStoreRefSegments(text);
  const ref = segments.find((s) => s.kind === "ref");
  assert.ok(ref && ref.kind === "ref");
  if (ref.kind === "ref") {
    assert.equal(ref.ref.kind, "skill");
    assert.equal(ref.ref.raw, "@frontend-review", "the period stays outside the chip");
  }
  assert.ok(
    segments.some((s) => s.kind === "text" && s.text.startsWith(". then report")),
    "period remains text"
  );
});

test("a root-level file with an extension now chips as file (2026-09-05 fix 3)", () => {
  // "@frontend-review.md" reads like a file — since root-level files are
  // recognized, it is a FILE chip (the skill shape's extension lookahead
  // already yields disambiguation: @x.md → file, @x → skill).
  const { refs } = extractStoreReferences("open @frontend-review.md please");
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "file");
  assert.equal(refs[0]?.label, "frontend-review.md");
});

test("relative .deeporca forms keep their wiki/review semantics (2026-09-05 fix 2)", () => {
  const { refs } = extractStoreReferences(
    "see @.deeporca/deepwiki/roadmap.md and @.deeporca/reviews/review-2026-09-05T10-00.json"
  );
  assert.equal(refs.length, 2);
  assert.equal(refs[0]?.kind, "wiki");
  assert.equal(refs[0]?.label, "roadmap");
  assert.equal(refs[1]?.kind, "review");
});

test("root-level plain file chips as file (2026-09-05 fix 3)", () => {
  const { refs } = extractStoreReferences("check @README.md first");
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "file");
  assert.equal(refs[0]?.label, "README.md");
});

test("prose containing '$ ' does not become a command chip", () => {
  const text = "it costs $ a month after the trial";
  const { refs } = extractStoreReferences(text);
  assert.equal(refs.length, 0, "stopword-first prose is not a command");
  assert.equal(
    splitStoreRefSegments(text).every((s) => s.kind === "text"),
    true,
    "text preserved verbatim"
  );
});

test("real command lines still chip with the command as label", () => {
  const { refs } = extractStoreReferences("run $ npm test --watch");
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "cmd");
  assert.equal(refs[0]?.label, "npm test --watch");
});

// ── 2026-09-06: quoted form (whitespace paths) + root-level regression guards ──

test("a QUOTED wiki path containing spaces chips as wiki (2026-09-06 quoted form)", () => {
  const text = '参考 @"My Drive/My Project/.deeporca/deepwiki/road map.md" 再动手';
  const { refs } = extractStoreReferences(text);
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "wiki");
  assert.equal(refs[0]?.label, "road map", "label drops quotes and the .md suffix");
  assert.equal(refs[0]?.raw, '@"My Drive/My Project/.deeporca/deepwiki/road map.md"');
});

test("a QUOTED plain file path containing spaces chips as file", () => {
  const { refs } = extractStoreReferences('看下 @"docs/My Notes.txt" 谢谢');
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "file");
  assert.equal(refs[0]?.label, "docs/My Notes.txt", "2026-09-15: multi-segment files show parent/file");
});

test("a QUOTED review path containing spaces chips as review with timestamp label", () => {
  const { refs } = extractStoreReferences('报告 @"My Project/.deeporca/reviews/review-2026-09-05T10-00-x.json" 已生成');
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "review");
  assert.equal(refs[0]?.label, "2026/09/05 10:00");
});

test("an email address in prose does NOT become a file chip (2026-09-06 guard)", () => {
  // Root-level files were legalized on 2026-09-05, which let the bare
  // "@gmail.com" tail of "someone@gmail.com" chip as a file — the lookbehind
  // now refuses an @ directly attached to a word character.
  const { refs } = extractStoreReferences("联系 someone@gmail.com 或者 dev@team.org 问问");
  assert.equal(refs.length, 0);
});

test("prose like '@e.g.' does NOT become a file chip (2026-09-06 guard)", () => {
  // Single-character basenames ("e" before the dot) are prose, not files.
  const { refs } = extractStoreReferences("如 @e.g. 与 @i.e. 所说");
  assert.equal(refs.length, 0);
});

test("single-character root-level basenames stay plain text (documented trade-off)", () => {
  // \S{2,}? requires a ≥2-char basename — real files that short at the repo
  // root are vanishingly rare, and prose forms are not.
  const { refs } = extractStoreReferences("open @a.ts now");
  assert.equal(refs.length, 0);
});

test("storeRefPath unwraps @-prefix and quotes for filesystem consumers", () => {
  assert.equal(storeRefPath("@.deeporca/deepwiki/roadmap.md"), ".deeporca/deepwiki/roadmap.md");
  assert.equal(storeRefPath('@"My Project/.deeporca/deepwiki/a.md"'), "My Project/.deeporca/deepwiki/a.md");
  assert.equal(storeRefPath("@README.md"), "README.md");
});

test("quoted refs count as COMPLETE (menu suppression over finished references)", () => {
  assert.equal(isCompleteStoreRef('@"My Project/.deeporca/deepwiki/a.md"'), true);
  assert.equal(isCompleteStoreRef('@"half typed'), false);
});

// ── 2026-09-15: ref-buffer compact store tokens (@wiki/ @review/ @design/ @prototype/) ──

test("compact store tokens chip with their declared kind and slug label", () => {
  const { refs } = extractStoreReferences("结合 @wiki/架构设计 和 @review/2026-09-02-15-49 一起看");
  assert.equal(refs.length, 2);
  assert.equal(refs[0]?.kind, "wiki");
  assert.equal(refs[0]?.label, "架构设计");
  assert.equal(refs[0]?.compact, true);
  assert.equal(refs[1]?.kind, "review");
  assert.equal(refs[1]?.compact, true);
});

test("design and prototype tokens get their own chip kinds", () => {
  const { refs } = extractStoreReferences("看看 @design/设计系统 与 @prototype/登录流程-demo");
  assert.deepEqual(
    refs.map((r) => r.kind),
    ["design", "prototype"]
  );
  assert.equal(refs[0]?.label, "设计系统");
  assert.equal(refs[1]?.label, "登录流程-demo");
});

test("extension-shaped @kind/ tokens resolve conservatively as files (no registry)", () => {
  // 无注册表上下文（回放气泡）：".ext" 结尾按文件芯片兜底——比把它当成
  // 必然悬空的紧凑令牌诚实。
  const { refs } = extractStoreReferences("read @wiki/notes.md please");
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "file");
  assert.equal(refs[0]?.label, "wiki/notes.md");
  assert.notEqual(refs[0]?.compact, true);
});

test("compact tokens count as COMPLETE for @-menu suppression", () => {
  assert.equal(isCompleteStoreRef("@wiki/架构设计"), true);
  assert.equal(isCompleteStoreRef("@wiki/"), false, "prefix without slug stays a query");
});

test("store completeness requires a registry hit when a resolver is given", () => {
  // 2026-09-15 bug-hunt 回归：语法完整判定曾把敲到一半的 @wiki/架 也当成品
  // 关掉 @ 菜单，掐死了前缀搜索流；Composer 侧传入注册表解析器后，完整 =
  // 注册命中（与 dir 组"查询不得关菜单"的约束对齐）。
  const resolver = (raw: string): string | null => (raw.startsWith("@wiki/架构设计") ? "@wiki/架构设计" : null);
  assert.equal(isCompleteStoreRef("@wiki/架构设计", resolver), true, "registered token = finished citation");
  assert.equal(isCompleteStoreRef("@wiki/架构设计。", resolver), true, "trailing punctuation still covers the key");
  assert.equal(isCompleteStoreRef("@wiki/架", resolver), false, "half-typed prefix is a query, not a citation");
  assert.equal(isCompleteStoreRef("@wiki/完全未登记", resolver), false);
  // 无解析器（测试/独立调用面）：语法判定兜底，行为不变
  assert.equal(isCompleteStoreRef("@wiki/架构设计"), true);
  assert.equal(isCompleteStoreRef("@wiki/"), false);
});

test("resolveLabel overrides the slug fallback for compact tokens only", () => {
  const segments = splitStoreRefSegments("见 @wiki/架构设计 与 @README.md", (token, kind) =>
    token === "@wiki/架构设计" && kind === "wiki" ? "真实页面标题" : null
  );
  const wiki = segments.find((s) => s.kind === "ref" && s.ref.kind === "wiki");
  const file = segments.find((s) => s.kind === "ref" && s.ref.kind === "file");
  assert.ok(wiki && wiki.kind === "ref");
  assert.equal(wiki.ref.label, "真实页面标题");
  assert.ok(file && file.kind === "ref");
  assert.equal(file.ref.label, "README.md", "non-compact refs keep the grammar label");
});

test("unregistered hand-typed @word is NOT a compact token", () => {
  const { refs } = extractStoreReferences("ping @frontend-review for a pass");
  assert.equal(refs[0]?.kind, "skill");
  assert.notEqual(refs[0]?.compact, true);
});

// ── 2026-09-15: 文件/目录引用的展示优化（与 store 引用同等的芯片待遇）──

test("directory refs (trailing separator) chip as dir with trailing-slash label", () => {
  const { refs } = extractStoreReferences("看下 @src/components/ 和 @packages/desktop/src/ 里的东西");
  assert.equal(refs.length, 2);
  assert.equal(refs[0]?.kind, "dir");
  assert.equal(refs[0]?.label, "components/");
  assert.equal(refs[1]?.kind, "dir");
  assert.equal(refs[1]?.label, "src/");
  assert.notEqual(refs[0]?.compact, true, "dirs are real paths, not registry tokens");
});

test("a multi-segment FILE keeps file kind with parent-qualified label", () => {
  const { refs } = extractStoreReferences("read @src/lib/store-refs.ts now");
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "file");
  assert.equal(refs[0]?.label, "lib/store-refs.ts");
});

test("dir completion suppresses the @ menu; a partial dir path does not", () => {
  assert.equal(isCompleteStoreRef("@src/components/"), true);
  assert.equal(isCompleteStoreRef("@src/comp"), false, "still typing → menu stays open");
});

test("file and dir refs coexist in one line, each matching once", () => {
  const text = "改 @src/lib/store-refs.ts 和 @src/components/ 两个地方";
  const segments = splitStoreRefSegments(text);
  const refs = segments.filter((s) => s.kind === "ref");
  assert.equal(refs.length, 2);
  assert.equal(refs[0]?.kind === "ref" && refs[0].ref.kind, "file");
  assert.equal(refs[1]?.kind === "ref" && refs[1].ref.kind, "dir");
  // 没有残片：目录令牌后的正文不被吃进芯片
  assert.ok(segments.some((s) => s.kind === "text" && s.text.includes("两个地方")));
});

// ── 2026-09-15 审查修复：紧凑令牌在自由文本中的降级与让位 ──

test("CJK suffix typed without space resolves via longest-prefix resolver", () => {
  // 用户跟打不空格：令牌贪婪吞掉「。谢谢」——解析器按注册表最长前缀
  // 收缩芯片边界，剩余字符留作正文，且注册键不受污染。
  const resolveStoreToken = (raw: string): string | null =>
    raw.startsWith("@wiki/架构设计") ? "@wiki/架构设计" : null;
  const segments = splitStoreRefSegments("看下 @wiki/架构设计。谢谢", undefined, resolveStoreToken);
  const ref = segments.find((s) => s.kind === "ref");
  assert.ok(ref && ref.kind === "ref");
  assert.equal(ref.ref.raw, "@wiki/架构设计");
  assert.ok(segments.some((s) => s.kind === "text" && s.text.includes("。谢谢")));
});

test("store early-exit paths keep the text preceding the chip (join invariant)", () => {
  // 2026-09-15 bug-hunt 回归：三条早退路径曾绕过通用 flush，令牌前的正文
  // （如「看下 」）在镜像层与传输形态里双双丢失。拼接不变量必须还原原文。
  const join = (segs: ReturnType<typeof splitStoreRefSegments>) =>
    segs.map((s) => (s.kind === "text" ? s.text : s.ref.raw)).join("");
  // 1) 注册表 miss + fileLike → file 芯片兜底
  const missFile = splitStoreRefSegments("看下 @wiki/notes.md 改", undefined, () => null);
  assert.equal(join(missFile), "看下 @wiki/notes.md 改");
  // 2) 最长前缀命中（CJK 跟打不空格）
  const longest = splitStoreRefSegments("看下 @wiki/架构设计。谢谢", undefined, (raw) =>
    raw.startsWith("@wiki/架构设计") ? "@wiki/架构设计" : null
  );
  assert.equal(join(longest), "看下 @wiki/架构设计。谢谢");
  // 3) 无 resolver + fileLike（回放形态）
  const noResolver = splitStoreRefSegments("看下 @wiki/notes.md 改");
  assert.equal(join(noResolver), "看下 @wiki/notes.md 改");
});

test("unregistered store-like tokens degrade to plain text (no dangling block)", () => {
  const segments = splitStoreRefSegments("看下 @wiki/完全未知的东西哦", undefined, () => null);
  assert.equal(
    segments.every((s) => s.kind === "text"),
    true,
    "no chip, no send-blocking for unknown keys"
  );
});

test("word-inner @ and real file paths never become compact tokens", () => {
  // 4c68ccee 词中 @ 守卫对 store 组同样生效
  const { refs: emailish } = extractStoreReferences("my@wiki/page x");
  assert.equal(emailish.length, 0);
  // 真实文件路径（斜杠+扩展名）落回 file 组，不被 store 组劫持
  const { refs: fileish } = extractStoreReferences("改 @review/notes.md 一下");
  assert.equal(fileish.length, 1);
  assert.equal(fileish[0]?.kind, "file");
  assert.equal(fileish[0]?.label, "review/notes.md");
});

test("URL tail like /@bob/ does not chip as directory", () => {
  const { refs } = extractStoreReferences("主页是 https://site.com/@bob/ 去看看");
  assert.equal(refs.length, 0);
});

test("deeporca designs paths chip as ONE full-path file ref on replay", () => {
  // 2026-09-15 审查：file 组曾把 @…/.deeporca/designs/... 截断成 .deeporca
  const text = "结合 @D:/repo/.deeporca/designs/s1/versions/v1.json 继续";
  const { refs } = extractStoreReferences(text);
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.kind, "file");
  assert.equal(refs[0]?.raw, "@D:/repo/.deeporca/designs/s1/versions/v1.json");
});
