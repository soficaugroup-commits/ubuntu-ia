import "server-only";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DesignDna } from "@/lib/server/design-dna";
import { loadDocumentSkillPrompt } from "@/lib/server/document-skills";
import type { DocumentSpec } from "@/lib/server/document-spec";
import type { FileFormat } from "@/lib/types";

export const DIRECT_LIMIT = 100;

const RULES: Partial<Record<FileFormat, string[]>> = {
  docx: [
    "Styles de titre natifs Titre 1 à 3, pas un gras manuel à la place du style.",
    "Une police de titres, une police de corps, marges et interligne homogènes.",
    "Images aux proportions d'origine, sans débordement.",
  ],
  pptx: [
    "Un masque et des mises en page réutilisés.",
    "Peu de lignes par diapositive.",
    "Contraste du texte sur le fond vérifié.",
  ],
  xlsx: [
    "Formules calculées, pas de totaux figés.",
    "Tableaux structurés pour que les formules s'étendent.",
    "Mise en forme conditionnelle sur les mesures.",
  ],
  pdf: [
    "Génération directe ou remplissage du formulaire.",
    "Pas de conversion externe.",
  ],
  html: [
    "Page autonome, CSS et script inclus, sans dépendance externe.",
  ],
};

export type GuideBrief = {
  format: FileFormat;
  consulted: true;
  chars: number;
};

export function consultGuide(format: FileFormat): GuideBrief {
  const asked: FileFormat[] =
    format === "csv" ? ["xlsx"] : format === "docx" || format === "pptx" || format === "xlsx" || format === "pdf" ? [format] : [];
  const text = loadDocumentSkillPrompt(asked);
  if (!text.trim()) {
    throw new Error(`Guide ${format} absent : aucun fichier n'est écrit.`);
  }
  return { format, consulted: true, chars: text.length };
}

export function assertGuide(guide: GuideBrief | undefined, format: FileFormat): void {
  if (!guide?.consulted || guide.format !== format) {
    throw new Error(`Le guide ${format} n'a pas été consulté avant l'écriture.`);
  }
}

export function elementCount(spec: DocumentSpec): number {
  let count = spec.sections.length;
  for (const section of spec.sections) {
    count += section.body.length + section.bullets.length + (section.numbered?.length ?? 0);
    count += section.table ? section.table.rows.length + 1 : 0;
    count += section.chart ? section.chart.categories.length : 0;
  }
  return count;
}

export function isLong(spec: DocumentSpec): boolean {
  return elementCount(spec) >= DIRECT_LIMIT;
}

export function ensureContrast(dna: DesignDna): DesignDna {
  const next = { ...dna, chartColors: [...dna.chartColors] };
  if (contrast(next.text, next.canvas) < 4.5) {
    next.text = luminance(next.canvas) > 0.45 ? "17405B" : "FFFFFF";
  }
  if (contrast(next.inverse, next.primary) < 4.5) {
    next.inverse = luminance(next.primary) > 0.45 ? "17405B" : "FFFFFF";
  }
  if (contrast(next.accent, next.primary) < 3) {
    next.accent = luminance(next.primary) > 0.45 ? "17405B" : "E8EEF2";
  }
  return next;
}

export async function stageDeliverable(name: string, bytes: Uint8Array): Promise<Buffer> {
  const root = await mkdtemp(join(tmpdir(), "ubuntu-ia-"));
  const work = join(root, "travail", name);
  const out = join(root, "sortie", name);
  try {
    await mkdir(dirname(work), { recursive: true });
    await mkdir(dirname(out), { recursive: true });
    await writeFile(work, bytes);
    await copyFile(work, out);
    return await readFile(out);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export function guideRules(format: FileFormat): string[] {
  return RULES[format] ?? [];
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
