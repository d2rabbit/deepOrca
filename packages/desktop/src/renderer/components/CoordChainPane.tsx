// Coord Chain pane — the decentralized workspace surface in the Hub.
//
// Reads state/members/blocks/genealogy from the main-process service through
// the typed window.deeporca.chain.* IPC surface and drives the three
// lifecycle actions (start / stop / rotate device key). Pure renderer code:
// no node/electron imports, so it unit-tests under jsdom with an api stub.

import { useCallback, useEffect, useState, type JSX } from "react";
import {
  type ChainBlockView,
  type ChainGenealogyView,
  type ChainMemberView,
  type ChainStatePayload,
  type ChainStartArgs,
} from "../../shared/ipc";
import { useI18n } from "../i18n";

const IDLE_STATE: ChainStatePayload = {
  running: false,
  chainId: "",
  theme: "",
  themeId: "",
  height: -1,
  memberCount: 0,
  peerCount: 0,
  pendingRecords: 0,
  port: 0,
  anchorId: "",
  deviceName: "",
  anchorBound: false,
  version: 0,
};

export function CoordChainPane(props: { startArgs?: Omit<ChainStartArgs, "mode"> }): JSX.Element {
  const { t } = useI18n();
  const api = window.deeporca;
  const [state, setState] = useState<ChainStatePayload>(IDLE_STATE);
  const [members, setMembers] = useState<ChainMemberView[]>([]);
  const [blocks, setBlocks] = useState<ChainBlockView[]>([]);
  const [genealogy, setGenealogy] = useState<ChainGenealogyView[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!api.chainGetState) {
      return;
    }
    try {
      const next = await api.chainGetState();
      setState(next);
      if (next.running) {
        setMembers(await api.chainMembers());
        setBlocks(await api.chainBlocks(10));
        setGenealogy(await api.chainGenealogy());
      } else {
        setMembers([]);
        setBlocks([]);
        setGenealogy([]);
      }
      setLastError(null);
    } catch (error) {
      setLastError((error as Error).message);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    return api.chainOnStateChanged?.(() => {
      void refresh();
    });
  }, [api, refresh]);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api.chainStart({
        mode: "create",
        theme: props.startArgs?.theme ?? localTheme(),
        ...props.startArgs,
      });
      if (!result.ok) {
        setLastError(result.error ?? t("chain.pane.error"));
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, props.startArgs, refresh, t]);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      await api.chainStop();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, refresh]);

  const rotate = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api.chainRotateKey();
      if (!result.ok) {
        setLastError(result.error ?? t("chain.pane.error"));
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [api, refresh, t]);

  const anchorLabel = state.anchorBound ? t("chain.pane.anchorBound") : t("chain.pane.anchorUnbound");
  return (
    <div className="ui-pane-stack" data-testid="coord-chain-pane">
      <h3 className="ui-pane-title">{t("chain.pane.title")}</h3>
      {!state.running ? (
        <p className="ui-pane-note">{t("chain.pane.notRunning")}</p>
      ) : (
        <dl className="ui-chain-facts">
          <div>
            <dt>{t("chain.pane.chainId")}</dt>
            <dd data-testid="chain-id">{state.chainId || t("chain.pane.noData")}</dd>
          </div>
          <div>
            <dt>{t("chain.pane.anchorId")}</dt>
            <dd>
              {state.anchorId || t("chain.pane.noData")} · {anchorLabel}
            </dd>
          </div>
          <div>
            <dt>{t("chain.pane.height")}</dt>
            <dd>{state.height}</dd>
          </div>
          <div>
            <dt>{t("chain.pane.device")}</dt>
            <dd>{state.deviceName || t("chain.pane.noData")}</dd>
          </div>
        </dl>
      )}
      <div className="ui-chain-actions">
        {!state.running ? (
          <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={() => void start()}>
            {t("chain.pane.start")}
          </button>
        ) : (
          <>
            <button type="button" className="ui-btn" disabled={busy} onClick={() => void stop()}>
              {t("chain.pane.stop")}
            </button>
            <button type="button" className="ui-btn" disabled={busy} onClick={() => void rotate()}>
              {t("chain.pane.rotateKey")}
            </button>
          </>
        )}
      </div>
      {lastError ? (
        <p className="ui-chain-error">
          {t("chain.pane.error")} {lastError}
        </p>
      ) : null}
      {state.running ? (
        <>
          <section className="ui-chain-section" data-testid="chain-members">
            <h4>{t("chain.pane.membersLabel")}</h4>
            {members.length === 0 ? (
              <p className="ui-pane-note">{t("chain.pane.noData")}</p>
            ) : (
              <ul>
                {members.map((member) => (
                  <li key={member.keyId}>
                    {member.deviceName} · {member.keyId.slice(0, 16)}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="ui-chain-section" data-testid="chain-blocks">
            <h4>{t("chain.pane.blocksLabel")}</h4>
            {blocks.length === 0 ? (
              <p className="ui-pane-note">{t("chain.pane.noData")}</p>
            ) : (
              <ul>
                {blocks.map((block) => (
                  <li key={`${block.height}-${block.hash}`}>
                    #{block.height} · {block.proposer.slice(0, 12)} · {block.recordCount} rec
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="ui-chain-section" data-testid="chain-genealogy">
            <h4>{t("chain.pane.genealogyLabel")}</h4>
            {genealogy.length === 0 ? (
              <p className="ui-pane-note">{t("chain.pane.noData")}</p>
            ) : (
              <ul>
                {genealogy.map((task) => (
                  <li key={task.recordId}>
                    {task.parentRecordId ? "⑂ " : ""}
                    {task.title} · {task.author.slice(0, 12)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

/** Theme for a workspace without an explicit chain config: the git remote string. */
function localTheme(): string {
  return document.body.dataset.chainTheme ?? "git:local";
}
