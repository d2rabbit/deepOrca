/**
 * LSP wire framing (specs/lsp-diagnostics P0-2): hand-rolled Content-Length
 * framing instead of the `vscode-languageserver-protocol` dependency — the
 * protocol surface this bridge needs (initialize / didOpen / didChange /
 * publishDiagnostics / textDocument·diagnostic / shutdown) is tiny, and zero
 * new runtime deps keeps the supply-chain surface unchanged (AGENTS.md policy;
 * deviation from design §0.2-3 recorded in specs/lsp-diagnostics/design.md §8).
 * Pure + unit-tested in src/tests/lsp-bridge.test.ts.
 */

export function encodeFrame(message: object | string): string {
  const body = typeof message === "string" ? message : JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

export type FrameParser = {
  /** Feed a raw chunk; emits complete message strings as they complete. */
  push(chunk: string): string[];
};

/** Incremental Content-Length frame parser (headers are ASCII, body UTF-8). */
export function createFrameParser(onMessage: (body: string) => void): FrameParser {
  let buffer = "";
  return {
    push(chunk: string): string[] {
      buffer += chunk;
      const emitted: string[] = [];
      for (;;) {
        const sep = buffer.indexOf("\r\n\r\n");
        if (sep === -1) break;
        const header = buffer.slice(0, sep);
        const match = header.match(/Content-Length: (\d+)/i);
        if (!match) {
          // Unframed garbage — drop through the header and resync.
          buffer = buffer.slice(sep + 4);
          continue;
        }
        const length = Number(match[1]);
        const bodyStart = sep + 4;
        if (Buffer.byteLength(buffer.slice(bodyStart), "utf8") < length) break;
        // Slice by characters can split UTF-8; use buffer byte math instead.
        const before = Buffer.byteLength(buffer.slice(0, bodyStart), "utf8");
        const all = Buffer.from(buffer, "utf8");
        const body = all.subarray(before, before + length).toString("utf8");
        buffer = all.subarray(before + length).toString("utf8");
        emitted.push(body);
        onMessage(body);
      }
      return emitted;
    },
  };
}
