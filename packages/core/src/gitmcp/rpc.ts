import { createInterface } from "readline";

/**
 * Minimal server side of the MCP stdio transport, mirroring what our
 * `McpClient` speaks: newline-delimited JSON-RPC 2.0 (one message per line,
 * no Content-Length framing), single messages or batch arrays, notifications
 * without `id`. Deliberately hand-rolled (~100 lines) instead of pulling
 * `@modelcontextprotocol/sdk` into core.
 */

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INTERNAL_ERROR = -32603;

/** Throw inside a handler to control the JSON-RPC error code sent back. */
export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export type RpcHandler = (params: Record<string, unknown> | undefined) => unknown | Promise<unknown>;

export type RpcHandlers = Record<string, RpcHandler>;

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
};

/**
 * Dispatch one parsed JSON-RPC message. Returns the response object, or
 * `null` for notifications (no `id` → nothing must be written back).
 * Exported so tests can exercise the protocol in-process without spawning.
 */
export async function dispatchRpcMessage(handlers: RpcHandlers, message: unknown): Promise<JsonRpcResponse | null> {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return { jsonrpc: "2.0", id: null, error: { code: INVALID_REQUEST, message: "Invalid request" } };
  }
  const { id, method, params } = message as {
    id?: number | string;
    method?: string;
    params?: Record<string, unknown>;
  };
  const isNotification = id === undefined;

  if (typeof method !== "string") {
    return isNotification
      ? null
      : { jsonrpc: "2.0", id: id ?? null, error: { code: INVALID_REQUEST, message: "Missing method" } };
  }

  const handler = handlers[method];
  if (!handler) {
    // Clients probe prompts/list, resources/list etc. and tolerate this error.
    return isNotification
      ? null
      : { jsonrpc: "2.0", id, error: { code: METHOD_NOT_FOUND, message: `Method not found: ${method}` } };
  }

  try {
    const result = await handler(params);
    return isNotification ? null : { jsonrpc: "2.0", id, result: result ?? {} };
  } catch (error) {
    if (isNotification) {
      return null;
    }
    const code = error instanceof RpcError ? error.code : INTERNAL_ERROR;
    const text = error instanceof Error ? error.message : String(error);
    return { jsonrpc: "2.0", id, error: { code, message: text } };
  }
}

/**
 * Run the stdio serve loop: read newline-delimited JSON-RPC from stdin,
 * dispatch sequentially (per-line order is preserved), write responses to
 * stdout. Exits when stdin closes (the client disconnected).
 */
export function serveStdio(handlers: RpcHandlers): void {
  const write = (response: JsonRpcResponse): void => {
    process.stdout.write(JSON.stringify(response) + "\n");
  };

  // Serialize handling so responses keep the request order per connection.
  let queue: Promise<void> = Promise.resolve();

  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    queue = queue.then(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        write({ jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "Parse error" } });
        return;
      }
      const messages = Array.isArray(parsed) ? parsed : [parsed];
      for (const message of messages) {
        const response = await dispatchRpcMessage(handlers, message);
        if (response) {
          write(response);
        }
      }
    });
  });
  rl.on("close", () => {
    void queue.then(() => process.exit(0));
  });
}
