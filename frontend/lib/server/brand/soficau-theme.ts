/**
 * Charte SOFICAU appliquée aux livrables (Word, PDF, Excel, PowerPoint, HTML).
 * Source unique : les générateurs lisent ces valeurs, jamais des couleurs codées en dur.
 * Couleurs en hexadécimal sans « # » (format attendu par docx, pptxgenjs, ExcelJS).
 */
export const SOFICAU_COLORS = {
  navy: "17405B",
  gold: "AD8859",
  canvas: "E8EEF2",
  /** Texte atténué dérivé du marine (légendes, pieds de page). */
  mid: "3D6A82",
  /** Or éclairci, troisième teinte des graphiques. */
  sand: "C4A574",
  white: "FFFFFF",
  /** Zébrure très claire des lignes de tableau, dérivée du canvas. */
  zebra: "F3F6F8",
  /** Bordure fine des tableaux, dérivée du marine. */
  rule: "C5D0D6",
  /** Texte clair posé sur le marine (sous-titres de couverture). */
  onNavyMuted: "DCE6EC",
} as const;

/**
 * Poppins est la police de l'interface. Elle n'est pas installée chez la plupart des destinataires :
 * les fichiers Office utilisent le repli Calibri (puis Arial) pour un rendu identique partout.
 */
export const SOFICAU_FONTS = {
  brand: "Poppins",
  office: "Calibri",
  fallback: "Arial",
} as const;

/** Tailles en points. */
export const SOFICAU_TYPE = {
  title: 28,
  h1: 16,
  h2: 13,
  h3: 12,
  body: 11,
  small: 9,
  table: 10,
  /** Interligne du corps (multiple). */
  lineHeight: 1.15,
  /** Espace après paragraphe (points). */
  paragraphAfter: 8,
} as const;

/** Marges A4 en millimètres. */
export const SOFICAU_PAGE = {
  widthMm: 210,
  heightMm: 297,
  marginMm: 20,
} as const;

export const SOFICAU_TABLE = {
  headerFill: SOFICAU_COLORS.navy,
  headerText: SOFICAU_COLORS.white,
  zebraFill: SOFICAU_COLORS.zebra,
  bodyFill: SOFICAU_COLORS.white,
  border: SOFICAU_COLORS.rule,
  /** Épaisseur de bordure en huitièmes de point (unité Word). */
  borderSize: 4,
} as const;

export const SOFICAU_CHART_COLORS = [
  SOFICAU_COLORS.navy,
  SOFICAU_COLORS.gold,
  SOFICAU_COLORS.mid,
  SOFICAU_COLORS.sand,
] as const;

export const SOFICAU_ENTITY = "SOFICAU Ubuntu Group";
export const SOFICAU_PRODUCT = "Ubuntu IA";

/** Conversions d'unités utiles aux générateurs. */
export const units = {
  mmToTwip: (mm: number) => Math.round((mm / 25.4) * 1440),
  mmToPt: (mm: number) => (mm / 25.4) * 72,
  ptToHalfPt: (pt: number) => Math.round(pt * 2),
  ptToTwip: (pt: number) => Math.round(pt * 20),
};
