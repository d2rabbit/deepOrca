/**
 * ref — 拆分自 Message.tsx（落地实施方案 §八）。
 * 八类引用芯片的正文侧渲染：kind 决定图标与颜色（与输入框镜像层同一映射）。
 */
import type { CSSProperties, JSX, ReactNode } from "react";
import type { StoreRefKind, StoreRefToken } from "../../lib/store-refs";
import { splitStoreRefSegments } from "../../lib/store-refs";
import { useI18n, type MessageKey } from "../../i18n";
import {
  IconBook,
  IconDesign,
  IconFile,
  IconFolderOutline,
  IconPrototype,
  IconShield,
  IconSlashCommand,
  IconSparkle,
} from "../../ui/index";

/** kind → 图标/种类名 i18n 键/着色。八类：wiki 蓝 · 审查 绿 · 文件/目录 石墨 ·
 *  命令 橙 · 技能 紫 · UI 设计 青 · 原型 玫红。每类一个专属轮廓 icon（user ask
 *  2026-09-03：文件/命令不再借用工具/铅笔 glyph）。种类名走 i18n
 *  （msg.refKind.*，AGENTS.md i18n 规则）。 */
const KIND_META: Record<StoreRefKind, { icon: ReactNode; kindKey: MessageKey; color: string }> = {
  wiki: { icon: <IconBook />, kindKey: "msg.refKind.wiki", color: "var(--ui-accent, #3b82f6)" },
  review: { icon: <IconShield />, kindKey: "msg.refKind.review", color: "var(--dot-review, #2f9e44)" },
  file: { icon: <IconFile />, kindKey: "msg.refKind.file", color: "#5f6b7a" },
  dir: { icon: <IconFolderOutline />, kindKey: "msg.refKind.dir", color: "#5f6b7a" },
  cmd: { icon: <IconSlashCommand />, kindKey: "msg.refKind.cmd", color: "#e8590c" },
  skill: { icon: <IconSparkle />, kindKey: "msg.refKind.skill", color: "#9a36b8" },
  design: { icon: <IconDesign />, kindKey: "msg.refKind.design", color: "#0c8599" },
  prototype: { icon: <IconPrototype />, kindKey: "msg.refKind.prototype", color: "#c2255c" },
};

export function refChipMeta(kind: StoreRefKind): { icon: ReactNode; kindKey: MessageKey; color: string } {
  return KIND_META[kind] ?? KIND_META.file;
}

export function ReferenceSegments({ text, refs }: { text: string; refs: StoreRefToken[] }): JSX.Element {
  const { t } = useI18n();
  const byRaw = new Map(refs.map((r) => [r.raw, r]));
  const parts: JSX.Element[] = [];
  splitStoreRefSegments(text).forEach((seg, i) => {
    if (seg.kind === "text") {
      parts.push(<span key={`t${i}`}>{seg.text}</span>);
      return;
    }
    const ref = byRaw.get(seg.ref.raw) ?? seg.ref;
    const meta = refChipMeta(ref.kind);
    parts.push(
      <span
        key={`r${i}`}
        className={`ui-ref-chip ${ref.kind}`}
        title={ref.raw.slice(1)}
        style={{ "--rc": meta.color } as CSSProperties}
      >
        <span className="ui-ref-chip-icon">{meta.icon}</span>
        <span className="ui-ref-chip-body">
          <span className="ui-ref-chip-kind">{t(meta.kindKey)}</span>
          <span className="ui-ref-chip-label">{ref.label}</span>
        </span>
      </span>
    );
  });
  return <>{parts}</>;
}
