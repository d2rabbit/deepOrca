/**
 * Unified thinking-effort scale + per-family native mappings.
 *
 * The UI and settings speak ONE unified five-tier scale (low / medium / high /
 * xhigh / max — displayed as 初/中/高 plus 极高/至高 hidden by default, with
 * the English tier in parentheses on CJK labels). Each model family projects
 * that scale onto its own native effort tiers via a map registered here;
 * unregistered families fall through to identity.
 *
 * New vendors land in THINK_LEVEL_FAMILY_MAPS one at a time (per-family
 * adaptation, specs/model-fleet-adaptation §2.4 G2c) — callers never change.
 */

export const THINK_LEVEL_ORDER = ["low", "medium", "high", "xhigh", "max"] as const;

export type ThinkLevel = (typeof THINK_LEVEL_ORDER)[number];

export type ThinkLevelMeta = {
  id: ThinkLevel;
  /** English tier name, shown in parentheses on CJK display labels. */
  english: string;
  /** Hidden tiers stay valid in settings/env but are kept out of the menus. */
  hiddenByDefault: boolean;
};

/** Per-tier display metadata. THINK_LEVEL_ORDER is the single source of tier
 * sequence — this record only carries the per-tier attributes. */
const THINK_LEVEL_META = {
  low: { english: "Low", hiddenByDefault: false },
  medium: { english: "Medium", hiddenByDefault: false },
  high: { english: "High", hiddenByDefault: false },
  xhigh: { english: "Extra High", hiddenByDefault: true },
  max: { english: "Max", hiddenByDefault: true },
} as const satisfies Record<ThinkLevel, Omit<ThinkLevelMeta, "id">>;

/** The unified display scale, weakest → strongest. */
export const THINK_LEVELS: readonly ThinkLevelMeta[] = THINK_LEVEL_ORDER.map(
  (id): ThinkLevelMeta => ({ id, ...THINK_LEVEL_META[id] })
);

/** A family's projection of the unified scale onto its native effort tiers. */
export type ThinkLevelFamilyMap = Readonly<Record<ThinkLevel, string>>;

/**
 * DeepSeek V4 family (deepseek-v4-flash / -pro / -flash-vision-exp): the API
 * effectively serves low / high / max — medium and xhigh are both folded to
 * high server-side (thinking-mode guide's request→effective table), so the
 * unified scale projects low→low, medium→high, high→high, xhigh→high, max→max.
 */
const DEEPSEEK_V4_FAMILY: ThinkLevelFamilyMap = {
  low: "low",
  medium: "high",
  high: "high",
  xhigh: "high",
  max: "max",
};

/** Registered family maps — new vendors land here one at a time. */
export const THINK_LEVEL_FAMILY_MAPS: Readonly<Record<string, ThinkLevelFamilyMap>> = {
  deepseek: DEEPSEEK_V4_FAMILY,
};

export function isThinkLevel(value: unknown): value is ThinkLevel {
  return typeof value === "string" && (THINK_LEVEL_ORDER as readonly string[]).includes(value);
}

/** Project a unified level onto the family's native tiers (identity fallback). */
export function mapThinkLevel(familyId: string, level: ThinkLevel): string {
  return THINK_LEVEL_FAMILY_MAPS[familyId]?.[level] ?? level;
}
