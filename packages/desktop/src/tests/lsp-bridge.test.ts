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
  assert.equal(resolveWithinRoot(ROOT, "src\\a.ts"), ROOT + "\\src\\a.ts");
  assert.equal(resolveWithinRoot(ROOT, "..\\outside.txt"), null);
  assert.equal(resolveWithinRoot(ROOT, "D:\\elsewhere\\x.ts"), null);
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
