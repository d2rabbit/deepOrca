import type { JSX } from "react";
import { useI18n } from "../../i18n";
import type { DesignSuite, DesignTheme } from "./types";

type Props = {
  /** 当前套件（主题/阶段/关系的元数据来源）。 */
  suite: DesignSuite | null;
  /** 主题列表（解析 themeId → 标题；缺失主题降级显示"主题已删除"）。 */
  themes: DesignTheme[];
  /** 关系目标套件的标题映射（缺失降级显示 suiteId）。 */
  suiteTitles: Record<string, string>;
};

/**
 * 轻量需求主题条（specs/prd-theme-layer WP4）：渲染在版本历史上方，只读展示
 * 当前套件的主题归属/阶段/继承/交叉参考。套件不带任何主题字段时整条隐藏
 * （EARS 14：旧工作区无主题数据零回归）。编辑入口在目录与编辑器生成器，
 * 这里刻意只读。
 */
export function ThemeStrip({ suite, themes, suiteTitles }: Props): JSX.Element | null {
  const { t } = useI18n();
  if (!suite) return null;
  const references = suite.references ?? [];
  const hasAnything = Boolean(suite.themeId || suite.stage || suite.inherits || references.length > 0);
  if (!hasAnything) return null;
  const themeTitle = suite.themeId ? (themes.find((theme) => theme.id === suite.themeId)?.title ?? null) : null;
  const refTitle = (ref: { suiteId: string }): string => suiteTitles[ref.suiteId] ?? ref.suiteId;
  return (
    <div className="ui-design-theme-strip" data-testid="design-theme-strip">
      {suite.themeId ? (
        <span className="ui-design-theme-chip" title={t("designTheme.themeLabel")}>
          {themeTitle ?? t("designTheme.missingTheme")}
        </span>
      ) : null}
      {suite.stage ? <span className="ui-design-theme-stage">{suite.stage}</span> : null}
      {suite.inherits ? (
        <span className="ui-design-theme-relation inherits">
          {t("designTheme.inheritsFrom")} {refTitle(suite.inherits)}
        </span>
      ) : null}
      {references.map((ref) => (
        <span className="ui-design-theme-relation cross" key={`${ref.suiteId}@${ref.versionId ?? "head"}`}>
          {t("designTheme.references")} {refTitle(ref)}
        </span>
      ))}
    </div>
  );
}
