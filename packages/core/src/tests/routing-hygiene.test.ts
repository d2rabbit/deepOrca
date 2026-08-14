import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionManager } from "../session";
import { VectorIndex } from "../routing/vector-index";
import { ToolRouterImpl } from "../routing/tool-router";
import { DEFAULT_ROUTING_CONFIG } from "../routing/types";

const originalHome = process.env.HOME;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createManager(workspace: string, routing: Record<string, unknown> = {}) {
  return new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({ client: null, model: "test-model", thinkingEnabled: false }),
    getResolvedSettings: () => ({ model: "test-model", routing }) as any,
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
}

test("a recent load failure is not retried on every prompt (60s backoff)", async () => {
  const workspace = createTempDir("routing-backoff-");
  const manager = createManager(workspace);
  // Simulate a recent failure.
  (manager as any).routingLoadFailedAt = Date.now();

  const bundle = await (manager as any).getRouters();

  assert.equal(bundle.skillRouter, null, "backoff window returns the fail-open bundle");
  assert.equal((manager as any).routerBundle, null, "early return must NOT cache a bundle");

  // invalidateRouting (host hot-reload hook) resets the backoff for an immediate retry.
  (manager as any).invalidateRouting();
  assert.equal((manager as any).routingLoadFailedAt, 0, "invalidateRouting clears the backoff");
});

test("invalidateRouting drops the cached bundle — settings changes apply to the next decision", async () => {
  const workspace = createTempDir("routing-hotreload-");
  const manager = createManager(workspace);

  // Force a bundle into the cache, then invalidate.
  (manager as any).routerBundle = { skillRouter: {}, toolRouter: null, facade: null };
  (manager as any).frozenToolRoutes.set("s1", [] as any);
  (manager as any).invalidateRouting();

  assert.equal((manager as any).routerBundle, null);
  assert.equal((manager as any).routerInitPromise, null);
  assert.equal((manager as any).frozenToolRoutes.size, 0, "frozen routes cleared too");
});

const FAKE_EMBEDDING = {
  isReady: () => true,
  embedBatch: async (texts: string[]) => texts.map(() => new Float32Array([1, 0, 0, 0])),
  embed: async () => new Float32Array([1, 0, 0, 0]),
  getProviderInfo: () => ({ model: "fake-model" }),
};

test("vector cache files are LRU-capped (no unbounded growth)", async () => {
  const cacheDir = path.join(createTempDir("routing-cache-gc-"), "cache");
  const index = new VectorIndex({ cacheDir });
  assert.ok(index.attach(FAKE_EMBEDDING as any));

  // 40 distinct candidate sets → 40 distinct cache keys.
  for (let i = 0; i < 40; i += 1) {
    const ok = await index.rebuild(
      [
        { id: `skill-${i}`, text: `skill number ${i}` },
        { id: "constant", text: "always the same" },
      ],
      "fake-model"
    );
    assert.ok(ok);
  }

  const files = fs.readdirSync(cacheDir).filter((f) => f.startsWith("routing-vec-"));
  assert.ok(files.length <= 32, `cache capped at 32 files (got ${files.length})`);
  assert.ok(files.length >= 30, "recent files retained");
});

test("token-budget estimate uses the real serialized schema when provided", () => {
  const router = new ToolRouterImpl(DEFAULT_ROUTING_CONFIG, FAKE_EMBEDDING as any);
  const estimate = (tools: any[]) => (router as any).estimateTokens(tools);

  const withoutSchema = [{ name: "t", description: "desc", serverName: "s" }];
  const withSchema = [
    { name: "t", description: "desc", serverName: "s", schemaJson: JSON.stringify({ parameters: { type: "object" } }) },
  ];

  const approx = estimate(withoutSchema);
  const real = estimate(withSchema);
  assert.ok(real > 0);
  assert.notEqual(approx, real, "schema-carrying tools estimate differently from the approximation");
  // The approximation for a tiny name+description is (4+4)*3/4 = 6; the real
  // JSON schema here is much longer, so the estimate must grow accordingly.
  assert.ok(real > approx, "real schema length dominates the estimate");
});
