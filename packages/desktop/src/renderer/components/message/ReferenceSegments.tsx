/**
 * ref — 拆分自 Message.tsx（落地实施方案 §八）。
 * 五类引用芯片的正文侧渲染：kind 决定图标与颜色（与输入框镜像层同一映射）。
 */
import type { CSSProperties, JSX, ReactNode } from "react";
import type { StoreRefKind, StoreRefToken } from "../../lib/store-refs";
import { splitStoreRefSegments } from "../../lib/store-refs";
import { IconBook, IconPencil, IconShield, IconSparkle, IconToolGeneric } from "../../ui/index";

/** kind → 图标/种类名/着色。五类：wiki 蓝 · 审查 绿 · 文件 石墨 · 命令 橙 · 技能 紫。 */
const KIND_META: Record<StoreRefKind, { icon: ReactNode; kindText: string; color: string }> = {
  wiki: { icon: <IconBook />, kindText: "Wiki", color: "var(--ui-accent, #3b82f6)" },
  review: { icon: <IconShield />, kindText: "审查报告", color: "var(--dot-review, #2f9e44)" },
  file: { icon: <IconToolGeneric />, kindText: "文件", color: "#5f6b7a" },
  cmd: { icon: <IconPencil />, kindText: "命令", color: "#e8590c" },
  skill: { icon: <IconSparkle />, kindText: "技能", color: "#9a36b8" },
};

export function refChipMeta(kind: StoreRefKind): { icon: ReactNode; kindText: string; color: string } {
  return KIND_META[kind] ?? KIND_META.file;
}

export function ReferenceSegments({ text, refs }: { text: string; refs: StoreRefToken[] }): JSX.Element {
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
          <span className="ui-ref-chip-kind">{meta.kindText}</span>
          <span className="ui-ref-chip-label">{ref.label}</span>
        </span>
      </span>
    );
  });
  return <>{parts}</>;
}
