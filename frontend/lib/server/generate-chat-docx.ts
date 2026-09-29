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
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { renderChartPng } from "@/lib/server/chart-png";
import { defaultDna, fitLogo, wordFont, type DesignDna } from "@/lib/server/design-dna";
import { BRAND, type DocumentSpec } from "@/lib/server/document-spec";
import { isLong } from "@/lib/server/document-process";
import { parseInline, plainInline } from "@/lib/server/rich-text";

const CONTENT_WIDTH = 9638;
const BODY_SPACING = { after: 160, line: 276, lineRule: LineRuleType.AUTO };

export async function buildDocx(spec: DocumentSpec, dna: DesignDna = defaultDna()): Promise<Uint8Array> {
  const font = wordFont(dna.headingFont);
  const content: (Paragraph | Table)[] = [];

  const bodyFont = wordFont(dna.bodyFont);
  if (isLong(spec)) {
    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 140 },
        children: [new TextRun({ text: "Plan", color: dna.primary, font })],
      }),
    );
    for (const section of spec.sections) {
      content.push(
        new Paragraph({
          numbering: { reference: "ubuntu-numbers", level: 0 },
          spacing: BODY_SPACING,
          children: [new TextRun({ text: section.title, color: dna.text, size: 22, font: bodyFont })],
        }),
      );
    }
  }
  if (spec.sections.length >= 3) {
    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 140 },
        children: [new TextRun({ text: "Sommaire", color: dna.primary, font })],
      }),
      new TableOfContents("Sommaire", { hyperlink: true, headingStyleRange: "1-3" }),
    );
  }
  for (const section of spec.sections) {
    content.push(
      new Paragraph({
        heading: headingFor(section.level),
        spacing: { before: section.level === 3 ? 180 : 280, after: 140, line: 276, lineRule: LineRuleType.AUTO },
        children: [new TextRun({ text: section.title, color: dna.primary, font })],
      }),
    );
    if (section.quote) {
      content.push(
        new Paragraph({
          spacing: { before: 120, after: 160 },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: dna.accent, space: 8 } },
          children: richRuns(section.quote, { size: 24, color: dna.primary, italics: true, font: bodyFont }),
        }),
      );
    }
    for (const paragraph of section.body) {
      content.push(...wordLines(paragraph, { size: 22, color: dna.text, font: bodyFont }));
    }
    section.bullets.forEach((item, index) => {
      content.push(
        new Paragraph({
          numbering: { reference: "ubuntu-bullets", level: section.bulletDepth?.[index] ? 1 : 0 },
          spacing: { after: 80 },
          children: richRuns(item, { size: 22, color: dna.text, font: bodyFont }),
        }),
      );
    });
    (section.numbered ?? []).forEach((item) => {
      content.push(
        new Paragraph({
          numbering: { reference: "ubuntu-numbers", level: 0 },
          spacing: { after: 80 },
          children: richRuns(item, { size: 22, color: dna.text, font: bodyFont }),
        }),
      );
    });
    if (section.table) {
      content.push(wordTable(section.table.headers, section.table.rows, dna));
      content.push(new Paragraph({ text: "" }));
    }
    if (section.chart) {
      content.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 120 },
          children: richRuns(section.chart.title, { size: 26, color: dna.accent, bold: true, font }),
        }),
      );
      const png = renderChartPng(section.chart, dna.chartColors);
      content.push(
        new Paragraph({
          spacing: { after: 160 },
          children: [
            new ImageRun({
              type: "png",
              data: png,
              transformation: { width: 520, height: 274 },
            }),
          ],
        }),
      );
      const headers = ["Catégorie", ...section.chart.series.map((item) => item.name)];
      const rows = section.chart.categories.map((category, index) => [
        category,
        ...section.chart!.series.map((item) => String(item.values[index] ?? "")),
      ]);
      content.push(wordTable(headers, rows, dna));
      content.push(new Paragraph({ text: "" }));
    }
  }

  const document = new Document({
    creator: "Ubuntu IA",
    title: spec.title,
    description: "Document généré par Ubuntu IA selon le skill docx.",
    numbering: {
      config: [
        {
          reference: "ubuntu-bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "\u2022",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: "\u2013",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 1080, hanging: 360 } } },
            },
          ],
        },
        {
          reference: "ubuntu-numbers",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      ...(spec.design?.couverture === false
        ? []
        : [
            {
              properties: {
                page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } },
              },
              children: [coverTable(spec, dna)],
            },
          ]),
      {
        properties: {
          page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 12, color: dna.accent, space: 6 },
                },
                spacing: { after: 200 },
                children: headerRuns(spec, dna, font),
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                border: {
                  top: { style: BorderStyle.SINGLE, size: 8, color: dna.accent, space: 6 },
                },
                children: [
                  new TextRun({ children: [PageNumber.CURRENT], color: dna.primary, size: 18 }),
                ],
              }),
            ],
          }),
        },
        children: content.length
          ? content
          : [new Paragraph({ alignment: AlignmentType.LEFT, text: spec.title })],
      },
    ],
  });
  return Packer.toBuffer(document);
}

function coverTable(spec: DocumentSpec, dna: DesignDna): Table {
  const logo = dna.logo;
  const logoSize = logo ? fitLogo(logo, 160, 64) : undefined;
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    rows: [
      new TableRow({
        height: { value: 12000, rule: HeightRule.ATLEAST },
        children: [
          new TableCell({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: dna.primary },
            margins: { top: 1600, bottom: 800, left: 600, right: 600 },
            children: [
              ...(logo && logoSize
                ? [
                    new Paragraph({
                      spacing: { after: 200 },
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
              ...(marks(spec, dna).eyebrow
                ? [
                    new Paragraph({
                      spacing: { after: 200 },
                      children: [
                        new TextRun({ text: marks(spec, dna).eyebrow, bold: true, color: dna.accent, size: 22 }),
                      ],
                    }),
                  ]
                : []),
              ...wordLines(spec.title, { size: 56, color: "FFFFFF", bold: true }),
              ...wordLines(spec.subtitle || marks(spec, dna).signature || "Ubuntu IA", { size: 24, color: dna.accent }),
              new Paragraph({
                spacing: { before: 800 },
                children: [
                  new TextRun({
                    text: marks(spec, dna).signature
                      ? `Document généré par Ubuntu IA pour ${marks(spec, dna).signature}`
                      : "Document généré par Ubuntu IA",
                    color: "DCE6EC",
                    size: 20,
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

function wordTable(headers: string[], rows: string[][], dna: DesignDna): Table {
  const columns = Math.max(1, headers.length);
  const colWidth = Math.floor(CONTENT_WIDTH / columns);
  const columnWidths = Array.from({ length: columns }, () => colWidth);
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths,
    rows: [
      new TableRow({
        children: headers.map((cell) => wordCell(cell, colWidth, true, dna)),
      }),
      ...rows.map(
        (row, rowIndex) =>
          new TableRow({
            children: Array.from({ length: columns }, (_, index) =>
              wordCell(row[index] ?? "", colWidth, false, dna, rowIndex),
            ),
          }),
      ),
    ],
  });
}

function marks(spec: DocumentSpec, dna: DesignDna): { eyebrow: string; signature: string } {
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

function headerRuns(spec: DocumentSpec, dna: DesignDna, font: string): TextRun[] {
  const label = marks(spec, dna);
  const runs: TextRun[] = [];
  if (label.eyebrow) {
    runs.push(new TextRun({ text: label.eyebrow.slice(0, 40), bold: true, color: dna.primary, size: 20, font }));
  }
  if (label.signature) {
    runs.push(
      new TextRun({
        text: `${label.eyebrow ? "  ·  " : ""}${label.signature}`,
        color: dna.accent,
        size: 20,
        font,
      }),
    );
  }
  if (!runs.length) runs.push(new TextRun({ text: "Ubuntu IA", bold: true, color: dna.primary, size: 20, font }));
  return runs;
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
  return source.map(
    (line) =>
        new Paragraph({
          spacing: BODY_SPACING,
          children: richRuns(line, run),
        }),
  );
}

function wordCell(text: string, width: number, header: boolean, dna: DesignDna, rowIndex = 0): TableCell {
  const bodyFill = dna.zebra && rowIndex % 2 === 1 ? dna.tableBodyFill : dna.canvas;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: {
      type: ShadingType.CLEAR,
      fill: header ? dna.tableHeaderFill : bodyFill,
    },
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: plainInline(text) || " ",
            bold: header,
            color: header ? dna.inverse : dna.text,
            size: 20,
          }),
        ],
      }),
    ],
  });
}
