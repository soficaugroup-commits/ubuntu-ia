const TARGET_CHARS = 650 * 4;
const OVERLAP_CHARS = Math.floor(TARGET_CHARS * 0.12);

export type TextChunk = {
  contenu: string;
  position_document: number;
};

export function chunkText(text: string): TextChunk[] {
  const cleaned = text.trim();
  if (!cleaned) return [];

  const paragraphs = cleaned
    .replace(/\r\n/g, "\n")
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
  const source = paragraphs.length ? paragraphs : [cleaned];

  const chunks: TextChunk[] = [];
  let buffer = "";

  const flush = (current: string) => {
    const body = current.trim();
    if (!body) return;
    chunks.push({ contenu: body, position_document: chunks.length });
  };

  for (const paragraph of source) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length <= TARGET_CHARS) {
      buffer = candidate;
      continue;
    }
    if (buffer) {
      flush(buffer);
      const overlap =
        OVERLAP_CHARS < buffer.length ? buffer.slice(-OVERLAP_CHARS) : buffer;
      buffer = `${overlap}\n\n${paragraph}`.trim();
      if (buffer.length > TARGET_CHARS * 1.3) {
        flush(paragraph);
        buffer = "";
      }
      continue;
    }
    for (let start = 0; start < paragraph.length; ) {
      const end = Math.min(start + TARGET_CHARS, paragraph.length);
      flush(paragraph.slice(start, end));
      if (end >= paragraph.length) break;
      start = Math.max(end - OVERLAP_CHARS, start + 1);
    }
  }

  if (buffer) flush(buffer);
  return chunks;
}
