import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { defaultDna, fitLogo, hexRgb, type DesignDna } from "@/lib/server/design-dna";
import { type DocumentSpec, type DocSection } from "@/lib/server/document-spec";

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

  const cover = pdf.addPage([PAGE_W, PAGE_H]);
  drawCover(cover, spec, font, bold, colors);
  await drawLogo(pdf, cover, dna, 48, 740);
  for (const section of spec.sections) {
    drawSection(pdf, section, font, bold, colors);
  }
  return pdf.save();
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

function drawCover(page: PDFPage, spec: DocumentSpec, font: PDFFont, bold: PDFFont, colors: PdfColors) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: colors.navy });
  page.drawCircle({ x: 520, y: 760, size: 90, color: colors.gold, opacity: 0.9 });
  page.drawCircle({ x: 40, y: 80, size: 70, color: colors.gold, opacity: 0.35 });
  page.drawText("UBUNTU IA", {
    x: 56,
    y: 520,
    size: 12,
    font: bold,
    color: colors.gold,
  });
  wrapText(page, spec.title, 56, 470, 480, 26, bold, colors.white, 32);
  if (spec.subtitle) {
    wrapText(page, spec.subtitle, 56, 360, 460, 13, font, colors.gold, 14);
  }
  page.drawText(winAnsi("SOFICAU Ubuntu Group"), {
    x: 56,
    y: 64,
    size: 11,
    font,
    color: colors.gold,
  });
}

function drawSection(pdf: PDFDocument, section: DocSection, font: PDFFont, bold: PDFFont, colors: PdfColors) {
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  fillCanvas(page, colors);
  goldCorner(page, colors);
  let y = 780;
  y = wrapText(page, section.title, 48, y, 500, 20, bold, colors.navy, 26);
  y -= 16;

  const write = (text: string, size: number, face: PDFFont, color = colors.navy) => {
    if (y < 72) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      fillCanvas(page, colors);
      goldCorner(page, colors);
      y = 780;
    }
    y = wrapText(page, text, 48, y, 500, size, face, color, size + 6);
  };

  for (const paragraph of section.body) write(paragraph, 11, font);
  for (const item of section.bullets) write(`- ${item}`, 11, font, colors.mid);

  if (section.table) {
    y -= 10;
    const cols = Math.max(1, section.table.headers.length);
    const colW = 499 / cols;
    const drawRow = (cells: string[], header: boolean) => {
      if (y < 80) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        fillCanvas(page, colors);
        goldCorner(page, colors);
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
        page.drawText(winAnsi(cell).slice(0, 28), {
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
    for (const row of section.table.rows.slice(0, 16)) {
      drawRow(section.table.headers.map((_, index) => row[index] ?? ""), false);
    }
    y -= 8;
  }

  if (section.chart) {
    y -= 8;
    write(section.chart.title, 12, bold, colors.gold);
    const max = Math.max(
      1,
      ...section.chart.series.flatMap((series) => series.values),
    );
    section.chart.categories.slice(0, 8).forEach((category, index) => {
      if (y < 90) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        fillCanvas(page, colors);
        goldCorner(page, colors);
        y = 780;
      }
      const value = section.chart!.series[0]?.values[index] ?? 0;
      const barW = Math.max(4, (value / max) * 320);
      page.drawText(winAnsi(category).slice(0, 22), {
        x: 48,
        y: y,
        size: 9,
        font,
        color: colors.navy,
      });
      page.drawRectangle({ x: 200, y: y - 2, width: barW, height: 10, color: index % 2 === 0 ? colors.navy : colors.gold });
      page.drawText(winAnsi(String(value)), {
        x: 208 + barW,
        y: y,
        size: 8,
        font: bold,
        color: colors.navy,
      });
      y -= 18;
    });
  }
}

function fillCanvas(page: PDFPage, colors: PdfColors) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: colors.canvas });
}

function goldCorner(page: PDFPage, colors: PdfColors) {
  page.drawCircle({ x: 575, y: 820, size: 36, color: colors.gold, opacity: 0.85 });
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
  const words = winAnsi(text).split(/\s+/).filter(Boolean);
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

function winAnsi(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}
