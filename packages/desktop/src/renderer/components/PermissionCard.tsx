import { useEffect, useMemo, useState, type JSX } from "react";
import type { AskPermissionRequest, PermissionScope } from "../../shared/ipc";
import {
  buildResult,
  buildScopePrompts,
  isAlwaysAllowedScope,
  scopeRiskColor,
  type PermissionResult,
} from "../lib/permissions";
import { useI18n, type MessageKey } from "../i18n";
import { Button, Card, CardHeader, Row } from "../ui/index";

type Props = {
  requests: AskPermissionRequest[];
  onSubmit: (result: PermissionResult) => void;
  onCancel: () => void;
};

/**
 * Walks through each requested scope, letting the user allow / always-allow / deny.
 * Emits the aggregated PermissionResult once every prompt has been answered.
 */
export function PermissionCard({ requests, onSubmit, onCancel }: Props): JSX.Element | null {
  const { t } = useI18n();
  const prompts = useMemo(() => buildScopePrompts(requests), [requests]);
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, "allow" | "deny">>({});
  const [alwaysAllows, setAlwaysAllows] = useState<PermissionScope[]>([]);

  // Skip scopes already granted "always" during this run.
  let effectiveIndex = index;
  while (effectiveIndex < prompts.length) {
    const scope = prompts[effectiveIndex]!.scope;
    if (isAlwaysAllowedScope(scope) && alwaysAllows.includes(scope)) {
      effectiveIndex += 1;
      continue;
    }
    break;
  }

  const prompt = prompts[effectiveIndex] ?? null;

  const allowAlways = prompt ? isAlwaysAllowedScope(prompt.scope) : false;

  // Keyboard shortcuts: 1=allow, 2=always (if available), 3=deny
  useEffect(() => {
    if (!prompt) return;
    function onKey(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "1") commit("allow");
      else if (e.key === "2" && allowAlways) commit("always");
      else if (e.key === "3" || (e.key === "2" && !allowAlways)) commit("deny");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!prompt) {
    return null;
  }

  function commit(kind: "allow" | "always" | "deny"): void {
    const current = prompt!;
    const nextDecisions = { ...decisions };
    const prev = nextDecisions[current.request.toolCallId];
    nextDecisions[current.request.toolCallId] = kind === "deny" ? "deny" : prev === "deny" ? "deny" : "allow";

    let nextAlways = alwaysAllows;
    if (kind === "always" && isAlwaysAllowedScope(current.scope)) {
      nextAlways = alwaysAllows.includes(current.scope) ? alwaysAllows : [...alwaysAllows, current.scope];
    }

    const nextIndex = effectiveIndex + 1;
    setDecisions(nextDecisions);
    setAlwaysAllows(nextAlways);
    setIndex(nextIndex);

    // Determine if any prompts remain after this decision.
    let remaining = nextIndex;
    while (remaining < prompts.length) {
      const scope = prompts[remaining]!.scope;
      if (isAlwaysAllowedScope(scope) && nextAlways.includes(scope)) {
        remaining += 1;
        continue;
      }
      break;
    }
    if (remaining >= prompts.length) {
      onSubmit(buildResult(requests, nextDecisions, nextAlways));
    }
  }

  return (
    <Card warn className="ui-card-enter ui-perm-card">
      <CardHeader>
        <span className="ui-perm-warn-icon" aria-hidden="true">
          ⚠
        </span>{" "}
        {t("perm.required")}{" "}
        <span style={{ color: "var(--ui-text-faint)", fontWeight: 400 }}>
          {Math.min(effectiveIndex + 1, prompts.length)}/{prompts.length}
        </span>
      </CardHeader>
      {/* Progress bar showing which permission step we're on */}
      {prompts.length > 1 ? (
        <div className="ui-perm-progress">
          {prompts.map((_, i) => (
            <div
              key={i}
              className={`ui-perm-progress-dot${i < effectiveIndex ? " done" : i === effectiveIndex ? " current" : ""}`}
            />
          ))}
        </div>
      ) : null}
      <div style={{ fontWeight: 600 }}>{prompt.request.name}</div>
      <div className="ui-mono ui-perm-cmd">{prompt.request.command}</div>
      {prompt.request.description ? (
        <div style={{ color: "var(--ui-text-dim)", fontSize: 12.5 }}>{prompt.request.description}</div>
      ) : null}
      <div style={{ marginTop: 8 }}>{t("perm.proceed")}</div>
      <div className="ui-opt-row">
        <button className="ui-opt ui-opt--allow" onClick={() => commit("allow")}>
          {t("perm.yes")}
        </button>
        {allowAlways ? (
          <button className="ui-opt" onClick={() => commit("always")}>
            {t("perm.always")}
            <span className="ui-scope-tag" style={{ color: scopeRiskColor(prompt.scope) }}>
              {t(`scope.${prompt.scope}` as MessageKey)}
            </span>
          </button>
        ) : null}
        <button className="ui-opt ui-opt--deny" onClick={() => commit("deny")}>
          {t("perm.no")}
        </button>
      </div>
      <div className="ui-perm-kbd-hint">
        <span>
          <kbd>1</kbd>
          {t("perm.yes")}
        </span>
        {allowAlways ? (
          <span>
            <kbd>2</kbd>
            {t("perm.always")}
          </span>
        ) : null}
        <span>
          <kbd>{allowAlways ? "3" : "2"}</kbd>
          {t("perm.no")}
        </span>
      </div>
      <Row justify="flex-end">
        <Button size="sm" onClick={onCancel}>
          {t("common.interrupt")}
        </Button>
      </Row>
    </Card>
  );
}
