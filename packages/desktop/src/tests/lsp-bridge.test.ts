import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pathToUri,
  resolveLanguageIdForFile,
  resolveServerKindForFile,
  resolveWithinRoot,
  uriToPath,
} from "../main/tools/lsp-bridge/routing";
import { createFrameParser, encodeFrame } from "../main/tools/lsp-bridge/frames";

const ROOT = "D:\\work\\demo";

test("lsp-bridge routing: TS family maps to the typescript server", () => {
  assert.equal(resolveServerKindForFile("src/app.ts"), "typescript-language-server");
  assert.equal(resolveServerKindForFile("src/App.tsx"), "typescript-language-server");
  assert.equal(resolveServerKindForFile("src/util.mjs"), "typescript-language-server");
});

test("lsp-bridge routing: unknown extensions yield empty (no server), never throw", () => {
  assert.equal(resolveServerKindForFile("readme.md"), null);
  assert.equal(resolveServerKindForFile("main.py"), null);
  assert.equal(resolveServerKindForFile("noext"), null);
});

test("lsp-bridge routing: language id distinguishes react", () => {
  assert.equal(resolveLanguageIdForFile("a.tsx"), "typescriptreact");
  assert.equal(resolveLanguageIdForFile("a.ts"), "typescript");
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
