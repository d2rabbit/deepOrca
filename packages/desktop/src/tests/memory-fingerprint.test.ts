// Memory config fingerprint (specs/model-fleet-adaptation D1 hot reload):
// field-sensitivity — every consumed field flips the fingerprint, unrelated
// fields do not; the thinking envelope rides the model/family switch.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ResolvedDeepcodingSettings } from "@deeporca/core";
import { extractMemoryFingerprint } from "../main/tools/memory-fingerprint";

function settings(overrides: Partial<ResolvedDeepcodingSettings> = {}): ResolvedDeepcodingSettings {
  return {
    model: "deepseek-v4-pro",
    baseURL: "https://api.example.test",
    secondaryBaseURL: "https://secondary.example.test",
    secondaryApiKey: "sk-secondary",
    secondaryModel: "deepseek-v4-flash",
    memory: { enabled: true, retentionDays: 30, everyNConversations: 10 },
    ...overrides,
  } as ResolvedDeepcodingSettings;
}

test("identical settings produce an identical fingerprint", () => {
  assert.equal(extractMemoryFingerprint(settings(), "/repo"), extractMemoryFingerprint(settings(), "/repo"));
});

test("every consumed field flips the fingerprint", () => {
  const base = extractMemoryFingerprint(settings(), "/repo");
  const memory = (over: Record<string, unknown>) => ({ ...settings().memory, ...over });
  const cases: Array<Partial<ResolvedDeepcodingSettings>> = [
    { secondaryBaseURL: "https://other.example.test" },
    { secondaryApiKey: "sk-rotated" },
    { secondaryModel: "deepseek-v4-pro" },
    // Inherit semantics: empty secondary = the primary model (deepseek-v4-pro
    // here), so clearing the secondary changes the effective extraction model.
    { secondaryModel: "" },
    { memory: memory({ retentionDays: 7 }) },
    { memory: memory({ everyNConversations: 20 }) },
    { memory: memory({ embedding: "local-onnx" }) },
  ];
  for (const overrides of cases) {
    assert.notEqual(extractMemoryFingerprint(settings(overrides), "/repo"), base, JSON.stringify(overrides));
  }
  // Project root is part of the identity (project-scoped data dir).
  assert.notEqual(extractMemoryFingerprint(settings(), "/other-repo"), base);
});

test("unrelated settings do NOT flip the fingerprint", () => {
  const base = extractMemoryFingerprint(settings(), "/repo");
  assert.equal(extractMemoryFingerprint(settings({ notify: "https://hooks.example" } as never), "/repo"), base);
  assert.equal(extractMemoryFingerprint(settings({ temperature: 0.7 } as never), "/repo"), base);
});
