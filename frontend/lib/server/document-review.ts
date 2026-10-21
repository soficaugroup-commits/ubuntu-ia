import type { DocumentSpec } from "@/lib/server/document-spec";
import { isTotalLabel, parseNumber } from "@/lib/server/xlsx-cells";
import type { ReviewAlert, ReviewCorrection, ReviewReport, ReviewStatus } from "@/lib/types";

const CONFIRM_MARK = "[à confirmer]";
const TOTAL_TOLERANCE = 0.051;
const PAST_HINT =
  /\b(a eu lieu|s['’]est tenu|s['’]est d[eé]roul[eé]|r[eé]alis[eé]|cl[oô]tur[eé]|vers[eé]|sign[eé]|publi[eé]|constat[eé]|enregistr[eé])\b/i;
const MONTHS: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  février: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  août: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
  décembre: 12,
};

export type ReviewInput = {
  spec: DocumentSpec;
  question: string;
  excerpts: string[];
  /** Nombre d'extraits citables : `[n]` est valide si 1 ≤ n ≤ citationCount. */
  citationCount: number;
  now?: Date;
  /** Vérificateur LLM optionnel (absent dans les tests). */
  verifyClaims?: (spec: DocumentSpec, excerpts: string[]) => Promise<ReviewAlert[]>;
};

export type ReviewResult = { spec: DocumentSpec; report: ReviewReport };

/** Relecture d'un livrable sur sa spec, avant construction des fichiers. */
export async function reviewDeliverable(input: ReviewInput): Promise<ReviewResult> {
  const spec = cloneSpec(input.spec);
  const corrections: ReviewCorrection[] = [];
  const alertes: ReviewAlert[] = [];
  const computed = new Set<string>();

  reviewTables(spec, corrections, alertes, computed);
  reviewNumbers(spec, input, computed, alertes);
  reviewCitations(spec, input.citationCount, alertes);
  reviewDates(spec, input.now ?? new Date(), alertes);

  if (input.verifyClaims && input.excerpts.some((item) => item.trim())) {
    try {
      const extra = await input.verifyClaims(spec, input.excerpts);
      for (const alert of extra) {
        if (alert.type === "fait_non_etaye" && alert.extrait.trim()) alertes.push(alert);
      }
    } catch (error) {
      console.error("[review] vérificateur", error);
    }
  }

  const marked = markUnsourced(spec, alertes, corrections);
  return { spec: marked, report: { statut: statusOf(corrections, alertes), corrections, alertes } };
}

function statusOf(corrections: ReviewCorrection[], alertes: ReviewAlert[]): ReviewStatus {
  if (alertes.length) return "a_verifier";
  if (corrections.length) return "corrige";
  return "ok";
}

function cloneSpec(spec: DocumentSpec): DocumentSpec {
  return structuredClone(spec);
}

function reviewTables(
  spec: DocumentSpec,
  corrections: ReviewCorrection[],
  alertes: ReviewAlert[],
  computed: Set<string>,
): void {
  for (const section of spec.sections) {
    const table = section.table;
    if (!table?.rows.length) continue;
    table.rows.forEach((row, index) => {
      if (!isTotalLabel(row[0] ?? "")) return;
      const data = table.rows.slice(0, index).filter((item) => !isTotalLabel(item[0] ?? ""));
      if (!data.length) return;
      for (let col = 1; col < table.headers.length; col += 1) {
        const values = data.map((item) => parseNumber(item[col] ?? "")).filter((item): item is number => item !== null);
        if (values.length < 2 || values.length < data.length - 1) continue;
        const expected = round(values.reduce((sum, item) => sum + item, 0));
        computed.add(keyOf(expected));
        const cell = row[col] ?? "";
        const actual = parseNumber(cell);
        if (actual === null) continue;
        if (Math.abs(actual - expected) <= TOTAL_TOLERANCE) continue;
        const next = formatLike(cell, expected);
        if (unambiguousTotal(table.rows, col)) {
          corrections.push({
            type: "total",
            extrait: `${row[0] ?? "Total"} / ${table.headers[col] ?? `col. ${col}`}`,
            avant: cell,
            apres: next,
          });
          row[col] = next;
        } else {
          alertes.push({
            type: "total_incorrect",
            extrait: cell,
            explication: `Le total « ${cell} » devrait valoir ${next} (somme de la colonne).`,
          });
        }
      }
    });
  }
}

function unambiguousTotal(rows: string[][], col: number): boolean {
  const totals = rows.filter((row) => isTotalLabel(row[0] ?? ""));
  return totals.length === 1 && totals.every((row) => parseNumber(row[col] ?? "") !== null);
}

function reviewNumbers(
  spec: DocumentSpec,
  input: ReviewInput,
  computed: Set<string>,
  alertes: ReviewAlert[],
): void {
  const pool = new Set<string>([
    ...extractNumbers(`${input.question}\n${input.excerpts.join("\n")}`).map((item) => keyOf(item.value)),
    ...computed,
  ]);
  const seen = new Set<string>();
  for (const item of extractNumbers(specText(spec))) {
    const key = keyOf(item.value);
    if (seen.has(key) || pool.has(key) || skipNumber(item.value)) continue;
    seen.add(key);
    alertes.push({
      type: "chiffre_non_source",
      extrait: item.raw,
      explication: `Le chiffre ${item.raw} n'apparaît ni dans la question, ni dans les pièces, ni dans les extraits cités, ni dans un calcul du tableau.`,
    });
  }
}

function reviewCitations(spec: DocumentSpec, citationCount: number, alertes: ReviewAlert[]): void {
  const text = specText(spec);
  const seen = new Set<number>();
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const index = Number(match[1]);
    if (seen.has(index)) continue;
    seen.add(index);
    if (index < 1 || index > citationCount) {
      alertes.push({
        type: "citation_manquante",
        extrait: match[0],
        explication:
          citationCount < 1
            ? `La citation ${match[0]} ne renvoie à aucun extrait fourni.`
            : `La citation ${match[0]} ne correspond à aucun des ${citationCount} extraits fournis.`,
      });
    }
  }
}

function reviewDates(spec: DocumentSpec, now: Date, alertes: ReviewAlert[]): void {
  const text = specText(spec);
  for (const found of extractDates(text)) {
    if (found.date.getTime() <= now.getTime()) continue;
    const window = text.slice(Math.max(0, found.index - 48), found.index + found.raw.length + 24);
    if (!PAST_HINT.test(window)) continue;
    alertes.push({
      type: "date_incoherente",
      extrait: found.raw,
      explication: `La date ${found.raw} est dans le futur alors que le texte la présente comme un fait passé.`,
    });
  }
}

function markUnsourced(spec: DocumentSpec, alertes: ReviewAlert[], corrections: ReviewCorrection[]): DocumentSpec {
  const snippets = alertes
    .filter((alert) => alert.type === "chiffre_non_source" || alert.type === "fait_non_etaye")
    .map((alert) => alert.extrait.trim())
    .filter((item) => item.length >= 2);
  if (!snippets.length) return spec;
  const visit = (value: string): string => {
    let next = value;
    for (const snippet of snippets) {
      if (!next.includes(snippet) || next.includes(CONFIRM_MARK)) continue;
      const apres = `${next} ${CONFIRM_MARK}`;
      corrections.push({ type: "marquage", extrait: snippet, avant: next, apres });
      next = apres;
      break;
    }
    return next;
  };
  for (const section of spec.sections) {
    section.body = section.body.map(visit);
    section.bullets = section.bullets.map(visit);
    if (section.numbered) section.numbered = section.numbered.map(visit);
    if (section.table) {
      section.table.headers = section.table.headers.map(visit);
      section.table.rows = section.table.rows.map((row) => row.map(visit));
    }
  }
  if (spec.fields) {
    spec.fields = Object.fromEntries(Object.entries(spec.fields).map(([key, value]) => [key, visit(value)]));
  }
  return spec;
}

function specText(spec: DocumentSpec): string {
  const parts = [spec.title, spec.subtitle];
  for (const section of spec.sections) {
    parts.push(section.title, ...section.body, ...section.bullets, ...(section.numbered ?? []));
    if (section.table) {
      parts.push(...section.table.headers, ...section.table.rows.flat());
    }
    if (section.chart) {
      parts.push(section.chart.title, ...section.chart.categories);
    }
  }
  if (spec.fields) parts.push(...Object.values(spec.fields));
  if (spec.kpis) parts.push(...spec.kpis.map((item) => `${item.value} ${item.label}`));
  return parts.join("\n");
}

function extractNumbers(text: string): { raw: string; value: number }[] {
  const found: { raw: string; value: number }[] = [];
  const pattern = /\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?|\d+[.,]\d+|\d+\s?%|\d{2,}/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0].replace(/\s?%$/, "");
    const value = parseNumber(raw);
    if (value !== null) found.push({ raw: match[0], value });
  }
  return found;
}

function skipNumber(value: number): boolean {
  if (value === 0) return true;
  if (Number.isInteger(value) && value >= 1 && value <= 12) return true;
  if (Number.isInteger(value) && value >= 1900 && value <= 2100) return true;
  return false;
}

function keyOf(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatLike(sample: string, value: number): string {
  const integer = Number.isInteger(value) && !/[.,]/.test(sample);
  if (integer) {
    return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
  const [whole, frac = ""] = value.toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${frac}`;
}

function extractDates(text: string): { raw: string; date: Date; index: number }[] {
  const found: { raw: string; date: Date; index: number }[] = [];
  const numeric = /(\d{1,2})\/(\d{1,2})\/(\d{4})/g;
  for (const match of text.matchAll(numeric)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    found.push({
      raw: match[0],
      date: new Date(year, month - 1, day),
      index: match.index ?? 0,
    });
  }
  const named = new RegExp(
    `(\\d{1,2})\\s+(${Object.keys(MONTHS).join("|")})\\s+(\\d{4})`,
    "gi",
  );
  for (const match of text.matchAll(named)) {
    const month = MONTHS[match[2].toLowerCase()];
    if (!month) continue;
    found.push({
      raw: match[0],
      date: new Date(Number(match[3]), month - 1, Number(match[1])),
      index: match.index ?? 0,
    });
  }
  return found;
}
