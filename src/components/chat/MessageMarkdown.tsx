"use client";

import { useMemo } from "react";

interface MarkdownBlock {
  kind: "heading" | "paragraph" | "list" | "code";
  level?: number;
  lines: string[];
  language?: string;
}

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.split(/\r?\n/);
  const nodes: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.startsWith("```")) {
      const language = line.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      nodes.push({ kind: "code", lines: codeLines, language });
      index += 1;
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      nodes.push({ kind: "heading", level: headingMatch[1].length, lines: [headingMatch[2].trim()] });
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, "").trim());
        index += 1;
      }
      nodes.push({ kind: "list", lines: items });
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith("```") &&
      !/^(#{1,3})\s+/.test(lines[index]) &&
      !/^[-*]\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    nodes.push({ kind: "paragraph", lines: [paragraph.join(" ")] });
  }

  return nodes;
}

export function MessageMarkdown({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);

  return (
    <div className="space-y-4 text-sm leading-7">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const className =
            block.level === 1
              ? "text-xl font-semibold"
              : block.level === 2
                ? "text-lg font-semibold"
                : "text-base font-semibold uppercase tracking-[0.12em]";
          return (
            <div key={index} className={className} style={{ color: "var(--text-primary)" }}>
              {block.lines[0]}
            </div>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={index} className="space-y-2 pl-5 list-disc" style={{ color: "var(--text-primary)" }}>
              {block.lines.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "code") {
          return (
            <div key={index} className="space-y-2">
              {block.language ? (
                <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                  {block.language}
                </div>
              ) : null}
              <pre
                className="overflow-auto border p-3 text-xs leading-6 whitespace-pre-wrap break-words"
                style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)", color: "var(--text-primary)" }}
              >
                <code>{block.lines.join("\n")}</code>
              </pre>
            </div>
          );
        }
        return (
          <p key={index} style={{ color: "var(--text-primary)" }}>
            {block.lines[0]}
          </p>
        );
      })}
    </div>
  );
}
