/**
 * user — 拆分自 Message.tsx（落地实施方案 §八）。
 */
import type { JSX } from "react";
import type { SessionMessage } from "../../../shared/ipc";
import type { SkillInfo } from "../../../shared/ipc";
import { extractStoreReferences } from "../../lib/store-refs";
import { useI18n } from "../../i18n";
import { IconCommand } from "../../ui/index";
import { IconSparkle } from "../../ui/index";
import { Avatar, truncate, formatTime } from "./shared";
import { ReferenceSegments } from "./ReferenceSegments";

export function parseSlashCommand(content: string): { name: string; args: string } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("/")) return null;
  const firstToken = trimmed.split(/\s+/, 1)[0] ?? "";
  if (!/^\/[a-zA-Z][\w-]*$/.test(firstToken)) return null;
  return { name: firstToken.slice(1), args: trimmed.slice(firstToken.length).trim() };
}

/** Source badge for a skill card: bundled skills ship with the product. */

export function SkillAttachmentCard({ skill }: { skill: SkillInfo }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ui-msg-skill-card" title={skill.description || skill.name}>
      <span className="ui-msg-skill-card-icon" aria-hidden="true">
        <IconSparkle />
      </span>
      <div className="ui-msg-skill-card-main">
        <div className="ui-msg-skill-card-head">
          <span className="ui-msg-skill-card-kind">{t("msg.skillBadge")}</span>
          <span className="ui-msg-skill-card-name">{skill.name}</span>
        </div>
        {skill.description ? <div className="ui-msg-skill-card-desc">{truncate(skill.description, 80)}</div> : null}
      </div>
    </div>
  );
}

/** Card rendering for a user-triggered slash command ("/init" …). */
export function CommandCard({ name, args, createTime }: { name: string; args: string; createTime?: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ui-cmd-card">
      <span className="ui-cmd-card-icon" aria-hidden="true">
        <IconCommand />
      </span>
      <div className="ui-cmd-card-main">
        <div className="ui-cmd-card-head">
          <span className="ui-cmd-card-kind">{t("msg.commandBadge")}</span>
          <span className="ui-cmd-card-name">{name}</span>
        </div>
        {args ? <div className="ui-cmd-card-args">{args}</div> : null}
      </div>
      {createTime ? <span className="ui-msg-time user">{formatTime(createTime)}</span> : null}
    </div>
  );
}

// ── User bubble (QQ-style: right-aligned) ─────────────────────────────────────
// ── Store references (@…/.deeporca/deepwiki|reviews/…) in user prompts ──────
// The wiki/report quote bridges insert absolute @-mention paths into the
// prompt. Rendering those raw paths as plain text is noisy — recognize the
// two canonical stores (shared parser: lib/store-refs.ts, also powering the
// composer's reference highlighting) and render branded chips instead.


export function UserBubble({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  const attachments = Array.isArray(message.contentParams) ? message.contentParams.length : 0;
  const skills = message.meta?.userPrompt?.skills ?? [];
  const command = parseSlashCommand(message.content || "");

  // Command invocations render as a dedicated card instead of a text bubble.
  const refs = message.content ? extractStoreReferences(message.content) : { hasRefs: false, refs: [] };
  const body = command ? (
    <CommandCard name={command.name} args={command.args} createTime={message.createTime} />
  ) : message.content || attachments > 0 || skills.length === 0 ? (
    <div className="ui-bubble user">
      {refs.hasRefs ? (
        <span style={{ whiteSpace: "pre-wrap" }}>
          <ReferenceSegments text={message.content ?? ""} refs={refs.refs} />
        </span>
      ) : (
        <span style={{ whiteSpace: "pre-wrap" }}>{message.content || t("msg.noContent")}</span>
      )}
      {attachments > 0 ? <span className="ui-bubble-attach">{t("msg.images", { n: attachments })}</span> : null}
      {message.createTime ? <span className="ui-msg-time user">{formatTime(message.createTime)}</span> : null}
    </div>
  ) : null;

  return (
    <div className="ui-bubble-row user">
      <div className="ui-user-stack">
        {skills.length > 0 ? (
          <div className="ui-msg-skills">
            {skills.map((skill) => (
              <SkillAttachmentCard key={skill.name} skill={skill} />
            ))}
          </div>
        ) : null}
        {body}
      </div>
      <Avatar role="user" />
    </div>
  );
}

// ── Thinking block (collapsible) ──────────────────────────────────────────────
