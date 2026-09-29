import "server-only";
import { PDFDocument, PDFTextField, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { renderChartPng } from "@/lib/server/chart-png";
import { defaultDna, fitLogo, hexRgb, type DesignDna } from "@/lib/server/design-dna";
import { BRAND, type DocumentSpec, type DocSection } from "@/lib/server/document-spec";
import { isLong } from "@/lib/server/document-process";
import { plainInline, toPdfText } from "@/lib/server/rich-text";

type PdfColors = {
  navy: ReturnType<typeof rgb>;
  gold: ReturnType<typeof rgb>;
  canvas: ReturnType<typeof rgb>;
  white: ReturnType<typeof rgb>;
  mid: ReturnType<typeof rgb>;
};

const PAGE_W = 595;
const PAGE_H = 842;

function pdfColors(dna: DesignDna): PdfColors {
  const primary = hexRgb(dna.primary);
  const accent = hexRgb(dna.accent);
  const canvas = hexRgb(dna.canvas);
  const inverse = hexRgb(dna.inverse);
  const muted = hexRgb(dna.muted);
  return {
    navy: rgb(primary.r, primary.g, primary.b),
    gold: rgb(accent.r, accent.g, accent.b),
    canvas: rgb(canvas.r, canvas.g, canvas.b),
    white: rgb(inverse.r, inverse.g, inverse.b),
    mid: rgb(muted.r, muted.g, muted.b),
  };
}

export async function buildPdf(spec: DocumentSpec, dna: DesignDna = defaultDna()): Promise<Uint8Array> {
  const colors = pdfColors(dna);
  const pdf = await PDFDocument.create();
  pdf.setTitle(spec.title);
  pdf.setAuthor("Ubuntu IA");
  pdf.setSubject("SOFICAU Ubuntu Group");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const showCover = spec.design?.couverture !== false;
  if (showCover) {
    const cover = pdf.addPage([PAGE_W, PAGE_H]);
    drawCover(cover, spec, font, bold, colors, dna);
    await drawLogo(pdf, cover, dna, 48, 740);
  }
  if (isLong(spec)) drawPlan(pdf, spec, font, bold, colors);
  for (const section of spec.sections) {
    await drawSection(pdf, section, font, bold, colors, dna, spec.design?.motif !== false);
  }
  return pdf.save();
}

export async function fillPdfForm(buffer: Buffer, spec: DocumentSpec): Promise<Uint8Array | null> {
  const pdf = await PDFDocument.load(buffer);
  const form = pdf.getForm();
  const fields = form.getFields();
  if (!fields.length) return null;
  const lines = [spec.title, spec.subtitle ?? "", ...spec.sections.flatMap((section) => [section.title, ...section.body, ...section.bullets])]
    .map((line) => toPdfText(plainInline(line)))
    .filter(Boolean);
  let cursor = 0;
  let filled = 0;
  for (const field of fields) {
    if (!(field instanceof PDFTextField)) continue;
    field.setText((lines[cursor] ?? "").slice(0, 400));
    cursor += 1;
    filled += 1;
  }
  if (!filled) return null;
  form.updateFieldAppearances();
  return pdf.save();
}

function drawPlan(
  pdf: PDFDocument,
  spec: DocumentSpec,
  font: PDFFont,
  bold: PDFFont,
  colors: PdfColors,
) {
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  fillCanvas(page, colors);
  page.drawText(toPdfText("Plan"), { x: 48, y: 780, size: 18, font: bold, color: colors.navy });
  let y = 740;
  for (const section of spec.sections) {
    if (y < 72) break;
    page.drawText(toPdfText(plainInline(section.title)).slice(0, 90), {
      x: 48,
      y,
      size: 11,
      font,
      color: colors.navy,
    });
    y -= 22;
  }
}

async function drawLogo(pdf: PDFDocument, page: PDFPage, dna: DesignDna, x: number, y: number) {
  if (!dna.logo) return;
  try {
    const image =
      dna.logo.mime === "image/png"
        ? await pdf.embedPng(dna.logo.bytes)
        : await pdf.embedJpg(dna.logo.bytes);
    const size = fitLogo(dna.logo, 96, 36);
    page.drawImage(image, { x, y: y - size.h, width: size.w, height: size.h });
  } catch {
    /* logo optionnel : un flux corrompu ne bloque pas le PDF */
  }
}

function drawCover(
  page: PDFPage,
  spec: DocumentSpec,
  font: PDFFont,
  bold: PDFFont,
  colors: PdfColors,
  dna: DesignDna,
) {
  const label = pdfMarks(spec, dna);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: colors.navy });
  if (spec.design?.motif !== false) {
    page.drawCircle({ x: 520, y: 760, size: 90, color: colors.gold, opacity: 0.9 });
    page.drawCircle({ x: 40, y: 80, size: 70, color: colors.gold, opacity: 0.35 });
  }
  if (label.eyebrow) {
    page.drawText(toPdfText(label.eyebrow), {
      x: 56,
      y: 520,
      size: 12,
      font: bold,
      color: colors.gold,
    });
  }
  wrapText(page, spec.title, 56, 470, 480, 26, bold, colors.white, 32);
  if (spec.subtitle) {
    wrapText(page, spec.subtitle, 56, 360, 460, 13, font, colors.gold, 14);
  }
  if (label.signature) {
    page.drawText(toPdfText(label.signature), {
      x: 56,
      y: 64,
      size: 11,
      font,
      color: colors.gold,
    });
  }
}

function pdfMarks(spec: DocumentSpec, dna: DesignDna): { eyebrow: string; signature: string } {
  const brand =
    dna.primary.toUpperCase() === BRAND.navy &&
    dna.accent.toUpperCase() === BRAND.gold &&
    !dna.headerLabel &&
    !dna.sourceName;
  return {
    eyebrow: spec.design?.marque?.trim() || dna.headerLabel?.trim() || (brand ? "UBUNTU IA" : ""),
    signature: spec.design?.signature?.trim() || (brand ? "SOFICAU Ubuntu Group" : dna.sourceName || ""),
  };
}

async function drawSection(
  pdf: PDFDocument,
  section: DocSection,
  font: PDFFont,
  bold: PDFFont,
  colors: PdfColors,
  dna: DesignDna,
  motif: boolean,
) {
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  fillCanvas(page, colors);
  if (motif) goldCorner(page, colors);
  let y = 780;
  y = wrapText(page, section.title, 48, y, 500, 20, bold, colors.navy, 26);
  y -= 16;

  const write = (text: string, size: number, face: PDFFont, color = colors.navy) => {
    if (y < 72) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      fillCanvas(page, colors);
      if (motif) goldCorner(page, colors);
      y = 780;
    }
    y = wrapText(page, text, 48, y, 500, size, face, color, size + 6);
  };

  if (section.quote) write(section.quote, 13, bold, colors.gold);
  for (const paragraph of section.body) write(paragraph, 11, font);
  for (const item of section.bullets) write(`- ${plainInline(item)}`, 11, font, colors.mid);
  for (const [index, item] of (section.numbered ?? []).entries()) {
    write(`${index + 1}. ${plainInline(item)}`, 11, font, colors.mid);
  }

  if (section.table) {
    y -= 10;
    const cols = Math.max(1, section.table.headers.length);
    const colW = 499 / cols;
    const drawRow = (cells: string[], header: boolean) => {
      if (y < 80) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        fillCanvas(page, colors);
        if (motif) goldCorner(page, colors);
        y = 780;
      }
      page.drawRectangle({
        x: 48,
        y: y - 16,
        width: 499,
        height: 20,
        color: header ? colors.navy : colors.white,
      });
      cells.forEach((cell, index) => {
        page.drawText(fitCell(cell, font, header ? bold : font, colW - 8), {
          x: 52 + index * colW,
          y: y - 10,
          size: 8,
          font: header ? bold : font,
          color: header ? colors.white : colors.navy,
        });
      });
      y -= 20;
    };
    drawRow(section.table.headers, true);
    for (const row of section.table.rows) {
      drawRow(section.table.headers.map((_, index) => row[index] ?? ""), false);
    }
    y -= 8;
  }

  if (section.chart) {
    y -= 8;
    write(section.chart.title, 12, bold, colors.gold);
    if (y < 220) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      fillCanvas(page, colors);
      if (motif) goldCorner(page, colors);
      y = 780;
    }
    try {
      const png = renderChartPng(section.chart, dna.chartColors, 640, 280);
      const image = await pdf.embedPng(png);
      const height = 180;
      page.drawImage(image, { x: 48, y: y - height, width: 420, height });
      y -= height + 12;
    } catch {
      /* le tableau de données reste lisible si l'image échoue */
    }
    const headers = ["Catégorie", ...section.chart.series.map((item) => item.name)];
    const rows = section.chart.categories.map((category, index) => [
      category,
      ...section.chart!.series.map((item) => String(item.values[index] ?? "")),
    ]);
    const cols = Math.max(1, headers.length);
    const colW = 499 / cols;
    const drawChartRow = (cells: string[], header: boolean) => {
      if (y < 80) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        fillCanvas(page, colors);
        if (motif) goldCorner(page, colors);
        y = 780;
      }
      page.drawRectangle({
        x: 48,
        y: y - 16,
        width: 499,
        height: 20,
        color: header ? colors.navy : colors.white,
      });
      cells.forEach((cell, index) => {
        page.drawText(fitCell(cell, header ? bold : font, header ? bold : font, colW - 8), {
          x: 52 + index * colW,
          y: y - 10,
          size: 8,
          font: header ? bold : font,
          color: header ? colors.white : colors.navy,
        });
      });
      y -= 20;
    };
    drawChartRow(headers, true);
    for (const row of rows) drawChartRow(row, false);
  }
}

function fillCanvas(page: PDFPage, colors: PdfColors) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: colors.canvas });
}

function goldCorner(page: PDFPage, colors: PdfColors) {
  page.drawCircle({ x: 575, y: 820, size: 36, color: colors.gold, opacity: 0.85 });
}

function fitCell(text: string, _font: PDFFont, _bold: PDFFont, _maxWidth: number): string {
  return toPdfText(plainInline(text));
}

function wrapText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
  lineGap: number,
): number {
  const words = toPdfText(plainInline(text)).split(/\s+/).filter(Boolean);
  let line = "";
  let cursor = y;
  const flush = () => {
    if (!line) return;
    page.drawText(line, { x, y: cursor, size, font, color });
    cursor -= lineGap;
    line = "";
  };
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth) flush();
    line = line ? `${line} ${word}` : word;
  }
  flush();
  return cursor;
}

