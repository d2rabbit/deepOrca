import { useCallback, useEffect, useState, type JSX } from "react";
import type { EditorFileEntry } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { IconButton } from "../ui/index";

/** Map file extension to a distinctive icon. */
function fileIcon(name: string, isDir: boolean): string {
  if (isDir) return "📁";
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const map: Record<string, string> = {
    ts: "🔷",
    tsx: "🔷",
    mts: "🔷",
    cts: "🔷",
    js: "🟡",
    jsx: "🟡",
    mjs: "🟡",
    cjs: "🟡",
    json: "📋",
    jsonc: "📋",
    json5: "📋",
    css: "🎨",
    scss: "🎨",
    less: "🎨",
    sass: "🎨",
    html: "🌐",
    htm: "🌐",
    xml: "🌐",
    svg: "🖼️",
    vue: "💚",
    svelte: "🧡",
    md: "📝",
    markdown: "📝",
    mdx: "📝",
    py: "🐍",
    pyi: "🐍",
    rs: "🦀",
    go: "🐹",
    java: "☕",
    kt: "☕",
    scala: "☕",
    c: "⚙️",
    h: "⚙️",
    cc: "⚙️",
    cpp: "⚙️",
    cxx: "⚙️",
    hpp: "⚙️",
    cs: "🔮",
    rb: "💎",
    php: "🐘",
    sh: "🐚",
    bash: "🐚",
    zsh: "🐚",
    fish: "🐚",
    yml: "⚙️",
    yaml: "⚙️",
    toml: "⚙️",
    ini: "⚙️",
    cfg: "⚙️",
    sql: "🗃️",
    graphql: "🗃️",
    gql: "🗃️",
    lua: "🌙",
    r: "📊",
    pl: "🐪",
    dockerfile: "🐳",
    mk: "🔨",
    makefile: "🔨",
    lock: "🔒",
    env: "🔒",
    png: "🖼️",
    jpg: "🖼️",
    jpeg: "🖼️",
    gif: "🖼️",
    webp: "🖼️",
    ico: "🖼️",
    mp3: "🎵",
    wav: "🎵",
    ogg: "🎵",
    flac: "🎵",
    mp4: "🎬",
    avi: "🎬",
    mov: "🎬",
    mkv: "🎬",
    webm: "🎬",
    zip: "📦",
    tar: "📦",
    gz: "📦",
    bz2: "📦",
    xz: "📦",
    "7z": "📦",
    rar: "📦",
    pdf: "📄",
    doc: "📄",
    docx: "📄",
    xls: "📊",
    xlsx: "📊",
    ppt: "📽️",
    pptx: "📽️",
    woff: "🔤",
    woff2: "🔤",
    ttf: "🔤",
    otf: "🔤",
    eot: "🔤",
    exe: "⚡",
    dll: "⚡",
    so: "⚡",
    dylib: "⚡",
    app: "⚡",
    db: "🗄️",
    sqlite: "🗄️",
    sqlite3: "🗄️",
    gitignore: "🙈",
    gitattributes: "🙈",
    npmrc: "📦",
    nvmrc: "📦",
    txt: "📃",
    log: "📃",
  };
  // Special filenames without extension
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "🐳";
  if (lower === "makefile" || lower === "gnumakefile") return "🔨";
  if (lower === ".gitignore" || lower === ".gitattributes") return "🙈";
  if (lower === "license" || lower === "licence") return "📜";
  if (lower === "readme" || lower.startsWith("readme.")) return "📖";
  if (lower === "changelog" || lower.startsWith("changelog.")) return "📋";
  return map[ext] ?? "📄";
}

type Props = {
  /** Called when the user picks a file to open in the editor. */
  onOpenFile: (filePath: string) => void;
};

/** Simple file-tree browser for the editor side panel. */
export function EditorPanel({ onOpenFile }: Props): JSX.Element {
  const { t } = useI18n();
  const [entries, setEntries] = useState<EditorFileEntry[]>([]);
  const [currentDir, setCurrentDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const loadDir = useCallback(
    async (dir: string) => {
      setLoading(true);
      setError(null);
      const result = await api.editorListFiles(dir);
      setLoading(false);
      if (!result.ok) {
        setError(result.error ?? t("editor.readError"));
        return;
      }
      setEntries(result.entries ?? []);
      setCurrentDir(dir);
    },
    [t]
  );

  useEffect(() => {
    void loadDir("");
  }, [loadDir]);

  const navigateUp = useCallback(() => {
    if (!currentDir) return;
    const parent = currentDir.split(/[\\/]/).slice(0, -1).join("/");
    void loadDir(parent);
  }, [currentDir, loadDir]);

  const handleEntryClick = useCallback(
    (entry: EditorFileEntry) => {
      if (entry.type === "directory") {
        void loadDir(entry.path);
      } else {
        setSelectedFile(entry.path);
        onOpenFile(entry.path);
      }
    },
    [loadDir, onOpenFile]
  );

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("editor.fileTree")}</span>
        <IconButton onClick={() => void loadDir(currentDir)} title={t("scm.refresh")} aria-label={t("scm.refresh")}>
          ⟳
        </IconButton>
      </div>
      <div className="ui-side-panel-body">
        {currentDir ? (
          <div className="ui-editor-breadcrumb">
            <button className="ui-editor-breadcrumb-btn" onClick={navigateUp}>
              ← ..
            </button>
            <span className="ui-editor-breadcrumb-path">{currentDir}</span>
          </div>
        ) : null}
        {loading ? (
          <div className="ui-side-panel-empty">
            <span className="ui-spinner" /> {t("editor.loading")}
          </div>
        ) : error ? (
          <div className="ui-side-panel-empty ui-editor-error">{error}</div>
        ) : entries.length === 0 ? (
          <div className="ui-side-panel-empty">{t("editor.noFiles")}</div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.path}
              className={`ui-editor-file-entry${entry.type === "directory" ? " is-dir" : ""}${selectedFile === entry.path ? " is-selected" : ""}`}
              onClick={() => handleEntryClick(entry)}
            >
              <span className="ui-editor-file-icon">{fileIcon(entry.name, entry.type === "directory")}</span>
              <span className="ui-editor-file-name" title={entry.path}>
                {entry.name}
              </span>
              {entry.type === "file" ? <span className="ui-editor-file-size">{formatSize(entry.size)}</span> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
