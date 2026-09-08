"use client";

import { Fragment, type ReactNode } from "react";
import { Surface } from "@/components/ui/Surface";
import { copy } from "@/content/fr";
import { stripInlineLinks } from "@/lib/answer-text";

type Props = {
  content: string;
  messageId: string;
  sourceCount: number;
  streaming?: boolean;
};

export function AnswerBody({ content, messageId, sourceCount, streaming = false }: Props) {
  if (streaming && !content.trim()) {
    return (
      <span className="stream-caret" aria-label={copy.chat.streamCaret} />
    );
  }
  const blocks = splitBlocks(stripInlineLinks(content));
  return (
    <div className="flex flex-col gap-4 text-[0.95rem] leading-7 text-content">
      {blocks.map((block, index) => (
        <Block
          key={`${messageId}-b-${index}`}
          block={block}
          messageId={messageId}
          sourceCount={sourceCount}
        />
      ))}
      {streaming ? (
        <span className="stream-caret" aria-label={copy.chat.streamCaret} />
      ) : null}
    </div>
  );
}

export function stripMarkdown(content: string): string {
  return answerPlainText(content).replace(/\s+/g, " ").trim();
}

export function answerPlainText(content: string): string {
  return stripInlineLinks(content)
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/```[^\n]*\n?/g, "").replace(/```/g, "").trim(),
    )
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*•]\s+/gm, "• ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Block =
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "code"; text: string; language?: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "rule" };

function splitBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  let code: string[] | null = null;
  let codeLanguage: string | undefined;
  let table: string[] | null = null;

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", lines: [...paragraph] });
    paragraph = [];
  }

  function flushList() {
    if (!list?.items.length) return;
    blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  }

  function flushQuote() {
    if (!quote.length) return;
    blocks.push({ type: "quote", lines: [...quote] });
    quote = [];
  }

  function flushCode() {
    if (!code) return;
    blocks.push({ type: "code", text: code.join("\n").trim(), language: codeLanguage });
    code = null;
    codeLanguage = undefined;
  }

  function flushTable() {
    if (!table?.length) {
      table = null;
      return;
    }
    const parsed = parseTable(table);
    if (parsed) blocks.push(parsed);
    else blocks.push({ type: "paragraph", lines: table });
    table = null;
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, "");
    const trimmed = line.trim();

    if (code) {
      if (trimmed.startsWith("```")) {
        flushCode();
        continue;
      }
      code.push(line);
      continue;
    }

    if (table) {
      if (!trimmed || !isTableLine(trimmed)) {
        flushTable();
        if (!trimmed) {
          flushParagraph();
          flushList();
          flushQuote();
          continue;
        }
      } else {
        table.push(trimmed);
        continue;
      }
    }

    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      flushQuote();
      code = [];
      codeLanguage = trimmed.slice(3).trim() || undefined;
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }

    if (isTableLine(trimmed)) {
      flushParagraph();
      flushList();
      flushQuote();
      table = [trimmed];
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push({ type: "rule" });
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      flushQuote();
      const hashes = heading[1].length;
      blocks.push({
        type: "heading",
        level: hashes <= 2 ? 2 : hashes === 3 ? 3 : 4,
        text: heading[2].trim(),
      });
      continue;
    }

    const boldHeading = trimmed.match(/^\*\*([^*]+)\*\*$/);
    if (boldHeading && boldHeading[1].length < 90) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push({ type: "heading", level: 3, text: boldHeading[1].trim() });
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quote.push(quoteMatch[1]);
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      flushQuote();
      if (!list || list.ordered) list = { ordered: false, items: [] };
      list.items.push(bullet[1]);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      flushQuote();
      if (!list || !list.ordered) list = { ordered: true, items: [] };
      list.items.push(ordered[1]);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(trimmed);
  }

  flushCode();
  flushTable();
  flushParagraph();
  flushList();
  flushQuote();
  return blocks.length ? blocks : [{ type: "paragraph", lines: [content.trim()] }];
}

function isTableSep(line: string): boolean {
  return /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(line);
}

function isTableLine(line: string): boolean {
  if (isTableSep(line)) return true;
  return line.startsWith("|") && line.includes("|", 1);
}

function parseTableCells(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseTable(lines: string[]): Extract<Block, { type: "table" }> | null {
  const body = lines.filter((line) => !isTableSep(line));
  if (body.length < 2) return null;
  const headers = parseTableCells(body[0]);
  if (headers.length < 2) return null;
  const rows = body.slice(1).map(parseTableCells).filter((row) => row.some(Boolean));
  if (!rows.length) return null;
  return { type: "table", headers, rows };
}

function Block({
  block,
  messageId,
  sourceCount,
}: {
  block: Block;
  messageId: string;
  sourceCount: number;
}) {
  if (block.type === "heading") {
    const Tag = block.level === 2 ? "h2" : block.level === 3 ? "h3" : "h4";
    const size =
      block.level === 2
        ? "text-lg"
        : block.level === 3
          ? "text-base"
          : "text-[0.95rem]";
    return (
      <Tag
        className={`font-semibold leading-snug tracking-tight text-content first:mt-0 ${size} ${
          block.level === 2 ? "mt-1" : "mt-0.5"
        }`}
      >
        {renderInline(block.text, messageId, sourceCount)}
      </Tag>
    );
  }

  if (block.type === "list") {
    const List = block.ordered ? "ol" : "ul";
    return (
      <List
        className={
          block.ordered
            ? "flex list-decimal flex-col gap-2 pl-5 marker:font-semibold marker:text-content"
            : "flex list-disc flex-col gap-2 pl-5 marker:text-content"
        }
      >
        {block.items.map((item, index) => (
          <li key={`${messageId}-i-${index}`} className="pl-1">
            {renderInline(item, messageId, sourceCount)}
          </li>
        ))}
      </List>
    );
  }

  if (block.type === "quote") {
    return (
      <Surface elevation="pressed" radius="surface" className="px-4 py-3">
        <blockquote className="text-sm leading-7 text-content-muted">
          {block.lines.map((line, index) => (
            <Fragment key={`${messageId}-q-${index}`}>
              {renderInline(line, messageId, sourceCount)}
              {index < block.lines.length - 1 ? <br /> : null}
            </Fragment>
          ))}
        </blockquote>
      </Surface>
    );
  }

  if (block.type === "code") {
    return (
      <Surface elevation="pressed" radius="surface" className="overflow-x-auto px-4 py-3">
        {block.language ? (
          <p className="mb-2 text-xs font-semibold text-content-muted">{block.language}</p>
        ) : null}
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-content">
          {block.text}
        </pre>
      </Surface>
    );
  }

  if (block.type === "table") {
    return (
      <Surface elevation="pressed" radius="surface" className="overflow-x-auto">
        <table className="w-full min-w-[18rem] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {block.headers.map((cell, index) => (
                <th
                  key={`${messageId}-th-${index}`}
                  className="px-3 py-2 text-left font-semibold text-content"
                >
                  {renderInline(cell, messageId, sourceCount)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${messageId}-tr-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${messageId}-td-${rowIndex}-${cellIndex}`}
                    className="px-3 py-2 text-content"
                  >
                    {renderInline(cell, messageId, sourceCount)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
    );
  }

  if (block.type === "rule") {
    return <hr />;
  }

  return (
    <p className="break-words">
      {block.lines.map((line, index) => (
        <Fragment key={`${messageId}-p-${index}`}>
          {renderInline(line, messageId, sourceCount)}
          {index < block.lines.length - 1 ? <br /> : null}
        </Fragment>
      ))}
    </p>
  );
}

function renderInline(
  text: string,
  messageId: string,
  sourceCount: number,
): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[\d+\])/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      nodes.push(
        <Fragment key={`${messageId}-t-${key++}`}>
          {text.slice(last, match.index)}
        </Fragment>,
      );
    }
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={`${messageId}-t-${key++}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*")) {
      nodes.push(
        <em key={`${messageId}-t-${key++}`} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <span key={`${messageId}-t-${key++}`} className="font-medium">
          {token.slice(1, -1)}
        </span>,
      );
    } else {
      const n = Number(token.slice(1, -1));
      nodes.push(
        <CitationMark
          key={`${messageId}-t-${key++}`}
          n={n}
          messageId={messageId}
          sourceCount={sourceCount}
        />,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    nodes.push(
      <Fragment key={`${messageId}-t-${key++}`}>{text.slice(last)}</Fragment>,
    );
  }
  return nodes;
}

function CitationMark({
  n,
  messageId,
  sourceCount,
}: {
  n: number;
  messageId: string;
  sourceCount: number;
}) {
  const valid = n >= 1 && n <= sourceCount;
  const mark = (
    <span className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-subtle px-1 align-middle text-[0.65rem] font-semibold text-content">
      {n}
    </span>
  );
  if (!valid) return mark;
  return (
    <a href={`#source-${messageId}-${n}`} className="inline-flex no-underline">
      {mark}
    </a>
  );
}
