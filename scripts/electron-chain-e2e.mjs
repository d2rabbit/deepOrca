// CDP driver: connect the real Electron renderer, evaluate sanity, capture screenshot.
import fs from "node:fs";
import WebSocket from "ws";

const url = process.argv[2] ?? "";
const out = process.argv[3] ?? "/tmp/app-shot.png";
const expr = process.argv[4] ?? "1";

const ws = new WebSocket(url);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && pending.has(m.id)) {
    const { res } = pending.get(m.id);
    pending.delete(m.id);
    res(m.result ?? m.error);
  }
});
ws.on("open", async () => {
  try {
    await send("Runtime.enable");
    await send("Page.enable");
    let r = null;
    if (expr.startsWith("click:")) {
      const [x, y] = expr.slice(6).split(",").map(Number);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      console.log("CLICK:", x, y);
    } else {
      r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      console.log("EVAL:", JSON.stringify(r));
    }
    if (r && r.exceptionDetails) console.log("EXC:", JSON.stringify(r.exceptionDetails.exception ?? r.exceptionDetails.text));
    const shot = await send("Page.captureScreenshot", { format: "png" });
    if (shot && shot.data) {
      fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
      console.log("SHOT:", out);
    } else {
      console.log("NOSHOT");
    }
  } catch (error) {
    console.error("DRIVER_ERR:", String(error));
  }
  process.exit(0);
});
ws.on("error", (e) => {
  console.error("WS_ERR:", String(e));
  process.exit(1);
});