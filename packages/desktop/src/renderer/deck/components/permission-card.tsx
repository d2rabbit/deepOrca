// Pending-approval card (待决卡): renders the engine's askPermission requests
// inline in the stage with per-request allow/deny and scope-level
// always-allow. Approve resumes the loop via /continue; any deny rejects the
// whole batch — same semantics as the classic PermissionCard.
import { useMemo, useState, type JSX } from "react";
import type { AskPermissionRequest, PermissionScope } from "../../../shared/ipc";
import { buildResult, describeScope, isAlwaysAllowedScope, type PermissionResult } from "../../lib/permissions";
import { useI18n } from "../../i18n";
import { GiIcon } from "../icons";

/** Scopes that mark the whole batch as high-risk (destructive / git-mutating). */
const HIGH_RISK_SCOPES: ReadonlySet<string> = new Set(["delete-in-cwd", "delete-out-cwd", "mutate-git-log"]);

export function PermissionCard(props: {
  requests: AskPermissionRequest[];
  onApprove: (result: PermissionResult) => void;
  onDeny: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [decisions, setDecisions] = useState<Record<string, "allow" | "deny">>({});
  const [always, setAlways] = useState<PermissionScope[]>([]);

  const scopes = useMemo(() => {
    const all = new Set<string>();
    for (const req of props.requests) {
      for (const scope of req.scopes) all.add(scope);
    }
    return [...all].filter(isAlwaysAllowedScope);
  }, [props.requests]);

  // Decision-point visual anchor (E4): the pending card is the one surface
  // demanding a choice — high-risk batches breathe red, others get a static
  // accent ring, so they never read as passive information.
  const highRisk = useMemo(
    () => props.requests.some((req) => req.scopes.some((scope) => HIGH_RISK_SCOPES.has(scope))),
    [props.requests]
  );

  const decide = (toolCallId: string, decision: "allow" | "deny") =>
    setDecisions((prev) => ({ ...prev, [toolCallId]: decision }));

  const toggleAlways = (scope: PermissionScope) =>
    setAlways((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));

  const submit = () => {
    const result = buildResult(props.requests, decisions, always);
    if (result.hasDeny) {
      props.onDeny();
    } else {
      props.onApprove(result);
    }
  };

  const allDecided = props.requests.every((req) => decisions[req.toolCallId] !== undefined);

  return (
    <section
      className={`deck-pending deck-gc anchor${highRisk ? " anchor-high" : ""}`}
      aria-label={t("deck.pending.title")}
    >
      <div className="deck-pending-title">
        <GiIcon id="alert" lg /> {t("deck.pending.title")}
      </div>
      <ul className="deck-pending-list">
        {props.requests.map((req) => (
          <li key={req.toolCallId}>
            <div className="deck-pending-req">
              <span className="deck-pending-tool">{req.name}</span>
              <span className="deck-pending-desc">{req.description ?? req.command}</span>
            </div>
            <div className="deck-pending-scopes">
              {req.scopes.map((scope) => (
                <span key={scope} className="deck-pending-scope">
                  {describeScope(scope)}
                </span>
              ))}
            </div>
            <div className="deck-pending-ops">
              <button
                type="button"
                className={`deck-op allow${decisions[req.toolCallId] === "allow" ? " active" : ""}`}
                onClick={() => decide(req.toolCallId, "allow")}
              >
                {t("deck.pending.allow")}
              </button>
              <button
                type="button"
                className={`deck-op deny${decisions[req.toolCallId] === "deny" ? " active" : ""}`}
                onClick={() => decide(req.toolCallId, "deny")}
              >
                {t("deck.pending.deny")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {scopes.length > 0 ? (
        <div className="deck-pending-always">
          {scopes.map((scope) => (
            <label key={scope}>
              <input type="checkbox" checked={always.includes(scope)} onChange={() => toggleAlways(scope)} />
              {t("deck.pending.always")} · {describeScope(scope)}
            </label>
          ))}
        </div>
      ) : null}
      <div className="deck-pending-submit">
        <button type="button" className="deck-op primary" disabled={!allDecided} onClick={submit}>
          {t("deck.pending.submit")}
        </button>
      </div>
    </section>
  );
}
