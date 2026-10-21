import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  HeightRule,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from "docx";
import {
  documentMarks,
  formatDateFr,
  tocHeadingCount,
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
import { defaultDna, fitLogo, wordFont, type DesignDna } from "@/lib/server/design-dna";
import type { DocChart, DocumentSpec } from "@/lib/server/document-spec";
import { parseInline, plainInline } from "@/lib/server/rich-text";

const MARGIN = units.mmToTwip(SOFICAU_PAGE.marginMm);
const CONTENT_WIDTH = units.mmToTwip(SOFICAU_PAGE.widthMm) - 2 * MARGIN;
const BODY_SIZE = units.ptToHalfPt(SOFICAU_TYPE.body);
const SMALL_SIZE = units.ptToHalfPt(SOFICAU_TYPE.small);
const TABLE_SIZE = units.ptToHalfPt(SOFICAU_TYPE.table);
const BODY_SPACING = {
  after: units.ptToTwip(SOFICAU_TYPE.paragraphAfter),
  line: Math.round(240 * SOFICAU_TYPE.lineHeight),
  lineRule: LineRuleType.AUTO,
};
const CHART_W = 720;
const CHART_H = 380;
const CHART_DISPLAY_W = 560;

type Fonts = { heading: string; body: string };
type Counters = { table: number; figure: number };

export async function buildDocx(spec: DocumentSpec, dna: DesignDna = defaultDna()): Promise<Uint8Array> {
  const fonts: Fonts = { heading: wordFont(dna.headingFont), body: wordFont(dna.bodyFont) };
  const marks = documentMarks(spec, dna);
  const withToc = tocHeadingCount(spec) >= TOC_MIN_HEADINGS;
  const content = [...(withToc ? tocBlock(dna, fonts) : []), ...bodyBlocks(spec, dna, fonts)];

  const document = new Document({
    creator: SOFICAU_PRODUCT,
    title: plainInline(spec.title),
    description: `Document généré par ${SOFICAU_PRODUCT}.`,
    features: withToc ? { updateFields: true } : undefined,
    styles: documentStyles(dna, fonts),
    numbering: numberingConfig(),
    sections: [
      ...(spec.design?.couverture === false
        ? []
        : [
            {
              properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
              children: [coverTable(spec, dna, marks)],
            },
          ]),
      {
        properties: { page: { margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
        headers: { default: pageHeader(spec, dna, fonts, marks) },
        footers: { default: pageFooter(dna, fonts) },
        children: content.length ? content : [new Paragraph({ text: plainInline(spec.title) })],
      },
    ],
  });
  return Packer.toBuffer(document);
}

function documentStyles(dna: DesignDna, fonts: Fonts) {
  const heading = (size: number, before: number, color: string) => ({
    run: { font: fonts.heading, size: units.ptToHalfPt(size), bold: true, color },
    paragraph: { spacing: { before, after: 120 }, keepNext: true, keepLines: true },
  });
  return {
    default: {
      document: { run: { font: fonts.body, size: BODY_SIZE, color: dna.text } },
      heading1: heading(SOFICAU_TYPE.h1, 360, dna.primary),
      heading2: heading(SOFICAU_TYPE.h2, 240, dna.primary),
      heading3: heading(SOFICAU_TYPE.h3, 200, dna.muted),
    },
    paragraphStyles: [
      {
        id: "Caption",
        name: "caption",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: fonts.body, size: SMALL_SIZE, italics: true, color: dna.muted },
        paragraph: { spacing: { before: 60, after: 160 } },
      },
    ],
  };
}

function numberingConfig() {
  const level = (index: number, format: (typeof LevelFormat)[keyof typeof LevelFormat], text: string) => ({
    level: index,
    format,
    text,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 + index * 360, hanging: 360 } } },
  });
  return {
    config: [
      {
        reference: "ubuntu-bullets",
        levels: [level(0, LevelFormat.BULLET, "\u2022"), level(1, LevelFormat.BULLET, "\u2013")],
      },
      { reference: "ubuntu-numbers", levels: [level(0, LevelFormat.DECIMAL, "%1.")] },
    ],
  };
}

function tocBlock(dna: DesignDna, fonts: Fonts): (Paragraph | TableOfContents)[] {
  return [
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: "Sommaire",
          bold: true,
          size: units.ptToHalfPt(SOFICAU_TYPE.h1),
          color: dna.primary,
          font: fonts.heading,
        }),
      ],
    }),
    new TableOfContents("Sommaire", { hyperlink: true, headingStyleRange: "1-2" }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function bodyBlocks(spec: DocumentSpec, dna: DesignDna, fonts: Fonts): (Paragraph | Table)[] {
  const content: (Paragraph | Table)[] = [];
  const counters: Counters = { table: 0, figure: 0 };
  const run = { size: BODY_SIZE, color: dna.text, font: fonts.body };
  for (const section of spec.sections) {
    content.push(
      new Paragraph({
        heading: headingFor(section.level),
        children: [new TextRun({ text: plainInline(section.title) })],
      }),
    );
    if (section.quote) {
      content.push(
        new Paragraph({
          spacing: { before: 120, after: 160 },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: dna.accent, space: 8 } },
          children: richRuns(section.quote, { ...run, size: units.ptToHalfPt(12), color: dna.primary, italics: true }),
        }),
      );
    }
    for (const paragraph of section.body) content.push(...wordLines(paragraph, run));
    section.bullets.forEach((item, index) => {
      content.push(
        new Paragraph({
          numbering: { reference: "ubuntu-bullets", level: section.bulletDepth?.[index] ? 1 : 0 },
          spacing: { after: 80 },
          children: richRuns(item, run),
        }),
      );
    });
    (section.numbered ?? []).forEach((item) => {
      content.push(
        new Paragraph({
          numbering: { reference: "ubuntu-numbers", level: 0 },
          spacing: { after: 80 },
          children: richRuns(item, run),
        }),
      );
    });
    if (section.table) {
      counters.table += 1;
      content.push(caption(`Tableau ${counters.table} — ${plainInline(section.title)}`, true));
      content.push(wordTable(section.table.headers, section.table.rows, dna, fonts));
      content.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    }
    if (section.chart) {
      counters.figure += 1;
      content.push(...chartBlock(section.chart, dna, fonts, counters, !section.table));
    }
  }
  return content;
}

function chartBlock(
  chart: DocChart,
  dna: DesignDna,
  fonts: Fonts,
  counters: Counters,
  withData: boolean,
): (Paragraph | Table)[] {
  const png = renderChartPng(chart, dna.chartColors, CHART_W, CHART_H, 2);
  const blocks: (Paragraph | Table)[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 160, after: 60 },
      children: [
        new ImageRun({
          type: "png",
          data: png,
          transformation: { width: CHART_DISPLAY_W, height: Math.round((CHART_DISPLAY_W * CHART_H) / CHART_W) },
        }),
      ],
    }),
    caption(`Figure ${counters.figure} — ${plainInline(chart.title)}`, false),
  ];
  if (withData) {
    counters.table += 1;
    const headers = ["Catégorie", ...chart.series.map((item) => item.name)];
    const rows = chart.categories.map((category, index) => [
      category,
      ...chart.series.map((item) => String(item.values[index] ?? "")),
    ]);
    blocks.push(caption(`Tableau ${counters.table} — Données : ${plainInline(chart.title)}`, true));
    blocks.push(wordTable(headers, rows, dna, fonts));
    blocks.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  }
  return blocks;
}

function caption(text: string, keepNext: boolean): Paragraph {
  return new Paragraph({ style: "Caption", keepNext, children: [new TextRun({ text })] });
}

function pageHeader(spec: DocumentSpec, dna: DesignDna, fonts: Fonts, marks: DocumentMarks): Header {
  const title = plainInline(spec.title).slice(0, 70);
  return new Header({
    children: [
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: dna.accent, space: 4 } },
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
        children: [
          new TextRun({ text: title, bold: true, color: dna.primary, size: SMALL_SIZE, font: fonts.heading }),
          ...(marks.signature
            ? [new TextRun({ text: `\t${marks.signature}`, color: dna.accent, size: SMALL_SIZE, font: fonts.body })]
            : []),
        ],
      }),
    ],
  });
}

function pageFooter(dna: DesignDna, fonts: Fonts): Footer {
  const style = { color: dna.muted, size: SMALL_SIZE, font: fonts.body };
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: SOFICAU_TABLE.border, space: 4 } },
        children: [
          new TextRun({ ...style, children: ["Page ", PageNumber.CURRENT, " sur ", PageNumber.TOTAL_PAGES] }),
        ],
      }),
    ],
  });
}

function coverTable(spec: DocumentSpec, dna: DesignDna, marks: DocumentMarks): Table {
  const logo = dna.logo;
  const logoSize = logo ? fitLogo(logo, 160, 64) : undefined;
  const width = units.mmToTwip(SOFICAU_PAGE.widthMm) - 2 * 720;
  const meta = [marks.signature, formatDateFr()].filter(Boolean).join("  ·  ");
  return new Table({
    width: { size: width, type: WidthType.DXA },
    columnWidths: [width],
    rows: [
      new TableRow({
        height: { value: 14800, rule: HeightRule.ATLEAST },
        children: [
          new TableCell({
            width: { size: width, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: dna.primary },
            margins: { top: 1600, bottom: 800, left: 600, right: 600 },
            children: [
              ...(logo && logoSize
                ? [
                    new Paragraph({
                      spacing: { after: 400 },
                      children: [
                        new ImageRun({
                          type: logo.mime === "image/png" ? "png" : "jpg",
                          data: logo.bytes,
                          transformation: { width: logoSize.w, height: logoSize.h },
                        }),
                      ],
                    }),
                  ]
                : []),
              ...(marks.eyebrow
                ? [
                    new Paragraph({
                      spacing: { after: 200 },
                      children: [new TextRun({ text: marks.eyebrow, bold: true, color: dna.accent, size: 22 })],
                    }),
                  ]
                : []),
              ...wordLines(spec.title, { size: units.ptToHalfPt(SOFICAU_TYPE.title), color: dna.inverse, bold: true }),
              ...(spec.subtitle ? wordLines(spec.subtitle, { size: 24, color: dna.accent }) : []),
              new Paragraph({
                spacing: { before: 1200 },
                children: [new TextRun({ text: meta, color: SOFICAU_COLORS.onNavyMuted, size: 22 })],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Document généré par ${SOFICAU_PRODUCT}`,
                    color: SOFICAU_COLORS.onNavyMuted,
                    size: SMALL_SIZE,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function wordTable(headers: string[], rows: string[][], dna: DesignDna, fonts: Fonts): Table {
  const columns = Math.max(1, headers.length);
  const colWidth = Math.floor(CONTENT_WIDTH / columns);
  const line = { style: BorderStyle.SINGLE, size: SOFICAU_TABLE.borderSize, color: SOFICAU_TABLE.border };
  return new Table({
    width: { size: colWidth * columns, type: WidthType.DXA },
    columnWidths: Array.from({ length: columns }, () => colWidth),
    borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: headers.map((cell) => wordCell(cell, colWidth, true, dna, fonts)),
      }),
      ...rows.map(
        (row, rowIndex) =>
          new TableRow({
            cantSplit: true,
            children: Array.from({ length: columns }, (_, index) =>
              wordCell(row[index] ?? "", colWidth, false, dna, fonts, rowIndex),
            ),
          }),
      ),
    ],
  });
}

function wordCell(
  text: string,
  width: number,
  header: boolean,
  dna: DesignDna,
  fonts: Fonts,
  rowIndex = 0,
): TableCell {
  const fill = header
    ? dna.tableHeaderFill
    : dna.zebra && rowIndex % 2 === 1
      ? dna.tableBodyFill
      : SOFICAU_TABLE.bodyFill;
  const value = plainInline(text);
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({
        alignment: !header && isNumeric(value) ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [
          new TextRun({
            text: value || " ",
            bold: header,
            color: header ? dna.inverse : dna.text,
            size: TABLE_SIZE,
            font: fonts.body,
          }),
        ],
      }),
    ],
  });
}

function isNumeric(value: string): boolean {
  return /^[-+]?[\d\s\u00a0\u202f.,]+\s?(%|€|FCFA|XOF|XAF|\$)?$/i.test(value.trim()) && /\d/.test(value);
}

function headingFor(level: 1 | 2 | 3 | undefined): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  if (level === 2) return HeadingLevel.HEADING_2;
  if (level === 3) return HeadingLevel.HEADING_3;
  return HeadingLevel.HEADING_1;
}

function richRuns(
  text: string,
  run: { size: number; color: string; bold?: boolean; italics?: boolean; font?: string },
): TextRun[] {
  const parts = parseInline(text);
  const source = parts.length ? parts : [{ text }];
  return source.map(
    (part) =>
      new TextRun({
        text: part.text,
        bold: run.bold || part.bold,
        italics: run.italics || part.italic,
        color: run.color,
        size: run.size,
        font: run.font,
      }),
  );
}

function wordLines(
  text: string,
  run: { size: number; color: string; bold?: boolean; font?: string },
): Paragraph[] {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const source = lines.length ? lines : [text];
  return source.map((line) => new Paragraph({ spacing: BODY_SPACING, children: richRuns(line, run) }));
}
