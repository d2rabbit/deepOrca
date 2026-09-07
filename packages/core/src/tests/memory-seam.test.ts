/**
 * Truth tables for the host-side seam binders (specs/sop-extraction P2.1/P2.2,
 * common/memory-seam): availability gate, sync-throw guard, 2s race budget and
 * the settings.behaviorContext opt-in gate — all without instantiating a
 * SessionManager.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bindBehaviorContextCollector, bindKnownMemorySearch } from "../common/memory-seam";

type Provider = Parameters<typeof bindKnownMemorySearch>[0] extends () => infer P | null ? P : never;

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    isAvailable: () => true,
    searchMemories: async () => ({ text: "known fact" }),
    ...overrides,
  };
}

test("bindKnownMemorySearch: full degradation truth table", async () => {
  const search = bindKnownMemorySearch(() => provider());

  // happy path
  assert.equal(await search("query"), "known fact");
  // empty query never reaches the provider
  let reached = false;
  const guarded = bindKnownMemorySearch(() => {
    reached = true;
    return provider();
  });
  assert.equal(await guarded("   "), null);
  assert.equal(reached, false);

  // provider absent / unavailable / sync-throwing / garbage / empty-text
  assert.equal(await bindKnownMemorySearch(() => null)("q"), null);
  assert.equal(
    await bindKnownMemorySearch(() => provider({ isAvailable: () => false }))("q"),
    null,
    "unavailable provider degrades to null"
  );
  assert.equal(
    await bindKnownMemorySearch(() =>
      provider({
        searchMemories: (() => {
          throw new Error("sync boom");
        }) as never,
      })
    )("q"),
    null,
    "sync throw stays inside the seam"
  );
  assert.equal(await bindKnownMemorySearch(() => provider({ searchMemories: async () => null }))("q"), null);
  assert.equal(
    await bindKnownMemorySearch(() => provider({ searchMemories: async () => ({ text: "  " }) }))("q"),
    null
  );
  assert.equal(
    await bindKnownMemorySearch(() =>
      provider({ searchMemories: async () => Promise.reject(new Error("async boom")) })
    )("q"),
    null,
    "async failure degrades to null"
  );

  // slow provider loses the race (small ms keeps the test fast)
  const slow = bindKnownMemorySearch(
    () =>
      provider({ searchMemories: () => new Promise((resolve) => setTimeout(() => resolve({ text: "late" }), 100)) }),
    10
  );
  assert.equal(await slow("q"), null, "slow lookup degrades to null within the budget");
});

test("bindBehaviorContextCollector: gate + failure truth table", () => {
  const collect = bindBehaviorContextCollector(
    () => true,
    () => "how this user works"
  );
  assert.equal(collect(), "how this user works");

  let gateReached = false;
  assert.equal(
    bindBehaviorContextCollector(
      () => false,
      () => {
        gateReached = true;
        return "never";
      }
    )(),
    null,
    "gate closed → null"
  );
  assert.equal(gateReached, false, "gated-off collector is never invoked (zero side effects)");
  assert.equal(
    bindBehaviorContextCollector(
      () => true,
      () => "   "
    )(),
    null,
    "blank block → null"
  );
  assert.equal(
    bindBehaviorContextCollector(
      () => {
        throw new Error("gate blew up");
      },
      () => "x"
    )(),
    null,
    "throwing gate degrades to null"
  );
  assert.equal(
    bindBehaviorContextCollector(
      () => true,
      () => {
        throw new Error("collector down");
      }
    )(),
    null,
    "throwing collector degrades to null"
  );
});

test("bindBehaviorContextCollector: workflow builder preferred, profile fallback honored", () => {
  // patterns win when present (procedure > persona, sop-extraction P2.2)
  assert.equal(
    bindBehaviorContextCollector(
      () => true,
      () => "patterns block",
      () => "profile block"
    )(),
    "patterns block"
  );
  // null / blank patterns → profile fallback
  assert.equal(
    bindBehaviorContextCollector(
      () => true,
      () => null,
      () => "profile block"
    )(),
    "profile block"
  );
  assert.equal(
    bindBehaviorContextCollector(
      () => true,
      () => "   ",
      () => "profile block"
    )(),
    "profile block"
  );
  // both empty / gate closed / fallback throwing → null
  assert.equal(
    bindBehaviorContextCollector(
      () => true,
      () => null,
      () => "  "
    )(),
    null
  );
  assert.equal(
    bindBehaviorContextCollector(
      () => false,
      () => "patterns",
      () => "profile"
    )(),
    null,
    "gate shuts both legs"
  );
  assert.equal(
    bindBehaviorContextCollector(
      () => true,
      () => null,
      () => {
        throw new Error("fallback down");
      }
    )(),
    null
  );
});
