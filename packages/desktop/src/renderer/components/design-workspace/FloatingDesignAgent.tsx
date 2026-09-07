import { useState, type JSX } from "react";
import { useI18n } from "../../i18n";
import { IconBot } from "../../ui/icons";

type Props = {
  tabLabel: string;
  quickItems: readonly string[];
  disabled?: boolean;
  busy?: boolean;
  onSubmit: (instruction: string) => void;
};

export function FloatingDesignAgent({ tabLabel, quickItems, disabled, busy, onSubmit }: Props): JSX.Element {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const submit = (value: string) => {
    const instruction = value.trim();
    if (!instruction || disabled || busy) return;
    onSubmit(instruction);
    setDraft("");
  };

  return (
    <aside className={`ui-floating-design-agent${collapsed ? " collapsed" : ""}`}>
      <header>
        <IconBot />
        <strong>{t("designWorkspace.agent")}</strong>
        <span>{t("designWorkspace.agentSilent")}</span>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={t("designWorkspace.agentToggle")}
        >
          {collapsed ? "+" : "−"}
        </button>
      </header>
      {!collapsed ? (
        <>
          <div className="ui-floating-design-agent-quick">
            <small>{t("designWorkspace.quickFor", { tab: tabLabel })}</small>
            {quickItems.map((item) => (
              <button type="button" key={item} disabled={disabled || busy} onClick={() => submit(item)}>
                {item}
              </button>
            ))}
          </div>
          <div className="ui-floating-design-agent-input">
            <input
              value={draft}
              disabled={disabled || busy}
              placeholder={t("designWorkspace.agentPrompt")}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit(draft);
              }}
            />
            <button type="button" disabled={disabled || busy || !draft.trim()} onClick={() => submit(draft)}>
              {busy ? t("actions.running") : t("common.submit")}
            </button>
          </div>
        </>
      ) : null}
    </aside>
  );
}
