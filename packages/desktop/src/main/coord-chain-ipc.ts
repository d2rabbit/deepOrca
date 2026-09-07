// chain:* IPC registration (OC3 task 12) — bridges the renderer's
// window.deeporca.chain.* surface onto the CoordChainService, and forwards
// lifecycle events to the renderer as IpcEvent.ChainStateChanged.

import type { BrowserWindow } from "electron";
import { ChainIpcRequest, IpcEvent, type ChainStartArgs } from "../shared/ipc.js";
import { CoordChainService } from "./coord-chain/service.js";
type IpcHelpersLike = {
  handle(channel: string, fn: (...args: never[]) => unknown): void;
};

type TaskTreeSourceLike = {
  getTree(
    treeId: string
  ): {
    index: {
      id: string;
      title: string;
      branches: Record<
        string,
        { name: string; headId: string; createdAt: string; abandoned?: boolean; mergedInto?: string }
      >;
      activeBranch: string;
    };
    nodes: unknown[];
  } | null;
  readReflog(
    treeId: string,
    limit?: number
  ): Array<{ at: string; op: string; branch: string; nodeId?: string; detail?: string }>;
};

export function registerCoordChainIpc(
  helpers: IpcHelpersLike,
  getWindow: () => BrowserWindow | null,
  taskTreeSourceFor: (workspaceRoot?: string) => TaskTreeSourceLike | null
): void {
  const service = new CoordChainService({
    taskTrees: () => taskTreeSourceFor(undefined) as never,
  });

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
  helpers.handle(ChainIpcRequest.Blocks, (limit?: number) => service.blocks(limit));
  helpers.handle(ChainIpcRequest.Genealogy, () => service.genealogy());
  helpers.handle(ChainIpcRequest.TaskTrees, (workspaceRoot?: string) => {
    const source = taskTreeSourceFor(workspaceRoot);
    if (!source) return [];
    return (
      source as unknown as {
        listTrees(): Array<{ id: string; title: string; activeBranch: string; branchCount: number }>;
      }
    )
      .listTrees()
      .map((summary) => {
        const tree = source.getTree(summary.id);
        if (!tree)
          return { treeId: summary.id, title: summary.title, branches: [], activeBranch: summary.activeBranch };
        return {
          treeId: tree.index.id,
          title: tree.index.title,
          branches: Object.values(tree.index.branches).map((b) => ({
            name: b.name,
            headId: b.headId,
            ...(b.abandoned !== undefined ? { abandoned: b.abandoned } : {}),
            ...(b.mergedInto !== undefined ? { mergedInto: b.mergedInto } : {}),
          })),
          activeBranch: tree.index.activeBranch,
        };
      });
  });
  helpers.handle(ChainIpcRequest.ShareTaskBranch, (args: { treeId: string; branch: string; workspaceRoot?: string }) =>
    service.shareTaskBranch(args)
  );
}
