import "server-only";
import { PDFDocument, PDFTextField, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import {
  documentMarks,
  formatDateFr,
  TOC_MIN_HEADINGS,
  type DocumentMarks,
} from "@/lib/server/brand/document-marks";
import {
  SOFICAU_COLORS,
  SOFICAU_PAGE,
  SOFICAU_PRODUCT,
  SOFICAU_TABLE,
  SOFICAU_TYPE,
  units,
} from "@/lib/server/brand/soficau-theme";
import { renderChartPng } from "@/lib/server/chart-png";
import { defaultDna, fitLogo, hexRgb, type DesignDna } from "@/lib/server/design-dna";
import type { DocChart, DocumentSpec, DocSection } from "@/lib/server/document-spec";
import { plainInline, toPdfText } from "@/lib/server/rich-text";

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = Math.round(units.mmToPt(SOFICAU_PAGE.marginMm));
const CONTENT_W = PAGE_W - 2 * MARGIN;
const TOP = PAGE_H - MARGIN - 18;
const BOTTOM = MARGIN + 16;
const TOC_PER_PAGE = 30;
/** Hauteur minimale à garder sous un titre : sinon il part en page suivante (pas de titre orphelin). */
const KEEP_WITH_TITLE = 3 * (SOFICAU_TYPE.body + 5);

type Palette = {
  primary: RGB;
  accent: RGB;
  text: RGB;
  muted: RGB;
  inverse: RGB;
  headerFill: RGB;
  zebra: RGB;
  rule: RGB;
  white: RGB;
};

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };

type TocEntry = { title: string; level: number; pageIndex: number };

function toRgb(hex: string): RGB {
  const { r, g, b } = hexRgb(hex);
  return rgb(r, g, b);
}

function palette(dna: DesignDna): Palette {
  return {
    primary: toRgb(dna.primary),
    accent: toRgb(dna.accent),
    text: toRgb(dna.text),
    muted: toRgb(dna.muted),
    inverse: toRgb(dna.inverse),
    headerFill: toRgb(dna.tableHeaderFill),
    zebra: toRgb(dna.zebra ? dna.tableBodyFill : SOFICAU_TABLE.bodyFill),
    rule: toRgb(SOFICAU_TABLE.border),
    white: toRgb(SOFICAU_COLORS.white),
  };
}

/** Curseur de mise en page : ajoute les pages au besoin et garde la position verticale. */
class Flow {
  page: PDFPage;
  y = TOP;
  readonly firstContentIndex: number;

  constructor(
    readonly pdf: PDFDocument,
    readonly fonts: Fonts,
    readonly colors: Palette,
  ) {
    this.firstContentIndex = pdf.getPageCount();
    this.page = pdf.addPage([PAGE_W, PAGE_H]);
  }

  get pageIndex(): number {
    return this.pdf.getPageCount() - 1;
  }

  newPage() {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.y = TOP;
  }

  ensure(height: number) {
    if (this.y - height < BOTTOM) this.newPage();
  }

  gap(height: number) {
    this.y -= height;
  }

  paragraph(text: string, options: { size?: number; font?: PDFFont; color?: RGB; indent?: number; after?: number } = {}) {
    const size = options.size ?? SOFICAU_TYPE.body;
    const font = options.font ?? this.fonts.regular;
    const indent = options.indent ?? 0;
    const leading = size * 1.35;
    for (const line of wrapLines(text, font, size, CONTENT_W - indent)) {
      this.ensure(leading);
      this.page.drawText(line, { x: MARGIN + indent, y: this.y - size, size, font, color: options.color ?? this.colors.text });
      this.y -= leading;
    }
    this.y -= options.after ?? SOFICAU_TYPE.paragraphAfter;
  }
}

export async function buildPdf(spec: DocumentSpec, dna: DesignDna = defaultDna()): Promise<Uint8Array> {
  const colors = palette(dna);
  const marks = documentMarks(spec, dna);
  const pdf = await PDFDocument.create();
  pdf.setTitle(plainInline(spec.title));
  pdf.setAuthor(SOFICAU_PRODUCT);
  pdf.setSubject(marks.signature || SOFICAU_PRODUCT);
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };

  const showCover = spec.design?.couverture !== false;
  if (showCover) {
    const cover = pdf.addPage([PAGE_W, PAGE_H]);
    drawCover(cover, spec, fonts, colors, marks, spec.design?.motif !== false);
    await drawLogo(pdf, cover, dna, MARGIN, PAGE_H - MARGIN);
  }

  const flow = new Flow(pdf, fonts, colors);
  const toc: TocEntry[] = [];
  const counters = { table: 0, figure: 0 };
  for (const section of spec.sections) {
    await drawSection(flow, section, dna, toc, counters);
  }

  const headings = toc.filter((entry) => entry.level <= 2);
  if (headings.length >= TOC_MIN_HEADINGS) {
    drawToc(pdf, headings, flow.firstContentIndex, fonts, colors);
  }
  decoratePages(pdf, spec, fonts, colors, marks, showCover ? 1 : 0);
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

async function drawSection(
  flow: Flow,
  section: DocSection,
  dna: DesignDna,
  toc: TocEntry[],
  counters: { table: number; figure: number },
) {
  const { fonts, colors } = flow;
  const level = section.level ?? 1;
  const size = level === 1 ? SOFICAU_TYPE.h1 : level === 2 ? SOFICAU_TYPE.h2 : SOFICAU_TYPE.h3;
  const titleLines = wrapLines(section.title, fonts.bold, size, CONTENT_W);
  flow.gap(level === 1 ? 14 : 8);
  flow.ensure(titleLines.length * size * 1.3 + KEEP_WITH_TITLE);
  toc.push({ title: plainInline(section.title), level, pageIndex: flow.pageIndex });
  flow.paragraph(section.title, { size, font: fonts.bold, color: level === 3 ? colors.muted : colors.primary, after: 6 });

  if (section.quote) {
    flow.paragraph(section.quote, { size: 12, font: fonts.italic, color: colors.primary, indent: 12 });
  }
  for (const paragraph of section.body) flow.paragraph(paragraph);
  section.bullets.forEach((item, index) => {
    const indent = section.bulletDepth?.[index] ? 28 : 12;
    flow.paragraph(`- ${plainInline(item)}`, { indent, after: 3 });
  });
  (section.numbered ?? []).forEach((item, index) => {
    flow.paragraph(`${index + 1}. ${plainInline(item)}`, { indent: 12, after: 3 });
  });

  if (section.table) {
    counters.table += 1;
    drawTable(flow, `Tableau ${counters.table} — ${plainInline(section.title)}`, section.table.headers, section.table.rows);
  }
  if (section.chart) {
    counters.figure += 1;
    await drawChart(flow, section.chart, dna, `Figure ${counters.figure} — ${plainInline(section.chart.title)}`);
    if (!section.table) {
      counters.table += 1;
      const headers = ["Catégorie", ...section.chart.series.map((item) => item.name)];
      const chart = section.chart;
      const rows = chart.categories.map((category, index) => [
        category,
        ...chart.series.map((item) => String(item.values[index] ?? "")),
      ]);
      drawTable(flow, `Tableau ${counters.table} — Données : ${plainInline(chart.title)}`, headers, rows);
    }
  }
}

function drawTable(flow: Flow, caption: string, headers: string[], rows: string[][]) {
  const { fonts, colors } = flow;
  const cols = Math.max(1, headers.length);
  const colW = CONTENT_W / cols;
  const size = SOFICAU_TYPE.table - 1;
  const pad = 4;
  const leading = size * 1.3;
  const measure = (cells: string[], font: PDFFont) =>
    cells.map((cell) => wrapLines(cell, font, size, colW - 2 * pad));
  const heightOf = (lines: string[][]) => Math.max(1, ...lines.map((cell) => cell.length)) * leading + 2 * pad;

  const headerLines = measure(headers, fonts.bold);
  const headerH = heightOf(headerLines);
  const firstRowH = rows.length ? heightOf(measure(headers.map((_, index) => rows[0][index] ?? ""), fonts.regular)) : 0;
  flow.gap(4);
  flow.ensure(SOFICAU_TYPE.small * 2 + headerH + firstRowH);
  flow.paragraph(caption, { size: SOFICAU_TYPE.small, font: fonts.italic, color: colors.muted, after: 4 });

  const drawRow = (lines: string[][], height: number, header: boolean, zebra: boolean) => {
    const fill = header ? colors.headerFill : zebra ? colors.zebra : colors.white;
    flow.page.drawRectangle({
      x: MARGIN,
      y: flow.y - height,
      width: CONTENT_W,
      height,
      color: fill,
      borderColor: colors.rule,
      borderWidth: 0.5,
    });
    lines.forEach((cell, index) => {
      cell.forEach((line, lineIndex) => {
        flow.page.drawText(line, {
          x: MARGIN + index * colW + pad,
          y: flow.y - pad - size - lineIndex * leading,
          size,
          font: header ? fonts.bold : fonts.regular,
          color: header ? colors.inverse : colors.text,
        });
      });
    });
    flow.y -= height;
  };

  drawRow(headerLines, headerH, true, false);
  rows.forEach((row, rowIndex) => {
    const lines = measure(headers.map((_, index) => row[index] ?? ""), fonts.regular);
    const height = heightOf(lines);
    if (flow.y - height < BOTTOM) {
      flow.newPage();
      drawRow(headerLines, headerH, true, false);
    }
    drawRow(lines, height, false, rowIndex % 2 === 1);
  });
  flow.gap(SOFICAU_TYPE.paragraphAfter + 4);
}

async function drawChart(flow: Flow, chart: DocChart, dna: DesignDna, caption: string) {
  const width = CONTENT_W;
  const height = Math.round((width * 280) / 640);
  flow.gap(4);
  flow.ensure(height + SOFICAU_TYPE.small * 2 + 8);
  try {
    const png = renderChartPng(chart, dna.chartColors, 640, 280, 2);
    const image = await flow.pdf.embedPng(png);
    flow.page.drawImage(image, { x: MARGIN, y: flow.y - height, width, height });
    flow.y -= height + 6;
  } catch (error) {
    console.error("[pdf] graphique", error);
  }
  flow.paragraph(caption, { size: SOFICAU_TYPE.small, font: flow.fonts.italic, color: flow.colors.muted });
}

function drawToc(pdf: PDFDocument, entries: TocEntry[], insertAt: number, fonts: Fonts, colors: Palette) {
  const pagesNeeded = Math.ceil(entries.length / TOC_PER_PAGE);
  const pages = Array.from({ length: pagesNeeded }, (_, index) => pdf.insertPage(insertAt + index, [PAGE_W, PAGE_H]));
  entries.forEach((entry, index) => {
    const page = pages[Math.floor(index / TOC_PER_PAGE)];
    const slot = index % TOC_PER_PAGE;
    if (slot === 0) {
      page.drawText("Sommaire", { x: MARGIN, y: TOP - SOFICAU_TYPE.h1, size: SOFICAU_TYPE.h1, font: fonts.bold, color: colors.primary });
    }
    const y = TOP - 48 - slot * 20;
    const indent = entry.level === 2 ? 16 : 0;
    const size = entry.level === 1 ? SOFICAU_TYPE.body : SOFICAU_TYPE.body - 1;
    const font = entry.level === 1 ? fonts.bold : fonts.regular;
    const pageLabel = String(entry.pageIndex + pagesNeeded + 1);
    const labelW = fonts.regular.widthOfTextAtSize(pageLabel, size);
    const title = truncate(toPdfText(entry.title), font, size, CONTENT_W - indent - labelW - 24);
    page.drawText(title, { x: MARGIN + indent, y, size, font, color: colors.text });
    const dotsStart = MARGIN + indent + font.widthOfTextAtSize(title, size) + 6;
    const dotsEnd = PAGE_W - MARGIN - labelW - 6;
    if (dotsEnd > dotsStart) {
      page.drawLine({
        start: { x: dotsStart, y: y + 2 },
        end: { x: dotsEnd, y: y + 2 },
        thickness: 0.6,
        color: colors.rule,
        dashArray: [1, 2],
      });
    }
    page.drawText(pageLabel, { x: PAGE_W - MARGIN - labelW, y, size, font: fonts.regular, color: colors.muted });
  });
}

function decoratePages(
  pdf: PDFDocument,
  spec: DocumentSpec,
  fonts: Fonts,
  colors: Palette,
  marks: DocumentMarks,
  skip: number,
) {
  const pages = pdf.getPages();
  const total = pages.length;
  const size = SOFICAU_TYPE.small;
  const title = truncate(toPdfText(plainInline(spec.title)), fonts.bold, size, CONTENT_W * 0.6);
  const entity = toPdfText(marks.signature);
  pages.forEach((page, index) => {
    if (index < skip) return;
    const headerY = PAGE_H - MARGIN + 4;
    page.drawText(title, { x: MARGIN, y: headerY, size, font: fonts.bold, color: colors.primary });
    if (entity) {
      const width = fonts.regular.widthOfTextAtSize(entity, size);
      page.drawText(entity, { x: PAGE_W - MARGIN - width, y: headerY, size, font: fonts.regular, color: colors.accent });
    }
    page.drawLine({
      start: { x: MARGIN, y: headerY - 5 },
      end: { x: PAGE_W - MARGIN, y: headerY - 5 },
      thickness: 0.8,
      color: colors.accent,
    });
    const label = `Page ${index + 1} / ${total}`;
    const labelW = fonts.regular.widthOfTextAtSize(label, size);
    page.drawLine({
      start: { x: MARGIN, y: MARGIN },
      end: { x: PAGE_W - MARGIN, y: MARGIN },
      thickness: 0.5,
      color: colors.rule,
    });
    page.drawText(label, { x: PAGE_W - MARGIN - labelW, y: MARGIN - size - 4, size, font: fonts.regular, color: colors.muted });
  });
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
  } catch (error) {
    console.error("[pdf] logo", error);
  }
}

function drawCover(
  page: PDFPage,
  spec: DocumentSpec,
  fonts: Fonts,
  colors: Palette,
  marks: DocumentMarks,
  motif: boolean,
) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: colors.primary });
  if (motif) {
    page.drawCircle({ x: 520, y: 760, size: 90, color: colors.accent, opacity: 0.9 });
    page.drawCircle({ x: 40, y: 80, size: 70, color: colors.accent, opacity: 0.35 });
  }
  if (marks.eyebrow) {
    page.drawText(toPdfText(marks.eyebrow), { x: 56, y: 520, size: 12, font: fonts.bold, color: colors.accent });
  }
  let y = 490;
  for (const line of wrapLines(spec.title, fonts.bold, SOFICAU_TYPE.title, 480)) {
    page.drawText(line, { x: 56, y: y - SOFICAU_TYPE.title, size: SOFICAU_TYPE.title, font: fonts.bold, color: colors.inverse });
    y -= SOFICAU_TYPE.title * 1.2;
  }
  if (spec.subtitle) {
    y -= 12;
    for (const line of wrapLines(spec.subtitle, fonts.regular, 13, 460).slice(0, 4)) {
      page.drawText(line, { x: 56, y: y - 13, size: 13, font: fonts.regular, color: colors.accent });
      y -= 18;
    }
  }
  const meta = toPdfText([marks.signature, formatDateFr()].filter(Boolean).join("  ·  "));
  page.drawText(meta, { x: 56, y: 84, size: 11, font: fonts.regular, color: toRgb(SOFICAU_COLORS.onNavyMuted) });
  page.drawText(`Document généré par ${SOFICAU_PRODUCT}`, {
    x: 56,
    y: 64,
    size: 9,
    font: fonts.regular,
    color: toRgb(SOFICAU_COLORS.onNavyMuted),
  });
}

export function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = toPdfText(plainInline(text)).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    while (font.widthOfTextAtSize(line, size) > maxWidth && line.length > 1) {
      const cut = fitLength(line, font, size, maxWidth);
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function fitLength(text: string, font: PDFFont, size: number, maxWidth: number): number {
  let cut = text.length;
  while (cut > 1 && font.widthOfTextAtSize(text.slice(0, cut), size) > maxWidth) cut -= 1;
  return cut;
}

function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const cut = fitLength(`${text}...`, font, size, maxWidth);
  return `${text.slice(0, Math.max(1, cut - 3))}...`;
}
