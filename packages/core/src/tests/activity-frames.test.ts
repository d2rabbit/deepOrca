import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUrl } from "../activity-frames/entities";
import { cleanName, domain } from "../activity-frames/sessionize";
import { parseEpoch, localDayWindowUtc, fmtLocalHms } from "../activity-frames/time";

// ── entities.test ────────────────────────────────────────────────────────────

test("parseUrl: GitHub repo", () => {
  const r = parseUrl("https://github.com/anthropics/claude-code");
  assert.equal(r.kind, "repo");
  assert.equal(r.domain, "github.com");
  assert.equal(r.entity, "anthropics/claude-code");
});

test("parseUrl: GitHub PR", () => {
  const r = parseUrl("https://github.com/anthropics/claude-code/pull/42");
  assert.equal(r.kind, "pull_request");
  assert.ok(r.entity.includes("42"));
});

test("parseUrl: GitHub profile", () => {
  const r = parseUrl("https://github.com/torvalds");
  assert.equal(r.kind, "profile");
  assert.equal(r.entity, "torvalds");
});

test("parseUrl: LinkedIn profile", () => {
  const r = parseUrl("https://www.linkedin.com/in/johndoe");
  assert.equal(r.kind, "profile");
  assert.equal(r.domain, "linkedin.com");
  assert.equal(r.entity, "johndoe");
});

test("parseUrl: Google search", () => {
  const r = parseUrl("https://www.google.com/search?q=hello+world");
  assert.equal(r.kind, "search");
  assert.equal(r.entity, "hello world");
});

test("parseUrl: YouTube video", () => {
  const r = parseUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(r.kind, "video");
  assert.equal(r.entity, "dQw4w9WgXcQ");
});

test("parseUrl: Slack channel", () => {
  const r = parseUrl("https://app.slack.com/client/T123/C456");
  assert.equal(r.kind, "channel");
  assert.ok(r.entity.includes("C456"));
});

test("parseUrl: Linear issue", () => {
  const r = parseUrl("https://linear.app/acme/issue/ENG-123");
  assert.equal(r.kind, "issue");
  assert.equal(r.entity, "ENG-123");
});

test("parseUrl: sign-in page", () => {
  const r = parseUrl("https://accounts.google.com/signin");
  assert.equal(r.kind, "sign_in");
});

test("parseUrl: unknown site fallback", () => {
  const r = parseUrl("https://random-site.example.com/some/page");
  assert.equal(r.kind, "page");
  assert.equal(r.domain, "random-site.example.com");
  assert.equal(r.entity, "some");
});

test("parseUrl: invalid URL fallback", () => {
  const r = parseUrl("not-a-url");
  assert.equal(r.kind, "page");
});

test("parseUrl: empty URL", () => {
  const r = parseUrl("");
  assert.equal(r.kind, "page");
  assert.equal(r.entity, "Unknown");
});

// ── sessionize.test ──────────────────────────────────────────────────────────

test("domain: extracts hostname, strips www.", () => {
  assert.equal(domain("https://www.example.com/path"), "example.com");
  assert.equal(domain("https://api.github.com/repos"), "api.github.com");
  assert.equal(domain("not-a-url"), null);
  assert.equal(domain(""), null);
});

test("cleanName: strips invisible Unicode marks", () => {
  const dirty = "Hello\u200EWorld\u200B\u2060";
  assert.equal(cleanName(dirty), "HelloWorld");
});

// ── time.test ────────────────────────────────────────────────────────────────

test("parseEpoch: valid ISO timestamp", () => {
  const epoch = parseEpoch("2026-08-01T12:00:00");
  assert.ok(epoch > 0);
});

test("parseEpoch: with fractional seconds", () => {
  const epoch = parseEpoch("2026-08-01T12:00:00.123456");
  assert.ok(epoch > 0);
  const fracPart = epoch - Math.floor(epoch);
  assert.ok(fracPart > 0.1 && fracPart < 0.2);
});

test("parseEpoch: invalid input returns 0", () => {
  assert.equal(parseEpoch(""), 0);
  assert.equal(parseEpoch("short"), 0);
});

test("parseEpoch: handles timezone suffix", () => {
  const e1 = parseEpoch("2026-08-01T12:00:00+00:00");
  const e2 = parseEpoch("2026-08-01T12:00:00.000Z");
  // Both should be valid and equal (UTC midnight).
  assert.ok(e1 > 0);
  assert.ok(e2 > 0);
});

test("localDayWindowUtc: produces valid UTC window", () => {
  const [start, end] = localDayWindowUtc("2026-08-01");
  assert.ok(start.startsWith("2026-"));
  assert.ok(end.startsWith("2026-"));
  // End should be after start.
  assert.ok(end > start);
});

test("localDayWindowUtc: throws on invalid format", () => {
  assert.throws(() => localDayWindowUtc("invalid"));
  assert.throws(() => localDayWindowUtc("2026/08/01"));
});

test("fmtLocalHms: returns HH:MM:SS for valid epoch", () => {
  const epoch = parseEpoch("2026-08-01T12:34:56");
  const formatted = fmtLocalHms(epoch);
  assert.match(formatted, /^\d{2}:\d{2}:\d{2}$/);
});

test("fmtLocalHms: returns ? for invalid epoch", () => {
  assert.equal(fmtLocalHms(0), "?");
  assert.equal(fmtLocalHms(-1), "?");
});
