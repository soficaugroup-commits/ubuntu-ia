import JSZip from "jszip";
import { cloneDocxWithSpec, readDocxStyles, sectionXml, type DocxStyles } from "@/lib/server/clone-docx";
import { clonePptxWithSpec } from "@/lib/server/clone-pptx";
import { defaultDna, type DesignDna } from "@/lib/server/design-dna";
import type { DocumentSpec } from "@/lib/server/document-spec";
import {
  blockText,
  collectTags,
  mergeSplitTags,
  normalizeKey,
  replaceTags,
  TAG_PATTERN,
} from "@/lib/server/ooxml-text";
import { fieldResolver, loopRows, missingField, sectionKey } from "@/lib/server/template-values";
import { fillXlsxTemplate, readXlsxLayout } from "@/lib/server/template-xlsx";
import type { DocumentTemplate, TemplateField, TemplateFormat } from "@/lib/types";

export type TemplateStructure = DocumentTemplate["structure"];

export type TemplateAnalysis = { champs: TemplateField[]; structure: TemplateStructure };

export type FillMode = "balises" | "structure" | "clone";

export type FillResult = { bytes: Uint8Array; mode: FillMode; missing: string[]; warnings: string[] };

const CONTENT_SLOT = /^\{\{\s*(contenu|corps|redaction|texte|sections)\s*\}\}$/i;
const WORD_BREAK = '</w:t><w:br/><w:t xml:space="preserve">';

function wordParts(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((name) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(name));
}

function slideParts(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
}

function headingOf(paragraph: string): string | undefined {
  const style = /<w:pStyle w:val="([^"]+)"/.exec(paragraph)?.[1] ?? "";
  if (!/^(heading|titre|title)/i.test(style)) return undefined;
  return blockText(paragraph, "w:t").trim() || undefined;
}

/** Champs et structure lus à l'import, pour l'aperçu admin et le choix du modèle par l'agent. */
export async function analyzeTemplate(format: TemplateFormat, bytes: Buffer): Promise<TemplateAnalysis> {
  const zip = await JSZip.loadAsync(bytes);
  if (format === "xlsx") {
    const layout = await readXlsxLayout(zip);
    const shared = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
    const tags = collectTags(mergeSplitTags(shared, "si", "t"), "si", "t");
    return {
      champs: [
        ...uniqueFields(tags),
        ...layout.definedNames.map((item) => ({ nom: item.name, type: "nom_defini" as const })),
        ...layout.tables.map((table) => ({
          nom: table.name,
          type: "tableau" as const,
          colonnes: table.columns.map((column) => column.name),
        })),
      ],
      structure: { feuilles: layout.sheets.map((sheet) => sheet.name) },
    };
  }
  if (format === "pptx") {
    const slides = slideParts(zip);
    const tags: string[] = [];
    for (const part of slides) {
      const xml = (await zip.file(part)?.async("string")) ?? "";
      tags.push(...collectTags(mergeSplitTags(xml, "a:p", "a:t"), "a:p", "a:t"));
    }
    const layouts: string[] = [];
    for (const name of Object.keys(zip.files).filter((item) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(item))) {
      const xml = (await zip.file(name)?.async("string")) ?? "";
      const label = /<p:cSld\b[^>]*\bname="([^"]*)"/.exec(xml)?.[1];
      if (label) layouts.push(label);
    }
    return { champs: uniqueFields(tags), structure: { diapositives: slides.length, dispositions: layouts } };
  }
  const tags: string[] = [];
  let titles: string[] = [];
  let tables = 0;
  let slot = false;
  for (const part of wordParts(zip)) {
    const xml = mergeSplitTags((await zip.file(part)?.async("string")) ?? "", "w:p", "w:t");
    tags.push(...collectTags(xml, "w:p", "w:t"));
    if (part !== "word/document.xml") continue;
    tables = (xml.match(/<w:tbl>/g) ?? []).length + (xml.match(/<w:tbl\s/g) ?? []).length;
    const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
    titles = paragraphs.map(headingOf).filter((item): item is string => Boolean(item));
    slot = paragraphs.some((paragraph) => CONTENT_SLOT.test(blockText(paragraph, "w:t").trim()));
    for (const loop of docxLoops(xml)) tags.push(`#${loop.name}`, ...loop.columns.map((column) => `@${loop.name}:${column}`));
  }
  return {
    champs: uniqueFields(tags),
    structure: { titres: titles.slice(0, 40), tableaux: tables, emplacementContenu: slot },
  };
}

function uniqueFields(tags: string[]): TemplateField[] {
  const fields = new Map<string, TemplateField>();
  for (const tag of tags) {
    if (tag.startsWith("/")) continue;
    if (tag.startsWith("@")) {
      const [loop, column] = tag.slice(1).split(":");
      const field = fields.get(`#${loop}`);
      if (field && column && !field.colonnes?.includes(column)) field.colonnes = [...(field.colonnes ?? []), column];
      continue;
    }
    if (tag.startsWith("#")) {
      const nom = tag.slice(1);
      if (!fields.has(tag)) fields.set(tag, { nom, type: "boucle", colonnes: [] });
      continue;
    }
    if (CONTENT_SLOT.test(`{{${tag}}}`)) continue;
    const key = normalizeKey(tag);
    if (![...fields.values()].some((item) => normalizeKey(item.nom) === key)) fields.set(tag, { nom: tag, type: "texte" });
  }
  const loopColumns = new Set(
    [...fields.values()].filter((item) => item.type === "boucle").flatMap((item) => item.colonnes ?? []).map(normalizeKey),
  );
  return [...fields.values()].filter((item) => item.type !== "texte" || !loopColumns.has(normalizeKey(item.nom)));
}

const ROW_PATTERN = /<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type DocxLoop = { name: string; from: number; to: number; block: string; columns: string[] };

function docxLoops(xml: string): DocxLoop[] {
  const rows = [...xml.matchAll(ROW_PATTERN)];
  const loops: DocxLoop[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const open = /\{\{\s*#\s*([^{}]+?)\s*\}\}/.exec(blockText(rows[index][0], "w:t"));
    if (!open) continue;
    const name = open[1];
    const close = new RegExp(`\\{\\{\\s*/\\s*${escapeRegExp(name)}\\s*\\}\\}`);
    let last = index;
    for (let probe = index; probe < rows.length; probe += 1) {
      if (close.test(blockText(rows[probe][0], "w:t"))) {
        last = probe;
        break;
      }
    }
    const from = rows[index].index ?? 0;
    const to = (rows[last].index ?? 0) + rows[last][0].length;
    const block = xml.slice(from, to);
    const columns = [...blockText(block, "w:t").matchAll(TAG_PATTERN)]
      .filter((match) => !match[1])
      .map((match) => match[2].trim());
    loops.push({ name, from, to, block, columns: [...new Set(columns)] });
    index = last;
  }
  return loops;
}

/** Duplique les lignes de tableau encadrées par `{{#nom}}…{{/nom}}`, une copie par ligne de données. */
export function expandDocxLoops(xml: string, spec: DocumentSpec, allowTableFallback: boolean): string {
  const loops = docxLoops(xml);
  let out = xml;
  for (const loop of loops.reverse()) {
    const markers = new RegExp(`\\{\\{\\s*[#/]\\s*${escapeRegExp(loop.name)}\\s*\\}\\}`, "g");
    const cleaned = loop.block.replace(markers, "");
    const rows = loopRows(spec, loop.name, loop.columns, allowTableFallback && loops.length === 1) ?? [];
    const items = rows.length ? rows : [{}];
    const body = items
      .map((item: Record<string, string>) =>
        replaceTags(cleaned, "w:t", (name) => item[name], { lineBreak: WORD_BREAK, missing: () => "" }),
      )
      .join("");
    out = `${out.slice(0, loop.from)}${body}${out.slice(loop.to)}`;
  }
  return out;
}

/**
 * Place les sections rédigées : sous le titre du modèle portant le même nom,
 * et toutes les autres à l'emplacement `{{contenu}}` s'il existe.
 */
export function insertDocxSections(
  xml: string,
  spec: DocumentSpec,
  styles: DocxStyles,
  dna: DesignDna,
): { xml: string; placed: boolean } {
  const used = new Set<number>();
  const SLOT_MARK = "\u0000UBUNTU_IA_CONTENU\u0000";
  let slot = false;
  const next = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const text = blockText(paragraph, "w:t").trim();
    if (CONTENT_SLOT.test(text)) {
      slot = true;
      return SLOT_MARK;
    }
    const heading = headingOf(paragraph);
    if (!heading) return paragraph;
    const key = sectionKey(heading);
    const index = spec.sections.findIndex((section, position) => !used.has(position) && sectionKey(section.title) === key);
    if (index < 0) return paragraph;
    used.add(index);
    return paragraph + sectionXml(spec.sections[index], styles, dna, false);
  });
  if (!slot) return { xml: next, placed: used.size > 0 };
  const rest = spec.sections.filter((_, index) => !used.has(index)).map((section) => sectionXml(section, styles, dna));
  return { xml: next.replace(SLOT_MARK, rest.join("") || "<w:p/>"), placed: true };
}

async function fillDocx(template: Buffer, spec: DocumentSpec, dna: DesignDna): Promise<FillResult> {
  const zip = await JSZip.loadAsync(template);
  const resolve = fieldResolver(spec);
  const missing = new Set<string>();
  const onMissing = (name: string) => {
    missing.add(name);
    return missingField(name);
  };
  const styles = await readDocxStyles(zip);
  let tagged = false;
  let placed = false;
  for (const part of wordParts(zip)) {
    let xml = mergeSplitTags((await zip.file(part)?.async("string")) ?? "", "w:p", "w:t");
    if (xml.includes("{{")) tagged = true;
    if (part === "word/document.xml") {
      xml = expandDocxLoops(xml, spec, true);
      const inserted = insertDocxSections(xml, spec, styles, dna);
      xml = inserted.xml;
      placed = inserted.placed;
    }
    zip.file(part, replaceTags(xml, "w:t", resolve, { lineBreak: WORD_BREAK, missing: onMissing }));
  }
  if (!tagged && !placed) {
    return { bytes: await cloneDocxWithSpec(template, spec, dna), mode: "clone", missing: [], warnings: [] };
  }
  return {
    bytes: await zip.generateAsync({ type: "uint8array" }),
    mode: tagged ? "balises" : "structure",
    missing: [...missing],
    warnings: [],
  };
}

async function fillPptx(template: Buffer, spec: DocumentSpec, synthesized: boolean): Promise<FillResult> {
  const zip = await JSZip.loadAsync(template);
  const slides = slideParts(zip);
  const merged = new Map<string, string>();
  for (const part of slides) {
    merged.set(part, mergeSplitTags((await zip.file(part)?.async("string")) ?? "", "a:p", "a:t"));
  }
  if (![...merged.values()].some((xml) => /\{\{[\s\S]*?\}\}/.test(xml))) {
    return { bytes: await clonePptxWithSpec(template, spec, { synthesized }), mode: "clone", missing: [], warnings: [] };
  }
  const resolve = fieldResolver(spec);
  const missing = new Set<string>();
  for (const [part, xml] of merged) {
    zip.file(
      part,
      replaceTags(xml, "a:t", resolve, {
        missing: (name) => {
          missing.add(name);
          return missingField(name);
        },
      }),
    );
  }
  return { bytes: await zip.generateAsync({ type: "uint8array" }), mode: "balises", missing: [...missing], warnings: [] };
}

/** Produit le livrable à partir d'un modèle du groupe, en conservant sa mise en page. */
export async function fillTemplate(
  format: TemplateFormat,
  template: Buffer,
  spec: DocumentSpec,
  options: { dna?: DesignDna; synthesized?: boolean } = {},
): Promise<FillResult> {
  if (format === "docx") return fillDocx(template, spec, options.dna ?? defaultDna());
  if (format === "pptx") return fillPptx(template, spec, Boolean(options.synthesized));
  const { bytes, report } = await fillXlsxTemplate(template, spec);
  return {
    bytes,
    mode: report.filledTables.length || report.filledNames.length ? "structure" : "balises",
    missing: [],
    warnings: report.warnings,
  };
}
