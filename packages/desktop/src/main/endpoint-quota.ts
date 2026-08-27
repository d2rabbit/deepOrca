/**
 * Endpoint quota probes — the per-ENDPOINT "how much is left" surface for
 * subscription/prepaid providers. Quota follows the endpoint, not the model:
 * every probe is keyed by the endpoint's own baseURL + apiKey.
 *
 *  - StepFun (both channels: pay-as-you-go /v1 and Step Plan /step_plan/v1 —
 *    the key identifies the ACCOUNT, so one read covers both): live balance
 *    via GET https://api.stepfun.com/v1/accounts.
 *  - OpenCode Go (subscription): the platform exposes NO balance API (open
 *    request anomalyco/opencode#10448; only the web dashboard shows credits),
 *    so the probe serves the plan's documented rolling limits as static info.
 *
 * Poll, don't push: neither platform offers quota webhooks, so the settings
 * surface refreshes on an interval while visible (60s) plus on demand. The
 * per-key TTL cache below keeps repeated opens cheap and rate-limit friendly.
 */

import type { EndpointQuotaKind } from "@deeporca/core";

export type StepfunAccount = {
  /** prepaid | postpaid. */
  type: "prepaid" | "postpaid";
  /** 可用余额（元）— cash + voucher. */
  balance: number;
  /** 累计充值（元）. */
  totalCashBalance: number;
  /** 累计赠送（元）. */
  totalVoucherBalance: number;
};

/** OpenCode Go subscription's documented rolling usage limits (USD). */
export type OpencodeGoLimits = {
  fiveHourUsd: number;
  weeklyUsd: number;
  monthlyUsd: number;
};

export type EndpointQuotaResult =
  | { ok: true; kind: "stepfun-account"; account: StepfunAccount; fetchedAt: string }
  | { ok: true; kind: "opencode-subscription"; limits: OpencodeGoLimits }
  | { ok: false; error: string };

const ACCOUNTS_URL = "https://api.stepfun.com/v1/accounts";

/** Docker/opencode docs' published Go-plan limits (usage, not balance). */
const OPENCODE_GO_LIMITS: OpencodeGoLimits = { fiveHourUsd: 12, weeklyUsd: 30, monthlyUsd: 60 };

/** Cache TTL — balance changes at token speed; a minute is honest enough. */
const CACHE_TTL_MS = 60_000;

type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

const cache = new Map<string, { at: number; result: EndpointQuotaResult }>();

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Parse the /v1/accounts payload defensively (shape per API reference). */
export function parseStepfunAccount(json: unknown): StepfunAccount | null {
  if (typeof json !== "object" || json === null) return null;
  const record = json as Record<string, unknown>;
  const balance = asFiniteNumber(record.balance);
  const totalCashBalance = asFiniteNumber(record.total_cash_balance);
  const totalVoucherBalance = asFiniteNumber(record.total_voucher_balance);
  if (balance === undefined) return null;
  return {
    type: record.type === "postpaid" ? "postpaid" : "prepaid",
    balance,
    totalCashBalance: totalCashBalance ?? 0,
    totalVoucherBalance: totalVoucherBalance ?? 0,
  };
}

/**
 * Probe one endpoint's quota. Never throws — callers get an ok:false
 * envelope (network, HTTP, auth, or shape errors) so a dead probe can never
 * break the settings surface. The opencode kind needs no network round-trip
 * (static limits) and therefore no key.
 */
export async function fetchEndpointQuota(
  kind: EndpointQuotaKind,
  apiKey: string,
  fetchImpl?: FetchLike
): Promise<EndpointQuotaResult> {
  if (kind === "opencode-subscription") {
    return { ok: true, kind, limits: OPENCODE_GO_LIMITS };
  }
  const key = apiKey.trim();
  if (!key) return { ok: false, error: "no api key" };
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;
  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init));
  let result: EndpointQuotaResult;
  try {
    const response = await doFetch(ACCOUNTS_URL, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) {
      result = { ok: false, error: `HTTP ${response.status}` };
    } else {
      const account = parseStepfunAccount(await response.json());
      result = account
        ? { ok: true, kind: "stepfun-account", account, fetchedAt: new Date().toISOString() }
        : { ok: false, error: "unexpected account payload" };
    }
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  cache.set(key, { at: Date.now(), result });
  return result;
}
