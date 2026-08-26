// LLM stream idle-timeout watchdog.

/**
 * Raised by the stream idle watchdog when a single read from the LLM stream
 * stays silent longer than the configured timeout. Classified as TIMEOUT by
 * classifyLlmError() and eligible for exactly one automatic retry.
 */
export class LlmStreamIdleTimeoutError extends Error {
  readonly idleTimeoutMs: number;

  constructor(idleTimeoutMs: number) {
    super(`LLM stream idle timeout: no data received for ${idleTimeoutMs}ms`);
    this.name = "LlmStreamIdleTimeoutError";
    this.idleTimeoutMs = idleTimeoutMs;
  }
}

/**
 * Wrap an async iterable so each individual next() must resolve within
 * `idleTimeoutMs`. Long thinking pauses and a genuinely dead connection are
 * indistinguishable from the caller's side; this watchdog turns the latter
 * into a classified TIMEOUT instead of a hung or silently-failed session.
 */
export function withStreamIdleTimeout<T>(stream: AsyncIterable<T>, idleTimeoutMs: number): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: () => {
      const iterator = stream[Symbol.asyncIterator]();
      const next = async (): Promise<IteratorResult<T>> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            iterator.next(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new LlmStreamIdleTimeoutError(idleTimeoutMs)), idleTimeoutMs);
              // A pending watchdog timer must not keep the process alive.
              timer.unref?.();
            }),
          ]);
        } finally {
          if (timer) {
            clearTimeout(timer);
          }
        }
      };
      const finish = async (): Promise<IteratorResult<T>> => {
        const terminate = (iterator as { return?: () => Promise<IteratorResult<T>> }).return;
        return terminate ? terminate.call(iterator) : { done: true, value: undefined as never };
      };
      return { next, return: finish };
    },
  };
}
