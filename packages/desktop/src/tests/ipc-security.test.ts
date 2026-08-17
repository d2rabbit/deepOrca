/**
 * Unit tests for the renderer IPC security policy.
 *
 * The policy is a pure predicate over {@link IpcSenderInfo} — no Electron is
 * loaded — so each case is a direct function call. These tests are the
 * security boundary: every case here must hold or the privileged preload
 * surface (file writes, settings, Git, MCP, prompt execution) leaks to an
 * unauthorized frame/window/origin.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createRendererPolicy, type IpcSenderInfo } from "../main/ipc-security.js";

// NOTE: the production URL must be derived with the SAME transformation the
// policy uses (pathToFileURL). Hand-building "file:///" + slashes diverges on
// POSIX, where backslashes are legal filename characters and get
// percent-encoded — which is exactly why these tests failed everywhere except
// the Windows machine that authored them.
const PROD_HTML = "D:\\others\\deepOrca\\packages\\desktop\\dist\\renderer\\index.html";
const PROD_URL = pathToFileURL(PROD_HTML).href;
const DEV_ORIGIN = "http://localhost:5173";

function makePolicy(devOrigin: string | null = null) {
  let mainId = 1;
  return {
    policy: createRendererPolicy({
      mainWindowId: () => mainId,
      rendererHtmlPath: PROD_HTML,
      devRendererOrigin: devOrigin,
    }),
    setMainId(id: number) {
      mainId = id;
    },
    get mainId() {
      return mainId;
    },
  };
}

function sender(overrides: Partial<IpcSenderInfo> = {}): IpcSenderInfo {
  return {
    senderId: 1,
    senderFrameUrl: PROD_URL,
    isMainFrame: true,
    ...overrides,
  };
}

test("production: exact main window + main frame + exact renderer URL is allowed", () => {
  const { policy } = makePolicy();
  assert.equal(policy.isMainRenderer(sender()), true);
});

test("wrong sender id is rejected even with correct URL", () => {
  const { policy } = makePolicy();
  assert.equal(policy.isMainRenderer(sender({ senderId: 999 })), false);
});

test("main window gone (id null) is rejected", () => {
  const { policy, setMainId } = makePolicy();
  setMainId(0);
  // mainWindowId returning null simulates the closed window case.
  const nullPolicy = createRendererPolicy({
    mainWindowId: () => null,
    rendererHtmlPath: PROD_HTML,
    devRendererOrigin: null,
  });
  assert.equal(nullPolicy.isMainRenderer(sender()), false);
  void setMainId;
});

test("subframe (isMainFrame false) is rejected even from the main window", () => {
  const { policy } = makePolicy();
  assert.equal(policy.isMainRenderer(sender({ isMainFrame: false })), false);
});

test("arbitrary other file:// URL is rejected", () => {
  const { policy } = makePolicy();
  assert.equal(policy.isMainRenderer(sender({ senderFrameUrl: "file:///D:/evil/index.html" })), false);
});

test("localhost prefix host attack (localhost.attacker.example) is rejected without dev origin", () => {
  const { policy } = makePolicy();
  assert.equal(policy.isMainRenderer(sender({ senderFrameUrl: "http://localhost.attacker.example/" })), false);
});

test("localhost prefix host attack is rejected even WITH a configured dev origin", () => {
  const { policy } = makePolicy(DEV_ORIGIN);
  assert.equal(policy.isMainRenderer(sender({ senderFrameUrl: "http://localhost.attacker.example/" })), false);
});

test("dev origin wrong port is rejected", () => {
  const { policy } = makePolicy(DEV_ORIGIN);
  assert.equal(policy.isMainRenderer(sender({ senderFrameUrl: "http://localhost:8080/" })), false);
});

test("dev origin correct host+port with any path is allowed", () => {
  const { policy } = makePolicy(DEV_ORIGIN);
  assert.equal(policy.isMainRenderer(sender({ senderFrameUrl: "http://localhost:5173/" })), true);
  assert.equal(policy.isMainRenderer(sender({ senderFrameUrl: "http://localhost:5173/app" })), true);
});

test("dev origin must match exactly — 127.0.0.1 is NOT localhost when origin is localhost", () => {
  const { policy } = makePolicy("http://localhost:5173");
  // Host comparison is exact; 127.0.0.1 is a different host string even if it
  // resolves to the same loopback. Configuring the dev origin requires the
  // exact host the renderer is served from.
  assert.equal(policy.isMainRenderer(sender({ senderFrameUrl: "http://127.0.0.1:5173/" })), false);
});

test("empty sender URL is rejected", () => {
  const { policy } = makePolicy();
  assert.equal(policy.isMainRenderer(sender({ senderFrameUrl: "" })), false);
});

test("missing sender URL (undefined) is rejected", () => {
  const { policy } = makePolicy();
  assert.equal(policy.isMainRenderer(sender({ senderFrameUrl: undefined })), false);
});

test("data: URL is rejected", () => {
  const { policy } = makePolicy();
  assert.equal(
    policy.isMainRenderer(sender({ senderFrameUrl: "data:text/html,<script>parent.deeporca</script>" })),
    false
  );
});

test("javascript: URL is rejected", () => {
  const { policy } = makePolicy();
  assert.equal(policy.isMainRenderer(sender({ senderFrameUrl: "javascript:alert(1)" })), false);
});

test("https dev origin cannot be impersonated by a same-host http URL", () => {
  const { policy } = makePolicy("https://localhost:5173");
  assert.equal(policy.isMainRenderer(sender({ senderFrameUrl: "http://localhost:5173/" })), false);
});

test("production file URL with a trailing query hash still matches (URL equality)", () => {
  // pathToFileURL does not append fragments; a renderer file URL with a hash
  // is a different URL and must be rejected to avoid hash-spoofing.
  const { policy } = makePolicy();
  assert.equal(policy.isMainRenderer(sender({ senderFrameUrl: `${PROD_URL}#evil` })), false);
});

test("production file URL is computed via pathToFileURL (encoded paths round-trip)", () => {
  // Invariant: whatever the config path's platform quirks (Windows drive
  // letters, spaces, non-ASCII), the policy derives its expected URL with
  // pathToFileURL — so a sender URL derived the same way always matches and a
  // naively hand-built URL does not.
  const htmlPath = "/opt/my app/dist renderer/index.html";
  const policy = createRendererPolicy({
    mainWindowId: () => 1,
    rendererHtmlPath: htmlPath,
    devRendererOrigin: null,
  });
  assert.equal(policy.isMainRenderer(sender({ senderFrameUrl: pathToFileURL(htmlPath).href })), true);
  assert.notEqual(`file://${htmlPath}`, pathToFileURL(htmlPath).href, "naive join must differ (spaces encoded)");
});

// ── will-navigate predicate (query/hash-tolerant) ───────────────────────────

test("navigation: exact renderer URL is allowed", () => {
  const { policy } = makePolicy();
  assert.equal(policy.isAllowedRendererNavigationUrl(PROD_URL), true);
});

test("navigation: renderer URL with prototype query string is allowed", () => {
  const { policy } = makePolicy();
  assert.equal(policy.isAllowedRendererNavigationUrl(`${PROD_URL}?view=prototype&token=abc`), true);
});

test("navigation: renderer URL with hash is allowed", () => {
  const { policy } = makePolicy();
  assert.equal(policy.isAllowedRendererNavigationUrl(`${PROD_URL}#section`), true);
});

test("navigation: a DIFFERENT file:// path is rejected", () => {
  const { policy } = makePolicy();
  assert.equal(policy.isAllowedRendererNavigationUrl("file:///D:/evil/index.html"), false);
});

test("navigation: a file:// path that prefix-matches the renderer dir but is a different file is rejected", () => {
  const { policy } = makePolicy();
  // Sibling file in the renderer directory — must not be blanket-allowed.
  assert.equal(policy.isAllowedRendererNavigationUrl(`${PROD_URL.replace("index.html", "evil.html")}`), false);
});

test("navigation: any path under the configured dev origin is allowed", () => {
  const { policy } = makePolicy(DEV_ORIGIN);
  assert.equal(policy.isAllowedRendererNavigationUrl("http://localhost:5173/"), true);
  assert.equal(policy.isAllowedRendererNavigationUrl("http://localhost:5173/app"), true);
});

test("navigation: dev origin wrong port is rejected", () => {
  const { policy } = makePolicy(DEV_ORIGIN);
  assert.equal(policy.isAllowedRendererNavigationUrl("http://localhost:8080/"), false);
});

test("navigation: javascript: and data: are rejected", () => {
  const { policy } = makePolicy();
  assert.equal(policy.isAllowedRendererNavigationUrl("javascript:alert(1)"), false);
  assert.equal(policy.isAllowedRendererNavigationUrl("data:text/html,<script>x</script>"), false);
});

test("navigation: empty URL is rejected", () => {
  const { policy } = makePolicy();
  assert.equal(policy.isAllowedRendererNavigationUrl(""), false);
});
