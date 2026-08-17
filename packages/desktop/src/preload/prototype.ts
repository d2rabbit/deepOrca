// Minimal preload for standalone prototype (popout) windows.
//
// Unlike the main preload (which exposes the full privileged bridge — file
// writes, settings, Git, MCP, prompt execution), this only exposes what a
// prototype presentation surface actually needs:
//   - receive the initial surface payload + live updates;
//   - forward button clicks to the agent;
//   - close the window.
//
// This limits the blast radius if a prototype surface ever loads untrusted
// content: it cannot touch the filesystem, settings, Git, or run prompts.

import { contextBridge, ipcRenderer } from "electron";
import { IpcEvent, IpcRequest } from "../shared/ipc";

function subscribe(channel: string, cb: (payload: never) => void): () => void {
  const listener = (_event: unknown, payload: unknown): void => cb(payload as never);
  ipcRenderer.on(channel, listener as never);
  return () => ipcRenderer.removeListener(channel, listener as never);
}

contextBridge.exposeInMainWorld("deeporca", {
  // Window controls (title-bar close button).
  closeWindow: () => ipcRenderer.invoke(IpcRequest.WindowClose),
  // Pull the initial surface payload by window token (race-free handshake).
  getPrototypePayload: (token: string) => ipcRenderer.invoke(IpcRequest.A2uiRequestPayload, token),
  // Initial surface payload (push — kept for back-compat; the pull above is preferred).
  onA2uiWindowPayload: (cb: (payload: never) => void) => subscribe(IpcEvent.A2uiWindowPayload, cb),
  // Live surface updates pushed after a2ui_action mutations.
  onA2uiSurfaceUpdate: (cb: (payload: never) => void) => subscribe(IpcEvent.A2uiSurfaceUpdate, cb),
  // Forward user interactions (button clicks) back to the agent.
  a2uiAction: (surfaceId: string, actionName: string, context: Record<string, unknown>) =>
    ipcRenderer.invoke(IpcRequest.A2uiAction, surfaceId, actionName, context),
});
