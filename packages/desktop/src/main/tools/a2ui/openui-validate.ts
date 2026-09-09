/**
 * Local OpenUI Lang validation (user ask 2026-09-09 自递归验证循环).
 *
 * Parses candidate programs against the OFFICIAL component schema — the same
 * library the renderer renders with — via @openuidev/lang-core's parser, in
 * the main process, BEFORE anything is persisted. Pure local: no network, no
 * OpenUI service. The schema is a build-time artifact of
 * scripts/generate-openui-prompt.mjs (`npm run openui:prompt`), drift-checked
 * by the desktop build, so this validator and the renderer's runtime parse
 * cannot silently diverge on a library upgrade.
 *
 * Pure + Electron-free — unit-tests cold (see tests/openui-validate.test.ts).
 */

import {
  createParser,
  type LibraryJSONSchema,
  type ParseResult,
  type Parser,
  type ValidationError,
} from "@openuidev/lang-core";
import { OPENUI_LIBRARY_SCHEMA } from "./openui-library-schema";

export interface OpenuiVerdict {
  valid: boolean;
  /** Parser saw a truncated stream (unterminated block/statement). */
  incomplete: boolean;
  statementCount: number;
  /** Prop/schema errors — lang-core's ValidationError taxonomy. */
  errors: Array<{ code: string; component?: string; path?: string; message: string }>;
  /** Referenced but never defined (wiring — the plan's `undefined-reference`). */
  unresolved: string[];
  /** Defined but not reachable from root (wiring — `unattached-component`). */
  orphaned: string[];
  /** WP2.3 dead-button findings (core's deterministic detector, single source) —
   *  `Action([])` empty-step buttons and bare-string button actions. Surfaced as
   *  errors so core's repair loop patches them BEFORE persistence. */
  deadButtons: string[];
}

let cachedParser: Parser | null = null;
function getParser(): Parser {
  // The generated schema is typed Record<string, unknown> (lang-core's
  // JSONSchemaDef is narrower than its own toJSONSchema output) — cast at the
  // single consumption point.
  cachedParser ??= createParser(OPENUI_LIBRARY_SCHEMA as unknown as LibraryJSONSchema);
  return cachedParser;
}

// The patch-instruction wording is OWNED by core's repair loop (it is literally
// what gets fed to the subagent), so it lives there and is re-exported here —
// the desktop test pins the same function object instead of a drifting copy.
// (`openuiIssueCount` is core-side only; nothing on desktop consumes it.)
export { formatOpenuiFeedback } from "@deeporca/core";
import { findDeadButtons } from "@deeporca/core";

/** Parse one complete program and flatten the parser's verdict. */
export function validateOpenuiCode(code: string): OpenuiVerdict {
  const result: ParseResult = getParser().parse(code);
  const meta = result.meta;
  const errors = meta.errors.map((e: ValidationError) => ({
    code: e.code,
    component: e.component,
    path: e.path,
    message: e.message,
  }));
  const unresolved = [...meta.unresolved];
  const orphaned = [...meta.orphaned];
  // WP2.3: dead-button 静态检测前置进 verdict——渲染器的事后审计只覆盖双引号
  // 字面量且不在持久化前;这里用 core 的单一来源检测(含单引号与 Action([])),
  // 计入 valid 让修复环在落盘前修掉。
  const deadButtons = findDeadButtons(code);
  return {
    valid:
      errors.length === 0 &&
      unresolved.length === 0 &&
      orphaned.length === 0 &&
      !meta.incomplete &&
      deadButtons.length === 0,
    incomplete: meta.incomplete,
    statementCount: meta.statementCount,
    errors,
    unresolved,
    orphaned,
    deadButtons,
  };
}
