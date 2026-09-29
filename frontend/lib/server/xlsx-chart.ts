import JSZip from "jszip";
import type { ChartKind } from "@/lib/server/document-spec";

export type SheetChart = {
  sheetName: string;
  title: string;
  kind: ChartKind;
  headerRow: number;
  firstDataRow: number;
  lastDataRow: number;
  categoryCol: number;
  seriesCols: number[];
  anchorRow: number;
  colors: string[];
};

export async function embedSheetCharts(bytes: Uint8Array, charts: SheetChart[]): Promise<Uint8Array> {
  if (!charts.length) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  const workbookRels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!workbook || !workbookRels) return bytes;

  const sheets = sheetTargets(workbook, workbookRels);
  let chartIndex = 1;
  for (const chart of charts) {
    const target = sheets.get(chart.sheetName);
    if (!target) continue;
    const sheetPath = `xl/${target}`;
    const sheetXml = await zip.file(sheetPath)?.async("string");
    if (!sheetXml) continue;
    const drawingName = `drawing${chartIndex}.xml`;
    const chartName = `chart${chartIndex}.xml`;
    const relsPath = sheetPath.replace("xl/worksheets/", "xl/worksheets/_rels/") + ".rels";
    const rels = (await zip.file(relsPath)?.async("string")) ?? defaultRels();
    const drawingRel = nextRelId(rels);
    const nextRels = appendRel(
      rels,
      drawingRel,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
      `../drawings/${drawingName}`,
    );
    zip.file(relsPath, nextRels);
    zip.file(sheetPath, insertDrawing(sheetXml, drawingRel));
    zip.file(`xl/drawings/${drawingName}`, drawingXml(chart, chartIndex));
    zip.file(
      `xl/drawings/_rels/${drawingName}.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/${chartName}"/>` +
        `</Relationships>`,
    );
    zip.file(`xl/charts/${chartName}`, chartXml(chart));
    chartIndex += 1;
  }
  if (chartIndex === 1) return bytes;
  const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
  if (contentTypes) zip.file("[Content_Types].xml", extendContentTypes(contentTypes, chartIndex - 1));
  return zip.generateAsync({ type: "uint8array" });
}

export function columnShouldSum(header: string, values: Array<number | null>): boolean {
  if (/\b(id|code|réf|ref|n°|numero|numéro|année|annee|year|date|taux|ratio|%|pourcent)\b/i.test(header)) {
    return false;
  }
  const numbers = values.filter((value): value is number => value !== null);
  if (numbers.length < 2) return false;
  if (numbers.every((value) => Number.isInteger(value) && value >= 1900 && value <= 2100)) return false;
  return true;
}

function sheetTargets(workbook: string, rels: string): Map<string, string> {
  const map = new Map<string, string>();
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((match) => ({
    id: /Id="([^"]+)"/.exec(match[0])?.[1],
    target: /Target="([^"]+)"/.exec(match[0])?.[1],
  }));
  const byId = new Map(
    rel.filter((item) => item.id && item.target).map((item) => [item.id as string, (item.target as string).replace(/^\//, "")]),
  );
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(match[0])?.[1];
    const id = /r:id="([^"]+)"/.exec(match[0])?.[1];
    const target = id ? byId.get(id) : undefined;
    if (name && target) map.set(unescapeXml(name), target.replace(/^xl\//, ""));
  }
  return map;
}

function chartXml(chart: SheetChart): string {
  const sheet = quoteSheet(chart.sheetName);
  const cat = `${sheet}!$${col(chart.categoryCol)}$${chart.firstDataRow}:$${col(chart.categoryCol)}$${chart.lastDataRow}`;
  const series = chart.seriesCols
    .map((column, index) => seriesXml(chart, sheet, column, index, cat))
    .join("");
  const plot =
    chart.kind === "pie"
      ? `<c:pieChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/></c:pieChart>`
      : chart.kind === "line"
        ? `<c:lineChart><c:grouping val="standard"/>${series}<c:marker val="1"/><c:axId val="1"/><c:axId val="2"/></c:lineChart>`
        : `<c:barChart><c:barDir val="${chart.kind === "bar" ? "bar" : "col"}"/><c:grouping val="clustered"/>${series}<c:axId val="1"/><c:axId val="2"/></c:barChart>`;
  const axes =
    chart.kind === "pie"
      ? ""
      : `<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>` +
        `<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/><c:crosses val="autoZero"/></c:valAx>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<c:chart>` +
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escapeXml(chart.title)}</a:t></a:r></a:p></c:rich></c:tx></c:title>` +
    `<c:plotArea><c:layout/>${plot}${axes}</c:plotArea>` +
    `<c:legend><c:legendPos val="b"/></c:legend>` +
    `<c:plotVisOnly val="1"/>` +
    `</c:chart>` +
    `</c:chartSpace>`
  );
}

function seriesXml(chart: SheetChart, sheet: string, column: number, index: number, cat: string): string {
  const letter = col(column);
  const name = `${sheet}!$${letter}$${chart.headerRow}`;
  const values = `${sheet}!$${letter}$${chart.firstDataRow}:$${letter}$${chart.lastDataRow}`;
  const color = chart.colors[index % chart.colors.length] || "17405B";
  const point =
    chart.kind === "pie"
      ? ""
      : `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>`;
  return (
    `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>` +
    `<c:tx><c:strRef><c:f>${name}</c:f></c:strRef></c:tx>` +
    point +
    `<c:cat><c:strRef><c:f>${cat}</c:f></c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>${values}</c:f></c:numRef></c:val>` +
    `</c:ser>`
  );
}

function drawingXml(chart: SheetChart, id: number): string {
  const fromRow = chart.anchorRow;
  const toRow = chart.anchorRow + 16;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id + 1}" name="Graphique ${id}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic>` +
    `</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`
  );
}

function insertDrawing(sheetXml: string, relId: string): string {
  let xml = sheetXml;
  if (!xml.includes("xmlns:r=")) {
    xml = xml.replace(
      /<worksheet\b/,
      '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    );
  }
  if (/<drawing\b/i.test(xml)) return xml;
  const tag = `<drawing r:id="${relId}"/>`;
  if (xml.includes("</worksheet>")) return xml.replace("</worksheet>", `${tag}</worksheet>`);
  return xml;
}

function extendContentTypes(xml: string, count: number): string {
  let next = xml;
  if (!next.includes("drawing+xml") && !next.includes("/xl/drawings/drawing1.xml")) {
    next = next.replace(
      "</Types>",
      `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`,
    );
  }
  for (let index = 1; index <= count; index += 1) {
    const drawing = `/xl/drawings/drawing${index}.xml`;
    const chart = `/xl/charts/chart${index}.xml`;
    if (!next.includes(drawing)) {
      next = next.replace(
        "</Types>",
        `<Override PartName="${drawing}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`,
      );
    }
    if (!next.includes(chart)) {
      next = next.replace(
        "</Types>",
        `<Override PartName="${chart}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`,
      );
    }
  }
  return next;
}

function defaultRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
}

function nextRelId(rels: string): string {
  const ids = [...rels.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
  return `rId${(ids.length ? Math.max(...ids) : 0) + 1}`;
}

function appendRel(rels: string, id: string, type: string, target: string): string {
  const tag = `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
  return rels.replace("</Relationships>", `${tag}</Relationships>`);
}

function quoteSheet(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function col(index: number): string {
  let n = index;
  let text = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    text = String.fromCharCode(65 + rem) + text;
    n = Math.floor((n - 1) / 26);
  }
  return text;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeXml(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
