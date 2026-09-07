/**
 * Minimal CDP driver (Node 22 built-in WebSocket, zero deps).
 * Usage: node scripts/cdp-drive.mjs <eval-js-file> <screenshot-out>
 * Connects to the first page target, evaluates the JS, waits, captures PNG.
 * The browser must run with --remote-debugging-port and its endpoint written
 * to /tmp/cdp-browser-ws.txt ({"webSocketDebuggerUrl": "..."}).
 */
import fs from "node:fs";

const [evalFile, shotOut] = process.argv.slice(2);

const wsUrl = JSON.parse(fs.readFileSync("/tmp/cdp-browser-ws.txt", "utf8")).webSocketDebuggerUrl;

// Node 22 globals (WebSocket/setTimeout/Buffer) are not whitelisted in the
// scripts eslint globals block — this helper opts out per-line.
const ws = new WebSocket(wsUrl); // eslint-disable-line no-undef
let msgId = 0;
const pending = new Map();

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

const notifyQueue = [];
let notifyWaiter = null;
function nextEvent() {
  if (notifyQueue.length) return notifyQueue.shift();
  return new Promise((resolve) => (notifyWaiter = resolve));
}
void nextEvent;

ws.onmessage = (event) => {
  const msg = JSON.parse(String(event.data));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  } else if (msg.method) {
    if (notifyWaiter) notifyWaiter(msg);
    else notifyQueue.push(msg);
  }
};

const opened = new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error("ws connect failed"));
});
await opened;

const { targetInfo } = await send("Target.getTargets");
const page = targetInfo.find((t) => t.type === "page" && !t.attached);
const target = page ?? targetInfo.find((t) => t.type === "page");
if (!target) throw new Error("no page target");
const { sessionId } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });

async function evaluate(expression, awaitPromise = false) {
  const res = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true }, sessionId);
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? "eval failed");
  }
  return res.result.value;
}

if (evalFile) {
  const expression = fs.readFileSync(evalFile, "utf8");
  await evaluate(expression, true);
}

// Wait for lazy chunks + data loads to settle.
await new Promise((r) => setTimeout(r, 2500)); // eslint-disable-line no-undef

const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
fs.writeFileSync(shotOut ?? "/tmp/cdp-shot.png", Buffer.from(data, "base64")); // eslint-disable-line no-undef
await send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
ws.close();
process.exit(0);
