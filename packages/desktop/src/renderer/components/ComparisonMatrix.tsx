/**
 * ComparisonMatrix — renders a multi-option comparison as a table.
 *
 * When the agent's assistant message contains a `<comparison>` XML tag,
 * Message.tsx extracts the content and passes it here. The content is
 * expected to be a markdown table:
 *
 * ```md
 * | Dimension | Option A | Option B | Option C |
 * |-----------|----------|----------|----------|
 * | Speed     | Fast     | Medium   | Slow     |
 * | Cost      | Free     | $10/mo   | $50/mo   |
 * ```
 *
 * We parse it into a table and render with DeepOrca styling.
 */

import { useMemo, type JSX } from "react";
import { IconBalance } from "../ui/index";

type Props = {
  /** Raw markdown table content (between <comparison> tags). */
  content: string;
};

type MatrixData = {
  headers: string[];
  rows: string[][];
};

function parseMarkdownTable(content: string): MatrixData | null {
  const lines = content
    .trim()
    .split("\n")
    .filter((l) => l.trim());
  if (lines.length < 2) return null;

  // First line = headers
  const headers = splitTableRow(lines[0]!);
  if (headers.length < 2) return null;

  // Skip separator line (|---|---|...)
  const dataLines = lines.filter((line) => !line.match(/^\s*\|[\s-:|]+\|\s*$/));

  const rows: string[][] = [];
  for (let i = 1; i < dataLines.length; i++) {
    const cells = splitTableRow(dataLines[i]!);
    if (cells.length > 0) rows.push(cells);
  }

  return { headers, rows };
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function ComparisonMatrix({ content }: Props): JSX.Element {
  const matrix = useMemo(() => parseMarkdownTable(content), [content]);

  if (!matrix) {
    // Fallback: render raw content if parsing fails
    return <div className="ui-comparison-matrix-raw">{content}</div>;
  }

  return (
    <div className="ui-comparison-matrix">
      <div className="ui-comparison-matrix-title">
        <IconBalance /> Option Comparison
      </div>
      <table className="ui-comparison-matrix-table">
        <thead>
          <tr>
            {matrix.headers.map((h, i) => (
              <th key={i} className={i === 0 ? "ui-comparison-matrix-dim" : ""}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} className={ci === 0 ? "ui-comparison-matrix-dim" : ""}>
                  {cell}
                </td>
              ))}
              {/* Pad missing cells */}
              {matrix.headers.length > row.length
                ? Array.from({ length: matrix.headers.length - row.length }, (_, i) => <td key={`pad-${i}`}>—</td>)
                : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Extract <comparison>...</comparison> blocks from assistant message content.
 * Returns an array of raw table content strings.
 */
export function extractComparisons(content: string): string[] {
  const matches: string[] = [];
  const regex = /<comparison>\s*([\s\S]*?)\s*<\/comparison>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    matches.push(match[1]!);
  }
  return matches;
}
