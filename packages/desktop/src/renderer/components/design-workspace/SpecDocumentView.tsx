import { useMemo, useState, type JSX } from "react";
import { StreamdownView } from "../StreamdownView";

type Props = {
  markdown: string;
  className?: string;
};

type ParsedSection = {
  id: string;
  title: string;
  body: string;
};

type ParsedDoc = {
  title: string;
  /** 信息表(GFM 两列表格)解析出的 key-value 头部字段。 */
  meta: Array<[string, string]>;
  sections: ParsedSection[];
};

/**
 * Parse the standardized PRD (spec-writer 契约格式) into a structured document:
 * `#` title, the leading 信息表 as key-value pairs, `##` sections with bodies.
 * Falls back to zero sections — the caller then renders plain markdown.
 */
export function parseSpecDocument(markdown: string): ParsedDoc {
  const lines = markdown.split(/\r?\n/);
  let title = "";
  const sections: ParsedSection[] = [];
  const meta: Array<[string, string]> = [];
  let current: ParsedSection | null = null;
  let seenHeading = false;

  for (const line of lines) {
    if (/^#\s+/.test(line) && !title && !seenHeading) {
      title = line.replace(/^#\s+/, "").trim();
      continue;
    }
    if (/^##\s+/.test(line)) {
      seenHeading = true;
      current = { id: `sec-${sections.length}`, title: line.replace(/^##\s+/, "").trim(), body: "" };
      sections.push(current);
      continue;
    }
    if (!seenHeading) {
      // 标题与第一个 ## 之间:信息表(GFM 行)→ key-value 对。
      if (/^\|/.test(line.trim())) {
        const cells = line
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim());
        if (cells.length >= 2 && !cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")) || cell === "")) {
          const key = cells[0].replace(/[`*]/g, "");
          const value = cells[1].replace(/[`*]/g, "");
          if (key && value && !/^(项目|字段|item|key)$/i.test(key)) meta.push([key, value]);
        }
      }
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  return { title, meta, sections };
}

/**
 * Structured PRD view (user ask 2026-09-09: 需求文档不是 markdown 平铺) —
 * document header with the 信息表 as meta chips, a sticky section TOC, and
 * each `##` section as its own card. Section bodies still go through the
 * shared Streamdown pipeline (tables / Mermaid / code render properly).
 */
export function SpecDocumentView({ markdown, className }: Props): JSX.Element {
  const doc = useMemo(() => parseSpecDocument(markdown), [markdown]);
  const [activeSection, setActiveSection] = useState<string>(doc.sections[0]?.id ?? "");

  if (doc.sections.length === 0) {
    // 非标准化文档:不硬拆,退回整页 markdown 渲染。
    return <StreamdownView markdown={markdown} className={className} />;
  }

  return (
    <div className={`ui-spec-doc ${className ?? ""}`}>
      <aside className="ui-spec-doc-toc" aria-label="document sections">
        <div className="ui-spec-doc-toc-title">{doc.title || "需求文档"}</div>
        {doc.sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className={`ui-spec-doc-toc-item${activeSection === section.id ? " active" : ""}`}
            onClick={() => setActiveSection(section.id)}
          >
            {section.title}
          </a>
        ))}
      </aside>
      <article className="ui-spec-doc-body">
        <header className="ui-spec-doc-head">
          <h1>{doc.title}</h1>
          {doc.meta.length > 0 ? (
            <div className="ui-spec-doc-meta">
              {doc.meta.map(([key, value]) => (
                <span className="ui-spec-doc-meta-item" key={key}>
                  <i>{key}</i>
                  <b>{value}</b>
                </span>
              ))}
            </div>
          ) : null}
        </header>
        {doc.sections.map((section) => (
          <section className="ui-spec-doc-section" key={section.id} id={section.id}>
            <h2>{section.title}</h2>
            <StreamdownView markdown={section.body.trim()} className="ui-spec-doc-section-md" />
          </section>
        ))}
      </article>
    </div>
  );
}
