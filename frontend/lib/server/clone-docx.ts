import JSZip from "jszip";
import { defaultDna, type DesignDna } from "@/lib/server/design-dna";
import type { DocumentSpec } from "@/lib/server/document-spec";
import { parseInline } from "@/lib/server/rich-text";

export async function cloneDocxWithSpec(
  template: Buffer,
  spec: DocumentSpec,
  dna: DesignDna = defaultDna(),
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("Modèle Word incomplet.");
  const original = await documentFile.async("string");
  const styles = await readDocxStyles(zip);
  const sectPr = /<w:sectPr[\s\S]*?<\/w:sectPr>/i.exec(original)?.[0] ?? "";
  const body = buildBody(spec, styles, dna) + sectPr;
  const next = replaceBody(original, body);
  zip.file("word/document.xml", next);
  return zip.generateAsync({ type: "uint8array" });
}

export type DocxStyles = {
  heading1?: string;
  heading2?: string;
  heading3?: string;
  normal: string;
  list?: string;
};

/** Styles du modèle à réutiliser pour le contenu inséré (titres, corps, listes). */
export async function readDocxStyles(zip: JSZip): Promise<DocxStyles> {
  const stylesXml = (await zip.file("word/styles.xml")?.async("string")) ?? "";
  const styleIds = [...stylesXml.matchAll(/w:styleId="([^"]+)"/g)].map((match) => match[1]);
  return {
    heading1: pickStyle(styleIds, ["Heading1", "Titre1", "Title", "Titre"]),
    heading2: pickStyle(styleIds, ["Heading2", "Titre2"]),
    heading3: pickStyle(styleIds, ["Heading3", "Titre3"]),
    normal: pickStyle(styleIds, ["Normal", "Normal0"]) ?? "Normal",
    list: pickStyle(styleIds, ["ListParagraph", "Paragraphedeliste", "ListBullet"]),
  };
}

function pickStyle(ids: string[], candidates: string[]): string | undefined {
  const lower = ids.map((id) => id.toLowerCase());
  for (const candidate of candidates) {
    const index = lower.indexOf(candidate.toLowerCase());
    if (index >= 0) return ids[index];
  }
  return undefined;
}

function replaceBody(xml: string, inner: string): string {
  const start = xml.search(/<w:body\b[^>]*>/i);
  const end = xml.lastIndexOf("</w:body>");
  if (start < 0 || end < 0) throw new Error("Corps Word introuvable.");
  const openEnd = xml.indexOf(">", start) + 1;
  return `${xml.slice(0, openEnd)}${inner}${xml.slice(end)}`;
}

function buildBody(spec: DocumentSpec, styles: DocxStyles, dna: DesignDna): string {
  const parts: string[] = [];
  parts.push(paragraph(spec.title, styles.heading1 ?? styles.normal));
  if (spec.subtitle) parts.push(paragraph(spec.subtitle, styles.normal));
  for (const section of spec.sections) parts.push(sectionXml(section, styles, dna));
  return parts.join("");
}

/** Une section rédigée en XML Word, avec les styles du modèle. `withTitle: false` = corps seul. */
export function sectionXml(
  section: DocumentSpec["sections"][number],
  styles: DocxStyles,
  dna: DesignDna,
  withTitle = true,
): string {
  const parts: string[] = [];
  const heading =
    section.level === 3
      ? styles.heading3 ?? styles.heading2 ?? styles.heading1
      : section.level === 2
        ? styles.heading2 ?? styles.heading1
        : styles.heading1;
  if (withTitle) parts.push(paragraph(section.title, heading ?? styles.normal));
  if (section.quote) parts.push(paragraph(section.quote, styles.normal, true));
  for (const line of section.body) parts.push(paragraph(line, styles.normal));
  for (const item of section.bullets) parts.push(paragraph(item, styles.list ?? styles.normal));
  for (const [index, item] of (section.numbered ?? []).entries()) {
    parts.push(paragraph(`${index + 1}. ${item}`, styles.normal));
  }
  if (section.table) parts.push(tableXml(section.table.headers, section.table.rows, dna));
  if (section.chart) {
    parts.push(paragraph(section.chart.title, styles.heading2 ?? styles.heading1 ?? styles.normal));
    const headers = ["Catégorie", ...section.chart.series.map((item) => item.name)];
    const rows = section.chart.categories.map((category, index) => [
      category,
      ...section.chart!.series.map((item) => String(item.values[index] ?? "")),
    ]);
    parts.push(tableXml(headers, rows, dna));
  }
  return parts.join("");
}

function paragraph(text: string, style: string, italic = false): string {
  const runs = parseInline(text);
  const source = runs.length ? runs : [{ text, bold: false, italic: false }];
  const body = source
    .map((part) => {
      const bold = part.bold ? "<w:b/>" : "";
      const emph = italic || part.italic ? "<w:i/>" : "";
      const props = bold || emph ? `<w:rPr>${bold}${emph}</w:rPr>` : "";
      return `<w:r>${props}<w:t xml:space="preserve">${esc(part.text)}</w:t></w:r>`;
    })
    .join("");
  return `<w:p><w:pPr><w:pStyle w:val="${esc(style)}"/></w:pPr>${body}</w:p>`;
}

function tableXml(headers: string[], rows: string[][], dna: DesignDna): string {
  const cols = Math.max(1, headers.length);
  const width = Math.floor(9000 / cols);
  const grid = Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join("");
  const rowXml = (cells: string[], header: boolean, rowIndex = 0) =>
    `<w:tr>` +
    Array.from({ length: cols }, (_, index) => {
      const fill = header
        ? dna.tableHeaderFill
        : dna.zebra && rowIndex % 2
          ? dna.tableBodyFill
          : dna.canvas;
      const color = header ? dna.inverse : dna.text;
      return (
        `<w:tc>` +
        `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:fill="${fill}"/></w:tcPr>` +
        `<w:p><w:r><w:rPr><w:b w:val="${header ? "1" : "0"}"/><w:color w:val="${color}"/></w:rPr>` +
        `<w:t xml:space="preserve">${esc(cells[index] ?? "")}</w:t></w:r></w:p>` +
        `</w:tc>`
      );
    }).join("") +
    `</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowXml(headers, true)}${rows.map((row, index) => rowXml(row, false, index)).join("")}</w:tbl><w:p/>`;
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
