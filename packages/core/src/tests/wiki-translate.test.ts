/**
 * Unit + functional tests for wiki.translate — the backend bilingual
 * translation stage of the build pipeline.
 *
 * Pins the naming convention (`<page>.<lang>.md`), the language heuristic
 * (CJK ratio after code/frontmatter stripping), the lexical containment
 * guard, the enumeration filter (variants never listed as base pages), and
 * the run orchestration end-to-end with a stubbed completeViaLlm: fresh
 * translate, mtime skip, LLM failure counting, and the no-LLM fail-open path.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ActionContext } from "../actions/types";
import {
  detectWikiLanguage,
  wikiVariantPath,
  isWikiVariantFile,
  containedUnderWiki,
  listWikiBasePages,
  wikiTranslateRun,
} from "../actions/wiki-translate";

async function withTempWiki(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wiki-translate-"));
  await fs.mkdir(path.join(root, "openwiki"), { recursive: true });
  try {
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function makeCtx(root: string, complete?: ActionContext["completeViaLlm"]): ActionContext {
  return {
    projectRoot: root,
    signal: new AbortController().signal,
    emit: () => {},
    spawner: null as unknown as ActionContext["spawner"],
    ...(complete ? { completeViaLlm: complete } : {}),
  };
}

test("detectWikiLanguage: Chinese prose wins even with english code fences", () => {
  const zh =
    "---\ntitle: 概览\n---\n# 系统概览\n\n这个模块负责会话的持久化与流式输出，是整个应用运行时的核心组件之一，" +
    "下面用一段代码展示典型配置方式。\n\n```bash\nexport FOO=bar_v2\nexport DEEPORCA_HOME=/tmp/home\n```\n" +
    "补充说明：该模块同时承担上下文压缩与工具调用的调度职责，读写路径都经过包含校验。";
  assert.equal(detectWikiLanguage(zh), "zh");
});

test("detectWikiLanguage: english prose with CJK mentions stays english", () => {
  const en =
    "---\ntitle: Overview\n---\n# System overview\n\nThis module handles session persistence and streaming. " +
    "The converter pairs tool results by their call id, and the index survives restarts. 它也会引用中文词条。";
  assert.equal(detectWikiLanguage(en), "en");
});

test("detectWikiLanguage: too little prose signal returns null (page is skipped)", () => {
  assert.equal(detectWikiLanguage("ok\n"), null);
});

test("wikiVariantPath / isWikiVariantFile: sibling naming convention", () => {
  assert.equal(wikiVariantPath("a/b.md", "zh"), "a/b.zh.md");
  assert.equal(wikiVariantPath("top.md", "en"), "top.en.md");
  assert.ok(isWikiVariantFile("b.zh.md"));
  assert.ok(isWikiVariantFile("b.EN.md"));
  assert.ok(!isWikiVariantFile("b.md"));
  assert.ok(!isWikiVariantFile("b.zh.txt"));
});

test("containedUnderWiki: traversal and outside absolutes are rejected", () => {
  const wikiDir = path.join(path.sep, "proj", "openwiki");
  assert.ok(containedUnderWiki(wikiDir, "a/b.md"));
  assert.ok(!containedUnderWiki(wikiDir, "../secret.md"));
  assert.ok(!containedUnderWiki(wikiDir, "../../outside.md"));
});

test("listWikiBasePages: enumerates recursively, skips variants and dot dirs", async () => {
  await withTempWiki(async (root) => {
    const wiki = path.join(root, "openwiki");
    await fs.writeFile(path.join(wiki, "home.md"), "english home page content here");
    await fs.mkdir(path.join(wiki, "guides"), { recursive: true });
    await fs.writeFile(path.join(wiki, "guides", "install.md"), "english install guide content");
    await fs.writeFile(path.join(wiki, "guides", "install.zh.md"), "译文");
    await fs.mkdir(path.join(wiki, ".git"), { recursive: true });
    await fs.writeFile(path.join(wiki, ".git", "config.md"), "ignored");
    assert.deepEqual(await listWikiBasePages(wiki), ["guides/install.md", "home.md"]);
  });
});

test("wikiTranslateRun: translates fresh pages, writes variants, reports counts", async () => {
  await withTempWiki(async (root) => {
    await fs.writeFile(
      path.join(root, "openwiki", "a.md"),
      "# Overview\n\nThis module owns session persistence, streaming transport and the tool-call loop."
    );
    await fs.writeFile(
      path.join(root, "openwiki", "b.md"),
      "# 概览\n\n这个模块负责会话持久化、流式传输与工具调用循环，是运行时的核心链路，承担全部调度职责。"
    );
    const calls: string[] = [];
    const out = await wikiTranslateRun(
      {},
      makeCtx(root, async (messages) => {
        calls.push(messages[1]?.content.slice(0, 24) ?? "");
        return `# TRANSLATED ${calls.length}`;
      })
    );
    assert.equal(out.total, 2);
    assert.equal(out.translated, 2);
    assert.equal(out.failed, 0);
    assert.equal(calls.length, 2);
    const zhVariant = await fs.readFile(path.join(root, "openwiki", "a.zh.md"), "utf8");
    assert.match(zhVariant, /^# TRANSLATED/);
    assert.ok(zhVariant.endsWith("\n"), "variant gets a trailing newline");
    const enVariant = await fs.readFile(path.join(root, "openwiki", "b.en.md"), "utf8");
    assert.match(enVariant, /^# TRANSLATED/);
  });
});

test("wikiTranslateRun: up-to-date variants are skipped via mtime", async () => {
  await withTempWiki(async (root) => {
    const src = path.join(root, "openwiki", "a.md");
    const variant = path.join(root, "openwiki", "a.zh.md");
    await fs.writeFile(src, "# Overview\n\nThis module owns session persistence and the streaming transport.");
    await fs.writeFile(variant, "# 既有译文\n\n这个模块负责会话持久化与流式传输，承担运行时核心调度职责。");
    // Make the variant strictly newer than the source.
    const now = new Date();
    await fs.utimes(src, new Date(now.getTime() - 10_000), new Date(now.getTime() - 10_000));
    let llmCalls = 0;
    const out = await wikiTranslateRun(
      {},
      makeCtx(root, async () => {
        llmCalls++;
        return "unused";
      })
    );
    assert.equal(out.upToDate, 1);
    assert.equal(out.translated, 0);
    assert.equal(llmCalls, 0);
  });
});

test("wikiTranslateRun: per-page LLM failure is counted, never thrown", async () => {
  await withTempWiki(async (root) => {
    await fs.writeFile(
      path.join(root, "openwiki", "a.md"),
      "# Overview\n\nThis module owns session persistence, streaming transport and the tool-call loop."
    );
    const out = await wikiTranslateRun(
      {},
      makeCtx(root, async () => {
        return null; // fail-open contract of completeViaLlm
      })
    );
    assert.equal(out.failed, 1);
    assert.equal(out.translated, 0);
  });
});

test("wikiTranslateRun: no completeViaLlm → noLlm fail-open, stage reports skipped", async () => {
  await withTempWiki(async (root) => {
    await fs.writeFile(
      path.join(root, "openwiki", "a.md"),
      "# Overview\n\nThis module owns session persistence, streaming transport and the tool-call loop."
    );
    const out = await wikiTranslateRun({}, makeCtx(root));
    assert.equal(out.noLlm, true);
    assert.equal(out.skipped, 1);
  });
});
