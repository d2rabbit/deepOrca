/**
 * user — 拆分自 Message.tsx（落地实施方案 §八）；渲染对齐 demo-flow .user-card。
 */
import type { JSX } from "react";
import type { SessionMessage, SkillInfo } from "../../../shared/ipc";
import { extractStoreReferences } from "../../lib/store-refs";
import { useI18n } from "../../i18n";
import { IconSparkle } from "../../ui/index";
import { formatTime, truncate } from "./shared";
import { ReferenceSegments } from "./ReferenceSegments";

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

// ── 用户消息（demo .user-card：右对齐 accent 淡染卡，引用芯片行内） ──────────
// wiki/审查报告引用桥会往 prompt 里插入绝对 @ 路径——原文直出噪音很大，
// 识别两类规范存储（shared 解析器 lib/store-refs.ts，与输入框高亮同源）
// 渲染成品牌芯片；其余文本照常。

export function UserMessage({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  const attachments = Array.isArray(message.contentParams) ? message.contentParams.length : 0;
  const skills = message.meta?.userPrompt?.skills ?? [];
  const refs = message.content ? extractStoreReferences(message.content) : { hasRefs: false, refs: [] };

  return (
    <div className="ui-user-row">
      <div className="ui-user-stack">
        {skills.length > 0 ? (
          <div className="ui-msg-skills">
            {skills.map((skill) => (
              <SkillAttachmentCard key={skill.name} skill={skill} />
            ))}
          </div>
        ) : null}
        <div className="ui-user-card">
          <div className="txt">
            {refs.hasRefs ? (
              <span style={{ whiteSpace: "pre-wrap" }}>
                <ReferenceSegments text={message.content ?? ""} refs={refs.refs} />
              </span>
            ) : (
              <span style={{ whiteSpace: "pre-wrap" }}>{message.content || t("msg.noContent")}</span>
            )}
            {attachments > 0 ? <span className="ui-bubble-attach">{t("msg.images", { n: attachments })}</span> : null}
          </div>
          <div className="meta">{message.createTime ? formatTime(message.createTime) : null}</div>
        </div>
      </div>
    </div>
  );
}

// ── Thinking block (collapsible) ──────────────────────────────────────────────
