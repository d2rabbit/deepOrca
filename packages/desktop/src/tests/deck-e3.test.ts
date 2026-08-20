/**
 * E3 guard tests for the Orca Deck experimental layout (experiment-plan v3).
 *
 * Pins the behaviour the E3 acceptance criteria depend on:
 *   - fuzzy scoring (lib/fuzzy.ts): prefix/consecutive bonuses, no-match = 0
 *   - the unified overlay stack (lib/overlay-stack.ts + DeckApp wiring):
 *     layers stack, Esc closes the topmost only, ⌘⇧Esc clears the stack,
 *     tier ordering keeps drawers below the command layer / workshop wall
 *   - ⌘K command layer: opens, filters by true fuzzy score, Enter runs,
 *     the ">" prefix locks the query to module navigation
 *   - notification drawer: engine events archive, dock badge, read-on-open
 *   - six-theme hot swap: attribute flip + localStorage persistence
 *   - settings: back-to-classic persists the layout fallback
 *   - shortcuts panel: same registry source as the dock (⌘T row present)
 *   - editor overlay: tree → load → edit → save through the editor IPC
 */

import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { DeckApp as DeckAppComponent } from "../renderer/deck/deck-app";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type * as Fuzzy from "../renderer/deck/lib/fuzzy";
import type * as OverlayStack from "../renderer/deck/lib/overlay-stack";

let dom: DomHandle;
let stub: ApiStub;
let fixture: Record<string, unknown>;
let render: typeof RTL.render;
let act: typeof RTL.act;
let fireEvent: typeof RTL.fireEvent;
let createElement: typeof React.createElement;
let StrictMode: typeof React.StrictMode;
let fuzzy: typeof Fuzzy;
let overlayStack: typeof OverlayStack;
let DeckApp: typeof DeckAppComponent;
let I18nProvider: typeof I18nProviderComponent;

function defaultFixture(): Record<string, unknown> {
  return {
    getActiveSession: async () => null,
    getSession: async () => null,
  };
}

before(async () => {
  dom = installDom();
  const win = (globalThis as unknown as { window: Window }).window;
  Object.defineProperty(globalThis, "localStorage", { value: win.localStorage, configurable: true });

  fixture = defaultFixture();
  stub = createApiStub(fixture);
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;

  const rtl = await import("@testing-library/react");
  const react = await import("react");
  render = rtl.render;
  act = rtl.act;
  fireEvent = rtl.fireEvent;
  createElement = react.createElement;
  StrictMode = react.StrictMode;
  fuzzy = await import("../renderer/deck/lib/fuzzy");
  overlayStack = await import("../renderer/deck/lib/overlay-stack");
  DeckApp = (await import("../renderer/deck/deck-app")).DeckApp;
  I18nProvider = (await import("../renderer/i18n")).I18nProvider;
});

after(() => {
  dom?.cleanup();
});

beforeEach(() => {
  Object.assign(fixture, defaultFixture());
  stub.reset();
  localStorage.clear();
});

describe("fuzzy scoring (lib/fuzzy.ts)", () => {
  test("prefix beats scattered, no match scores 0", () => {
    assert.equal(fuzzy.fuzzyScore("xyz", "abc"), 0, "non-subsequence must score 0");
    const prefix = fuzzy.fuzzyScore("ab", "abc");
    const scattered = fuzzy.fuzzyScore("ab", "a1111111b");
    assert.ok(prefix > scattered, `prefix (${prefix}) should outrank scattered (${scattered})`);
    assert.ok(prefix > 0 && scattered > 0);
  });

  test("consecutive + word-start bonuses rank a tight match above a loose one", () => {
    // "Tape" matches t-a consecutively from a prefix; "Total" scatters them.
    const tape = fuzzy.fuzzyScore("ta", "Tape tape");
    const total = fuzzy.fuzzyScore("ta", "Total total");
    assert.ok(tape > total, `Tape (${tape}) should outrank Total (${total})`);

    const ranked = fuzzy.rankFuzzy("ta", ["Total total", "Tape tape"], (item) => item).map((entry) => entry.item);
    assert.deepEqual(ranked, ["Tape tape", "Total total"]);
  });

  test("empty query matches everything with a neutral score", () => {
    assert.equal(fuzzy.fuzzyScore("", "anything"), 1);
    assert.equal(fuzzy.rankFuzzy("  ", ["a", "b"], (item) => item).length, 2);
  });
});

describe("overlay stack (lib/overlay-stack.ts)", () => {
  test("toggling the top layer closes it; re-opening dedupes and raises", () => {
    let stack = overlayStack.pushLayer([], "tape", 1);
    stack = overlayStack.pushLayer(stack, "files", 2);
    assert.deepEqual(
      stack.map((l) => l.kind),
      ["tape", "files"],
      "same-tier layers stack by recency — the newly opened one on top"
    );

    // Same kind again while on top → toggle off.
    stack = overlayStack.pushLayer(stack, "files", 3);
    assert.deepEqual(
      stack.map((l) => l.kind),
      ["tape"]
    );

    // Re-opening tape dedupes the old instance and raises it to the top.
    stack = overlayStack.pushLayer(stack, "ledger", 4);
    stack = overlayStack.pushLayer(stack, "tape", 5);
    assert.deepEqual(
      stack.map((l) => l.kind),
      ["ledger", "tape"]
    );
  });

  test("tier ordering keeps the command layer / workshop wall above panels", () => {
    // Open the workshop wall (top tier) first, then panels — they must land
    // BELOW the wall, never on top of it.
    let stack = overlayStack.pushLayer([], "floor", 1);
    stack = overlayStack.pushLayer(stack, "files", 2);
    stack = overlayStack.pushLayer(stack, "tape", 3);
    assert.deepEqual(
      stack.map((l) => l.kind),
      ["files", "tape", "floor"]
    );

    stack = overlayStack.popLayer(stack);
    assert.deepEqual(
      stack.map((l) => l.kind),
      ["files", "tape"],
      "Esc must close the topmost layer only"
    );
  });
});

describe("Deck E3 overlay stack + command layer", () => {
  let mounted: { unmount(): void; container: HTMLElement } | null = null;

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  async function mountDeck(): Promise<{ unmount(): void; container: HTMLElement }> {
    let result!: ReturnType<typeof render>;
    await act(async () => {
      result = render(createElement(StrictMode, null, createElement(I18nProvider, null, createElement(DeckApp))));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    return { unmount: () => result.unmount(), container: result.container };
  }

  function keyDown(key: string, opts: { meta?: boolean; shift?: boolean } = {}): Promise<void> {
    return act(async () => {
      fireEvent.keyDown(window, { key, metaKey: opts.meta ?? true, shiftKey: opts.shift ?? false });
    });
  }

  test("⌘K opens the command layer; Enter runs the top match and closes it", async () => {
    mounted = await mountDeck();
    await keyDown("k");
    assert.ok(mounted.container.querySelector('[data-layer="command"]'), "command layer should open on ⌘K");

    const input = mounted.container.querySelector(".deck-cmd-input");
    assert.ok(input, "command input missing");
    await act(async () => {
      fireEvent.change(input!, { target: { value: "tape" } });
    });
    await act(async () => {
      fireEvent.keyDown(input!, { key: "Enter" });
    });

    assert.ok(mounted.container.querySelector('[data-layer="tape"]'), "Enter should open the Tape overlay");
    assert.ok(!mounted.container.querySelector('[data-layer="command"]'), "command layer should close after run");
  });

  test("Esc closes only the topmost layer; ⌘⇧Esc clears the stack", async () => {
    mounted = await mountDeck();
    await keyDown("t"); // tape panel
    await keyDown("k"); // command layer on top
    assert.ok(mounted.container.querySelector('[data-layer="tape"]'));
    assert.ok(mounted.container.querySelector('[data-layer="command"]'));

    await keyDown("Escape"); // closes command only
    assert.ok(!mounted.container.querySelector('[data-layer="command"]'));
    assert.ok(mounted.container.querySelector('[data-layer="tape"]'), "tape must survive Esc on the layer above");

    await keyDown("k");
    await keyDown("Escape", { meta: true, shift: true }); // ⌘⇧Esc clears everything
    assert.ok(!mounted.container.querySelector('[data-layer="command"]'));
    assert.ok(!mounted.container.querySelector(".deck-overlay"), "⌘⇧Esc must clear the whole stack");
  });

  test("the › prefix locks the query to module navigation", async () => {
    mounted = await mountDeck();
    await keyDown("k");
    const input = mounted.container.querySelector(".deck-cmd-input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: ">flat" } });
    });
    // "flat" is a theme, not a module → the module-locked list must be empty.
    assert.ok(
      mounted.container.textContent?.includes("No matching commands."),
      "module lock should hide non-module commands"
    );

    await act(async () => {
      fireEvent.change(input, { target: { value: ">tape" } });
    });
    assert.ok(mounted.container.textContent?.includes("Tape"), "module lock should still find Tape");
  });

  test("notification events archive into the drawer and badge read-on-open", async () => {
    mounted = await mountDeck();
    await act(async () => {
      stub.emit("onSessionEntryUpdated", { id: "sess-abcdef12", status: "completed" });
    });

    const badge = mounted.container.querySelector(".deck-dock-badge");
    assert.ok(badge, "unread badge missing after a notify-worthy event");
    assert.equal(badge!.textContent, "1");

    const bell = mounted.container.querySelector('[data-overlay="notifications"]');
    await act(async () => {
      fireEvent.click(bell!);
    });
    const drawer = mounted.container.querySelector('[data-layer="notifications"]');
    assert.ok(drawer, "notification drawer missing");
    assert.ok(drawer!.textContent?.includes("completed"), "archived event missing from the drawer");
    assert.ok(!mounted.container.querySelector(".deck-dock-badge"), "badge must clear when the drawer opens");
  });

  test("theme swatch hot-swaps the attribute and persists the choice", async () => {
    mounted = await mountDeck();
    const swatchButton = mounted.container.querySelector('[data-overlay="theme"]');
    await act(async () => {
      fireEvent.click(swatchButton!);
    });
    const flat = mounted.container.querySelector('[data-theme-swatch="flat"]');
    await act(async () => {
      fireEvent.click(flat!);
    });

    assert.equal(
      mounted.container.querySelector(".deck-app")?.getAttribute("data-deck-theme"),
      "flat",
      "picking a theme must flip data-deck-theme with no reload"
    );
    assert.equal(localStorage.getItem("deeporca.deck.theme"), "flat");
  });

  test("a persisted theme restores on boot", async () => {
    localStorage.setItem("deeporca.deck.theme", "vern");
    mounted = await mountDeck();
    assert.equal(mounted.container.querySelector(".deck-app")?.getAttribute("data-deck-theme"), "vern");
  });

  test("settings panel persists the back-to-classic escape hatch", async () => {
    localStorage.setItem("deeporca.layout", "deck");
    mounted = await mountDeck();
    const gear = mounted.container.querySelector('[data-overlay="settings"]');
    await act(async () => {
      fireEvent.click(gear!);
    });
    const panel = mounted.container.querySelector('[data-layer="settings"]');
    assert.ok(panel, "settings panel missing");
    assert.ok(panel!.textContent?.includes("Orca Deck"), "settings should show the current layout");

    const back = [...panel!.querySelectorAll("button")].find((b) => b.textContent === "Back to Classic");
    await act(async () => {
      fireEvent.click(back!);
    });
    assert.equal(localStorage.getItem("deeporca.layout"), "classic");
  });

  test("shortcuts panel lists global keys and dock modules from one source", async () => {
    mounted = await mountDeck();
    const keys = mounted.container.querySelector('[data-overlay="shortcuts"]');
    await act(async () => {
      fireEvent.click(keys!);
    });
    const panel = mounted.container.querySelector('[data-layer="shortcuts"]');
    assert.ok(panel, "shortcuts panel missing");
    assert.ok(panel!.textContent?.includes("⌘K"), "global ⌘K row missing");
    assert.ok(panel!.textContent?.includes("Tape"), "dock module rows missing");
    assert.ok(panel!.textContent?.includes("⌘T"), "dock shortcut ⌘T missing");
  });

  test("editor overlay loads, edits and saves through the editor IPC", async () => {
    fixture.editorListFiles = async () => ({
      ok: true,
      entries: [
        { name: "hello.txt", path: "hello.txt", type: "file", size: 5 },
        { name: "src", path: "src", type: "directory", size: 0 },
      ],
    });
    fixture.editorReadFile = async () => ({ ok: true, content: "hello" });
    fixture.editorWriteFile = async () => ({ ok: true });

    mounted = await mountDeck();
    const edit = mounted.container.querySelector('[data-overlay="editor"]');
    await act(async () => {
      fireEvent.click(edit!);
    });

    const fileRow = [...mounted.container.querySelectorAll(".deck-editor-tree .deck-row")].find((r) =>
      r.textContent?.includes("hello.txt")
    );
    await act(async () => {
      fireEvent.click(fileRow!);
    });

    const textarea = mounted.container.querySelector(".deck-editor-text");
    assert.ok(textarea, "editor textarea missing after picking a file");
    assert.equal((textarea as HTMLTextAreaElement).value, "hello");

    await act(async () => {
      fireEvent.change(textarea!, { target: { value: "hello deck" } });
    });
    await act(async () => {
      fireEvent.keyDown(textarea!, { key: "s", metaKey: true });
    });

    const write = stub.calls.filter((c) => c.method === "editorWriteFile");
    assert.equal(
      write.length,
      1,
      `expected one editorWriteFile call, saw ${JSON.stringify(stub.calls.map((c) => c.method))}`
    );
    assert.deepEqual(write[0].args, ["hello.txt", "hello deck"]);
  });

  test("clicking a file in the files drawer deep-links into the editor", async () => {
    fixture.editorListFiles = async () => ({
      ok: true,
      entries: [{ name: "note.md", path: "note.md", type: "file", size: 4 }],
    });
    fixture.editorReadFile = async () => ({ ok: true, content: "note" });

    mounted = await mountDeck();
    await keyDown("e"); // files drawer
    const fileRow = [...mounted.container.querySelectorAll('[data-layer="files"] .deck-row')].find((r) =>
      r.textContent?.includes("note.md")
    );
    await act(async () => {
      fireEvent.click(fileRow!);
    });

    const editorOverlay = mounted.container.querySelector('[data-layer="editor"]');
    assert.ok(editorOverlay, "editor overlay should open from the files drawer");
    const textarea = mounted.container.querySelector(".deck-editor-text");
    assert.ok(textarea, "deep-linked file should load into the editor");
    assert.equal((textarea as HTMLTextAreaElement).value, "note");
  });
});
