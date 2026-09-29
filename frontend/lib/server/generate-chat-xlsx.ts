import "server-only";
import ExcelJS from "exceljs";
import type { PreparedAttachment } from "@/lib/server/chat-attachments";
import { argb, defaultDna, type DesignDna } from "@/lib/server/design-dna";
import type { DocumentSpec } from "@/lib/server/document-spec";
import { columnShouldSum, embedSheetCharts, type SheetChart } from "@/lib/server/xlsx-chart";
import { plainInline } from "@/lib/server/rich-text";

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

  const charts: SheetChart[] = [];
  const measures: { formula: string; label: string }[] = [];
  spec.sections.forEach((section, index) => {
    if (!section.table && !section.chart) return;
    const name =
      sheetName(section.title, index) === "Synthèse"
        ? sheetName(`${section.title} donnees`, index)
        : sheetName(section.title, index);
    const existing = workbook.getWorksheet(name);
    if (!(loaded && existing)) {
      const sheet = existing ?? workbook.addWorksheet(name);
      if (section.table) {
        const written = writeDataSheet(sheet, section.title, section.table.headers, section.table.rows, colors, index + 1);
        if (written.measureFormula) measures.push({ formula: written.measureFormula, label: section.title });
      }
      else if (section.chart) {
        const headers = [section.chart.title, ...section.chart.series.map((item) => item.name)];
        const rows = section.chart.categories.map((category, rowIndex) => [
          category,
          ...section.chart!.series.map((item) => String(item.values[rowIndex] ?? "")),
        ]);
        const written = writeDataSheet(sheet, section.title, headers, rows, colors, index + 1);
        if (written.measureFormula) measures.push({ formula: written.measureFormula, label: section.title });
        charts.push({
          sheetName: sheet.name,
          title: section.chart.title,
          kind: section.chart.kind,
          headerRow: 3,
          firstDataRow: 4,
          lastDataRow: 3 + written.rows,
          categoryCol: 1,
          seriesCols: section.chart.series.map((_, seriesIndex) => seriesIndex + 2),
          anchorRow: 3 + written.rows + 2,
          colors: dna.chartColors,
        });
      }
    }
    if (section.table && section.chart) {
      const chartName = sheetName(`${section.title} graphe`, index + 20);
      if (!workbook.getWorksheet(chartName)) {
        const sheet = workbook.addWorksheet(chartName);
        const headers = [section.chart.title, ...section.chart.series.map((item) => item.name)];
        const rows = section.chart.categories.map((category, rowIndex) => [
          category,
          ...section.chart!.series.map((item) => String(item.values[rowIndex] ?? "")),
        ]);
        const written = writeDataSheet(sheet, section.chart.title, headers, rows, colors, index + 21);
        if (written.measureFormula) measures.push({ formula: written.measureFormula, label: section.chart.title });
        charts.push({
          sheetName: sheet.name,
          title: section.chart.title,
          kind: section.chart.kind,
          headerRow: 3,
          firstDataRow: 4,
          lastDataRow: 3 + written.rows,
          categoryCol: 1,
          seriesCols: section.chart.series.map((_, seriesIndex) => seriesIndex + 2),
          anchorRow: 3 + written.rows + 2,
          colors: dna.chartColors,
        });
      }
    }
  });

  if (workbook.worksheets.length === 0) {
    workbook.addWorksheet("Ubuntu IA").getCell("A1").value = spec.title;
  }
  if (!spec.kpis?.length && measures.length) {
    const board = workbook.getWorksheet("Synthèse");
    measures.slice(0, 4).forEach((item, index) => {
      const column = String.fromCharCode(66 + index);
      const label = board?.getCell(`${column}5`);
      const value = board?.getCell(`${column}6`);
      if (label) label.value = item.label.slice(0, 28);
      if (value) value.value = { formula: item.formula };
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer);
  return embedSheetCharts(bytes, charts.filter((chart) => chart.lastDataRow >= chart.firstDataRow));
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

  const kpis = spec.kpis?.length ? spec.kpis.slice(0, 3) : dashboardKpis(spec);
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

  sheet.getCell("B28").value = "Source : contenu validé dans la conversation Ubuntu IA. Les totaux SUM ne portent que sur les colonnes de mesures.";
  styleCell(sheet.getCell("B28"), { size: 9, color: colors.gold }, colors);
}

function writeDataSheet(
  sheet: ExcelJS.Worksheet,
  title: string,
  headers: string[],
  rows: string[][],
  colors: SheetColors,
  tableIndex: number,
): { rows: number; measureFormula?: string } {
  sheet.views = [{ state: "frozen", ySplit: 3, showGridLines: false }];
  const lastCol = Math.max(1, headers.length);
  sheet.mergeCells(1, 1, 1, lastCol);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  styleCell(titleCell, { bold: true, size: 16, color: colors.white, fill: colors.navy, align: "left" }, colors);
  sheet.getRow(1).height = 28;

  const unique = headers.map((header, index) => {
    const base = (plainInline(header).replace(/[\][]/g, " ").trim() || `Colonne ${index + 1}`).slice(0, 40);
    const taken = headers.slice(0, index).some((item, prior) => {
      const other = (plainInline(item).replace(/[\][]/g, " ").trim() || `Colonne ${prior + 1}`).slice(0, 40);
      return other === base;
    });
    return taken ? `${base} ${index + 1}`.slice(0, 40) : base;
  });
  const tableRows = rows.map((line) =>
    unique.map((_, colIndex) => {
      const raw = plainInline(line[colIndex] ?? "");
      return toNumber(raw) ?? raw;
    }),
  );
  const summable = unique.map((header, index) =>
    index === 0 ? false : columnShouldSum(header, rows.map((line) => toNumber(plainInline(line[index] ?? "")))),
  );
  const tableName = `Donnees${tableIndex}`;
  let tableOk = false;
  try {
    sheet.addTable({
      name: tableName,
      ref: "A3",
      headerRow: true,
      totalsRow: summable.some(Boolean),
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: unique.map((name, index) => ({
        name,
        totalsRowLabel: index === 0 ? "Total" : undefined,
        totalsRowFunction: summable[index] ? "sum" : "none",
        filterButton: true,
      })),
      rows: tableRows,
    });
    tableOk = true;
    if (rows.length && summable.some(Boolean) && unique.length > 1) {
      sheet.addConditionalFormatting({
        ref: `B4:${colLetter(unique.length)}${3 + rows.length}`,
        rules: [
          {
            type: "colorScale",
            priority: 1,
            cfvo: [{ type: "min" }, { type: "max" }],
            color: [{ argb: colors.canvas }, { argb: colors.navy }],
          },
        ],
      });
    }
  } catch (error) {
    console.error("[chat] excel table", error);
    const header = sheet.getRow(3);
    unique.forEach((name, index) => {
      const cell = header.getCell(index + 1);
      cell.value = name;
      styleCell(cell, { bold: true, size: 11, color: colors.white, fill: colors.navy, align: "center" }, colors);
      sheet.getColumn(index + 1).width = index === 0 ? 28 : 16;
    });
    tableRows.forEach((line, rowIndex) => {
      const excelRow = sheet.getRow(4 + rowIndex);
      line.forEach((value, colIndex) => {
        const cell = excelRow.getCell(colIndex + 1);
        cell.value = value;
        styleCell(cell, {
          size: 11,
          color: colors.navy,
          fill: rowIndex % 2 === 0 ? colors.white : colors.canvas,
          align: colIndex === 0 ? "left" : "center",
        }, colors);
      });
    });
    if (rows.length >= 2 && summable.some(Boolean)) {
      const totalRow = 4 + rows.length;
      sheet.getCell(totalRow, 1).value = "Total";
      styleCell(sheet.getCell(totalRow, 1), { bold: true, size: 11, color: colors.white, fill: colors.gold }, colors);
      summable.forEach((ok, index) => {
        if (!ok) return;
        const cell = sheet.getCell(totalRow, index + 1);
        const letter = colLetter(index + 1);
        cell.value = { formula: `SUM(${letter}4:${letter}${totalRow - 1})` };
        styleCell(cell, { bold: true, size: 11, color: colors.white, fill: colors.gold, align: "center" }, colors);
      });
    }
  }
  unique.forEach((_, index) => {
    sheet.getColumn(index + 1).width = index === 0 ? 28 : 16;
  });
  const first = summable.findIndex(Boolean);
  return {
    rows: rows.length,
    measureFormula:
      tableOk && first >= 0 ? `SUM(${tableName}[${unique[first]}])` : undefined,
  };
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
