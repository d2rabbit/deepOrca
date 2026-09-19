/**
 * Tests for specs-ipc (specs/spec-graph-adoption §1.4) — the Specs panel's
 * wire surface. Pins the two security claims the 2026-09 swarm review found
 * untested:
 *   - an explicitly supplied but UNREGISTERED root is refused (specs:open)
 *     / degrades to an empty graph (specs:graph) — never enumerated;
 *   - specs:open funnels every target through safeSpecsPath (markdown-only +
 *     two-layer containment) and never hands a rejected target to openPath.
 *
 * Electron and the root resolver are injected deps (design-ipc test pattern),
 * so this runs outside an Electron runtime.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { registerSpecsIpc } from "../main/specs-ipc.js";
import { IpcRequest } from "../shared/ipc.js";

type Handler = (...args: never[]) => unknown;

type Harness = {
  handlers: Map<string, Handler>;
  privileged: Set<string>;
  opened: string[];
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>;
};

async function withRegisteredRoot(
  fn: (root: string, harness: Harness) => Promise<void>,
  openPathImpl: (absPath: string) => Promise<string> = async () => ""
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "specs-ipc-"));
  try {
    await fs.mkdir(path.join(root, ".deeporca", "specs", "suite-a"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".deeporca", "specs", "suite-a", "design.md"),
      "---\nid: suite-a\ntype: design\nstatus: active\n---\n\n# Suite A\n"
    );
    await fn(root, createHarness(root, openPathImpl));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function createHarness(registeredRoot: string, openPathImpl: (absPath: string) => Promise<string>): Harness {
  const handlers = new Map<string, Handler>();
  const privileged = new Set<string>();
  const opened: string[] = [];
  const capture =
    (isPrivileged: boolean) =>
    <T>(channel: string, handler: (...args: never[]) => T | Promise<T>): void => {
      handlers.set(channel, handler as Handler);
      if (isPrivileged) privileged.add(channel);
    };
  registerSpecsIpc(
    { handle: capture(false), handlePrivileged: capture(true) },
    {
      resolveRoot: (root) => (root === undefined || root === registeredRoot ? registeredRoot : null),
      openPath: async (absPath) => {
        opened.push(absPath);
        return openPathImpl(absPath);
      },
    }
  );
  const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
    const handler = handlers.get(channel);
    assert.ok(handler, `missing handler for ${channel}`);
    return (await handler(...(args as never[]))) as T;
  };
  return { handlers, privileged, opened, invoke };
}

test("channel privileges: specs:graph is plain, specs:open is privileged", async () => {
  await withRegisteredRoot(async (_root, harness) => {
    assert.ok(harness.privileged.has(IpcRequest.SpecsOpen), "SpecsOpen must be privileged");
    assert.ok(!harness.privileged.has(IpcRequest.SpecsGraph), "SpecsGraph must be plain");
  });
});

test("specs:graph degrades to an empty graph for an unregistered root", async () => {
  await withRegisteredRoot(async (root, harness) => {
    assert.deepEqual(await harness.invoke(IpcRequest.SpecsGraph, "/unregistered/elsewhere"), {
      root: "",
      nodes: [],
      issues: [],
    });
    // …while the registered root returns its real graph (the fixture node)
    // and a clean (empty) issues list.
    const graph = await harness.invoke<{ root: string; nodes: { id: string }[]; issues: unknown[] }>(
      IpcRequest.SpecsGraph,
      root
    );
    assert.equal(graph.root, root);
    assert.deepEqual(
      graph.nodes.map((node) => node.id),
      ["suite-a"]
    );
    assert.deepEqual(graph.issues, []);
  });
});

test("specs:graph surfaces validateSpecs issues with structured data", async () => {
  await withRegisteredRoot(async (root, harness) => {
    // An architecture node whose parent dangles → error issue with the
    // structured params the panel's localized rendering needs (M1 closure).
    await fs.writeFile(
      path.join(root, ".deeporca", "specs", "suite-a", "dangling.md"),
      "---\nid: dangling\ntype: architecture\nstatus: active\nparent: no-such-node\n---\n\n# Dangling\n"
    );
    const graph = await harness.invoke<{
      issues: Array<{ severity: string; code: string; data?: Record<string, string> }>;
    }>(IpcRequest.SpecsGraph, root);
    const dangling = graph.issues.find((issue) => issue.code === "dangling-link");
    assert.ok(dangling, `issues: ${JSON.stringify(graph.issues)}`);
    assert.equal(dangling.severity, "error");
    assert.equal(dangling.data?.kind, "parent");
    assert.equal(dangling.data?.id, "no-such-node");
  });
});

test("specs:graph resolves an OMITTED root to the registered (active) root", async () => {
  await withRegisteredRoot(async (root, harness) => {
    const graph = await harness.invoke<{ root: string }>(IpcRequest.SpecsGraph, undefined);
    assert.equal(graph.root, root);
  });
});

test("specs:open refuses an unregistered root and never calls openPath", async () => {
  await withRegisteredRoot(async (root, harness) => {
    const result = await harness.invoke<{ ok: boolean; error?: string }>(
      IpcRequest.SpecsOpen,
      "/unregistered/x",
      "a.md"
    );
    assert.equal(result.ok, false);
    assert.equal(result.error, "unregistered workspace");
    assert.deepEqual(harness.opened, []);
  });
});

test("specs:open rejects non-markdown targets without calling openPath", async () => {
  await withRegisteredRoot(async (root, harness) => {
    const result = await harness.invoke<{ ok: boolean; error?: string }>(
      IpcRequest.SpecsOpen,
      root,
      ".deeporca/specs/evil.sh"
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /markdown/i);
    assert.deepEqual(harness.opened, []);
  });
});

test("specs:open rejects paths outside the spec domain without calling openPath", async () => {
  await withRegisteredRoot(async (root, harness) => {
    const result = await harness.invoke<{ ok: boolean; error?: string }>(IpcRequest.SpecsOpen, root, "README.md");
    assert.equal(result.ok, false);
    assert.equal(result.error, "Path is outside the spec domain");
    assert.deepEqual(harness.opened, []);
  });
});

test("specs:open opens a contained spec markdown through the injected opener", async () => {
  await withRegisteredRoot(async (root, harness) => {
    const result = await harness.invoke<{ ok: boolean; error?: string }>(
      IpcRequest.SpecsOpen,
      root,
      ".deeporca/specs/suite-a/design.md"
    );
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(harness.opened, [path.join(root, ".deeporca", "specs", "suite-a", "design.md")]);
  });
});

test("specs:open surfaces an opener failure", async () => {
  await withRegisteredRoot(
    async (root, harness) => {
      const result = await harness.invoke<{ ok: boolean; error?: string }>(
        IpcRequest.SpecsOpen,
        root,
        ".deeporca/specs/suite-a/design.md"
      );
      assert.equal(result.ok, false);
      assert.equal(result.error, "no application");
      // The opener WAS reached — the failure is the OS open, not the guard.
      assert.equal(harness.opened.length, 1);
    },
    async () => "no application"
  );
});
