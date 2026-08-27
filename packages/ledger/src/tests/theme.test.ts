import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeGitRemote, normalizeThemeName, resolveWorkspaceTheme, themeIdFromTheme } from "../theme/theme.js";

test("theme: ssh and https remotes of the same repo normalize identically", () => {
  const viaSsh = normalizeGitRemote("git@github.com:zshipu/deeporca.git");
  const viaHttps = normalizeGitRemote("https://github.com/zshipu/deeporca");
  const viaSshScheme = normalizeGitRemote("ssh://git@github.com:22/zshipu/deeporca.git");
  assert.equal(viaSsh, "git:github.com/zshipu/deeporca");
  assert.equal(viaHttps, viaSsh);
  assert.equal(viaSshScheme, viaSsh);
});

test("theme: credentials stripped, host lowercased, port kept, .git suffix stripped", () => {
  // Path case is preserved (hosts are case-insensitive, repo paths are not).
  assert.equal(
    normalizeGitRemote("https://user:secret@gitlab.example.com:8443/Team/Repo.GIT"),
    "git:gitlab.example.com:8443/Team/Repo"
  );
  assert.equal(normalizeGitRemote("https://token@github.com/owner/repo.git/"), "git:github.com/owner/repo");
});

test("theme: malformed remotes rejected", () => {
  assert.equal(normalizeGitRemote(""), null);
  assert.equal(normalizeGitRemote("not a url"), null);
  assert.equal(normalizeGitRemote("https:///only-path"), null);
  assert.equal(normalizeGitRemote("git@github.com:"), null);
});

test("theme: explicit names slugify (whitespace to hyphen, CJK preserved) and enforce length", () => {
  assert.equal(normalizeThemeName("平台中台 重构"), "平台中台-重构");
  assert.equal(normalizeThemeName("  My   Theme  "), "my-theme");
  assert.equal(normalizeThemeName(""), null);
  assert.equal(normalizeThemeName("-".repeat(65)), null);
});

test("theme: resolution priority — remote beats explicit name; nothing usable yields null", () => {
  const resolved = resolveWorkspaceTheme({
    gitRemotes: ["https://github.com/zshipu/deeporca.git", "git@gitlab.com:z/deeporca.git"],
    explicitName: "fallback",
  });
  assert.equal(resolved?.theme, "git:github.com/zshipu/deeporca");
  assert.equal(resolved?.source, "git-remote");

  const explicit = resolveWorkspaceTheme({ explicitName: "平台中台 重构" });
  assert.equal(explicit?.theme, "name:平台中台-重构");
  assert.equal(explicit?.source, "explicit-name");

  // Directory names are local display only — absent remote + absent name = no theme.
  assert.equal(resolveWorkspaceTheme({}), null);
});

test("theme: themeId is stable and distinct per theme string", () => {
  const a = themeIdFromTheme("git:github.com/zshipu/deeporca");
  const b = themeIdFromTheme("git:github.com/zshipu/deeporca");
  const c = themeIdFromTheme("name:平台中台-重构");
  assert.equal(a, b);
  assert.match(a, /^wt:[0-9a-f]{16}$/);
  assert.notEqual(a, c);
});
