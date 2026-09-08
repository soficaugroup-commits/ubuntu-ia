import JSZip from "jszip";
import type { PreparedAttachment } from "@/lib/server/chat-attachments";
import {
  defaultDna,
  extractDesignDna,
  formatFromName,
  mergeDna,
  pickStyleAttachment,
  type DesignDna,
} from "@/lib/server/design-dna";
import {
  type DocumentSpec,
  type DocSection,
} from "@/lib/server/document-spec";
import type { FileFormat } from "@/lib/types";

export type StyleJob = {
  style?: PreparedAttachment;
  content?: PreparedAttachment;
  sameDocument: boolean;
  frozenSource: boolean;
  editorialSynthesis: boolean;
  dna: DesignDna;
};

export type ContentCheck = {
  ok: boolean;
  missing: string[];
};

export function classifyAttachments(
  question: string,
  attachments: PreparedAttachment[],
): Pick<StyleJob, "style" | "content" | "sameDocument" | "frozenSource"> {
  const style = pickStyleAttachment(question, attachments);
  const content =
    attachments.find((item) => item !== style) ??
    (attachments.length === 1 ? attachments[0] : undefined);
  const styleFormat = style ? formatFromName(style.name, style.mime) : "unknown";
  return {
    style,
    content,
    sameDocument: !style || !content || style === content,
    frozenSource: styleFormat === "pdf" || styleFormat === "image",
  };
}

export async function planStyleTransfer(input: {
  question: string;
  attachments: PreparedAttachment[];
  spec: DocumentSpec;
  outputFormats: FileFormat[];
}): Promise<StyleJob> {
  const roles = classifyAttachments(input.question, input.attachments);
  const extracted = roles.style
    ? roles.style.design ?? (await extractDesignDna(roles.style))
    : defaultDna();
  const dna = mergeDna(extracted, input.spec.design, {
    frozenSource: roles.frozenSource,
    assumptions: [
      ...(extracted.assumptions ?? []),
      roles.sameDocument
        ? "Même document : habillage uniquement, contenu intact."
        : "Deux documents distincts : le texte du modèle de style n'est pas réinjecté.",
    ],
  });
  const toSlides = input.outputFormats.includes("pptx");
  const sourceFormat = roles.content
    ? formatFromName(roles.content.name, roles.content.mime)
    : "unknown";
  return {
    ...roles,
    dna,
    editorialSynthesis: toSlides && sourceFormat !== "pptx",
  };
}

export function cleanSpec(spec: DocumentSpec): DocumentSpec {
  const sections = spec.sections
    .map((section) => cleanSection(section))
    .filter((section) => sectionHasContent(section));
  return {
    ...spec,
    title: spec.title.trim() || "Ubuntu IA",
    subtitle: spec.subtitle.trim(),
    sections: sections.length
      ? sections
      : [{ title: spec.title || "Synthèse", body: spec.subtitle ? [spec.subtitle] : [], bullets: [] }],
    charts: spec.charts.filter((chart) => chart.categories.length && chart.series.length),
  };
}

export function specHasDataTables(spec: DocumentSpec): boolean {
  return spec.sections.some((section) => Boolean(section.table || section.chart)) || spec.charts.length > 0;
}

export function fingerprintSpec(spec: DocumentSpec): string[] {
  const parts = [spec.title, spec.subtitle];
  for (const section of spec.sections) {
    parts.push(section.title, ...section.body, ...section.bullets);
    if (section.table) parts.push(...section.table.headers, ...section.table.rows.flat());
    if (section.chart) {
      parts.push(section.chart.title, ...section.chart.categories);
      for (const series of section.chart.series) {
        parts.push(series.name, ...series.values.map(String));
      }
    }
  }
  return significantTokens(parts.join(" "));
}

export function verifyContent(expected: string[], actual: string, loose = false): ContentCheck {
  if (!expected.length) return { ok: true, missing: [] };
  const hay = normalizeToken(actual);
  const missing = expected.filter((token) => token.length >= 3 && !hay.includes(normalizeToken(token)));
  const kept = 1 - missing.length / expected.length;
  return {
    ok: kept >= (loose ? 0.55 : 0.85),
    missing: missing.slice(0, 12),
  };
}

export async function textFromGenerated(format: FileFormat, bytes: Uint8Array): Promise<string> {
  if (format === "docx" || format === "pptx" || format === "xlsx") {
    return textFromOoxml(bytes, format);
  }
  if (format === "pdf") {
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      return Array.isArray(text) ? text.join(" ") : text;
    } catch {
      return "";
    }
  }
  return new TextDecoder().decode(bytes);
}

export function isOfficeWorkbook(item: { name: string; mime: string }): boolean {
  const format = formatFromName(item.name, item.mime);
  return format === "xlsx";
}

export function pickContentWorkbook(
  attachments: PreparedAttachment[],
  style: PreparedAttachment | undefined,
  spec: DocumentSpec,
): PreparedAttachment | undefined {
  const books = attachments.filter(isOfficeWorkbook);
  const content = books.find((item) => item !== style);
  if (content) return content;
  if (books.length === 1 && !specHasDataTables(spec)) return books[0];
  return undefined;
}

function cleanSection(section: DocSection): DocSection {
  const body = section.body.map((line) => line.trim()).filter(Boolean);
  const bullets = section.bullets.map((line) => line.trim()).filter(Boolean);
  const table =
    section.table && section.table.headers.some(Boolean) && section.table.rows.some((row) => row.some(Boolean))
      ? {
          headers: section.table.headers.map((cell) => cell.trim()),
          rows: section.table.rows
            .map((row) => row.map((cell) => cell.trim()))
            .filter((row) => row.some(Boolean)),
        }
      : undefined;
  return { ...section, title: section.title.trim(), body, bullets, table };
}

function sectionHasContent(section: DocSection): boolean {
  return Boolean(
    section.title ||
      section.body.length ||
      section.bullets.length ||
      section.table ||
      section.chart,
  );
}

async function textFromOoxml(bytes: Uint8Array, format: FileFormat): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const parts: string[] = [];
  for (const name of Object.keys(zip.files)) {
    if (!keepXml(name, format)) continue;
    const xml = await zip.files[name].async("string");
    parts.push(
      xml
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " "),
    );
  }
  return parts.join(" ");
}

function keepXml(name: string, format: FileFormat): boolean {
  if (format === "docx") return /word\/document\.xml$/i.test(name);
  if (format === "pptx") return /ppt\/slides\/slide\d+\.xml$/i.test(name);
  return /xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/i.test(name);
}

function significantTokens(text: string): string[] {
  const words =
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[\p{L}]{4,}|\d+(?:[.,]\d+)?%?/gu) ?? [];
  return [...new Set(words)].slice(0, 80);
}

function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}
