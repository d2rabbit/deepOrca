import { test } from "node:test";
import assert from "node:assert/strict";
import { endpointQuotaKind } from "@deeporca/core";
import { fetchEndpointQuota, parseStepfunAccount } from "../main/endpoint-quota";

test("parseStepfunAccount accepts the documented /v1/accounts shape", () => {
  const account = parseStepfunAccount({
    object: "account",
    type: "prepaid",
    balance: 12.5,
    total_cash_balance: 10,
    total_voucher_balance: 2.5,
  });
  assert.deepEqual(account, {
    type: "prepaid",
    balance: 12.5,
    totalCashBalance: 10,
    totalVoucherBalance: 2.5,
  });
  // postpaid passthrough + missing optional balances default to 0
  assert.deepEqual(parseStepfunAccount({ type: "postpaid", balance: 1 }), {
    type: "postpaid",
    balance: 1,
    totalCashBalance: 0,
    totalVoucherBalance: 0,
  });
});

test("parseStepfunAccount rejects payloads without a finite balance", () => {
  for (const bad of [null, "x", {}, { balance: "NaN" }, { balance: Number.POSITIVE_INFINITY }]) {
    assert.equal(parseStepfunAccount(bad), null);
  }
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

test("fetchEndpointQuota surfaces ok:true envelopes", async () => {
  const result = await fetchEndpointQuota("stepfun-account", "k-success", async () =>
    jsonResponse({ object: "account", type: "prepaid", balance: 3, total_cash_balance: 2, total_voucher_balance: 1 })
  );
  assert.equal(result.ok, true);
  if (result.ok && result.kind === "stepfun-account") {
    assert.equal(result.account.balance, 3);
    assert.equal(result.account.totalVoucherBalance, 1);
    assert.ok(result.fetchedAt);
  }
});

test("fetchEndpointQuota folds HTTP errors and bad payloads into ok:false", async () => {
  const unauthorized = await fetchEndpointQuota("stepfun-account", "k-401", async () =>
    jsonResponse({ detail: "bad key" }, 401)
  );
  assert.deepEqual(unauthorized, { ok: false, error: "HTTP 401" });

  const malformed = await fetchEndpointQuota("stepfun-account", "k-shape", async () => jsonResponse({ hello: 1 }));
  assert.deepEqual(malformed, { ok: false, error: "unexpected account payload" });

  const empty = await fetchEndpointQuota("stepfun-account", "  ", async () => {
    throw new Error("must not be called");
  });
  assert.deepEqual(empty, { ok: false, error: "no api key" });
});

test("endpointQuotaKind maps hosts to probes (quota follows the endpoint)", () => {
  assert.equal(endpointQuotaKind("https://api.stepfun.com/v1"), "stepfun-account");
  assert.equal(endpointQuotaKind("https://api.stepfun.com/step_plan/v1"), "stepfun-account");
  assert.equal(endpointQuotaKind("https://opencode.ai/zen/go/v1"), "opencode-subscription");
  assert.equal(endpointQuotaKind("https://opencode.ai/zen/v1"), "opencode-subscription");
  assert.equal(endpointQuotaKind("https://api.deepseek.com"), null);
  assert.equal(endpointQuotaKind("https://opencode.ai.evil.io"), null);
  assert.equal(endpointQuotaKind(undefined), null);
});

test("opencode subscription serves static plan limits without a key or network", async () => {
  const result = await fetchEndpointQuota("opencode-subscription", "", async () => {
    throw new Error("must not be called");
  });
  assert.deepEqual(result, {
    ok: true,
    kind: "opencode-subscription",
    limits: { fiveHourUsd: 12, weeklyUsd: 30, monthlyUsd: 60 },
  });
});
