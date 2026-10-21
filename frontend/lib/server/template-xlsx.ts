import JSZip from "jszip";
import type { DocumentSpec } from "@/lib/server/document-spec";
import { decodeXml, encodeXml, mergeSplitTags, replaceTags } from "@/lib/server/ooxml-text";
import { fieldResolver, loopRows, missingField } from "@/lib/server/template-values";
import { parseCellValue } from "@/lib/server/xlsx-cells";

/**
 * Remplissage d'un classeur modèle par édition XML directe : on n'écrit que des valeurs,
 * jamais par-dessus une formule, et les colonnes calculées des tableaux sont prolongées.
 */

type XCell = { col: number; attrs: string; inner: string | null };
type XRow = { r: number; attrs: string; cells: Map<number, XCell> };

export type XlsxTable = {
  path: string;
  sheetPath: string;
  name: string;
  columns: { name: string; formula?: string }[];
};

export type XlsxDefinedName = { name: string; sheetPath: string; cell: string };

export type XlsxLayout = {
  sheets: { name: string; path: string }[];
  tables: XlsxTable[];
  definedNames: XlsxDefinedName[];
};

export function colToNumber(col: string): number {
  return col.split("").reduce((sum, char) => sum * 26 + (char.charCodeAt(0) - 64), 0);
}

export function numberToCol(value: number): string {
  let n = value;
  let out = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function parseRef(ref: string): { col: number; row: number } | null {
  const match = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref.trim());
  return match ? { col: colToNumber(match[1]), row: Number(match[2]) } : null;
}

function parseRange(ref: string): { c1: number; r1: number; c2: number; r2: number } | null {
  const [from, to = from] = ref.split(":");
  const a = parseRef(from);
  const b = parseRef(to);
  return a && b ? { c1: a.col, r1: a.row, c2: b.col, r2: b.row } : null;
}

function attr(source: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(source);
  return match ? decodeXml(match[1]) : undefined;
}

function resolveTarget(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== ".") parts.push(piece);
  }
  return parts.join("/");
}

function relsPath(part: string): string {
  const parts = part.split("/");
  const file = parts.pop() ?? "";
  return [...parts, "_rels", `${file}.rels`].join("/");
}

async function readRels(zip: JSZip, part: string): Promise<{ id: string; type: string; target: string }[]> {
  const xml = (await zip.file(relsPath(part))?.async("string")) ?? "";
  return [...xml.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((match) => ({
    id: attr(match[1], "Id") ?? "",
    type: attr(match[1], "Type") ?? "",
    target: resolveTarget(part, attr(match[1], "Target") ?? ""),
  }));
}

/** Feuilles, tableaux structurés et noms définis (cellule unique) du classeur. */
export async function readXlsxLayout(zip: JSZip): Promise<XlsxLayout> {
  const workbook = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const rels = await readRels(zip, "xl/workbook.xml");
  const sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map((match) => {
    const id = attr(match[1], "r:id") ?? "";
    return { name: attr(match[1], "name") ?? "", path: rels.find((rel) => rel.id === id)?.target ?? "" };
  });
  const tables: XlsxTable[] = [];
  for (const sheet of sheets) {
    for (const rel of await readRels(zip, sheet.path)) {
      if (!rel.type.endsWith("/table")) continue;
      const xml = (await zip.file(rel.target)?.async("string")) ?? "";
      const head = /<table\b[^>]*>/.exec(xml)?.[0] ?? "";
      const columns = [...xml.matchAll(/<tableColumn\b([^>]*?)(?:\/>|>([\s\S]*?)<\/tableColumn>)/g)].map((match) => {
        const formula = /<calculatedColumnFormula[^>]*>([\s\S]*?)<\/calculatedColumnFormula>/.exec(match[2] ?? "")?.[1];
        return { name: attr(match[1], "name") ?? "", formula: formula ? decodeXml(formula) : undefined };
      });
      tables.push({
        path: rel.target,
        sheetPath: sheet.path,
        name: attr(head, "displayName") ?? attr(head, "name") ?? "",
        columns,
      });
    }
  }
  const definedNames: XlsxDefinedName[] = [];
  for (const match of workbook.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    const name = attr(match[1], "name") ?? "";
    if (!name || name.startsWith("_xlnm")) continue;
    const target = /^(?:'((?:[^']|'')+)'|([^!]+))!(\$?[A-Z]{1,3}\$?\d+)$/.exec(decodeXml(match[2]).trim());
    if (!target) continue;
    const sheetName = (target[1] ?? target[2] ?? "").replace(/''/g, "'");
    const sheet = sheets.find((item) => item.name === sheetName);
    if (sheet) definedNames.push({ name, sheetPath: sheet.path, cell: target[3].replace(/\$/g, "") });
  }
  return { sheets, tables, definedNames };
}

function parseRows(xml: string): { rows: Map<number, XRow>; open: string; close: string; start: number; end: number } | null {
  const empty = /<sheetData\s*\/>/.exec(xml);
  if (empty) {
    return { rows: new Map(), open: "<sheetData>", close: "</sheetData>", start: empty.index, end: empty.index + empty[0].length };
  }
  const full = /(<sheetData(?:\s[^>]*)?>)([\s\S]*?)(<\/sheetData>)/.exec(xml);
  if (!full) return null;
  const rows = new Map<number, XRow>();
  for (const match of full[2].matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(attr(match[1], "r"));
    if (!r) continue;
    const cells = new Map<number, XCell>();
    for (const cell of (match[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = parseRef(attr(cell[1], "r") ?? "");
      if (ref) cells.set(ref.col, { col: ref.col, attrs: cell[1], inner: cell[2] ?? null });
    }
    rows.set(r, { r, attrs: match[1], cells });
  }
  return { rows, open: full[1], close: full[3], start: full.index, end: full.index + full[0].length };
}

function serializeRows(rows: Map<number, XRow>): string {
  return [...rows.values()]
    .sort((a, b) => a.r - b.r)
    .map((row) => {
      const attrs = row.attrs.replace(/\s*\bspans="[^"]*"/, "").replace(/\br="\d+"/, `r="${row.r}"`);
      const cells = [...row.cells.values()]
        .sort((a, b) => a.col - b.col)
        .map((cell) => {
          const ref = `${numberToCol(cell.col)}${row.r}`;
          const cellAttrs = /\br="/.test(cell.attrs) ? cell.attrs.replace(/\br="[^"]*"/, `r="${ref}"`) : ` r="${ref}"${cell.attrs}`;
          return cell.inner === null ? `<c${cellAttrs}/>` : `<c${cellAttrs}>${cell.inner}</c>`;
        })
        .join("");
      return cells ? `<row${attrs}>${cells}</row>` : `<row${attrs}/>`;
    })
    .join("");
}

function styleAttr(attrs: string | undefined): string {
  const style = attrs ? /\bs="(\d+)"/.exec(attrs)?.[1] : undefined;
  return style ? ` s="${style}"` : "";
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

function valueCell(col: number, style: string, raw: string): XCell {
  const parsed = parseCellValue(raw);
  if (typeof parsed.value === "number") {
    return { col, attrs: style, inner: `<v>${parsed.value}</v>` };
  }
  if (parsed.value instanceof Date) {
    const serial = Math.round((parsed.value.getTime() - EXCEL_EPOCH) / 86_400_000);
    return { col, attrs: style, inner: `<v>${serial}</v>` };
  }
  if (!raw) return { col, attrs: style, inner: null };
  return { col, attrs: `${style} t="inlineStr"`, inner: `<is><t xml:space="preserve">${encodeXml(raw)}</t></is>` };
}

function hasFormula(cell: XCell | undefined): boolean {
  return Boolean(cell?.inner && /<f\b/.test(cell.inner));
}

/** Décale les références relatives de ligne d'une formule A1 (`B4` → `B6` pour delta = 2). */
export function shiftFormulaRows(formula: string, delta: number): string {
  if (!delta) return formula;
  return formula.replace(/("[^"]*")|(?<![A-Za-z_\d$])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(])/g, (full, quoted, d1, col, d2, row) => {
    if (quoted) return full;
    return d2 ? full : `${d1}${col}${d2}${Number(row) + delta}`;
  });
}

function formulaText(cell: XCell | undefined): string | undefined {
  const match = cell?.inner ? /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(cell.inner) : null;
  return match ? decodeXml(match[1]) : undefined;
}

export type XlsxFillReport = { filledTables: string[]; filledNames: string[]; warnings: string[] };

export async function fillXlsxTemplate(template: Buffer, spec: DocumentSpec): Promise<{ bytes: Uint8Array; report: XlsxFillReport }> {
  const zip = await JSZip.loadAsync(template);
  const layout = await readXlsxLayout(zip);
  const resolve = fieldResolver(spec);
  const report: XlsxFillReport = { filledTables: [], filledNames: [], warnings: [] };
  const missing = (name: string) => missingField(name);

  const shared = zip.file("xl/sharedStrings.xml");
  if (shared) {
    const xml = mergeSplitTags(await shared.async("string"), "si", "t");
    zip.file("xl/sharedStrings.xml", replaceTags(xml, "t", resolve, { lineBreak: "\n", missing }));
  }

  const sheetXml = new Map<string, string>();
  for (const sheet of layout.sheets) {
    const xml = await zip.file(sheet.path)?.async("string");
    if (xml) sheetXml.set(sheet.path, replaceTags(mergeSplitTags(xml, "is", "t"), "t", resolve, { lineBreak: "\n", missing }));
  }

  for (const defined of layout.definedNames) {
    const value = resolve(defined.name);
    const xml = sheetXml.get(defined.sheetPath);
    const ref = parseRef(defined.cell);
    if (value === undefined || !xml || !ref) continue;
    const parsed = parseRows(xml);
    if (!parsed) continue;
    const row = parsed.rows.get(ref.row) ?? { r: ref.row, attrs: ` r="${ref.row}"`, cells: new Map() };
    const current = row.cells.get(ref.col);
    if (hasFormula(current)) {
      report.warnings.push(`Le nom « ${defined.name} » pointe sur une formule : valeur non écrite.`);
      continue;
    }
    row.cells.set(ref.col, valueCell(ref.col, styleAttr(current?.attrs), value));
    parsed.rows.set(ref.row, row);
    sheetXml.set(defined.sheetPath, `${xml.slice(0, parsed.start)}${parsed.open}${serializeRows(parsed.rows)}${parsed.close}${xml.slice(parsed.end)}`);
    report.filledNames.push(defined.name);
  }

  const single = layout.tables.length === 1;
  for (const table of layout.tables) {
    const rows = loopRows(spec, table.name, table.columns.map((column) => column.name), single);
    if (!rows) continue;
    const xml = sheetXml.get(table.sheetPath);
    const tableXml = await zip.file(table.path)?.async("string");
    if (!xml || !tableXml) continue;
    const result = fillTable(xml, tableXml, table, rows);
    if ("warning" in result) {
      report.warnings.push(result.warning);
      continue;
    }
    sheetXml.set(table.sheetPath, result.sheet);
    zip.file(table.path, result.table);
    report.filledTables.push(table.name);
  }

  for (const [path, xml] of sheetXml) zip.file(path, refreshDimension(xml));
  await dropCalcChain(zip);
  return { bytes: await zip.generateAsync({ type: "uint8array" }), report };
}

function fillTable(
  sheet: string,
  tableXml: string,
  table: XlsxTable,
  items: Record<string, string>[],
): { sheet: string; table: string } | { warning: string } {
  const head = /<table\b[^>]*>/.exec(tableXml)?.[0] ?? "";
  const range = parseRange(attr(head, "ref") ?? "");
  const parsed = parseRows(sheet);
  if (!range || !parsed) return { warning: `Tableau « ${table.name} » illisible : laissé tel quel.` };
  const headerRows = Number(attr(head, "headerRowCount") ?? "1");
  const totals = Number(attr(head, "totalsRowCount") ?? "0");
  const firstData = range.r1 + headerRows;
  const oldBottom = range.r2;
  const count = Math.max(1, items.length);
  const newLast = firstData + count - 1;
  const newBottom = newLast + totals;

  for (let r = oldBottom + 1; r <= newBottom; r += 1) {
    const row = parsed.rows.get(r);
    if (row && [...row.cells.keys()].some((col) => col >= range.c1 && col <= range.c2)) {
      return { warning: `Le tableau « ${table.name} » ne peut pas s'agrandir sans écraser des cellules voisines : laissé tel quel.` };
    }
  }

  const model = parsed.rows.get(firstData);
  const modelAttrs = model?.attrs;
  const modelCells = new Map(model?.cells ?? []);
  const totalsRow = totals ? parsed.rows.get(oldBottom) : undefined;
  const totalCells = totalsRow
    ? [...totalsRow.cells.values()].filter((cell) => cell.col >= range.c1 && cell.col <= range.c2)
    : [];
  for (let r = firstData; r <= oldBottom; r += 1) {
    const row = parsed.rows.get(r);
    if (!row) continue;
    for (let col = range.c1; col <= range.c2; col += 1) row.cells.delete(col);
  }

  items.slice(0, count).concat(items.length ? [] : [{}]).forEach((item, index) => {
    const r = firstData + index;
    const row = parsed.rows.get(r) ?? { r, attrs: modelAttrs ?? ` r="${r}"`, cells: new Map<number, XCell>() };
    table.columns.forEach((column, offset) => {
      const col = range.c1 + offset;
      const template = modelCells.get(col);
      const style = styleAttr(template?.attrs);
      const formula = column.formula ?? (hasFormula(template) ? formulaText(template) : undefined);
      if (formula) {
        const text = column.formula ? formula : shiftFormulaRows(formula, index);
        row.cells.set(col, { col, attrs: style, inner: `<f>${encodeXml(text)}</f>` });
      } else {
        row.cells.set(col, valueCell(col, style, item[column.name] ?? ""));
      }
    });
    parsed.rows.set(r, row);
  });

  if (totalCells.length) {
    const row = parsed.rows.get(newBottom) ?? { r: newBottom, attrs: totalsRow?.attrs ?? ` r="${newBottom}"`, cells: new Map<number, XCell>() };
    for (const cell of totalCells) row.cells.set(cell.col, cell);
    parsed.rows.set(newBottom, row);
  }

  const ref = `${numberToCol(range.c1)}${range.r1}:${numberToCol(range.c2)}${newBottom}`;
  const filterRef = `${numberToCol(range.c1)}${range.r1}:${numberToCol(range.c2)}${newLast}`;
  const nextTable = tableXml
    .replace(head, head.replace(/\bref="[^"]*"/, `ref="${ref}"`))
    .replace(/(<autoFilter\b[^>]*\bref=")[^"]*"/, `$1${filterRef}"`);
  const nextSheet = `${sheet.slice(0, parsed.start)}${parsed.open}${serializeRows(parsed.rows)}${parsed.close}${sheet.slice(parsed.end)}`;
  return { sheet: nextSheet, table: nextTable };
}

function refreshDimension(xml: string): string {
  const parsed = parseRows(xml);
  if (!parsed || !parsed.rows.size) return xml;
  let c1 = Infinity;
  let c2 = 0;
  let r1 = Infinity;
  let r2 = 0;
  for (const row of parsed.rows.values()) {
    for (const col of row.cells.keys()) {
      c1 = Math.min(c1, col);
      c2 = Math.max(c2, col);
      r1 = Math.min(r1, row.r);
      r2 = Math.max(r2, row.r);
    }
  }
  if (!c2) return xml;
  return xml.replace(/<dimension\b[^>]*\/>/, `<dimension ref="${numberToCol(c1)}${r1}:${numberToCol(c2)}${r2}"/>`);
}

/** La chaîne de calcul référence des cellules qui ont bougé : Excel la reconstruit à l'ouverture. */
async function dropCalcChain(zip: JSZip): Promise<void> {
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  if (workbook) {
    const anchor = ["</definedNames>", "</externalReferences>", "</sheets>"].find((tag) => workbook.includes(tag));
    const next = /<calcPr\b/.test(workbook)
      ? workbook.replace(/<calcPr\b([^>]*?)(\/?)>/, (_full, attrs: string, slash: string) =>
          `<calcPr${attrs.replace(/\s*\bfullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"${slash}>`)
      : anchor
        ? workbook.replace(anchor, `${anchor}<calcPr fullCalcOnLoad="1"/>`)
        : workbook;
    zip.file("xl/workbook.xml", next);
  }
  if (!zip.file("xl/calcChain.xml")) return;
  zip.remove("xl/calcChain.xml");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (rels) zip.file("xl/_rels/workbook.xml.rels", rels.replace(/<Relationship\b[^>]*calcChain[^>]*\/>/g, ""));
  const types = await zip.file("[Content_Types].xml")?.async("string");
  if (types) zip.file("[Content_Types].xml", types.replace(/<Override\b[^>]*calcChain[^>]*\/>/g, ""));
}
