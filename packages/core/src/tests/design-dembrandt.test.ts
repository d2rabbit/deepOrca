/**
 * Tests for the dembrandt brand-ingestion workstream (E1a–E1e):
 *  - common/dembrandt.ts offline-first vendor seam (vendored argv / npx
 *    fallback / path containment) + disable gate + MCP spawn config,
 *  - actions/design.ts design.extract / design.drift definitions + runs.
 *
 * Pure-logic: the CLI is never really spawned — ctx.spawner is stubbed with
 * the same MockSpawner shape actions.test.ts uses (line iterables + a
 * resolved exit code). The vendored-path tests fake a vendor root on disk
 * (temp dir + the bin js files the resolver validates). See
 * docs/research/2026-08-17-external-repos-prestudy.md §1.
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ActionRegistry, ActionError, NULL_SPAWNER } from "../actions";
import type { Spawner, SpawnedProcess } from "../actions";
import { designExtractDefinition, designExtractRun, designDriftDefinition, designDriftRun } from "../actions";
import {
  DEMBRANDT_MCP_SERVER_NAME,
  DEMBRANDT_PACKAGE_SPEC,
  buildDembrandtMcpServerConfig,
  configureDembrandtCdpEndpointGetter,
  configureDembrandtVendorRoot,
  hasDembrandtDesignContext,
  isDembrandtDisabled,
  resolveDembrandtCommand,
  setDembrandtDisabled,
  validateDembrandtTargetUrl,
  validateDembrandtVendorRoot,
} from "../common/dembrandt";

// ── Test fixtures ─────────────────────────────────────────────────────────────

function asyncIterableOf(lines: string[]): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next(): Promise<IteratorResult<string>> {
          if (i < lines.length) return Promise.resolve({ value: lines[i++] as string, done: false });
          return Promise.resolve({ value: undefined as unknown as string, done: true });
        },
      };
    },
  };
}

interface SpawnCall {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

/** Stub spawner: records spawn calls, replies with a canned stdout/exit code. */
function makeStubSpawner(reply: { stdout?: string; stderr?: string; code: number }): {
  spawner: Spawner;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const spawner: Spawner = {
    spawn(command, args, opts) {
      calls.push({ command, args: [...args], cwd: opts?.cwd, env: opts?.env });
      const proc: SpawnedProcess = {
        stdout: asyncIterableOf(reply.stdout ? [reply.stdout] : []),
        stderr: asyncIterableOf(reply.stderr ? [reply.stderr] : []),
        exited: Promise.resolve({ code: reply.code }),
        kill() {
          /* nothing to kill */
        },
      };
      return proc;
    },
    resolveNodeRunner: () => null,
  };
  return { spawner, calls };
}

function makeRegistry(spawner: Spawner, projectRoot: string): ActionRegistry {
  const r = new ActionRegistry({ projectRoot, spawner });
  r.register(designExtractDefinition, designExtractRun);
  r.register(designDriftDefinition, designDriftRun);
  return r;
}

// Throwaway project roots — design.extract mkdirs its temp output dir under
// the workspace root, so each test gets its own root on disk.
const tempRoots: string[] = [];

function makeProjectRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "design-dembrandt-test-"));
  tempRoots.push(root);
  return root;
}

/** Mark a project as design-active (the `designs/` marker the config builder gates on). */
function seedDesignContext(root: string): void {
  fs.mkdirSync(path.join(root, "designs"), { recursive: true });
}

/**
 * Fake vendor root matching the layout scripts/vendor-dembrandt.js produces:
 * node_modules/dembrandt/dist/{index,mcp-server}.js. Both files must exist on
 * disk — the resolver validates that before returning the vendored argv.
 */
function makeFakeVendorRoot(withBins = true): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dembrandt-vendor-test-"));
  tempRoots.push(root);
  if (withBins) {
    const dist = path.join(root, "node_modules", "dembrandt", "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, "index.js"), "#!/usr/bin/env node\n");
    fs.writeFileSync(path.join(dist, "mcp-server.js"), "#!/usr/bin/env node\n");
  }
  return root;
}

// Roots whose disable flag was toggled (module-level state) — reset after each test.
const gateRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop() as string;
    fs.rmSync(root, { recursive: true, force: true });
  }
  while (gateRoots.length > 0) {
    setDembrandtDisabled(gateRoots.pop() as string, false);
  }
  // Offline-first seam state isolation: tests that configure a vendor root or
  // CDP endpoint must not leak them into the unavailable-path assertions of
  // later tests.
  configureDembrandtVendorRoot(null);
  configureDembrandtCdpEndpointGetter(null);
});

// A realistic (trimmed) `--json-only` payload — schema-versioned upstream;
// the action only reads `domain` out of it.
const EXTRACT_STDOUT = JSON.stringify({
  schema_version: "0.28.0",
  domain: "example.com",
  colors: { primary: "#6366f1", background: "#0a0a0a" },
  typography: { scale: ["0.875rem", "1rem", "1.25rem"] },
});

const DRIFT_STDOUT = JSON.stringify({
  drift: {
    score: 41.5,
    status: "drift",
    summary: "primary color and radius deviate",
    changes: [{ token: "color.primary" }],
  },
});

// NOTE: one outer describe, mirroring actions.test.ts — node:test's
// --test-force-exit interacts badly with concurrent top-level describe blocks.
describe("dembrandt brand ingestion (E1)", { concurrency: 1 }, () => {
  // ── E1a: disable gate + MCP spawn config ──────────────────────────────────

  describe("dembrandt disable gate", () => {
    test("defaults to enabled and toggles per project root", () => {
      const root = makeProjectRoot();
      gateRoots.push(root, "/tmp/other-project");
      assert.equal(isDembrandtDisabled(root), false);
      setDembrandtDisabled(root, true);
      assert.equal(isDembrandtDisabled(root), true);
      // Per-root isolation: another project stays enabled.
      assert.equal(isDembrandtDisabled("/tmp/other-project"), false);
      setDembrandtDisabled(root, false);
      assert.equal(isDembrandtDisabled(root), false);
    });
  });

  describe("buildDembrandtMcpServerConfig", () => {
    test("returns null when no vendored tree is provisioned (offline-only, never npx)", () => {
      const root = makeProjectRoot();
      seedDesignContext(root);
      gateRoots.push(root);
      // No vendor root configured → offline-only resolver reports unavailable,
      // and the MCP config builder refuses to register an unrunnable server.
      const cmd = resolveDembrandtCommand("dembrandt-mcp");
      assert.equal(cmd.kind, "unavailable");
      if (cmd.kind === "unavailable") {
        assert.match(cmd.reason, /vendor-dembrandt|desktop:build|never downloads/i);
      }
      assert.equal(buildDembrandtMcpServerConfig(root), null);
      assert.equal(DEMBRANDT_PACKAGE_SPEC, "dembrandt@0.28.0");
    });

    test("uses the vendored node-runner argv when a valid vendor root is configured", () => {
      const root = makeProjectRoot();
      seedDesignContext(root);
      gateRoots.push(root);
      const vendorRoot = makeFakeVendorRoot(true);
      configureDembrandtVendorRoot(vendorRoot);

      const config = buildDembrandtMcpServerConfig(root);
      assert.ok(config);
      // Node runner + the vendored mcp-server.js — argv form, no shell, no npx.
      assert.equal(config.command, process.execPath);
      const expectedBin = path.join(vendorRoot, "node_modules", "dembrandt", "dist", "mcp-server.js");
      assert.deepEqual(config.args, [expectedBin]);
      assert.equal(config.cwd, root);
      assert.equal(config.env?.ELECTRON_RUN_AS_NODE, "1");
      assert.equal(config.env?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, "1");
    });

    test("injects the built-in Chromium CDP endpoint when the host getter is wired", () => {
      const vendorRoot = makeFakeVendorRoot(true);
      configureDembrandtVendorRoot(vendorRoot);
      configureDembrandtCdpEndpointGetter(() => "http://127.0.0.1:9333");
      const cmd = resolveDembrandtCommand("dembrandt");
      assert.equal(cmd.kind, "vendored");
      if (cmd.kind === "vendored") {
        assert.equal(cmd.env.DEMBRANDT_CDP_ENDPOINT, "http://127.0.0.1:9333");
      }
      configureDembrandtCdpEndpointGetter(null);
      const cmdNoCdp = resolveDembrandtCommand("dembrandt");
      assert.equal(cmdNoCdp.kind, "vendored");
      if (cmdNoCdp.kind === "vendored") {
        assert.equal(cmdNoCdp.env.DEMBRANDT_CDP_ENDPOINT, undefined);
      }
    });

    test("returns null for a workspace with no design context (codegraph-style marker gate)", () => {
      const root = makeProjectRoot();
      gateRoots.push(root);
      // MCP registration requires BOTH design context AND a provisioned vendor
      // tree (offline-only). Seed the vendor root so the design-context gate is
      // the only variable under test.
      configureDembrandtVendorRoot(makeFakeVendorRoot(true));
      assert.equal(hasDembrandtDesignContext(root), false);
      assert.equal(buildDembrandtMcpServerConfig(root), null);
      // The brand contract alone also activates the server.
      fs.mkdirSync(path.join(root, ".deeporca"), { recursive: true });
      fs.writeFileSync(path.join(root, ".deeporca", "DESIGN.md"), "# Brand\n");
      assert.equal(hasDembrandtDesignContext(root), true);
      assert.ok(buildDembrandtMcpServerConfig(root));
    });

    test("returns null when the server is disabled for the project root", () => {
      const root = makeProjectRoot();
      const other = makeProjectRoot();
      seedDesignContext(root);
      seedDesignContext(other);
      gateRoots.push(root, other);
      configureDembrandtVendorRoot(makeFakeVendorRoot(true));
      setDembrandtDisabled(root, true);
      assert.equal(buildDembrandtMcpServerConfig(root), null);
      // Another design-active project is unaffected.
      assert.ok(buildDembrandtMcpServerConfig(other));
    });
  });

  // ── E1e: offline-first vendor seam (resolver + containment) ────────────────

  describe("offline-first resolver", () => {
    test("prefers the vendored bin via a node runner when the vendor root is valid", () => {
      const vendorRoot = makeFakeVendorRoot(true);
      configureDembrandtVendorRoot(vendorRoot);

      const cli = resolveDembrandtCommand("dembrandt");
      assert.equal(cli.kind, "vendored");
      if (cli.kind !== "vendored") return;
      assert.equal(cli.nodeBin, process.execPath);
      const expectedBin = path.join(vendorRoot, "node_modules", "dembrandt", "dist", "index.js");
      assert.deepEqual(cli.args, [expectedBin]);
      // Containment: the spawned path is absolute and inside the vendor root.
      assert.ok(path.isAbsolute(cli.args[0] as string));
      assert.ok((cli.args[0] as string).startsWith(path.resolve(vendorRoot) + path.sep));
      assert.ok(fs.statSync(cli.args[0] as string).isFile(), "the vendored bin must exist on disk");
      // Offline env: Electron-as-Node runner + hard no-download guard.
      assert.equal(cli.env.ELECTRON_RUN_AS_NODE, "1");
      assert.equal(cli.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, "1");

      // The MCP binary resolves to its own dist entry under the same root.
      const mcp = resolveDembrandtCommand("dembrandt-mcp");
      assert.equal(mcp.kind, "vendored");
      if (mcp.kind === "vendored") {
        assert.deepEqual(mcp.args, [path.join(vendorRoot, "node_modules", "dembrandt", "dist", "mcp-server.js")]);
      }
    });

    test("reports unavailable (never npx) when the vendor root has no bin files", () => {
      const vendorRoot = makeFakeVendorRoot(false); // Valid root, missing bins.
      configureDembrandtVendorRoot(vendorRoot);
      const cmd = resolveDembrandtCommand("dembrandt");
      assert.equal(cmd.kind, "unavailable");
      if (cmd.kind === "unavailable") {
        assert.match(cmd.reason, /vendor-dembrandt|desktop:build|never downloads/i);
        assert.equal(cmd.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, "1");
      }
    });

    test("reports unavailable (never npx) with no vendor root configured (dev checkout)", () => {
      const cmd = resolveDembrandtCommand("dembrandt-mcp");
      assert.equal(cmd.kind, "unavailable");
    });

    test("rejects a vendor root containing '..' segments (path gate)", () => {
      const root = makeFakeVendorRoot(true);
      // Built by concatenation, NOT path.join — join would collapse the '..'
      // segments and the raw string is exactly what must stay rejected.
      const traversal = [root, "..", "..", "dembrandt"].join(path.sep);
      assert.ok(traversal.split(/[\\/]/).includes(".."), "fixture must contain literal '..' segments");
      const verdict = validateDembrandtVendorRoot(traversal);
      assert.equal(verdict.ok, false);
      if (!verdict.ok) {
        assert.match(verdict.reason, /\.\./);
      }
      configureDembrandtVendorRoot(traversal);
      assert.equal(resolveDembrandtCommand("dembrandt").kind, "unavailable");
      // The MCP config builder degrades the same way instead of throwing.
      const project = makeProjectRoot();
      seedDesignContext(project);
      gateRoots.push(project);
      assert.equal(buildDembrandtMcpServerConfig(project), null);
    });

    test("rejects a non-absolute vendor root (path gate)", () => {
      const verdict = validateDembrandtVendorRoot(path.join("vendor", "dembrandt"));
      assert.equal(verdict.ok, false);
      if (!verdict.ok) {
        assert.match(verdict.reason, /not absolute/);
      }
      configureDembrandtVendorRoot(path.join("vendor", "dembrandt"));
      assert.equal(resolveDembrandtCommand("dembrandt").kind, "unavailable");
    });
  });

  describe("validateDembrandtTargetUrl (SSRF guard)", () => {
    test("accepts public http/https URLs and normalizes scheme-less hosts", () => {
      assert.equal(validateDembrandtTargetUrl("https://example.com").ok, true);
      assert.equal(validateDembrandtTargetUrl("http://example.com/path").ok, true);
      const schemeless = validateDembrandtTargetUrl("example.com");
      assert.equal(schemeless.ok, true);
      if (schemeless.ok) assert.equal(schemeless.url, "https://example.com/");
    });

    test("rejects non-http(s) schemes and malformed URLs", () => {
      assert.equal(validateDembrandtTargetUrl("ftp://example.com").ok, false);
      assert.equal(validateDembrandtTargetUrl("file:///etc/passwd").ok, false);
      assert.equal(validateDembrandtTargetUrl("not a url at all :::").ok, false);
    });

    test("rejects localhost, loopback, private, link-local and reserved addresses", () => {
      for (const bad of [
        "http://localhost/",
        "http://foo.localhost/",
        "http://127.0.0.1/",
        "http://[::1]/",
        "http://10.0.0.5/",
        "http://172.16.3.4/",
        "http://172.31.255.1/",
        "http://192.168.1.1/",
        "http://169.254.1.1/",
        "http://100.64.0.1/",
        "http://0.0.0.0/",
        "http://224.0.0.1/",
        "http://240.1.2.3/",
        "http://[fd00::1]/",
        "http://[fe80::1]/",
      ]) {
        const verdict = validateDembrandtTargetUrl(bad);
        assert.equal(verdict.ok, false, `must reject ${bad}`);
      }
      // Public look-alikes must pass: 172.32 (outside /12), 192.169 (outside /16).
      assert.equal(validateDembrandtTargetUrl("http://172.32.0.1/").ok, true);
      assert.equal(validateDembrandtTargetUrl("http://192.169.0.1/").ok, true);
    });
  });

  // ── E1b/E1c: action definitions ───────────────────────────────────────────

  describe("action definitions", () => {
    test("design.extract declares id/parameters/sideEffects honestly", () => {
      assert.equal(designExtractDefinition.id, "design.extract");
      assert.equal(designExtractDefinition.category, "design");
      const params = designExtractDefinition.parameters as {
        properties: Record<string, { type: string }>;
        required: string[];
      };
      assert.equal(params.properties.url?.type, "string");
      assert.equal(params.properties.projectRoot?.type, "string");
      assert.deepEqual(params.required, ["url"]);
      // Network only: the CLI fetches the URL; durable writes are agent-mediated.
      assert.deepEqual(designExtractDefinition.sideEffects, ["network"]);
    });

    test("design.drift declares id/parameters/sideEffects honestly", () => {
      assert.equal(designDriftDefinition.id, "design.drift");
      assert.equal(designDriftDefinition.category, "design");
      const params = designDriftDefinition.parameters as {
        properties: Record<string, { type: string }>;
        required: string[];
      };
      assert.equal(params.properties.baseline?.type, "string");
      assert.equal(params.properties.current?.type, "string");
      assert.deepEqual(params.required, ["baseline", "current"]);
      // Static declaration covering both input modes (URL fetch + baseline read).
      assert.deepEqual(designDriftDefinition.sideEffects, ["network", "read-in-cwd"]);
    });

    test("registry surfaces both as dotted tool names", () => {
      const r = makeRegistry(NULL_SPAWNER, makeProjectRoot());
      const ids = r.list().map((d) => d.id);
      assert.ok(ids.includes("design.extract"));
      assert.ok(ids.includes("design.drift"));
      assert.equal(r.actionIdForToolName("design_extract"), "design.extract");
      assert.equal(r.actionIdForToolName("design_drift"), "design.drift");
    });
  });

  // ── E1b: design.extract run ────────────────────────────────────────────────

  describe("design.extract run", () => {
    test("spawns the vendored CLI via the literal node runner and returns tokens + DESIGN.md instruction", async () => {
      const root = makeProjectRoot();
      configureDembrandtVendorRoot(makeFakeVendorRoot(true));
      const { spawner, calls } = makeStubSpawner({ stdout: EXTRACT_STDOUT, code: 0 });
      const r = makeRegistry(spawner, root);

      const result = await r.execute<{ url: string }, Record<string, unknown>>("design.extract", {
        url: "https://example.com",
      }).result;

      // One spawn: literal "node" executable + the containment-validated
      // vendored bin as argv[0] + the CLI contract. Offline-only — no npx.
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.command, "node");
      assert.match(calls[0]?.args[0] ?? "", /node_modules[\\/]dembrandt[\\/]dist[\\/]index\.js$/);
      assert.deepEqual(calls[0]?.args.slice(1), ["https://example.com/", "--json-only", "--save-output"]);
      assert.equal(calls[0]?.env?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, "1");
      // The temp output dir is under the session workspace and IS the spawn cwd.
      const outputDir = result.outputDir as string;
      assert.ok(
        outputDir.startsWith(path.join(root, ".deeporca", "tmp", "dembrandt")),
        `outputDir under session workspace: ${outputDir}`
      );
      assert.equal(calls[0]?.cwd, outputDir);
      assert.ok(fs.statSync(outputDir).isDirectory(), "output dir was created");

      // Success path: tokens carried through, minimally parsed domain.
      assert.equal(result.ok, true);
      assert.equal(result.url, "https://example.com/");
      assert.equal(result.domain, "example.com");
      assert.ok(String(result.tokensJson).includes('"primary":"#6366f1"'));

      // The deterministic persistence instruction (agent-mediated write).
      const instruction = String(result.instruction);
      assert.match(instruction, /\.deeporca\/DESIGN\.md/);
      assert.match(instruction, /`write` tool/);
    });

    test("vendored argv carries the offline env guards", async () => {
      const root = makeProjectRoot();
      const vendorRoot = makeFakeVendorRoot(true);
      configureDembrandtVendorRoot(vendorRoot);
      const { spawner, calls } = makeStubSpawner({ stdout: EXTRACT_STDOUT, code: 0 });
      const r = makeRegistry(spawner, root);

      const result = await r.execute<{ url: string }, Record<string, unknown>>("design.extract", {
        url: "https://example.com",
      }).result;

      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.command, "node");
      assert.equal(calls[0]?.args[0], path.join(vendorRoot, "node_modules", "dembrandt", "dist", "index.js"));
      assert.equal(calls[0]?.env?.ELECTRON_RUN_AS_NODE, "1");
      assert.equal(calls[0]?.env?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, "1");
      assert.equal(result.ok, true);
      assert.equal(result.domain, "example.com");
    });

    test("missing vendor tree returns the offline-provisioning spawnError (never spawns npx)", async () => {
      const root = makeProjectRoot();
      // No vendor root configured.
      const { spawner, calls } = makeStubSpawner({ stdout: EXTRACT_STDOUT, code: 0 });
      const r = makeRegistry(spawner, root);
      const result = await r.execute<{ url: string }, Record<string, unknown>>("design.extract", {
        url: "https://example.com",
      }).result;
      assert.equal(calls.length, 0, "nothing spawned without a vendored tree");
      assert.equal(result.ok, false);
      assert.match(String(result.error), /vendor-dembrandt|desktop:build|never downloads/i);
    });

    test("non-zero exit returns a structured error with the stderr tail", async () => {
      configureDembrandtVendorRoot(makeFakeVendorRoot(true));
      const { spawner } = makeStubSpawner({
        stderr: "Error: browser launch failed (CDP endpoint unreachable).",
        code: 1,
      });
      const r = makeRegistry(spawner, makeProjectRoot());
      const result = await r.execute<{ url: string }, Record<string, unknown>>("design.extract", {
        url: "https://example.com",
      }).result;
      assert.equal(result.ok, false);
      assert.match(String(result.error), /exited with code 1/);
      assert.match(String(result.error), /browser launch failed/);
      // Offline-only: the error must never point at a runtime download.
      assert.doesNotMatch(String(result.error), /install-browser/);
    });

    test("rejects non-public URL targets before anything is spawned (SSRF guard)", async () => {
      const { spawner, calls } = makeStubSpawner({ stdout: EXTRACT_STDOUT, code: 0 });
      const r = makeRegistry(spawner, makeProjectRoot());
      for (const bad of ["http://localhost:8080/", "http://192.168.1.1/", "ftp://example.com"]) {
        const result = await r.execute<{ url: string }, Record<string, unknown>>("design.extract", { url: bad }).result;
        assert.equal(result.ok, false, `must reject ${bad}`);
      }
      assert.equal(calls.length, 0, "no spawn for rejected targets");
    });

    test("missing url input is rejected by the action itself", async () => {
      const { spawner } = makeStubSpawner({ stdout: "{}", code: 0 });
      const r = makeRegistry(spawner, makeProjectRoot());
      const result = await r.execute<Record<string, unknown>, Record<string, unknown>>("design.extract", {}).result;
      assert.equal(result.ok, false);
      assert.match(String(result.error), /url is required/);
    });

    test("NULL_SPAWNER surfaces as a structured ACTION_FAILED error", async () => {
      configureDembrandtVendorRoot(makeFakeVendorRoot(true));
      const r = makeRegistry(NULL_SPAWNER, makeProjectRoot());
      await assert.rejects(
        () => r.execute<{ url: string }, unknown>("design.extract", { url: "https://example.com" }).result,
        (err: unknown) => err instanceof ActionError && err.code === "ACTION_FAILED" && /NULL_SPAWNER/.test(err.message)
      );
    });
  });

  // ── E1c: design.drift run ──────────────────────────────────────────────────

  describe("design.drift run", () => {
    test("spawns the --compare drift gate via the vendored runner and parses the payload (no drift)", async () => {
      const root = makeProjectRoot();
      const vendorRoot = makeFakeVendorRoot(true);
      configureDembrandtVendorRoot(vendorRoot);
      const { spawner, calls } = makeStubSpawner({
        stdout: JSON.stringify({ drift: { score: 0, status: "pass", summary: "within baseline", changes: [] } }),
        code: 0,
      });
      const r = makeRegistry(spawner, root);

      const result = await r.execute<{ baseline: string; current: string }, Record<string, unknown>>("design.drift", {
        baseline: ".deeporca/design-baseline.json",
        current: "https://example.com",
      }).result;

      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.command, "node");
      assert.equal(calls[0]?.args[0], path.join(vendorRoot, "node_modules", "dembrandt", "dist", "index.js"));
      assert.deepEqual(calls[0]?.args.slice(1), [
        "https://example.com/",
        "--compare",
        ".deeporca/design-baseline.json",
        "--json-only",
      ]);
      // cwd is the project root so relative baseline paths resolve.
      assert.equal(calls[0]?.cwd, root);

      assert.equal(result.ok, true);
      assert.equal(result.driftDetected, false);
      assert.equal(result.score, 0);
      assert.match(String(result.summary), /within baseline/);
      assert.ok(String(result.driftJson).includes('"status":"pass"'));
    });

    test("exit 1 means drift DETECTED, not a failed run", async () => {
      configureDembrandtVendorRoot(makeFakeVendorRoot(true));
      const { spawner } = makeStubSpawner({ stdout: DRIFT_STDOUT, code: 1 });
      const r = makeRegistry(spawner, makeProjectRoot());
      const result = await r.execute<{ baseline: string; current: string }, Record<string, unknown>>("design.drift", {
        baseline: "baseline.json",
        current: "https://example.com",
      }).result;
      assert.equal(result.ok, true);
      assert.equal(result.driftDetected, true);
      assert.equal(result.score, 41.5);
      assert.match(String(result.summary), /primary color/);
    });

    test("extraction failures (exit != 0/1) return a structured error", async () => {
      configureDembrandtVendorRoot(makeFakeVendorRoot(true));
      const { spawner } = makeStubSpawner({ stderr: "Error: navigation timeout", code: 67 });
      const r = makeRegistry(spawner, makeProjectRoot());
      const result = await r.execute<{ baseline: string; current: string }, Record<string, unknown>>("design.drift", {
        baseline: "baseline.json",
        current: "https://example.com",
      }).result;
      assert.equal(result.ok, false);
      assert.match(String(result.error), /exit code 67/);
      assert.match(String(result.error), /navigation timeout/);
    });

    test("missing inputs are rejected by the action itself", async () => {
      const { spawner } = makeStubSpawner({ stdout: "{}", code: 0 });
      const r = makeRegistry(spawner, makeProjectRoot());
      const result = await r.execute<Record<string, unknown>, Record<string, unknown>>("design.drift", {
        baseline: "baseline.json",
      }).result;
      assert.equal(result.ok, false);
      assert.match(String(result.error), /baseline and current are required/);
    });

    test("NULL_SPAWNER surfaces as a structured ACTION_FAILED error", async () => {
      configureDembrandtVendorRoot(makeFakeVendorRoot(true));
      const r = makeRegistry(NULL_SPAWNER, makeProjectRoot());
      await assert.rejects(
        () =>
          r.execute<{ baseline: string; current: string }, unknown>("design.drift", {
            baseline: "b.json",
            current: "https://example.com",
          }).result,
        (err: unknown) => err instanceof ActionError && err.code === "ACTION_FAILED" && /NULL_SPAWNER/.test(err.message)
      );
    });
  });

  // ── E1a wiring sanity: the server name constant used by session.ts ─────────

  test("DEMBRANDT_MCP_SERVER_NAME matches the registration key", () => {
    assert.equal(DEMBRANDT_MCP_SERVER_NAME, "dembrandt");
  });
});
