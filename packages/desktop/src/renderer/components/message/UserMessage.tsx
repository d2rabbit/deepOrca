/**
 * user — 人类指令条（user ask 2026-09-03 七轮：弱化聊天感）。
 * 不再是右侧聊天气泡，而是整幅左起的指令条：accent 竖条 + 指令名
 * （mono，不带 "/" 前缀——识别是解析层的事）或正文（引用芯片行内），
 * 右端时间。TaskTurn 的回合指令与 leading 消息共用 UserDirective。
 */
import type { JSX } from "react";
import type { SessionMessage, SkillInfo } from "../../../shared/ipc";
import { extractStoreReferences } from "../../lib/store-refs";
import { useI18n } from "../../i18n";
import { IconSparkle } from "../../ui/index";
import { formatTime, truncate } from "./shared";
import { ReferenceSegments } from "./ReferenceSegments";

/** 技能附件胶囊 — 随提示词发送的技能（描述进 tooltip，胶囊保持一行）。 */
export function SkillAttachmentChip({ skill }: { skill: SkillInfo }): JSX.Element {
  const { t } = useI18n();
  return (
    <span className="ui-ref-chip skill" title={skill.description || skill.name}>
      <span className="ui-ref-chip-icon" aria-hidden="true">
        <IconSparkle />
      </span>
      <span className="ui-ref-chip-body">
        <span className="ui-ref-chip-kind">{t("msg.skillBadge")}</span>
        <span className="ui-ref-chip-label">{skill.name}</span>
      </span>
    </span>
  );
}

/**
 * 首个空白分词必须恰好是 "/<word>" —— 前导绝对路径（如 /Volumes/data）含
 * 第二个斜杠，因此不会被误判为指令。
 */
export function parseSlashCommand(content: string): { name: string; args: string } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("/")) return null;
  const firstToken = trimmed.split(/\s+/, 1)[0] ?? "";
  if (!/^\/[a-zA-Z][\w-]*$/.test(firstToken)) return null;
  return { name: firstToken.slice(1), args: trimmed.slice(firstToken.length).trim() };
}

/** 人类指令条：整幅指令头，开启一个回合；正文含五类引用芯片。 */
export function UserDirective({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  const attachments = Array.isArray(message.contentParams) ? message.contentParams.length : 0;
  const skills = message.meta?.userPrompt?.skills ?? [];
  const slash = parseSlashCommand(message.content ?? "");
  const refs = message.content ? extractStoreReferences(message.content) : { hasRefs: false, refs: [] };
  const clock = message.createTime ? formatTime(message.createTime) : "";

  return (
    <div className="ui-directive">
      {skills.length > 0 ? (
        <div className="ui-msg-skills">
          {skills.map((skill) => (
            <SkillAttachmentChip key={skill.name} skill={skill} />
          ))}
        </div>
      ) : null}
      <div className="ui-directive-main">
        {slash ? (
          <>
            <span className="ui-directive-cmd">{slash.name}</span>
            {slash.args ? <span className="ui-directive-args">{truncate(slash.args, 160)}</span> : null}
          </>
        ) : (
          <span className="ui-directive-text">
            {refs.hasRefs ? (
              <ReferenceSegments text={message.content ?? ""} refs={refs.refs} />
            ) : (
              message.content || t("msg.noContent")
            )}
            {attachments > 0 ? <span className="ui-bubble-attach">{t("msg.images", { n: attachments })}</span> : null}
          </span>
        )}
        {clock ? <span className="ui-directive-time">{clock}</span> : null}
      </div>
    </div>
  );
}

export function UserMessage({ message }: { message: SessionMessage }): JSX.Element {
  return <UserDirective message={message} />;
}
