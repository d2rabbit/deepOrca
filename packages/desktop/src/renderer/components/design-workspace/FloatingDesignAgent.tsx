import { useEffect, useRef, useState, type JSX } from "react";
import { useI18n } from "../../i18n";
import { IconBot } from "../../ui/icons";

type AgentMessage = { role: "user" | "agent"; text: string };

type Props = {
  tabLabel: string;
  quickItems: readonly string[];
  disabled?: boolean;
  busy?: boolean;
  /** Resolves to true when the revision ran to completion (new version). */
  onSubmit: (instruction: string) => Promise<boolean>;
};

/**
 * Silent floating design agent (mockup proto-dialog): quick chips + a message
 * body with a typing indicator + free-form input. Every instruction runs as a
 * silent subagent — nothing lands in the main session (silent invariant).
 */
export function FloatingDesignAgent({ tabLabel, quickItems, disabled, busy, onSubmit }: Props): JSX.Element {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Welcome bubble on first expand (mockup pdlgBody first agent message).
  useEffect(() => {
    if (!collapsed && messages.length === 0) {
      setMessages([{ role: "agent", text: t("prototypeWorkspace.agentWelcome") }]);
    }
  }, [collapsed, messages.length, t]);

  // Keep the newest message visible (mockup scrolls the body); jsdom has no
  // Element.scrollTo, so guard on the capability.
  useEffect(() => {
    const body = bodyRef.current;
    if (body && typeof body.scrollTo === "function") body.scrollTo({ top: body.scrollHeight });
  }, [messages, typing]);

  const submit = async (value: string) => {
    const instruction = value.trim();
    if (!instruction || disabled || busy || typing) return;
    setDraft("");
    setMessages((prev) => [...prev, { role: "user", text: instruction }]);
    setTyping(true);
    let applied = false;
    try {
      applied = await onSubmit(instruction);
    } catch {
      applied = false;
    }
    setTyping(false);
    setMessages((prev) => [
      ...prev,
      { role: "agent", text: applied ? t("designWorkspace.toastRevised") : t("prototypeWorkspace.agentFailed") },
    ]);
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
              <button type="button" key={item} disabled={disabled || busy || typing} onClick={() => void submit(item)}>
                {item}
              </button>
            ))}
          </div>
          <div className="ui-floating-design-agent-body" ref={bodyRef}>
            {messages.map((message, index) => (
              <div className={`ui-floating-design-agent-msg ${message.role}`} key={`${message.role}-${index}`}>
                {message.text}
              </div>
            ))}
            {typing ? (
              <div className="ui-floating-design-agent-typing" role="status">
                <i />
                <i />
                <i />
                <span>{t("prototypeWorkspace.agentTyping")}</span>
              </div>
            ) : null}
          </div>
          <div className="ui-floating-design-agent-input">
            <input
              value={draft}
              disabled={disabled || busy || typing}
              placeholder={t("designWorkspace.agentPrompt")}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit(draft);
              }}
            />
            <button
              type="button"
              disabled={disabled || busy || typing || !draft.trim()}
              onClick={() => void submit(draft)}
            >
              {typing ? t("actions.running") : t("common.submit")}
            </button>
          </div>
        </>
      ) : null}
    </aside>
  );
}
