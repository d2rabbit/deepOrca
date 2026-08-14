/**
 * DesignPanel — the Designer module's left-sidebar workspace.
 *
 * Lists all design artifacts from `.deeporca/designs/` (persisted by
 * design-store), grouped by pipeline:
 *   - PM-Design prototypes (pipeline="openui")
 *   - UI-Design documents (pipeline="design", .dd format)
 *
 * Clicking an artifact opens it in the right-side preview panel.
 * Mirrors the IndexLibraryPanel pattern (workspace panel + artifact list).
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { IconButton } from "../ui/index";
import type { DesignArtifactMeta } from "../../shared/ipc";

type Props = {
  /** Open an artifact in the preview panel (mode: "openui" | "design"). */
  onOpenArtifact: (artifact: DesignArtifactMeta) => void;
};

type FilterTab = "all" | "openui" | "design";

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function DesignPanel({ onOpenArtifact }: Props): JSX.Element {
  const { t } = useI18n();
  const [artifacts, setArtifacts] = useState<DesignArtifactMeta[]>([]);
  const [filter, setFilter] = useState<FilterTab>("all");

  const reload = useCallback(async () => {
    try {
      const list = await api.designList();
      setArtifacts(list);
    } catch {
      setArtifacts([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm(t("design.deleteConfirm"))) return;
      await api.designDelete(id);
      void reload();
    },
    [reload, t]
  );

  const filtered = filter === "all" ? artifacts : artifacts.filter((a) => a.pipeline === filter);
  const prototypes = artifacts.filter((a) => a.pipeline === "openui");
  const documents = artifacts.filter((a) => a.pipeline === "design");

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("design.title")}</span>
        <IconButton onClick={() => void reload()} title={t("scm.refresh")} aria-label={t("scm.refresh")}>
          ⟳
        </IconButton>
      </div>
      <div className="ui-side-panel-body">
        {artifacts.length === 0 ? (
          <div className="ui-side-panel-empty">{t("design.empty")}</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, padding: "8px 12px", fontSize: 12 }}>
              <button
                type="button"
                onClick={() => setFilter("all")}
                style={{
                  padding: "3px 10px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  background: filter === "all" ? "var(--ui-accent, #3b82f6)" : "var(--ui-surface-hover, transparent)",
                  color: filter === "all" ? "#fff" : "var(--ui-text, inherit)",
                }}
              >
                {t("design.filter.all")} ({artifacts.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("openui")}
                style={{
                  padding: "3px 10px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  background:
                    filter === "openui" ? "var(--ui-accent, #3b82f6)" : "var(--ui-surface-hover, transparent)",
                  color: filter === "openui" ? "#fff" : "var(--ui-text, inherit)",
                }}
              >
                {t("design.filter.prototypes")} ({prototypes.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("design")}
                style={{
                  padding: "3px 10px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  background:
                    filter === "design" ? "var(--ui-accent, #3b82f6)" : "var(--ui-surface-hover, transparent)",
                  color: filter === "design" ? "#fff" : "var(--ui-text, inherit)",
                }}
              >
                {t("design.filter.documents")} ({documents.length})
              </button>
            </div>
            <div style={{ padding: "4px 8px" }}>
              {filtered.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    marginBottom: 4,
                    borderRadius: 8,
                    border: "1px solid var(--ui-border-soft, #333)",
                    cursor: "pointer",
                  }}
                  onClick={() => onOpenArtifact(a)}
                >
                  <span style={{ fontSize: 16 }}>{a.pipeline === "openui" ? "🎯" : "📐"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--ui-text, inherit)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.title}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ui-text-dim, #888)" }}>
                      {a.pipeline === "openui" ? "PM-Design" : "UI-Design"} · {timeAgo(a.updatedAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(a.id);
                    }}
                    style={{
                      padding: "2px 6px",
                      fontSize: 11,
                      background: "transparent",
                      border: "none",
                      color: "var(--ui-text-dim, #888)",
                      cursor: "pointer",
                    }}
                    title={t("design.delete")}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
