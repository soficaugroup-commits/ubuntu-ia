import "server-only";
import ExcelJS from "exceljs";
import type { PreparedAttachment } from "@/lib/server/chat-attachments";
import { SOFICAU_ENTITY, SOFICAU_PAGE, SOFICAU_PRODUCT, SOFICAU_TABLE } from "@/lib/server/brand/soficau-theme";
import { argb, defaultDna, type DesignDna } from "@/lib/server/design-dna";
import type { DocumentSpec } from "@/lib/server/document-spec";
import { columnShouldSum, embedSheetCharts, type SheetChart } from "@/lib/server/xlsx-chart";
import { columnWidth, parseCellValue, splitTotalRow, type CellValue } from "@/lib/server/xlsx-cells";
import { plainInline } from "@/lib/server/rich-text";

type SheetColors = {
  navy: string;
  gold: string;
  canvas: string;
  white: string;
  mid: string;
  zebra: string;
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
    zebra: argb(dna.zebra ? dna.tableBodyFill : SOFICAU_TABLE.bodyFill),
    font: dna.bodyFont,
  };
  const workbook = new ExcelJS.Workbook();
  workbook.creator = SOFICAU_PRODUCT;
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
  applyPrintSetup(sheet, spec.title, 8);
  mergeFill(sheet, "B4:H4", spec.subtitle || `${SOFICAU_ENTITY}  ·  ${SOFICAU_PRODUCT}`, {
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
  const { data } = splitTotalRow(rows.map((line) => line.map((cell) => plainInline(cell ?? ""))));
  const parsed = data.map((line) => unique.map((_, colIndex) => parseCellValue(line[colIndex] ?? "")));
  const tableRows = parsed.map((line) => line.map((cell) => cell.value));
  const percentCol = unique.map((_, index) => parsed.some((line) => line[index]?.kind === "percent"));
  const totals: Array<"sum" | "average" | "none"> = unique.map((header, index) => {
    if (index === 0) return "none";
    const numbers = parsed.map((line) => (typeof line[index]?.value === "number" ? (line[index].value as number) : null));
    if (percentCol[index]) return numbers.filter((value) => value !== null).length >= 2 ? "average" : "none";
    return columnShouldSum(header, numbers) ? "sum" : "none";
  });
  const summable = totals.map((item) => item !== "none");
  const tableName = `Donnees${tableIndex}`;
  let tableOk = false;
  try {
    sheet.addTable({
      name: tableName,
      ref: "A3",
      headerRow: true,
      totalsRow: summable.some(Boolean),
      style: { theme: "TableStyleLight1", showRowStripes: false },
      columns: unique.map((name, index) => ({
        name,
        totalsRowLabel: index === 0 ? "Total" : undefined,
        totalsRowFunction: totals[index],
        filterButton: true,
      })),
      rows: tableRows,
    });
    tableOk = true;
    brandTable(sheet, unique.length, parsed, summable.some(Boolean), colors);
    summable.forEach((ok, index) => {
      if (!ok || totals[index] !== "sum" || data.length < 2) return;
      const letter = colLetter(index + 1);
      sheet.addConditionalFormatting({
        ref: `${letter}4:${letter}${3 + data.length}`,
        rules: [{ type: "dataBar", priority: 1, cfvo: [{ type: "min" }, { type: "max" }], color: { argb: colors.gold } }],
      } as unknown as ExcelJS.ConditionalFormattingOptions);
    });
  } catch (error) {
    console.error("[chat] excel table", error);
    writePlainTable(sheet, unique, parsed, totals, colors);
  }
  unique.forEach((name, index) => {
    const values = [name, ...data.map((line) => line[index] ?? "")];
    sheet.getColumn(index + 1).width = columnWidth(values, index === 0 ? 16 : 10, index === 0 ? 50 : 30);
  });
  applyPrintSetup(sheet, title, unique.length, 3);
  const first = summable.findIndex(Boolean);
  const fn = totals[first] === "average" ? "AVERAGE" : "SUM";
  return {
    rows: data.length,
    measureFormula:
      tableOk && first >= 0 ? `${fn}(${tableName}[${unique[first]}])` : undefined,
  };
}

/** Styles SOFICAU explicites (le style de tableau Office reste neutre) : en-tête marine, zébrure claire, formats FR. */
function brandTable(
  sheet: ExcelJS.Worksheet,
  columns: number,
  parsed: CellValue[][],
  hasTotals: boolean,
  colors: SheetColors,
) {
  for (let col = 1; col <= columns; col += 1) {
    styleCell(sheet.getCell(3, col), { bold: true, size: 11, color: colors.white, fill: colors.navy, align: "center" }, colors);
  }
  parsed.forEach((line, rowIndex) => {
    line.forEach((value, colIndex) => {
      const cell = sheet.getCell(4 + rowIndex, colIndex + 1);
      styleCell(cell, {
        size: 11,
        color: colors.navy,
        fill: rowIndex % 2 === 1 ? colors.zebra : colors.white,
        align: value.kind === "text" ? "left" : "right",
      }, colors);
      if (value.numFmt) cell.numFmt = value.numFmt;
    });
  });
  if (!hasTotals) return;
  const totalRow = 4 + parsed.length;
  for (let col = 1; col <= columns; col += 1) {
    const cell = sheet.getCell(totalRow, col);
    styleCell(cell, { bold: true, size: 11, color: colors.navy, fill: colors.canvas, align: col === 1 ? "left" : "right" }, colors);
    cell.border = { ...cell.border, top: { style: "medium", color: { argb: colors.navy } } };
    const sample = parsed.find((line) => line[col - 1]?.numFmt)?.[col - 1];
    if (sample?.numFmt && sample.kind !== "date") cell.numFmt = sample.numFmt;
  }
}

function writePlainTable(
  sheet: ExcelJS.Worksheet,
  headers: string[],
  parsed: CellValue[][],
  totals: Array<"sum" | "average" | "none">,
  colors: SheetColors,
) {
  const header = sheet.getRow(3);
  headers.forEach((name, index) => {
    const cell = header.getCell(index + 1);
    cell.value = name;
    styleCell(cell, { bold: true, size: 11, color: colors.white, fill: colors.navy, align: "center" }, colors);
  });
  parsed.forEach((line, rowIndex) => {
    line.forEach((value, colIndex) => {
      const cell = sheet.getCell(4 + rowIndex, colIndex + 1);
      cell.value = value.value;
      if (value.numFmt) cell.numFmt = value.numFmt;
      styleCell(cell, {
        size: 11,
        color: colors.navy,
        fill: rowIndex % 2 === 1 ? colors.zebra : colors.white,
        align: value.kind === "text" ? "left" : "right",
      }, colors);
    });
  });
  if (parsed.length < 2 || !totals.some((item) => item !== "none")) return;
  const totalRow = 4 + parsed.length;
  sheet.getCell(totalRow, 1).value = "Total";
  styleCell(sheet.getCell(totalRow, 1), { bold: true, size: 11, color: colors.navy, fill: colors.canvas }, colors);
  totals.forEach((fn, index) => {
    if (fn === "none") return;
    const cell = sheet.getCell(totalRow, index + 1);
    const letter = colLetter(index + 1);
    cell.value = { formula: `${fn === "average" ? "AVERAGE" : "SUM"}(${letter}4:${letter}${totalRow - 1})` };
    const sample = parsed.find((line) => line[index]?.numFmt)?.[index];
    if (sample?.numFmt) cell.numFmt = sample.numFmt;
    styleCell(cell, { bold: true, size: 11, color: colors.navy, fill: colors.canvas, align: "right" }, colors);
  });
}

/** Impression A4 : orientation selon la largeur, ajustement à une page en largeur, en-tête de tableau répété. */
function applyPrintSetup(sheet: ExcelJS.Worksheet, title: string, columns: number, headerRow?: number) {
  const margin = SOFICAU_PAGE.marginMm / 25.4;
  sheet.pageSetup = {
    ...sheet.pageSetup,
    paperSize: 9,
    orientation: columns > 6 ? "landscape" : "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: margin, right: margin, top: margin, bottom: margin, header: 0.3, footer: 0.3 },
    ...(headerRow ? { printTitlesRow: `${headerRow}:${headerRow}` } : {}),
  };
  const safeTitle = title.replace(/&/g, "&&").slice(0, 60);
  sheet.headerFooter = {
    oddHeader: `&L&8${safeTitle}&R&8${SOFICAU_ENTITY}`,
    oddFooter: "&R&8Page &P sur &N",
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
    align?: "left" | "center" | "right";
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

