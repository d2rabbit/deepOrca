import { test } from "node:test";
import assert from "node:assert/strict";
import { testEndpoint, modelsUrl, countModels } from "../main/endpoint-test";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

test("modelsUrl preserves the path and folds trailing slashes onto /models", () => {
  assert.equal(modelsUrl("https://api.example.com"), "https://api.example.com/models");
  assert.equal(modelsUrl("https://api.example.com/"), "https://api.example.com/models");
  assert.equal(modelsUrl("https://api.example.com///"), "https://api.example.com/models");
  assert.equal(modelsUrl("https://api.example.com/v1"), "https://api.example.com/v1/models");
  assert.equal(modelsUrl("https://api.example.com/v1/models"), "https://api.example.com/v1/models");
});

test("countModels reads the OpenAI {data:[…]} shape defensively", () => {
  assert.equal(countModels({ object: "list", data: [{ id: "a" }, { id: "b" }] }), 2);
  assert.equal(countModels({ data: [] }), 0);
  for (const bad of [null, "x", {}, { data: "nope" }]) assert.equal(countModels(bad), undefined);
});

test("200 with a models payload → reachable, apiOk, count + latency recorded", async () => {
  let sawUrl = "";
  let sawAuth = "";
  const result = await testEndpoint("https://api.example.com/v1", "sk-key", async (url, init) => {
    sawUrl = url;
    sawAuth = (init.headers as Record<string, string>).Authorization ?? "";
    return jsonResponse({ object: "list", data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] });
  });
  assert.equal(sawUrl, "https://api.example.com/v1/models");
  assert.equal(sawAuth, "Bearer sk-key");
  assert.deepEqual(
    { ...result, latencyMs: 0 },
    { reachable: true, apiOk: true, status: "ok", httpStatus: 200, latencyMs: 0, modelsCount: 2 }
  );
  assert.ok(result.latencyMs >= 0);
});

test("200 with a non-JSON body still reports ok — just without a count", async () => {
  const result = await testEndpoint(
    "https://api.example.com",
    "k",
    async () => new Response("gateway: up", { status: 200 })
  );
  assert.equal(result.status, "ok");
  assert.equal(result.apiOk, true);
  assert.equal(result.modelsCount, undefined);
});

test("no api key → the probe is sent without an Authorization header", async () => {
  let sawAuth: string | undefined = "__unset__";
  const result = await testEndpoint("https://api.example.com", "", async (_url, init) => {
    sawAuth = (init.headers as Record<string, string>).Authorization;
    return jsonResponse({}, 200);
  });
  assert.equal(sawAuth, undefined);
  assert.equal(result.status, "ok");
});

test("401/403 → reachable but the key is rejected", async () => {
  for (const code of [401, 403]) {
    const result = await testEndpoint("https://api.example.com", "bad", async () => jsonResponse({}, code));
    assert.deepEqual(
      { ...result, latencyMs: 0 },
      { reachable: true, apiOk: false, status: "auth-failed", httpStatus: code, latencyMs: 0 }
    );
  }
});

test("404/405 → reachable, but /models is not served (usability unverified)", async () => {
  for (const code of [404, 405]) {
    const result = await testEndpoint("https://api.example.com", "k", async () => jsonResponse({}, code));
    assert.deepEqual(
      { ...result, latencyMs: 0 },
      { reachable: true, apiOk: false, status: "no-models-route", httpStatus: code, latencyMs: 0 }
    );
  }
});

test("other HTTP statuses fold into http-error", async () => {
  const result = await testEndpoint("https://api.example.com", "k", async () => jsonResponse({}, 503));
  assert.deepEqual(
    { ...result, latencyMs: 0 },
    { reachable: true, apiOk: false, status: "http-error", httpStatus: 503, latencyMs: 0 }
  );
});

test("transport failures fold into network-error with the raw message", async () => {
  const result = await testEndpoint("https://nope.invalid", "k", async () => {
    throw new Error("getaddrinfo ENOTFOUND nope.invalid");
  });
  assert.equal(result.reachable, false);
  assert.equal(result.status, "network-error");
  assert.match(result.error ?? "", /ENOTFOUND/);
});
