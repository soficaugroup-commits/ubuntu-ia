import "server-only";
import ExcelJS from "exceljs";
import type { PreparedAttachment } from "@/lib/server/chat-attachments";
import { argb, defaultDna, type DesignDna } from "@/lib/server/design-dna";
import type { DocumentSpec } from "@/lib/server/document-spec";

type SheetColors = {
  navy: string;
  gold: string;
  canvas: string;
  white: string;
  mid: string;
  font: string;
};

export async function buildXlsx(
  spec: DocumentSpec,
  attachments: PreparedAttachment[],
  dna: DesignDna = defaultDna(),
): Promise<Uint8Array> {
  const colors: SheetColors = {
    navy: argb(dna.primary),
    gold: argb(dna.accent),
    canvas: argb(dna.canvas),
    white: argb(dna.inverse),
    mid: argb(dna.muted),
    font: dna.bodyFont,
  };
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Ubuntu IA";
  workbook.created = new Date();

  const original = attachments.find(
    (item) =>
      item.buffer &&
      (item.mime.includes("spreadsheet") ||
        item.name.toLowerCase().endsWith(".xlsx") ||
        item.name.toLowerCase().endsWith(".xlsm")),
  );
  let loaded = false;
  if (original?.buffer) {
    try {
      await workbook.xlsx.load(original.buffer as unknown as ExcelJS.Buffer);
      loaded = workbook.worksheets.length > 0;
    } catch {
      workbook.worksheets.forEach((sheet) => workbook.removeWorksheet(sheet.id));
      loaded = false;
    }
  }

  if (loaded) {
    restyleExistingSheets(workbook, colors);
    if (!workbook.getWorksheet("Synthèse")) writeDashboard(workbook, spec, colors);
  } else {
    writeDashboard(workbook, spec, colors);
  }

  spec.sections.forEach((section, index) => {
    if (!section.table && !section.chart) return;
    const name =
      sheetName(section.title, index) === "Synthèse"
        ? sheetName(`${section.title} donnees`, index)
        : sheetName(section.title, index);
    const existing = workbook.getWorksheet(name);
    if (loaded && existing) return;
    const sheet = existing ?? workbook.addWorksheet(name);
    if (section.table) writeDataSheet(sheet, section.title, section.table.headers, section.table.rows, colors);
    else if (section.chart) {
      const headers = [section.chart.title, ...section.chart.series.map((item) => item.name)];
      const rows = section.chart.categories.map((category, rowIndex) => [
        category,
        ...section.chart!.series.map((item) => String(item.values[rowIndex] ?? "")),
      ]);
      writeDataSheet(sheet, section.title, headers, rows, colors);
    }
  });

  if (workbook.worksheets.length === 0) {
    workbook.addWorksheet("Ubuntu IA").getCell("A1").value = spec.title;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

function restyleExistingSheets(workbook: ExcelJS.Workbook, colors: SheetColors) {
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        const prev = cell.font ?? {};
        const fillArgb = solidFill(cell);
        cell.font = {
          name: colors.font,
          bold: prev.bold,
          italic: prev.italic,
          size: prev.size,
          color: prev.color,
        };
        if (!fillArgb) return;
        const headerLike = isDarkArgb(fillArgb) || Boolean(prev.bold);
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: headerLike ? colors.navy : colors.canvas },
        };
        cell.font = {
          name: colors.font,
          bold: prev.bold,
          italic: prev.italic,
          size: prev.size,
          color: { argb: headerLike ? colors.white : colors.navy },
        };
      });
    });
  });
}

function solidFill(cell: ExcelJS.Cell): string | undefined {
  const fill = cell.fill;
  if (!fill || fill.type !== "pattern") return undefined;
  const argb = fill.fgColor?.argb;
  return typeof argb === "string" && /^[0-9A-Fa-f]{6,8}$/.test(argb) ? argb.slice(-6).toUpperCase() : undefined;
}

function isDarkArgb(value: string): boolean {
  const n = Number.parseInt(value.slice(-6), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return r * 0.299 + g * 0.587 + b * 0.114 < 140;
}

function writeDashboard(workbook: ExcelJS.Workbook, spec: DocumentSpec, colors: SheetColors) {
  const existing = workbook.getWorksheet("Synthèse");
  if (existing) workbook.removeWorksheet(existing.id);
  const sheet = workbook.addWorksheet("Synthèse", { properties: { tabColor: { argb: colors.navy } } });
  sheet.views = [{ showGridLines: false, zoomScale: 110 }];
  sheet.getColumn(1).width = 3;
  for (let col = 2; col <= 8; col += 1) sheet.getColumn(col).width = 18;

  mergeFill(sheet, "B2:H3", spec.title, {
    bold: true,
    size: 20,
    color: colors.white,
    fill: colors.navy,
    align: "left",
  }, colors);
  mergeFill(sheet, "B4:H4", spec.subtitle || "SOFICAU Ubuntu Group  ·  Ubuntu IA", {
    size: 11,
    color: colors.gold,
    fill: colors.navy,
    align: "left",
  }, colors);

  const kpis = dashboardKpis(spec);
  kpis.forEach((kpi, index) => {
    const col = 2 + index * 2;
    const letter = colLetter(col);
    const next = colLetter(col + 1);
    mergeFill(sheet, `${letter}6:${next}7`, kpi.value, {
      bold: true,
      size: 18,
      color: colors.white,
      fill: index % 2 === 0 ? colors.navy : colors.gold,
      align: "center",
    }, colors);
    mergeFill(sheet, `${letter}8:${next}8`, kpi.label, {
      size: 9,
      color: colors.navy,
      fill: colors.canvas,
      align: "center",
    }, colors);
  });

  let row = 11;
  sheet.getCell(`B${row}`).value = "Sommaire";
  styleCell(sheet.getCell(`B${row}`), { bold: true, size: 14, color: colors.navy }, colors);
  row += 1;
  spec.sections.forEach((section, index) => {
    sheet.getCell(`B${row}`).value = `${index + 1}. ${section.title}`;
    styleCell(sheet.getCell(`B${row}`), { size: 11, color: colors.navy, fill: index % 2 === 0 ? colors.canvas : colors.white }, colors);
    sheet.getCell(`C${row}`).value = section.bullets[0] || section.body[0] || "";
    styleCell(sheet.getCell(`C${row}`), { size: 11, color: colors.mid }, colors);
    row += 1;
  });

  sheet.getCell("B28").value = "Source : contenu validé dans la conversation Ubuntu IA. Les totaux des feuilles de données sont des formules SUM.";
  styleCell(sheet.getCell("B28"), { size: 9, color: colors.gold }, colors);
}

function writeDataSheet(
  sheet: ExcelJS.Worksheet,
  title: string,
  headers: string[],
  rows: string[][],
  colors: SheetColors,
) {
  sheet.spliceRows(1, sheet.rowCount || 1);
  sheet.views = [{ state: "frozen", ySplit: 3, showGridLines: false }];
  const lastCol = Math.max(1, headers.length);
  sheet.mergeCells(1, 1, 1, lastCol);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  styleCell(titleCell, { bold: true, size: 16, color: colors.white, fill: colors.navy, align: "left" }, colors);
  sheet.getRow(1).height = 28;

  const header = sheet.getRow(3);
  headers.forEach((name, index) => {
    const cell = header.getCell(index + 1);
    cell.value = name;
    styleCell(cell, { bold: true, size: 11, color: colors.white, fill: colors.navy, align: "center" }, colors);
    sheet.getColumn(index + 1).width = index === 0 ? 28 : 16;
  });

  rows.forEach((line, rowIndex) => {
    const excelRow = sheet.getRow(4 + rowIndex);
    headers.forEach((_, colIndex) => {
      const raw = line[colIndex] ?? "";
      const numeric = toNumber(raw);
      const cell = excelRow.getCell(colIndex + 1);
      cell.value = numeric ?? raw;
      styleCell(cell, {
        size: 11,
        color: colors.navy,
        fill: rowIndex % 2 === 0 ? colors.white : colors.canvas,
        align: colIndex === 0 ? "left" : "center",
      }, colors);
    });
  });

  const firstData = 4;
  const lastData = 3 + rows.length;
  if (rows.length >= 2 && lastCol >= 2) {
    const totalRow = lastData + 1;
    sheet.getCell(totalRow, 1).value = "Total";
    styleCell(sheet.getCell(totalRow, 1), { bold: true, size: 11, color: colors.white, fill: colors.gold }, colors);
    for (let col = 2; col <= lastCol; col += 1) {
      const letter = colLetter(col);
      const values = rows.map((line) => toNumber(line[col - 1]));
      if (values.every((value) => value === null)) continue;
      const cell = sheet.getCell(totalRow, col);
      cell.value = { formula: `SUM(${letter}${firstData}:${letter}${lastData})` };
      styleCell(cell, { bold: true, size: 11, color: colors.white, fill: colors.gold, align: "center" }, colors);
    }
  }
}

function dashboardKpis(spec: DocumentSpec): { value: string; label: string }[] {
  const fromCharts = spec.charts.flatMap((chart) =>
    chart.series.flatMap((series) =>
      series.values.slice(0, 1).map((value) => ({
        value: String(value),
        label: `${chart.categories[0] ?? series.name} · ${series.name}`,
      })),
    ),
  );
  const fallback = [
    { value: String(spec.sections.length), label: "Sections" },
    { value: String(spec.charts.length), label: "Séries chiffrées" },
  ];
  return (fromCharts.length ? fromCharts : fallback).slice(0, 3);
}

function mergeFill(
  sheet: ExcelJS.Worksheet,
  range: string,
  value: string,
  style: { bold?: boolean; size: number; color: string; fill: string; align: "left" | "center" },
  colors: SheetColors,
) {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(":")[0]);
  cell.value = value;
  styleCell(cell, style, colors);
}

function styleCell(
  cell: ExcelJS.Cell,
  style: {
    bold?: boolean;
    size: number;
    color: string;
    fill?: string;
    align?: "left" | "center";
  },
  colors: SheetColors,
) {
  cell.font = { name: colors.font, bold: style.bold, size: style.size, color: { argb: style.color } };
  cell.alignment = { vertical: "middle", horizontal: style.align ?? "left", wrapText: true, indent: style.align === "left" ? 1 : 0 };
  if (style.fill) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: style.fill } };
  }
  cell.border = {
    top: { style: "thin", color: { argb: colors.canvas } },
    bottom: { style: "thin", color: { argb: colors.canvas } },
    left: { style: "thin", color: { argb: colors.canvas } },
    right: { style: "thin", color: { argb: colors.canvas } },
  };
}

function sheetName(title: string, index: number): string {
  const clean = title.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 28);
  return clean || `Feuille ${index + 1}`;
}

function colLetter(col: number): string {
  let n = col;
  let text = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    text = String.fromCharCode(65 + rem) + text;
    n = Math.floor((n - 1) / 26);
  }
  return text;
}

function toNumber(value: string): number | null {
  const text = value.replace(/\s/g, "").replace("%", "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}
