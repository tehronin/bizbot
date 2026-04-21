"use client";

import { Fragment, useMemo, useState } from "react";

interface MarkdownBlock {
  kind: "heading" | "paragraph" | "list" | "code";
  level?: number;
  lines: string[];
  language?: string;
  ordered?: boolean;
}

interface InlineToken {
  kind: "text" | "bold" | "italic" | "code" | "link";
  value: string;
  href?: string;
}

const INLINE_PATTERN = /(\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\)|`[^`]+`|\*\*[^*]+\*\*|_[^_]+_)/g;

function parseInlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const matched = match[0];
    const startIndex = match.index ?? 0;

    if (startIndex > lastIndex) {
      tokens.push({ kind: "text", value: text.slice(lastIndex, startIndex) });
    }

    if (matched.startsWith("[")) {
      const linkMatch = matched.match(/^\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)]+)\)$/);
      if (linkMatch) {
        tokens.push({ kind: "link", value: linkMatch[1], href: linkMatch[2] });
      } else {
        tokens.push({ kind: "text", value: matched });
      }
    } else if (matched.startsWith("`")) {
      tokens.push({ kind: "code", value: matched.slice(1, -1) });
    } else if (matched.startsWith("**")) {
      tokens.push({ kind: "bold", value: matched.slice(2, -2) });
    } else if (matched.startsWith("_")) {
      tokens.push({ kind: "italic", value: matched.slice(1, -1) });
    } else {
      tokens.push({ kind: "text", value: matched });
    }

    lastIndex = startIndex + matched.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ kind: "text", value: text.slice(lastIndex) });
  }

  return tokens;
}

function renderInline(text: string, options?: { trailingCursor?: boolean }) {
  return parseInlineTokens(text).map((token, index) => {
    if (token.kind === "bold") {
      return <strong key={`${token.kind}-${index}`}>{token.value}</strong>;
    }

    if (token.kind === "italic") {
      return <em key={`${token.kind}-${index}`}>{token.value}</em>;
    }

    if (token.kind === "code") {
      return (
        <code
          key={`${token.kind}-${index}`}
          className="rounded px-1 py-0.5 text-[0.95em] bg-surface text-primary"
        >
          {token.value}
        </code>
      );
    }

    if (token.kind === "link" && token.href) {
      return (
        <a
          key={`${token.kind}-${index}`}
          href={token.href}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline"
        >
          {token.value}
        </a>
      );
    }

    return <Fragment key={`${token.kind}-${index}`}>{token.value}</Fragment>;
  }).concat(options?.trailingCursor ? [
    <span key={`${text}-cursor`} data-testid="chat-streaming-cursor" className="inline-block ml-1 animate-pulse text-muted">
      ▌
    </span>,
  ] : []);
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
      nodes.push({ kind: "list", lines: items, ordered: false });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, "").trim());
        index += 1;
      }
      nodes.push({ kind: "list", lines: items, ordered: true });
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith("```") &&
      !/^(#{1,3})\s+/.test(lines[index]) &&
      !/^[-*]\s+/.test(lines[index]) &&
      !/^\d+\.\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    nodes.push({ kind: "paragraph", lines: [paragraph.join(" ")] });
  }

  return nodes;
}

export function MessageMarkdown({ markdown, showStreamingCursor = false }: { markdown: string; showStreamingCursor?: boolean }) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);
  const [copiedBlockIndex, setCopiedBlockIndex] = useState<number | null>(null);

  async function copyCode(blockIndex: number, content: string): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }

    await navigator.clipboard.writeText(content);
    setCopiedBlockIndex(blockIndex);
    window.setTimeout(() => {
      setCopiedBlockIndex((current) => current === blockIndex ? null : current);
    }, 1200);
  }

  return (
    <div className="space-y-3 text-sm leading-6">
      {blocks.map((block, index) => {
        const isLastBlock = index === blocks.length - 1;
        const shouldShowCursor = showStreamingCursor && isLastBlock;

        if (block.kind === "heading") {
          const className =
            block.level === 1
              ? "text-xl font-semibold"
              : block.level === 2
                ? "text-lg font-semibold"
                : "text-base font-semibold uppercase tracking-[0.12em]";
          return (
            <div key={index} className={`${className} text-primary`}>
              {renderInline(block.lines[0], { trailingCursor: shouldShowCursor })}
            </div>
          );
        }
        if (block.kind === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={index}
              className={`space-y-2 pl-5 text-primary ${block.ordered ? "list-decimal" : "list-disc"}`}
            >
              {block.lines.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item, { trailingCursor: shouldShowCursor && itemIndex === block.lines.length - 1 })}</li>
              ))}
            </ListTag>
          );
        }
        if (block.kind === "code") {
          const codeContent = block.lines.join("\n");
          return (
            <div key={index} className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-muted">
                <div>{block.language ?? "code"}</div>
                <button
                  type="button"
                  onClick={() => {
                    void copyCode(index, codeContent);
                  }}
                  className={`border px-2 py-1 transition-colors border-border-sub ${copiedBlockIndex === index ? "text-accent" : "text-dim"}`}
                  data-testid={`code-copy-${index}`}
                >
                  {copiedBlockIndex === index ? "Copied" : "Copy"}
                </button>
              </div>
              <pre
                className="overflow-auto border border-border-sub bg-raised text-primary p-3 text-xs leading-6 whitespace-pre-wrap break-words"
              >
                <code>
                  {codeContent}
                  {shouldShowCursor ? <span data-testid="chat-streaming-cursor" className="animate-pulse">▌</span> : null}
                </code>
              </pre>
            </div>
          );
        }
        return (
          <p key={index} className="text-primary">
            {renderInline(block.lines[0], { trailingCursor: shouldShowCursor })}
          </p>
        );
      })}
    </div>
  );
}
