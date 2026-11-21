import React from "react";

/**
 * Pure-React, XSS-safe Markdown renderer for scientific assistant responses.
 * Never uses dangerouslySetInnerHTML; restricts hyperlinks strictly to http(s)://.
 */

function isSafeHttpUrl(url) {
  return /^https?:\/\/[^\s<>"]+$/i.test(String(url || "").trim());
}

function renderInline(text, keyPrefix) {
  if (!text) return null;
  // Tokenize links [label](url), inline code `code`, bold **text**, italic *text*
  const tokenRegex =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\n]+)\*)/g;

  const nodes = [];
  let lastIndex = 0;
  let match;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2] && match[3] && isSafeHttpUrl(match[3])) {
      nodes.push(
        <a
          key={`${keyPrefix}-a-${idx++}`}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="md-link"
        >
          {match[2]}
        </a>
      );
    } else if (match[4] !== undefined) {
      nodes.push(
        <code key={`${keyPrefix}-c-${idx++}`} className="md-inline-code">
          {match[4]}
        </code>
      );
    } else if (match[5] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-b-${idx++}`}>{match[5]}</strong>);
    } else if (match[6] !== undefined) {
      nodes.push(<em key={`${keyPrefix}-i-${idx++}`}>{match[6]}</em>);
    } else {
      nodes.push(match[0]);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function isTableSeparator(line) {
  return /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line);
}

function splitTableCells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function renderSafeMarkdown(rawText) {
  if (typeof rawText !== "string") {
    return null;
  }

  const lines = rawText.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  let keyIdx = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code block ```
    if (trimmed.startsWith("```")) {
      const codeLines = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre key={`md-pre-${keyIdx++}`} className="md-code-block">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Headings (# / ## / ### / ####)
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = renderInline(headingMatch[2], `h-${keyIdx}`);
      const Tag = level <= 2 ? "h3" : "h4";
      blocks.push(
        <Tag key={`md-h-${keyIdx++}`} className={`md-heading md-h${level}`}>
          {content}
        </Tag>
      );
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      blocks.push(<hr key={`md-hr-${keyIdx++}`} className="md-hr" />);
      i += 1;
      continue;
    }

    // Markdown table
    if (trimmed.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableCells(trimmed);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().includes("|")) {
        rows.push(splitTableCells(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={`md-tbl-${keyIdx++}`} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {headers.map((h, hIdx) => (
                  <th key={`th-${hIdx}`}>{renderInline(h, `th-${keyIdx}-${hIdx}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, rIdx) => (
                <tr key={`tr-${rIdx}`}>
                  {headers.map((_, cIdx) => (
                    <td key={`td-${rIdx}-${cIdx}`}>
                      {renderInline(r[cIdx] || "", `td-${keyIdx}-${rIdx}-${cIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Unordered list (- or *)
    if (/^[-*•]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={`md-ul-${keyIdx++}`} className="md-list">
          {items.map((item, idx) => (
            <li key={`li-${idx}`}>{renderInline(item, `ul-${keyIdx}-${idx}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list (1. 2. ...)
    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol key={`md-ol-${keyIdx++}`} className="md-list md-ol">
          {items.map((item, idx) => (
            <li key={`oli-${idx}`}>{renderInline(item, `ol-${keyIdx}-${idx}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Blockquote (> ...)
    if (trimmed.startsWith("> ")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2));
        i += 1;
      }
      blocks.push(
        <blockquote key={`md-bq-${keyIdx++}`} className="md-blockquote">
          {renderInline(quoteLines.join(" "), `bq-${keyIdx}`)}
        </blockquote>
      );
      continue;
    }

    // Regular paragraph (merge consecutive plain lines until blank or structural marker)
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !/^#{1,4}\s+/.test(lines[i].trim()) &&
      !/^[-*•]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith("> ") &&
      !(lines[i].trim().includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      paraLines.push(lines[i].trim());
      i += 1;
    }
    blocks.push(
      <p key={`md-p-${keyIdx++}`} className="md-p">
        {renderInline(paraLines.join(" "), `p-${keyIdx}`)}
      </p>
    );
  }

  return blocks;
}
