import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configureSkillSpectorUvResolver,
  configureSkillSpectorVendorRoot,
  ensureSkillSpectorInstalled,
  type SkillSpectorExecFile,
} from "../common/skill-spector";

const VERSION_MARKER = ".vendored-skillspector-version";

test("SkillSpector provisioning passes executable and install spec as separate argv", () => {
  const uvBinary = String.raw`C:\Program Files\DeepOrca & tools\uv.exe`;
  const calls: Array<{ file: string; args: readonly string[]; options: Parameters<SkillSpectorExecFile>[2] }> = [];
  const execFile: SkillSpectorExecFile = (file, args, options) => {
    calls.push({ file, args, options });
    return "";
  };

  configureSkillSpectorUvResolver(() => uvBinary);
  configureSkillSpectorVendorRoot(null);
  try {
    assert.equal(ensureSkillSpectorInstalled(execFile), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.file, uvBinary);
    assert.deepEqual(calls[0]?.args, [
      "tool",
      "install",
      "--force",
      "skillspector[mcp] @ https://github.com/NVIDIA/SkillSpector/releases/download/v2.5.1/skillspector-2.5.1-py3-none-any.whl",
    ]);
    assert.equal(calls[0]?.options.timeout, 300_000);
    assert.deepEqual(calls[0]?.options.stdio, ["ignore", "pipe", "ignore"]);
    assert.equal(calls[0]?.options.windowsHide, true);
  } finally {
    configureSkillSpectorUvResolver(null);
    configureSkillSpectorVendorRoot(null);
  }
});

test("SkillSpector provisioning falls back to a pinned git tag with safe argv", () => {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const execFile: SkillSpectorExecFile = (file, args) => {
    calls.push({ file, args });
    if (calls.length === 1) throw new Error("wheel unavailable");
    return "";
  };

  configureSkillSpectorUvResolver(() => "uv-test");
  configureSkillSpectorVendorRoot(null);
  try {
    assert.equal(ensureSkillSpectorInstalled(execFile), true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], {
      file: "uv-test",
      args: ["tool", "install", "--force", "skillspector[mcp] @ git+https://github.com/NVIDIA/SkillSpector.git@v2.5.1"],
    });
  } finally {
    configureSkillSpectorUvResolver(null);
    configureSkillSpectorVendorRoot(null);
  }
});

test("SkillSpector rejects an invalid present version marker", () => {
  const vendorRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-skillspector-invalid-"));
  let calls = 0;
  const execFile: SkillSpectorExecFile = () => {
    calls += 1;
    return "";
  };

  fs.writeFileSync(path.join(vendorRoot, VERSION_MARKER), "2.5.1 & whoami\n", "utf8");
  configureSkillSpectorUvResolver(() => "uv-test");
  configureSkillSpectorVendorRoot(vendorRoot);
  try {
    assert.equal(ensureSkillSpectorInstalled(execFile), false);
    assert.equal(calls, 0);
  } finally {
    configureSkillSpectorUvResolver(null);
    configureSkillSpectorVendorRoot(null);
    fs.rmSync(vendorRoot, { recursive: true, force: true });
  }
});

test("SkillSpector uses a valid vendor marker for the wheel URL", () => {
  const vendorRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-skillspector-version-"));
  const calls: Array<readonly string[]> = [];
  const execFile: SkillSpectorExecFile = (_file, args) => {
    calls.push(args);
    return "";
  };

  fs.writeFileSync(path.join(vendorRoot, VERSION_MARKER), "2.6.0\r\n", "utf8");
  configureSkillSpectorUvResolver(() => "uv-test");
  configureSkillSpectorVendorRoot(vendorRoot);
  try {
    assert.equal(ensureSkillSpectorInstalled(execFile), true);
    assert.equal(
      calls[0]?.[3],
      "skillspector[mcp] @ https://github.com/NVIDIA/SkillSpector/releases/download/v2.6.0/skillspector-2.6.0-py3-none-any.whl"
    );
  } finally {
    configureSkillSpectorUvResolver(null);
    configureSkillSpectorVendorRoot(null);
    fs.rmSync(vendorRoot, { recursive: true, force: true });
  }
});
