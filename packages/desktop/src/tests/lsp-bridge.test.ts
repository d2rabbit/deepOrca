import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToUri, resolveWithinRoot, uriToPath } from "../main/tools/lsp-bridge/routing";
import {
  LSP_SERVER_SPECS,
  candidatesForSpec,
  languageIdForFile,
  resolveSpecForFile,
} from "../main/tools/lsp-bridge/server-specs";
import { createFrameParser, encodeFrame } from "../main/tools/lsp-bridge/frames";

const ROOT = "D:\\work\\demo";

test("lsp-bridge routing: user-required language families all resolve", () => {
  // C 系列 / java / kotlin / dart / swift / c# / go / python / rust
  const expectations: Array<[string, string]> = [
    ["main.ts", "typescript"],
    ["app.tsx", "typescript"],
    ["util.mjs", "typescript"],
    ["svc.py", "python"],
    ["lib.rs", "rust"],
    ["main.go", "go"],
    ["kernel.c", "cpp"],
    ["widget.cpp", "cpp"],
    ["header.h", "cpp"],
    ["Program.cs", "csharp"],
    ["App.java", "java"],
    ["Repo.kt", "kotlin"],
    ["page.dart", "dart"],
    ["View.swift", "swift"],
  ];
  for (const [file, expected] of expectations) {
    assert.equal(resolveSpecForFile(file)?.id, expected, `${file} → ${expected}`);
  }
});

test("lsp-bridge routing: unknown extensions yield no spec, never throw", () => {
  assert.equal(resolveSpecForFile("readme.md"), null);
  assert.equal(resolveSpecForFile("noext"), null);
});

test("lsp-bridge routing: language id distinguishes react and c headers", () => {
  assert.equal(languageIdForFile(LSP_SERVER_SPECS[0]!, "a.tsx"), "typescriptreact");
  assert.equal(languageIdForFile(LSP_SERVER_SPECS[0]!, "a.ts"), "typescript");
  const cpp = LSP_SERVER_SPECS.find((s) => s.id === "cpp")!;
  assert.equal(languageIdForFile(cpp, "a.h"), "c");
  assert.equal(languageIdForFile(cpp, "a.cpp"), "cpp");
});

test("lsp-bridge specs: npm fallback only for npm-distributed servers", () => {
  const ts = LSP_SERVER_SPECS.find((s) => s.id === "typescript")!;
  const tsCandidates = candidatesForSpec(ts);
  assert.equal(tsCandidates.at(-1)!.command, "npx");
  // Non-npm servers (rust/go/...) have no npx fallback — probe-only.
  const rust = LSP_SERVER_SPECS.find((s) => s.id === "rust")!;
  const rustCandidates = candidatesForSpec(rust);
  assert.ok(rustCandidates.every((c) => c.command !== "npx"));
  assert.equal(rustCandidates[0]!.command, "rust-analyzer");
});

test("lsp-bridge routing: uri roundtrip on windows paths", () => {
  const uri = pathToUri("D:\\work\\demo\\src\\a b.ts");
  assert.ok(uri.startsWith("file:///D:/work/demo/"));
  assert.ok(uri.includes("a%20b.ts"));
  // Native separators on Windows — the inverse mapping lands back on "\".
  assert.equal(uriToPath("file:///D:/work/demo/src/a.ts"), "D:\\work\\demo\\src\\a.ts");
});

test("lsp-bridge routing: escaping paths are rejected (root pinning)", () => {
  // Windows-style fixture on win32; POSIX separators elsewhere. The escape
  // semantics under test (inside-root / parent-escape / absolute-elsewhere)
  // are identical on both — the fixture just follows the host's separators.
  const win = process.platform === "win32";
  const root = win ? ROOT : "/work/demo";
  const sep = win ? "\\" : "/";
  assert.equal(resolveWithinRoot(root, `src${sep}a.ts`), root + `${sep}src${sep}a.ts`);
  assert.equal(resolveWithinRoot(root, `..${sep}outside.txt`), null);
  const elsewhere = win ? "D:\\elsewhere\\x.ts" : "/elsewhere/x.ts";
  assert.equal(resolveWithinRoot(root, elsewhere), null);
});

test("lsp-bridge frames: encode carries byte length + payload", () => {
  const frame = encodeFrame({ jsonrpc: "2.0", id: 1, method: "x" });
  const header = frame.slice(0, frame.indexOf("\r\n\r\n"));
  const declared = Number(header.match(/Content-Length: (\d+)/i)?.[1]);
  const body = frame.slice(frame.indexOf("\r\n\r\n") + 4);
  assert.equal(declared, Buffer.byteLength(body, "utf8"));
  assert.equal((JSON.parse(body) as { method: string }).method, "x");
});

test("lsp-bridge frames: parser reassembles split frames", () => {
  const messages: string[] = [];
  const parser = createFrameParser((body) => messages.push(body));
  const whole = encodeFrame({ jsonrpc: "2.0", id: 1, result: 7 });
  const mid = Math.floor(whole.length / 2);
  parser.push(whole.slice(0, mid));
  assert.equal(messages.length, 0);
  parser.push(whole.slice(mid));
  assert.equal(messages.length, 1);
  assert.equal((JSON.parse(messages[0]!) as { result: number }).result, 7);
});

test("lsp-bridge frames: parser resyncs after unframed garbage", () => {
  const messages: string[] = [];
  const parser = createFrameParser((body) => messages.push(body));
  parser.push("garbage without header\r\n\r\n");
  parser.push(encodeFrame({ ok: true }));
  assert.equal(messages.length, 1);
});

// ── CMB-5: dependency readiness probes (specs/cmb-adoption design §2.2) ────

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { depsMissingError, probeDepsReadiness } from "../main/tools/lsp-bridge/deps-readiness";

function specById(id: string) {
  const spec = LSP_SERVER_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`missing spec: ${id}`);
  return spec;
}

function withTempProject(build: (root: string) => void, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "lsp-deps-"));
  try {
    build(root);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("CMB-5 deps-readiness: TS with package.json but no node_modules is deps-missing", () => {
  withTempProject(
    (root) => writeFileSync(join(root, "package.json"), '{"name":"demo"}'),
    (root) => {
      const probe = probeDepsReadiness(root, specById("typescript"));
      assert.equal(probe.ready, false);
      if (!probe.ready) {
        assert.ok(probe.remediation.includes("npm install"));
        assert.ok(depsMissingError(probe).includes("node_modules"));
      }
    }
  );
});

test("CMB-5 deps-readiness: TS ready when node_modules exists, open when no package.json", () => {
  withTempProject(
    (root) => {
      writeFileSync(join(root, "package.json"), "{}");
      mkdirSync(join(root, "node_modules"));
    },
    (root) => assert.equal(probeDepsReadiness(root, specById("typescript")).ready, true)
  );
  withTempProject(
    () => {},
    (root) => assert.equal(probeDepsReadiness(root, specById("typescript")).ready, true)
  );
});

test("CMB-5 deps-readiness: python declared but no venv is missing; venv or undeclared is fine", () => {
  withTempProject(
    (root) => writeFileSync(join(root, "requirements.txt"), "flask\n"),
    (root) => {
      const probe = probeDepsReadiness(root, specById("python"));
      assert.equal(probe.ready, false);
      if (!probe.ready) assert.ok(probe.remediation.includes("venv"));
    }
  );
  withTempProject(
    (root) => {
      writeFileSync(join(root, "pyproject.toml"), "[project]\n");
      mkdirSync(join(root, ".venv"));
    },
    (root) => assert.equal(probeDepsReadiness(root, specById("python")).ready, true)
  );
  withTempProject(
    () => {},
    (root) => assert.equal(probeDepsReadiness(root, specById("python")).ready, true)
  );
});

test("CMB-5 deps-readiness: go stdlib-only module stays open; declared deps without go.sum is missing", () => {
  withTempProject(
    (root) => writeFileSync(root === "" ? "" : join(root, "go.mod"), "module demo\n\ngo 1.22\n"),
    (root) => assert.equal(probeDepsReadiness(root, specById("go")).ready, true)
  );
  withTempProject(
    (root) => writeFileSync(join(root, "go.mod"), "module demo\n\nrequire (\n\tgithub.com/x/y v1.2.3\n)\n"),
    (root) => {
      const probe = probeDepsReadiness(root, specById("go"));
      assert.equal(probe.ready, false);
      if (!probe.ready) assert.ok(probe.remediation.includes("go mod tidy"));
    }
  );
  withTempProject(
    (root) => {
      writeFileSync(join(root, "go.mod"), "module demo\n\nrequire (\n\tgithub.com/x/y v1.2.3\n)\n");
      writeFileSync(join(root, "go.sum"), "\n");
    },
    (root) => assert.equal(probeDepsReadiness(root, specById("go")).ready, true)
  );
});

test("CMB-5 deps-readiness: families without criteria stay fail-open", () => {
  withTempProject(
    () => {},
    (root) => {
      for (const id of ["rust", "cpp", "csharp", "java", "kotlin", "swift", "dart"]) {
        assert.equal(probeDepsReadiness(root, specById(id)).ready, true, id);
      }
    }
  );
});
