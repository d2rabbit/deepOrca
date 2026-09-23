/**
 * 静态 patch 表 + 路径冲突检测（specs/model-vendor-profiles P3.1 —
 * ZCode merge-patch.ts 的零依赖移植；受限表达式 DSL 的完整移植为可选后续）。
 *
 * 语义（RFC 7386 JSON Merge Patch，ZCode 同构）：
 *   - `null` = 删除该键
 *   - 对象 = 深合并
 *   - 其它 = 覆盖
 *
 * 路径冲突检测（ZCode applyOrderedJsonMergePatches）：两个 patch 若写到
 * **重叠**的 JSON 路径（前缀比较——`$.thinking` 与 `$.thinking.type` 冲突）
 * 即抛错——防止两个优化悄悄争抢同一请求字段。这类 bug 在代码分支实现里
 * 极难发现，是 ZCode 该模块最有价值的工程保障。
 */

export type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type NamedPatch = {
  name: string;
  patch: JsonObject;
};

export class PatchConflictError extends Error {
  constructor(path: string, a: string, b: string) {
    super(`Optimization patches write conflicting JSON path ${path}: ${a} and ${b}`);
    this.name = "PatchConflictError";
  }
}

/**
 * 按序应用一组命名 patch 到 base；先做全量路径冲突检测（任两个 patch 的
 * 写入路径重叠即抛 PatchConflictError），再逐个深合并。
 */
export function applyPatches<T extends JsonObject>(base: T, patches: readonly NamedPatch[]): T {
  assertNoPathConflicts(patches);
  let result = base as Record<string, JsonValue>;
  for (const named of patches) {
    result = mergeObject(result, named.patch) as Record<string, JsonValue>;
  }
  return result as unknown as T;
}

/** 收集一个 patch 写到的全部叶路径（对象下钻，空对象视为写到自身）。 */
function collectWrittenPaths(patch: JsonObject, prefix: readonly string[] = []): string[][] {
  const paths: string[][] = [];
  for (const [key, value] of Object.entries(patch)) {
    const path = [...prefix, key];
    if (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
      paths.push(...collectWrittenPaths(value as JsonObject, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

/** 前缀重叠（ZCode pathsOverlap）：共享前缀上任意一段不同即不重叠。 */
function pathsOverlap(left: readonly string[], right: readonly string[]): boolean {
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function formatPath(path: readonly string[]): string {
  return path.length === 0 ? "$" : `$.${path.join(".")}`;
}

function assertNoPathConflicts(patches: readonly NamedPatch[]): void {
  const owned: Array<{ name: string; path: string[] }> = [];
  for (const named of patches) {
    for (const path of collectWrittenPaths(named.patch)) {
      const conflict = owned.find((entry) => pathsOverlap(entry.path, path));
      if (conflict) {
        throw new PatchConflictError(formatPath(path), conflict.name, named.name);
      }
      owned.push({ name: named.name, path });
    }
  }
}

/** RFC 7386 merge：null 删除键；双方都为对象则递归；否则覆盖。 */
function mergeObject(target: Record<string, JsonValue>, patch: JsonObject): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = { ...target };
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === null) {
      delete result[key];
      continue;
    }
    const existing = result[key];
    if (isJsonObject(patchValue) && isJsonObject(existing)) {
      result[key] = mergeObject(existing, patchValue);
      continue;
    }
    result[key] = cloneJson(patchValue);
  }
  return result;
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (!isJsonObject(value)) return value;
  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = cloneJson(entry);
  }
  return result;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
