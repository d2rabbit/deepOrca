// Drive the running Electron desktop app over CDP (native WebSocket, Node 22)
// to execute the GUI part of specs/gitmcp-local-module/tasks.md #12 checklist.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CDP = "http://127.0.0.1:9223";

const targets = (await (await fetch(`${CDP}/json`)).json()) as Array<{
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
  title: string;
}>;
const page = targets.find((t) => t.type === "page");
if (!page) {
  console.error("FATAL: no page target", JSON.stringify(targets, null, 2));
  process.exit(2);
}
console.log("page target:", page.title, page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 1;
const pending = new Map<number, (v: any) => void>();
ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)!(msg);
    pending.delete(msg.id);
  }
};
function send(method: string, params?: unknown, timeoutMs = 30000): Promise<any> {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`cdp timeout: ${method}`)), timeoutMs);
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function evaluate(expression: string): Promise<any> {
  const res = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result?.exceptionDetails) {
    throw new Error(JSON.stringify(res.result.exceptionDetails));
  }
  return res.result?.result?.value;
}
let shot = 0;
async function screenshot(name: string): Promise<string | null> {
  try {
    const res = await send("Page.captureScreenshot", { format: "png" }, 8000);
    const file = path.join(here, `shot-${String(++shot).padStart(2, "0")}-${name}.png`);
    writeFileSync(file, Buffer.from(res.result.data, "base64"));
    console.log("screenshot:", file);
    return file;
  } catch {
    console.log(`screenshot ${name}: unavailable (window likely not visible to CDP)`);
    return null;
  }
}

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
}

await send("Page.enable");
await send("Runtime.enable");
await sleep(1500);
const pageInfo = await evaluate(
  `JSON.stringify({ ready: document.readyState, vis: document.visibilityState, buttons: document.querySelectorAll("button").length })`
);
console.log("page state:", pageInfo);
await screenshot("app-initial");

// ── 1. GitMCP rail button exists and opens the panel ────────────────────────
const railClicked = await evaluate(`(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /gitmcp/i.test((b.getAttribute("aria-label") || "") + (b.title || "")));
  if (!btn) return "missing";
  btn.click();
  return "clicked";
})()`);
check("GitMCP rail button present + clicked", railClicked === "clicked", String(railClicked));
await sleep(800);
await screenshot("gitmcp-panel-open");

const panelState = await evaluate(`(() => {
  const input = document.querySelector(".ui-mcp-add-form input, .ui-side-panel input");
  const head = document.querySelector(".ui-side-panel-head")?.textContent ?? "";
  return { hasInput: Boolean(input), head };
})()`);
check("panel shows title + repo input", panelState?.hasInput === true, JSON.stringify(panelState));

// ── 2. Invalid input shows error ─────────────────────────────────────────────
async function setInput(value: string): Promise<void> {
  await evaluate(`(() => {
    const input = document.querySelector(".ui-side-panel input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
}
async function clickAdd(): Promise<void> {
  await evaluate(`(() => {
    [...document.querySelectorAll(".ui-side-panel button")]
      .find((b) => b.closest(".ui-mcp-add-form, .ui-mcp-add-actions"))?.click();
  })()`);
}
await setInput("not a repo!!");
await clickAdd();
await sleep(500);
const invalidError = await evaluate(`document.querySelector(".ui-side-panel .ui-scm-error")?.textContent ?? ""`);
check("invalid input shows error text", typeof invalidError === "string" && invalidError.length > 0, invalidError);
await screenshot("gitmcp-invalid-error");

// ── 3. Valid add → row appears and indexing kicks in ────────────────────────
await setInput("https://github.com/octocat/Spoon-Knife");
await clickAdd();
let rowText = "";
for (let i = 0; i < 180; i++) {
  await sleep(1000);
  rowText = await evaluate(
    `[...document.querySelectorAll(".ui-side-panel .ui-mcp-row")].map((r) => r.textContent).join(" | ")`
  );
  if (/chunk|分块/i.test(rowText) || /失败|failed/i.test(rowText)) break;
}
check("repo row appears after add", rowText.includes("octocat/Spoon-Knife"), rowText);
check("row reaches indexed state (chunks shown)", /chunk|分块/i.test(rowText), rowText);
await screenshot("gitmcp-indexed");

// ── 4. Duplicate add rejected in UI ─────────────────────────────────────────
await setInput("octocat/spoon-knife");
await clickAdd();
await sleep(500);
const dupError = await evaluate(`document.querySelector(".ui-side-panel .ui-scm-error")?.textContent ?? ""`);
check("duplicate add shows error text", typeof dupError === "string" && dupError.length > 0, dupError);

// ── 5. Toggle switch off/on from the panel ──────────────────────────────────
const toggled = await evaluate(`(async () => {
  const findSw = () => {
    const row = [...document.querySelectorAll(".ui-side-panel .ui-mcp-row")]
      .find((r) => r.textContent.includes("octocat/Spoon-Knife"));
    return row?.querySelector('input[type="checkbox"]');
  };
  const sw = findSw();
  if (!sw) return "no-switch";
  const before = String(sw.checked);
  sw.click();
  await new Promise((r) => setTimeout(r, 1500));
  const sw2 = findSw();
  const after = String(sw2?.checked);
  sw2?.click();
  await new Promise((r) => setTimeout(r, 1500));
  return before + "->" + after;
})()`);
check("switch toggles state", /true->false|false->true/.test(String(toggled)), String(toggled));
await sleep(1000);

// ── 6. Plugin center MCP tab: gitmcp row has no delete button ────────────────
const mcpTab = await evaluate(`(async () => {
  const plugins = [...document.querySelectorAll("button")].find((b) =>
    /plugin|插件/i.test((b.getAttribute("aria-label") || "") + (b.title || "")));
  if (!plugins) return { err: "no-plugins-rail" };
  plugins.click();
  await new Promise((r) => setTimeout(r, 600));
  const tab = [...document.querySelectorAll("button, [role=tab]")].find((b) => /^MCP$/i.test(b.textContent.trim()));
  if (tab) { tab.click(); await new Promise((r) => setTimeout(r, 600)); }
  const rows = [...document.querySelectorAll(".ui-mcp-row")];
  const git = rows.find((r) => r.textContent.includes("octocat/Spoon-Knife"));
  if (!git) return { err: "no-gitmcp-row", rows: rows.map((r) => r.textContent.slice(0, 40)) };
  const actions = [...git.querySelectorAll("button")].map((b) => (b.textContent || b.className).trim());
  const hasSwitch = Boolean(git.querySelector('input[type="checkbox"]'));
  const hasDanger = Boolean(git.querySelector(".ui-btn--danger"));
  return { actions, hasSwitch, hasDanger, text: git.textContent.slice(0, 80) };
})()`);
check(
  "MCP tab: gitmcp row toggle-only (no delete button)",
  mcpTab && !mcpTab.err && mcpTab.hasSwitch === true && mcpTab.hasDanger === false,
  JSON.stringify(mcpTab)
);
await screenshot("plugin-mcp-tab");

// ── 7. Back to GitMCP panel → delete with confirm ───────────────────────────
await evaluate(`[...document.querySelectorAll("button")].find((b) =>
  /gitmcp/i.test((b.getAttribute("aria-label") || "") + (b.title || "")))?.click()`);
await sleep(600);
const deleted = await evaluate(`(async () => {
  const findRow = () => [...document.querySelectorAll(".ui-side-panel .ui-mcp-row")]
    .find((r) => r.textContent.includes("octocat/Spoon-Knife"));
  const row = findRow();
  if (!row) return "no-row";
  const del = [...row.querySelectorAll("button")].find((b) => !b.closest('[role="switch"]') && !b.className.includes("switch"));
  const buttons = [...row.querySelectorAll("button")];
  // click the last non-switch action button (delete), then the danger confirm
  const delBtn = buttons.filter((b) => !b.className.includes("ui-switch")).at(-1);
  delBtn?.click();
  await new Promise((r) => setTimeout(r, 400));
  const confirm = document.querySelector(".ui-side-panel .ui-btn--danger");
  if (!confirm) return "no-confirm";
  confirm.click();
  await new Promise((r) => setTimeout(r, 1500));
  return findRow() ? "still-there" : "deleted";
})()`);
check("delete flow: confirm button + row removed", deleted === "deleted", String(deleted));
await screenshot("gitmcp-after-delete");

console.log(failures === 0 ? "\nALL GUI CHECKS PASSED" : `\n${failures} GUI CHECK(S) FAILED`);
ws.close();
process.exit(failures === 0 ? 0 : 1);
