import { SOFICAU_COLORS, SOFICAU_ENTITY } from "@/lib/server/brand/soficau-theme";
import type { DesignDna } from "@/lib/server/design-dna";
import type { DocumentSpec } from "@/lib/server/document-spec";

export type DocumentMarks = {
  /** Sur-titre de couverture (« UBUNTU IA » ou marque du modèle). */
  eyebrow: string;
  /** Entité émettrice affichée en en-tête et en couverture. */
  signature: string;
  /** Vrai quand le livrable porte la charte SOFICAU par défaut (pas de modèle importé). */
  brand: boolean;
};

export function documentMarks(spec: DocumentSpec, dna: DesignDna): DocumentMarks {
  const brand =
    dna.primary.toUpperCase() === SOFICAU_COLORS.navy &&
    dna.accent.toUpperCase() === SOFICAU_COLORS.gold &&
    !dna.headerLabel &&
    !dna.sourceName;
  return {
    eyebrow: spec.design?.marque?.trim() || dna.headerLabel?.trim() || (brand ? "UBUNTU IA" : ""),
    signature: spec.design?.signature?.trim() || (brand ? SOFICAU_ENTITY : dna.sourceName || ""),
    brand,
  };
}

export function formatDateFr(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

/** Titres qui comptent pour la table des matières (niveaux 1 et 2). */
export function tocHeadingCount(spec: DocumentSpec): number {
  return spec.sections.filter((section) => (section.level ?? 1) <= 2).length;
}

export const TOC_MIN_HEADINGS = 3;
