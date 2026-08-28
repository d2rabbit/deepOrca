/**
 * Endpoint connectivity probe — the model-pool "测试" button's backend.
 * One request answers both questions the settings surface asks:
 *
 *  - Reachability: did ANY HTTP response come back? (DNS failure, connection
 *    refused and timeout all fold into network-error with the raw message.)
 *  - API usability: GET {baseURL}/models with the endpoint's key, the
 *    OpenAI-compatible surface every pool endpoint speaks. 200 = usable
 *    (models counted when the payload parses), 401/403 = key rejected,
 *    404/405 = reachable but no /models route (usability unverified).
 *
 * Never throws — like the quota probe, a dead test must not be able to break
 * the settings surface; every failure path returns a typed envelope.
 */

import type { EndpointTestResponse } from "../shared/ipc";

/** Generous ceiling for a cold TLS handshake + round trip. */
export const ENDPOINT_TEST_TIMEOUT_MS = 8_000;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** {base}/, {base}, {base}/models → {base}/models (path-preserving: /v1 stays). */
export function modelsUrl(baseURL: string): string {
  const base = baseURL.trim().replace(/\/+$/, "");
  if (base.endsWith("/models")) return base;
  return `${base}/models`;
}

/** OpenAI-compatible /models payload → advertised model count (defensive). */
export function countModels(json: unknown): number | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const data = (json as Record<string, unknown>).data;
  return Array.isArray(data) ? data.length : undefined;
}

export async function testEndpoint(
  baseURL: string,
  apiKey: string | undefined,
  fetchImpl?: FetchLike
): Promise<EndpointTestResponse> {
  const started = Date.now();
  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENDPOINT_TEST_TIMEOUT_MS);
  const headers: Record<string, string> = {};
  const key = apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  try {
    const response = await doFetch(modelsUrl(baseURL), { headers, signal: controller.signal });
    const latencyMs = Date.now() - started;
    if (response.status === 200) {
      let modelsCount: number | undefined;
      try {
        modelsCount = countModels(await response.json());
      } catch {
        // Non-JSON 200 is still a working key + surface — just no count.
      }
      return { reachable: true, apiOk: true, status: "ok", httpStatus: 200, latencyMs, modelsCount };
    }
    if (response.status === 401 || response.status === 403) {
      return { reachable: true, apiOk: false, status: "auth-failed", httpStatus: response.status, latencyMs };
    }
    if (response.status === 404 || response.status === 405) {
      return { reachable: true, apiOk: false, status: "no-models-route", httpStatus: response.status, latencyMs };
    }
    return { reachable: true, apiOk: false, status: "http-error", httpStatus: response.status, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const aborted = err instanceof Error && err.name === "AbortError";
    const message = err instanceof Error ? err.message : String(err);
    return {
      reachable: false,
      apiOk: false,
      status: "network-error",
      latencyMs,
      error: aborted ? `timeout after ${ENDPOINT_TEST_TIMEOUT_MS / 1000}s` : message,
    };
  } finally {
    clearTimeout(timer);
  }
}
