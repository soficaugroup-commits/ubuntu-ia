import { formatDateFr } from "@/lib/server/brand/document-marks";
import { SOFICAU_ENTITY } from "@/lib/server/brand/soficau-theme";
import type { DocSection, DocumentSpec } from "@/lib/server/document-spec";
import { normalizeKey } from "@/lib/server/ooxml-text";
import { plainInline } from "@/lib/server/rich-text";

/** Texte laissé dans le livrable quand un champ du modèle n'a pas de valeur. */
export function missingField(name: string): string {
  return `[à compléter : ${name}]`;
}

const TITLE_KEYS = new Set(["titre", "title", "intitule", "titre_document"]);
const SUBTITLE_KEYS = new Set(["sous_titre", "soustitre", "subtitle", "objet", "sujet"]);
const DATE_KEYS = new Set(["date", "date_document", "date_du_jour", "aujourd_hui"]);
const ENTITY_KEYS = new Set(["entite", "societe", "organisation", "groupe", "emetteur", "entreprise"]);

/** Clé de section : sans numérotation de tête (« 2. Contexte » → « contexte »). */
export function sectionKey(title: string): string {
  return normalizeKey(title).replace(/^(?:\d+_)+/, "");
}

function sectionText(section: DocSection): string {
  return [
    ...section.body,
    ...section.bullets.map((item) => `• ${item}`),
    ...(section.numbered ?? []).map((item, index) => `${index + 1}. ${item}`),
  ]
    .map((line) => plainInline(line))
    .join("\n");
}

/**
 * Valeur d'une balise `{{champ}}` : bloc `champs` rédigé par le modèle de langage,
 * puis valeurs déductibles (titre, date, entité, section du même nom).
 */
export function fieldResolver(spec: DocumentSpec, now: Date = new Date()): (name: string) => string | undefined {
  const fields = new Map(Object.entries(spec.fields ?? {}).map(([key, value]) => [normalizeKey(key), value]));
  const sections = new Map(spec.sections.map((section) => [sectionKey(section.title), section]));
  return (name) => {
    const key = normalizeKey(name);
    const direct = fields.get(key);
    if (direct !== undefined) return direct.trim() ? direct : undefined;
    if (TITLE_KEYS.has(key)) return spec.title;
    if (SUBTITLE_KEYS.has(key)) return spec.subtitle || spec.title;
    if (DATE_KEYS.has(key)) return formatDateFr(now);
    if (ENTITY_KEYS.has(key)) return SOFICAU_ENTITY;
    const section = sections.get(key);
    if (section) return sectionText(section);
    return undefined;
  };
}

/**
 * Lignes d'une boucle ou d'un tableau du modèle, indexées par nom de colonne du modèle.
 * Source : bloc `lignes` du même nom, sinon (si autorisé) le premier tableau de la réponse.
 */
export function loopRows(
  spec: DocumentSpec,
  name: string,
  columns: string[],
  allowTableFallback: boolean,
): Record<string, string>[] | null {
  const loops = Object.entries(spec.loops ?? {});
  const named = loops.find(([key]) => normalizeKey(key) === normalizeKey(name))?.[1];
  if (named) return named.map((row) => remap(row, columns));
  if (!allowTableFallback) return null;
  const table = spec.sections.find((section) => section.table)?.table;
  if (!table) return null;
  const headerKeys = table.headers.map((header) => normalizeKey(header));
  const matches = columns.map((column) => headerKeys.indexOf(normalizeKey(column)));
  const anyMatch = matches.some((index) => index >= 0);
  return table.rows.map((row) => {
    const item: Record<string, string> = {};
    columns.forEach((column, position) => {
      const index = anyMatch ? matches[position] : position;
      item[column] = index >= 0 ? plainInline(row[index] ?? "") : "";
    });
    return item;
  });
}

function remap(row: Record<string, string>, columns: string[]): Record<string, string> {
  const byKey = new Map(Object.entries(row).map(([key, value]) => [normalizeKey(key), value]));
  const item: Record<string, string> = {};
  for (const column of columns) item[column] = byKey.get(normalizeKey(column)) ?? "";
  return item;
}
