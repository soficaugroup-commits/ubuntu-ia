import JSZip from "jszip";
import { defaultDna, type DesignDna } from "@/lib/server/design-dna";
import type { DocumentSpec } from "@/lib/server/document-spec";

export async function cloneDocxWithSpec(
  template: Buffer,
  spec: DocumentSpec,
  dna: DesignDna = defaultDna(),
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("Modèle Word incomplet.");
  const original = await documentFile.async("string");
  const stylesXml = (await zip.file("word/styles.xml")?.async("string")) ?? "";
  const styleIds = [...stylesXml.matchAll(/w:styleId="([^"]+)"/g)].map((match) => match[1]);
  const heading1 = pickStyle(styleIds, ["Heading1", "Titre1", "Title", "Titre"]);
  const heading2 = pickStyle(styleIds, ["Heading2", "Titre2"]);
  const normal = pickStyle(styleIds, ["Normal", "Normal0"]) ?? "Normal";
  const list = pickStyle(styleIds, ["ListParagraph", "Paragraphedeliste", "ListBullet"]);
  const sectPr = /<w:sectPr[\s\S]*?<\/w:sectPr>/i.exec(original)?.[0] ?? "";
  const body = buildBody(spec, { heading1, heading2, normal, list }, dna) + sectPr;
  const next = replaceBody(original, body);
  zip.file("word/document.xml", next);
  return zip.generateAsync({ type: "uint8array" });
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

function buildBody(
  spec: DocumentSpec,
  styles: { heading1?: string; heading2?: string; normal: string; list?: string },
  dna: DesignDna,
): string {
  const parts: string[] = [];
  parts.push(paragraph(spec.title, styles.heading1 ?? styles.normal));
  if (spec.subtitle) parts.push(paragraph(spec.subtitle, styles.normal));
  for (const section of spec.sections) {
    parts.push(paragraph(section.title, styles.heading1 ?? styles.normal));
    for (const line of section.body) parts.push(paragraph(line, styles.normal));
    for (const item of section.bullets) {
      parts.push(paragraph(item, styles.list ?? styles.normal));
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
  }
  return parts.join("");
}

function paragraph(text: string, style: string): string {
  return (
    `<w:p>` +
    `<w:pPr><w:pStyle w:val="${esc(style)}"/></w:pPr>` +
    `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>` +
    `</w:p>`
  );
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
