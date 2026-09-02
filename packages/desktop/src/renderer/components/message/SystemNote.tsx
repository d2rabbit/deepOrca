/**
 * system — 拆分自 Message.tsx（落地实施方案 §八）。
 */
import type { JSX } from "react";
import type { SkillInfo } from "../../../shared/ipc";
import { useI18n } from "../../i18n";
import { IconSparkle } from "../../ui/index";
import { truncate } from "./shared";

export function SkillSourceBadge({ skill }: { skill: SkillInfo }): JSX.Element {
  const { t } = useI18n();
  const bundled = skill.path.startsWith("bundled:");
  return (
    <span className={`ui-skill-card-badge${bundled ? " bundled" : ""}`} title={skill.path}>
      {bundled ? t("msg.skillSourceBuiltin") : t("msg.skillSourceLocal")}
    </span>
  );
}

/** Mini skill card attached to a user message (skills sent with the prompt). */

export function SystemNote({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="ui-bubble-row system">
      <div className="ui-system-note">{children}</div>
    </div>
  );
}

// ── Skill loaded card (system message with meta.skill) ───────────────────────
export function SkillLoadedCard({ skill }: { skill: SkillInfo }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ui-bubble-row system">
      <div className="ui-skill-card">
        <span className="ui-skill-card-icon" aria-hidden="true">
          <IconSparkle />
        </span>
        <div className="ui-skill-card-main">
          <div className="ui-skill-card-head">
            <span className="ui-skill-card-title">{t("msg.skillLoadedTitle")}</span>
            <span className="ui-skill-card-name">{skill.name}</span>
            <SkillSourceBadge skill={skill} />
          </div>
          {skill.description ? <div className="ui-skill-card-desc">{truncate(skill.description, 140)}</div> : null}
        </div>
        <span className="ui-skill-card-check" aria-hidden="true">
          ✓
        </span>
      </div>
    </div>
  );
}

// ── Main Message dispatcher ───────────────────────────────────────────────────
// Memoized: message objects are stable references, so unrelated app-level
