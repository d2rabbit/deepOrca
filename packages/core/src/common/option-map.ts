/**
 * 受限表达式选项映射 DSL（specs/model-vendor-profiles P3.1 后半 —— ZCode
 * `@zcode/model-option-map` 的完整移植；调研报告 D9.3/D9.5 为语义基准）。
 *
 * 定位：把「用户选项值（如 reasoningLevel）→ 请求体 JSON patch」的翻译从
 * 代码分支搬进**数据**（一条受限表达式串），使模型专属适配可以不改代码、
 * 可编译期校验地表达。与 optimization-patches.ts 的分工：本模块只负责
 * 「表达式串 → 单个 JsonObject patch」；多个 patch 按序应用 + 路径冲突
 * 检测复用 {@link applyPatches}（同一能力不重复实现）。
 *
 * 表达力边界（与 ZCode evaluator/parser 一致——无 IO、无副作用、纯表达式）：
 *   支持：字面量（单/双引号字符串、数字、true/false/null、数组、对象）、
 *         唯一变量 `input`、一元 `! - +`、二元 `== != < <= > >= + - * / % && ||`、
 *         三元 `? :`、括号分组。
 *   不支持：函数调用、属性访问、索引、变量声明。
 * 编译期校验：结果必须是 JSON **对象**——递归进入三元两个分支检查，任何
 * 路径落到非对象即抛 {@link RestrictedCelError}（带 offset 定位）。
 */

import type { JsonObject, JsonValue } from "./optimization-patches";

export class RestrictedCelError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(`${message} (offset ${offset})`);
    this.name = "RestrictedCelError";
    this.offset = offset;
  }
}

// ── 词法 ─────────────────────────────────────────────────────────────────────

type TokenType = "number" | "string" | "ident" | "op" | "punct";
interface Token {
  type: TokenType;
  value: string;
  offset: number;
}

const TWO_CHAR_OPS = ["==", "!=", "<=", ">=", "&&", "||"];
const ONE_CHAR_OPS = ["!", "-", "+", "<", ">", "*", "/", "%", "?", ":"];
const PUNCT = ["(", ")", "[", "]", "{", "}", ","];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const start = i;
      i += 1;
      let raw = "";
      while (i < source.length && source[i] !== ch) {
        if (source[i] === "\\") {
          const next = source[i + 1];
          if (next === undefined) throw new RestrictedCelError("Unterminated escape", i);
          raw += next === "n" ? "\n" : next === "t" ? "\t" : next;
          i += 2;
          continue;
        }
        raw += source[i]!;
        i += 1;
      }
      if (i >= source.length) throw new RestrictedCelError("Unterminated string literal", start);
      i += 1;
      tokens.push({ type: "string", value: raw, offset: start });
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      const start = i;
      while (i < source.length && /[0-9._]/.test(source[i]!)) i += 1;
      tokens.push({ type: "number", value: source.slice(start, i).replace(/_/g, ""), offset: start });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i]!)) i += 1;
      tokens.push({ type: "ident", value: source.slice(start, i), offset: start });
      continue;
    }
    const two = source.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      tokens.push({ type: "op", value: two, offset: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.includes(ch)) {
      tokens.push({ type: "op", value: ch, offset: i });
      i += 1;
      continue;
    }
    if (PUNCT.includes(ch)) {
      tokens.push({ type: "punct", value: ch, offset: i });
      i += 1;
      continue;
    }
    throw new RestrictedCelError(`Unexpected character ${JSON.stringify(ch)}`, i);
  }
  return tokens;
}

// ── 语法（递归下降；优先级低→高：三元 < || < && < 相等 < 关系 < 加减 < 乘除 < 一元 < 初等）──

type Node =
  | { kind: "literal"; value: JsonValue }
  | { kind: "input" }
  | { kind: "array"; items: Node[] }
  | { kind: "object"; entries: Array<{ key: string; value: Node }> }
  | { kind: "unary"; op: string; operand: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "ternary"; test: Node; consequent: Node; alternate: Node };

class Parser {
  private pos = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  parseExpression(): Node {
    const node = this.parseTernary();
    const next = this.tokens[this.pos];
    if (next) throw new RestrictedCelError(`Unexpected token ${JSON.stringify(next.value)}`, next.offset);
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eatOp(op: string): boolean {
    const token = this.peek();
    if (token && token.type === "op" && token.value === op) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  /**
   * 按值匹配（不区分 op/punct）：`?` 与 `:` 在词法里属 op，但 `:` 同时是
   * 对象字面量的键值分隔符——两处都必须能用同一个值语义消费。
   */
  private eatValue(value: string): boolean {
    const token = this.peek();
    if (token && token.value === value && (token.type === "op" || token.type === "punct")) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private expectPunct(value: string): Token {
    const token = this.peek();
    if (!token || token.type !== "punct" || token.value !== value) {
      throw new RestrictedCelError(`Expected ${JSON.stringify(value)}`, token?.offset ?? this.source_end());
    }
    this.pos += 1;
    return token;
  }

  private source_end(): number {
    const last = this.tokens[this.tokens.length - 1];
    return last ? last.offset + last.value.length : 0;
  }

  private parseTernary(): Node {
    const test = this.parseBinary(0);
    if (this.eatValue("?")) {
      const consequent = this.parseTernary();
      if (!this.eatValue(":")) {
        throw new RestrictedCelError("Expected ':' in ternary", this.peek()?.offset ?? this.source_end());
      }
      const alternate = this.parseTernary();
      return { kind: "ternary", test, consequent, alternate };
    }
    return test;
  }

  private static readonly BINARY_LEVELS: readonly string[][] = [
    ["||"],
    ["&&"],
    ["==", "!="],
    ["<", "<=", ">", ">="],
    ["+", "-"],
    ["*", "/", "%"],
  ];

  private parseBinary(level: number): Node {
    if (level >= Parser.BINARY_LEVELS.length) return this.parseUnary();
    let left = this.parseBinary(level + 1);
    for (;;) {
      const token = this.peek();
      if (!token || token.type !== "op" || !Parser.BINARY_LEVELS[level]!.includes(token.value)) break;
      this.pos += 1;
      const right = this.parseBinary(level + 1);
      left = { kind: "binary", op: token.value, left, right };
    }
    return left;
  }

  private parseUnary(): Node {
    const token = this.peek();
    if (token && token.type === "op" && (token.value === "!" || token.value === "-" || token.value === "+")) {
      this.pos += 1;
      return { kind: "unary", op: token.value, operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const token = this.peek();
    if (!token) throw new RestrictedCelError("Unexpected end of expression", this.source_end());
    if (token.type === "number") {
      this.pos += 1;
      const value = Number(token.value);
      if (Number.isNaN(value)) throw new RestrictedCelError("Invalid number literal", token.offset);
      return { kind: "literal", value };
    }
    if (token.type === "string") {
      this.pos += 1;
      return { kind: "literal", value: token.value };
    }
    if (token.type === "ident") {
      this.pos += 1;
      if (token.value === "true") return { kind: "literal", value: true };
      if (token.value === "false") return { kind: "literal", value: false };
      if (token.value === "null") return { kind: "literal", value: null };
      if (token.value === "input") return { kind: "input" };
      throw new RestrictedCelError(
        `Unknown identifier ${JSON.stringify(token.value)} — only 'input' is in scope`,
        token.offset
      );
    }
    if (token.value === "(") {
      this.pos += 1;
      const inner = this.parseTernary();
      this.expectPunct(")");
      return inner;
    }
    if (token.value === "[") {
      this.pos += 1;
      const items: Node[] = [];
      if (this.peek()?.value !== "]") {
        for (;;) {
          items.push(this.parseTernary());
          if (this.eatValue(",")) continue;
          break;
        }
      }
      this.expectPunct("]");
      return { kind: "array", items };
    }
    if (token.value === "{") {
      this.pos += 1;
      const entries: Array<{ key: string; value: Node }> = [];
      if (this.peek()?.value !== "}") {
        for (;;) {
          const keyToken = this.peek();
          if (!keyToken || (keyToken.type !== "ident" && keyToken.type !== "string")) {
            throw new RestrictedCelError("Expected object key", keyToken?.offset ?? this.source_end());
          }
          this.pos += 1;
          if (!this.eatValue(":")) {
            throw new RestrictedCelError("Expected ':' after object key", this.peek()?.offset ?? this.source_end());
          }
          entries.push({ key: keyToken.value, value: this.parseTernary() });
          if (this.eatValue(",")) continue;
          break;
        }
      }
      this.expectPunct("}");
      return { kind: "object", entries };
    }
    throw new RestrictedCelError(`Unexpected token ${JSON.stringify(token.value)}`, token.offset);
  }
}

// ── 编译期结果校验：每条路径都必须落到对象字面量 ────────────────────────────

function assertObjectResult(node: Node): void {
  switch (node.kind) {
    case "object":
      // 对象字面量即合法结果——entry 值是 JsonValue 位置（可放任意表达式，
      // 含产标量的三元），不在这里检查（ZCode 语义：校验的是「结果整体
      // 是对象」，不是每个子值都是对象）。
      return;
    case "ternary":
      // 唯一会改变结果形状的构造——两条分支都必须落到对象。
      assertObjectResult(node.consequent);
      assertObjectResult(node.alternate);
      return;
    default:
      // 校验失败的定位给到整条表达式（AST 未回带每个节点的 offset；
      // 语法层错误已带精确 offset，这里补充的是「语义形状」错误）。
      throw new RestrictedCelError(
        "Expression must evaluate to a JSON object on every branch (object literals only)",
        0
      );
  }
}

// ── 求值 ─────────────────────────────────────────────────────────────────────

export type RestrictedCelInput = string | number | boolean | null;

function evaluateNode(node: Node, input: RestrictedCelInput): JsonValue {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "input":
      return input;
    case "array":
      return node.items.map((item) => evaluateNode(item, input));
    case "object": {
      const result: Record<string, JsonValue> = {};
      for (const entry of node.entries) result[entry.key] = evaluateNode(entry.value, input);
      return result;
    }
    case "unary": {
      const value = evaluateNode(node.operand, input);
      if (node.op === "!") return !truthy(value);
      const num = requireNumber(value, node.op);
      return node.op === "-" ? -num : +num;
    }
    case "binary":
      return evaluateBinary(node, input);
    case "ternary":
      return truthy(evaluateNode(node.test, input))
        ? evaluateNode(node.consequent, input)
        : evaluateNode(node.alternate, input);
  }
}

function truthy(value: JsonValue): boolean {
  return value !== null && value !== false && value !== 0 && value !== "";
}

function requireNumber(value: JsonValue, op: string): number {
  if (typeof value !== "number") {
    throw new RestrictedCelError(`Operator ${op} requires numeric operands`, 0);
  }
  return value;
}

function requirePrimitive(value: JsonValue, op: string): string | number | boolean | null {
  if (value !== null && typeof value === "object") {
    throw new RestrictedCelError(`Operator ${op} requires scalar operands`, 0);
  }
  return value;
}

function evaluateBinary(node: Extract<Node, { kind: "binary" }>, input: RestrictedCelInput): JsonValue {
  const op = node.op;
  if (op === "&&") {
    return truthy(evaluateNode(node.left, input)) ? evaluateNode(node.right, input) : false;
  }
  if (op === "||") {
    const left = evaluateNode(node.left, input);
    return truthy(left) ? left : evaluateNode(node.right, input);
  }
  const left = evaluateNode(node.left, input);
  const right = evaluateNode(node.right, input);
  switch (op) {
    case "==":
      return requirePrimitive(left, op) === requirePrimitive(right, op);
    case "!=":
      return requirePrimitive(left, op) !== requirePrimitive(right, op);
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const l = requireNumber(left, op);
      const r = requireNumber(right, op);
      return op === "<" ? l < r : op === "<=" ? l <= r : op === ">" ? l > r : l >= r;
    }
    case "+": {
      if (typeof left === "string" || typeof right === "string") {
        return `${formatConcat(left)}${formatConcat(right)}`;
      }
      return requireNumber(left, op) + requireNumber(right, op);
    }
    case "-":
      return requireNumber(left, op) - requireNumber(right, op);
    case "*":
      return requireNumber(left, op) * requireNumber(right, op);
    case "/":
      return requireNumber(left, op) / requireNumber(right, op);
    case "%":
      return requireNumber(left, op) % requireNumber(right, op);
    default:
      throw new RestrictedCelError(`Unsupported operator ${op}`, 0);
  }
}

function formatConcat(value: JsonValue): string {
  return value === null ? "null" : String(value);
}

// ── 门面：编译（带 memo）→ 求值 → 冻结 ──────────────────────────────────────

export interface RestrictedCelProgram {
  readonly source: string;
  /** 用本轮冻结的选项值求值；结果深冻结。 */
  evaluate(input: RestrictedCelInput): JsonObject;
}

const programCache = new Map<string, RestrictedCelProgram>();
const PROGRAM_CACHE_LIMIT = 64;

/**
 * 编译一条受限表达式（进程级 memo：同一 map 源只 parse/校验一次）。
 * 任何语法/校验失败抛 RestrictedCelError——调用方 fail-open。
 */
export function compileOptionMap(source: string): RestrictedCelProgram {
  const cached = programCache.get(source);
  if (cached) return cached;
  const tokens = tokenize(source);
  if (tokens.length === 0) throw new RestrictedCelError("Empty expression", 0);
  const ast = new Parser(tokens).parseExpression();
  assertObjectResult(ast);
  const program: RestrictedCelProgram = {
    source,
    evaluate(input: RestrictedCelInput): JsonObject {
      const value = evaluateNode(ast, input);
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new RestrictedCelError("Expression evaluated to a non-object", 0);
      }
      return freezeJson(value) as JsonObject;
    },
  };
  if (programCache.size >= PROGRAM_CACHE_LIMIT) {
    const oldest = programCache.keys().next().value;
    if (oldest !== undefined) programCache.delete(oldest);
  }
  programCache.set(source, program);
  return program;
}

function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  if (value !== null && typeof value === "object") {
    const frozen: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) frozen[key] = freezeJson(entry);
    return Object.freeze(frozen);
  }
  return value;
}
