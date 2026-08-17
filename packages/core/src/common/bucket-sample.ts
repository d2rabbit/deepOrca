/**
 * Bucketed sampling for long diagnostic listings.
 *
 * Naive truncation of a 500-item error/finding list keeps the first N and
 * discards structure: the model loses whole categories of problems. Bucketed
 * sampling keeps COVERAGE instead of PREFIX: group items by a key (error
 * code, finding rule, file…), rank buckets by size, keep the top few buckets
 * with a few samples each, and carry honest "…and N more of this type"
 * counts for everything dropped.
 *
 * Shape follows the diagnostic post-processing of external LSP tool servers
 * (bucket by error code → top 5 types × 5 samples with retained counts);
 * ported as a pattern, no dependency.
 */

export interface BucketSampleOptions {
  /** Max buckets to keep (ranked by item count, descending). Default 5. */
  readonly maxBuckets?: number;
  /** Max items to keep per bucket. Default 5. */
  readonly perBucket?: number;
}

export interface SampledBucket<T> {
  /** Grouping key shared by every item in this bucket. */
  readonly key: string;
  /** Retained sample items (first `perBucket` in input order). */
  readonly items: readonly T[];
  /** Total items in this bucket (retained + omitted). */
  readonly total: number;
  /** `total - items.length` — what "…and N more of this type" should say. */
  readonly omitted: number;
}

export interface BucketSampleResult<T> {
  readonly buckets: readonly SampledBucket<T>[];
  /** Buckets dropped entirely by maxBuckets. */
  readonly omittedBuckets: number;
  /** Total input items (all buckets). */
  readonly total: number;
}

/**
 * Bucket `items` by `keyOf`, keep the top `maxBuckets` buckets (by count,
 * ties broken by first appearance) with up to `perBucket` samples each, and
 * report honest omission counts everywhere something was dropped.
 * Pure function; input order is preserved within a bucket.
 */
export function bucketSample<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  options: BucketSampleOptions = {}
): BucketSampleResult<T> {
  const maxBuckets = options.maxBuckets ?? 5;
  const perBucket = options.perBucket ?? 5;

  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }

  const ranked = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length || 0);

  const kept = ranked.slice(0, maxBuckets);
  const buckets: SampledBucket<T>[] = kept.map(([key, all]) => {
    const keptItems = all.slice(0, perBucket);
    return { key, items: keptItems, total: all.length, omitted: all.length - keptItems.length };
  });

  return {
    buckets,
    omittedBuckets: Math.max(0, ranked.length - kept.length),
    total: items.length,
  };
}

/**
 * Render a bucket sample as model-readable text lines:
 * `## key (total) · first items… · …and N more of this type`, plus a trailer
 * line when whole buckets were dropped. `render` must produce a short,
 * single-line representation of one item.
 */
export function renderBucketSample<T>(result: BucketSampleResult<T>, render: (item: T) => string): string[] {
  const lines: string[] = [];
  for (const bucket of result.buckets) {
    const samples = bucket.items.map(render).join(" · ");
    const more = bucket.omitted > 0 ? ` · …and ${bucket.omitted} more of this type` : "";
    lines.push(`${bucket.key} (${bucket.total}): ${samples}${more}`);
  }
  if (result.omittedBuckets > 0) {
    lines.push(`…and ${result.omittedBuckets} more types omitted`);
  }
  return lines;
}
