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
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { defaultDna, fitLogo, wordFont, type DesignDna } from "@/lib/server/design-dna";
import type { DocumentSpec } from "@/lib/server/document-spec";

const CONTENT_WIDTH = 9638;

export async function buildDocx(spec: DocumentSpec, dna: DesignDna = defaultDna()): Promise<Uint8Array> {
  const font = wordFont(dna.headingFont);
  const content: (Paragraph | Table)[] = [];

  for (const section of spec.sections) {
    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 140 },
        children: [new TextRun({ text: section.title, bold: true, color: dna.primary, font })],
      }),
    );
    for (const paragraph of section.body) {
      content.push(...wordLines(paragraph, { size: 22, color: dna.text, font: wordFont(dna.bodyFont) }));
    }
    for (const item of section.bullets) {
      content.push(
        new Paragraph({
          numbering: { reference: "ubuntu-bullets", level: 0 },
          spacing: { after: 80 },
          children: [new TextRun({ text: item, color: dna.text, size: 22, font: wordFont(dna.bodyFont) })],
        }),
      );
    }
    if (section.table) {
      content.push(wordTable(section.table.headers, section.table.rows, dna));
      content.push(new Paragraph({ text: "" }));
    }
    if (section.chart) {
      content.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 120 },
          children: [new TextRun({ text: section.chart.title, bold: true, color: dna.accent, font })],
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
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } },
        },
        children: [coverTable(spec, dna)],
      },
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
                children: [
                  new TextRun({ text: dna.headerLabel?.slice(0, 40) || "Ubuntu IA", bold: true, color: dna.primary, size: 20, font }),
                  new TextRun({ text: "  ·  SOFICAU Ubuntu Group", color: dna.accent, size: 20, font }),
                ],
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
              new Paragraph({
                spacing: { after: 200 },
                children: [
                  new TextRun({ text: "UBUNTU IA", bold: true, color: dna.accent, size: 22 }),
                ],
              }),
              ...wordLines(spec.title, { size: 56, color: "FFFFFF", bold: true }),
              ...wordLines(spec.subtitle || "SOFICAU Ubuntu Group", { size: 24, color: dna.accent }),
              new Paragraph({
                spacing: { before: 800 },
                children: [
                  new TextRun({
                    text: "Document professionnel généré pour SOFICAU Ubuntu Group",
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

function wordLines(
  text: string,
  run: { size: number; color: string; bold?: boolean; font?: string },
): Paragraph[] {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const source = lines.length ? lines : [text];
  return source.map(
    (line) =>
      new Paragraph({
        spacing: { after: 160 },
        children: [new TextRun({ text: line, ...run })],
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
            text: text || " ",
            bold: header,
            color: header ? dna.inverse : dna.text,
            size: 20,
          }),
        ],
      }),
    ],
  });
}
