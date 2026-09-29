export type InlinePart = {
  text: string;
  bold?: boolean;
  italic?: boolean;
};

const MARK = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_)/g;

export function parseInline(input: string): InlinePart[] {
  const text = input.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const parts: InlinePart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MARK)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: text.slice(cursor, index) });
    if (match[2]) parts.push({ text: match[2], bold: true });
    else if (match[3]) parts.push({ text: match[3], italic: true });
    else if (match[4]) parts.push({ text: match[4], italic: true });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts.filter((part) => part.text.length > 0);
}

export function plainInline(input: string): string {
  const parts = parseInline(input);
  return parts.length ? parts.map((part) => part.text).join("") : input.trim();
}

const PDF_EXTRA: Record<number, string> = {
  0x2018: "'",
  0x2019: "'",
  0x201c: '"',
  0x201d: '"',
  0x2013: "-",
  0x2014: "-",
  0x2026: "...",
  0x2022: "-",
  0x0152: "OE",
  0x0153: "oe",
  0x00a0: " ",
  0x202f: " ",
  0x2009: " ",
};

/** Garde les accents français (WinAnsi) et remplace seulement le hors encodage. */
export function toPdfText(input: string): string {
  let out = "";
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) || (code >= 160 && code <= 255) || code === 0x20ac) {
      out += char;
      continue;
    }
    out += PDF_EXTRA[code] ?? "?";
  }
  return out;
}
