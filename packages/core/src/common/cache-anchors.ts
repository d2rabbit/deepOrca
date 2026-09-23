/**
 * cache_control 锚点与 TTL 单调归一（specs/model-vendor-profiles P3.2 —
 * qwen converter.ts 的零依赖移植）。
 *
 * 三个锚点：`system` / `tool` / `user.last`；每个可独立 `ephemeral`（5m）
 * 或 `'1h'`（扩展层）。**TTL 单调性归一**：Anthropic 要求长 TTL 锚点必须
 * 在短 TTL 锚点之前上线（wire 序 tool→system→user.last），`resolveCacheRetention`
 * 反向扫描把 `'1h'` 锚点**之前**的锚点自动提升为 `'1h'`——任何 per-anchor
 * 组合都产出合法请求（`{system:'1h'}` 自动连带提升 tool 锚）。
 */

export type CacheAnchor = "system" | "tool" | "user.last";
export type CacheRetention = "ephemeral" | "1h";

export type CacheRetentionByAnchor = Partial<Record<CacheAnchor, CacheRetention>>;

export type AppliedCacheAnchor = {
  anchor: CacheAnchor;
  retention: CacheRetention;
};

/** wire 序（Anthropic 要求长 TTL 在前；tool 在最前）。 */
export const CACHE_ANCHOR_WIRE_ORDER: readonly CacheAnchor[] = ["tool", "system", "user.last"];

/**
 * TTL 单调归一 + 锚点落位：输入 per-anchor 覆盖（缺省 ephemeral），
 * 输出按 wire 序排好、TTL 单调不减的锚点数组。skipCacheWrite 时
 * `user.last` 锚**前移到上一条消息**（ZCode skipCacheWrite：一次性
 * 摘要请求不污染缓存写断点）——此处建模为返回不含 user.last 的数组
 * （调用方自行把锚挂到倒数第二条消息）。
 */
export function resolveCacheAnchors(
  byAnchor: CacheRetentionByAnchor,
  options?: { skipCacheWrite?: boolean }
): AppliedCacheAnchor[] {
  // 归一：从 wire 序末位向前扫，一旦遇到 '1h'，其前所有锚提升为 '1h'。
  const resolved: Record<CacheAnchor, CacheRetention> = {
    tool: byAnchor.tool ?? "ephemeral",
    system: byAnchor.system ?? "ephemeral",
    "user.last": byAnchor["user.last"] ?? "ephemeral",
  };
  let seenLong = false;
  for (let i = CACHE_ANCHOR_WIRE_ORDER.length - 1; i >= 0; i -= 1) {
    const anchor = CACHE_ANCHOR_WIRE_ORDER[i]!;
    if (resolved[anchor] === "1h") {
      seenLong = true;
    } else if (seenLong) {
      resolved[anchor] = "1h"; // 长 TTL 之后的短 TTL 提升为长（单调性）。
    }
  }
  const anchors: AppliedCacheAnchor[] = CACHE_ANCHOR_WIRE_ORDER.map((anchor) => ({
    anchor,
    retention: resolved[anchor],
  }));
  if (options?.skipCacheWrite) {
    // skipCacheWrite：摘要把锚前移——不作为 user.last 的写断点（只保留
    // system/tool 锚，user.last 由调用方挂到上一条真实上下文消息）。
    return anchors.filter((entry) => entry.anchor !== "user.last");
  }
  return anchors;
}
