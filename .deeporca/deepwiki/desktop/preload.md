---
type: desktop
title: Preload Bridge
description: The preload implementation that exposes the typed window.deeporca under contextIsolation, plus the restricted preload for A2UI prototype windows (prototype.cjs).
tags: [preload, context-isolation, bridge]
---

# Preload Bridge

The preload is the only bridge between the renderer and main (`contextIsolation: true`, `nodeIntegration: false`). The renderer never touches Node/Electron directly.

## Main bridge (`preload/index.ts`)

- `contextBridge.exposeInMainWorld("deeporca", api)`: implements `DesktopApi` (defined in [ipc-contract](ipc-contract.md)).
- One `ipcRenderer.invoke(IpcRequest.X, ...)` per method; event subscriptions are wrapped via `subscribe(channel, cb)` (`ipcRenderer.on` → returns an unsubscribe function).
- Covers: window, session, prompts, permissions, settings/models, skills/plugins, MCP, undo, file scanning, workspace, Git, CodeGraph, OCR review, CRG, Wiki, GitMCP, editor, memory, knowledge, design, task tree, A2UI, Actions.

## Restricted bridge for prototype windows (`preload/prototype.ts`)

- Standalone build output `dist/prototype.cjs` (see [build-and-vendoring](build-and-vendoring.md)).
- Only exposes the A2UI surface plus a minimal window-close surface—**no** file/settings/Git/MCP capabilities. Even if a prototype loads untrusted content, it cannot reach the privileged bridge.
- Companion: `registerA2uiPrototypeWindowIpc` (main) provides the `A2uiRequestPayload` handshake (avoids the did-finish-load race: fetches the initial payload by token when the window mounts).

## Related pages

- [ipc-contract](ipc-contract.md), [main-process](main-process.md)
- [design-system](design-system.md) (A2UI usage for prototype windows)