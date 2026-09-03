import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import type { EditorFileEntry } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { DirIcon, FileIcon, IconFile, IconFolder, IconButton } from "../ui/index";

type Props = {
  /** Called when the user picks a file to open in the editor. */
  onOpenFile: (filePath: string) => void;
  /** Workspace root — the tree header shows its name (user ask 2026-09-03
   *  十二轮 B3b：标题不再是「文件」而是工作区名)。 */
  root?: string;
};

/** One node of the lazily-loaded tree (VSCode/IDEA 展开逻辑, user ask
 *  2026-09-03 十二轮 B3a): directories expand IN PLACE with indentation —
 *  旧的平铺单目录浏览（进目录=整列替换 + ".." 返回）作废。Children are
 *  fetched per-directory on first expand and cached; collapsed dirs keep
 *  their cache so re-expanding is instant. */
type TreeNode = {
  entry: EditorFileEntry;
  depth: number;
  expanded?: boolean;
  loaded?: boolean;
  loading?: boolean;
  children?: TreeNode[];
};

/** Build a display tree (depth-first) from the node store. */
function flatten(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: TreeNode[]): void => {
    for (const n of list) {
      out.push(n);
      if (n.entry.type === "directory" && n.expanded && n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Sort dirs-first, then name — the VSCode/IDEA convention. */
function sortEntries(entries: EditorFileEntry[]): EditorFileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function EditorPanel({ onOpenFile, root }: Props): JSX.Element {
  const { t } = useI18n();
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const loadChildren = useCallback(
    async (dir: string): Promise<EditorFileEntry[]> => {
      const result = await api.editorListFiles(dir);
      if (!result.ok) throw new Error(result.error ?? t("editor.readError"));
      return sortEntries(result.entries ?? []);
    },
    [t]
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const entries = await loadChildren("");
        if (alive) setRoots(entries.map((entry) => ({ entry, depth: 0 })));
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadChildren]);

  /** Expand/collapse a directory in place — children load lazily on first
   *  expand, cached afterwards (collapsed state never drops the cache). */
  const toggleDir = useCallback(
    (path: string) => {
      setRoots((prev) => {
        const mutate = (nodes: TreeNode[]): TreeNode[] =>
          nodes.map((n) => {
            if (n.entry.path !== path) {
              return n.children ? { ...n, children: mutate(n.children) } : n;
            }
            if (n.entry.type !== "directory") return n;
            if (n.expanded) return { ...n, expanded: false };
            if (n.loaded) return { ...n, expanded: true };
            // first expand — fetch children (loading state painted immediately)
            void (async () => {
              try {
                const entries = await loadChildren(path);
                setRoots((cur) => {
                  const patch = (nodes2: TreeNode[]): TreeNode[] =>
                    nodes2.map((m) => {
                      if (m.entry.path === path) {
                        return {
                          ...m,
                          expanded: true,
                          loaded: true,
                          loading: false,
                          children: entries.map((entry) => ({ entry, depth: m.depth + 1 })),
                        };
                      }
                      return m.children ? { ...m, children: patch(m.children) } : m;
                    });
                  return patch(cur);
                });
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                setRoots((cur) => {
                  const patch = (nodes2: TreeNode[]): TreeNode[] =>
                    nodes2.map((m) =>
                      m.entry.path === path
                        ? { ...m, loading: false }
                        : m.children
                          ? { ...m, children: patch(m.children) }
                          : m
                    );
                  return patch(cur);
                });
              }
            })();
            return { ...n, expanded: true, loading: true };
          });
        return mutate(prev);
      });
    },
    [loadChildren]
  );

  const rows = useMemo(() => flatten(roots), [roots]);
  const workspaceName = (root ?? "").split(/[\\/]/).filter(Boolean).pop() ?? t("editor.fileTree");

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span title={root}>{workspaceName}</span>
        <IconButton
          onClick={() => {
            setRoots((prev) => {
              const strip = (nodes: TreeNode[]): TreeNode[] =>
                nodes.map((n) => ({
                  entry: n.entry,
                  depth: n.depth,
                  // 保留已加载缓存，只收拢展开态 —— 刷新语义。
                  loaded: n.loaded,
                  children: n.children ? strip(n.children) : undefined,
                }));
              return strip(prev);
            });
          }}
          title={t("scm.refresh")}
          aria-label={t("scm.refresh")}
        >
          ⟳
        </IconButton>
      </div>
      <div className="ui-side-panel-body">
        {loading ? (
          <div className="ui-side-panel-empty">
            <span className="ui-spinner" /> {t("editor.loading")}
          </div>
        ) : error ? (
          <div className="ui-side-panel-empty ui-editor-error">{error}</div>
        ) : rows.length === 0 ? (
          <div className="ui-side-panel-empty">{t("editor.noFiles")}</div>
        ) : (
          rows.map((node) => {
            const isDir = node.entry.type === "directory";
            return (
              <div
                key={node.entry.path}
                className={`ui-editor-file-entry${isDir ? " is-dir" : ""}${selectedFile === node.entry.path ? " is-selected" : ""}`}
                style={{ paddingLeft: 6 + node.depth * 14 }}
                onClick={() => {
                  if (isDir) toggleDir(node.entry.path);
                  else {
                    setSelectedFile(node.entry.path);
                    onOpenFile(node.entry.path);
                  }
                }}
              >
                <span className={`ui-editor-file-icon${isDir ? " is-dir" : ""}`}>
                  {isDir ? (
                    <>
                      <span className={`ui-tree-chev${node.expanded ? " open" : ""}`} aria-hidden>
                        ›
                      </span>
                      <DirIcon name={node.entry.name} fallback={<IconFolder />} />
                    </>
                  ) : (
                    <FileIcon name={node.entry.name} fallback={<IconFile />} />
                  )}
                </span>
                <span className="ui-editor-file-name" title={node.entry.path}>
                  {node.entry.name}
                </span>
                {node.loading ? <span className="ui-spinner" aria-hidden /> : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
