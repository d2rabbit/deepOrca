// chain:* IPC registration (OC3 task 12) — bridges the renderer's
// window.deeporca.chain.* surface onto the CoordChainService, and forwards
// lifecycle events to the renderer as IpcEvent.ChainStateChanged.

import type { BrowserWindow } from "electron";
import { ChainIpcRequest, IpcEvent, type ChainStartArgs } from "../shared/ipc.js";
import { CoordChainService } from "./coord-chain/service.js";

type IpcHelpersLike = {
  handle(channel: string, fn: (...args: never[]) => unknown): void;
};

export function registerCoordChainIpc(helpers: IpcHelpersLike, getWindow: () => BrowserWindow | null): void {
  const service = new CoordChainService();

  service.onEvent((event) => {
    if ((event.type === "started" || event.type === "stopped" || event.type === "rotated") && event.payload) {
      getWindow()?.webContents.send(IpcEvent.ChainStateChanged, event.payload);
    }
  });

  helpers.handle(ChainIpcRequest.Start, (args: ChainStartArgs) => service.start(args));
  helpers.handle(ChainIpcRequest.Stop, () => service.stop());
  helpers.handle(ChainIpcRequest.GetState, () => service.state());
  helpers.handle(ChainIpcRequest.RotateKey, () => service.rotateKey());
  helpers.handle(ChainIpcRequest.Members, () => service.members());
  helpers.handle(ChainIpcRequest.Blocks, (limit?: number) => service.blocks());
  helpers.handle(ChainIpcRequest.Genealogy, () => service.genealogy());
}
