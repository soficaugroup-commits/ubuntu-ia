/**
 * Logique pure (sans réseau) de la catégorie Méthodologie.
 * Les documents « méthodologie » sont des références de STRUCTURE : rapports types,
 * trames d'audit, modèles de bailleurs (GIZ, BDO, UE…). Ils guident la rédaction,
 * ne sont jamais cités et leurs faits ou chiffres ne sont jamais recopiés.
 */

export { isMethodologyCategory, METHODOLOGY_CATEGORY } from "@/lib/methodology-category";

const WRITING_INTENT =
  /\b(r[eé]dige[rz]?|r[eé]daction|[eé]cri[st]|[eé]crire|pr[eé]pare[rz]?|produi[st]|[eé]labore[rz]?|g[eé]n[eè]re[rz]?|reprend[sz]?|reformule[rz]?|structure[rz]?|compare[rz]?|comparaison|comparatif|analyse[rz]?|[eé]value[rz]?|[eé]valuation|audite[rz]?|synth[eè]se|synth[eé]tise[rz]?)\b/i;

const DELIVERABLE_WORD =
  /\b(rapport|audit|compte[- ]rendu|note|m[eé]mo|offre|proposition|tdr|termes de r[eé]f[eé]rence|cahier des charges|[eé]tude|diagnostic|bilan|plan d['’]action|strat[eé]gie|m[eé]thodologie|revue|[eé]valuation|comparaison|comparatif|benchmark|analyse|synth[eè]se|livrable|document|dossier|r[eé]sum[eé] ex[eé]cutif|matrice|grille)\b/i;

/**
 * La demande appelle-t-elle une rédaction structurée (rapport, audit, comparaison…) ?
 * Un livrable fichier ou un canevas suffit aussi à déclencher la méthodologie.
 */
export function wantsMethodology(
  question: string,
  options: { deliverable?: boolean; mode?: "answer" | "task" | "hybrid" } = {},
): boolean {
  const text = question.trim();
  if (!text) return false;
  if (options.deliverable) return true;
  const writes = WRITING_INTENT.test(text);
  const deliverable = DELIVERABLE_WORD.test(text);
  if (writes && deliverable) return true;
  return options.mode !== "answer" && deliverable && text.length > 40;
}

const STOP = new Set([
  "les", "une", "des", "dans", "pour", "par", "sur", "avec", "sans", "que", "qui", "est",
  "sont", "pas", "plus", "rapport", "document", "fichier", "rediger", "redige", "faire",
  "fais", "moi", "nous", "vous", "cette", "notre", "votre", "leur", "aux", "the", "and",
  "methodologie", "modele", "version", "final", "finale", "projet",
]);

export function titleTokens(text: string): string[] {
  const words =
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]{2,}/g) ?? [];
  return [...new Set(words.filter((word) => !STOP.has(word)))];
}

/**
 * Score de correspondance entre la demande et le titre d'un document de méthodologie.
 * Les sigles courts (GIZ, BDO, UE, AFD…) comptent double : ce sont eux qui désignent
 * le bon modèle (« un rapport pour la GIZ » → la trame GIZ).
 */
export function titleMatchScore(question: string, title: string): number {
  const asked = new Set(titleTokens(question));
  let score = 0;
  for (const token of titleTokens(title)) {
    if (!asked.has(token)) continue;
    score += token.length <= 4 ? 2 : 1;
  }
  return score;
}

export type MethodologyCandidate = {
  documentId: string;
  titre: string;
  /** Meilleure similarité vectorielle d'un segment du document (0 si aucun). */
  similarite: number;
  /** Nombre de segments retrouvés. */
  hits: number;
};

/**
 * Choisit au plus `limit` documents : d'abord ceux que la demande désigne par leur titre,
 * puis les plus proches sémantiquement.
 */
export function rankMethodologyDocuments(
  question: string,
  candidates: MethodologyCandidate[],
  limit = 2,
  minSimilarity = 0.3,
): MethodologyCandidate[] {
  const scored = candidates.map((item) => ({
    item,
    title: titleMatchScore(question, item.titre),
    semantic: item.similarite + Math.min(item.hits, 6) * 0.01,
  }));
  const named = scored.filter((row) => row.title > 0);
  const pool = named.length ? named : scored.filter((row) => row.item.similarite >= minSimilarity);
  return pool
    .sort((a, b) => b.title - a.title || b.semantic - a.semantic)
    .slice(0, limit)
    .map((row) => row.item);
}

const HEADING_MARKDOWN = /^#{1,4}\s+\S/;
const HEADING_NUMBERED = /^((\d{1,2}(\.\d{1,2}){0,3})|([IVXLC]{1,5})|([A-H]))[.)\-–]\s+\S.{0,110}$/;
const HEADING_KEYWORD =
  /^(introduction|contexte|objectifs?|m[eé]thodologie|approche|r[eé]sum[eé]( ex[eé]cutif)?|synth[eè]se|constats?|r[eé]sultats?|analyse|recommandations?|conclusions?|annexes?|sommaire|table des mati[eè]res|limites|le[cç]ons apprises|perspectives|plan d['’]action|calendrier|budget)\b.{0,80}$/i;

/** Extrait le plan (titres) d'un texte indexé, dans l'ordre, sans doublons. */
export function extractOutline(text: string, max = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length < 3 || line.length > 120) continue;
    const isHeading =
      HEADING_MARKDOWN.test(line) ||
      HEADING_NUMBERED.test(line) ||
      HEADING_KEYWORD.test(line) ||
      (line.length <= 70 && /^[A-ZÀ-ÖØ-Þ0-9][A-ZÀ-ÖØ-Þ0-9 '’,&/()-]{4,}$/.test(line));
    if (!isHeading) continue;
    if (/[.;]$/.test(line) && !HEADING_MARKDOWN.test(line)) continue;
    const clean = line.replace(/^#{1,4}\s+/, "");
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

export type MethodologyReference = {
  documentId: string;
  titre: string;
  plan: string[];
  extraits: string[];
};

/** Budget de caractères injectés par référence (borne coût et latence). */
export const METHODOLOGY_CHAR_BUDGET = 9_000;

/** Bloc d'instructions système à partir des références choisies. */
export function formatMethodologyBrief(references: MethodologyReference[]): string {
  if (!references.length) return "";
  const blocks = references.map((ref, index) => {
    const plan = ref.plan.length
      ? `Plan de la référence :\n${ref.plan.map((item) => `- ${item}`).join("\n")}`
      : "Plan de la référence : non détecté — déduis-le des extraits.";
    const body = ref.extraits.join("\n…\n").slice(0, METHODOLOGY_CHAR_BUDGET);
    return `Référence ${index + 1} — « ${ref.titre} »\n${plan}\n\nExtraits de la référence (forme, ton, niveau de détail) :\n${body}`;
  });
  return [
    "RÉFÉRENCES MÉTHODOLOGIQUES INTERNES (usage confidentiel — NE JAMAIS CITER).",
    "Ces documents viennent de la catégorie Méthodologie. Ce sont des modèles de structure, pas des sources.",
    "Pour rédiger la réponse ou le livrable :",
    "1. Reprends la structure de la référence la plus adaptée à la demande : ordre et intitulés des sections, sous-parties, tableaux et grilles d'analyse, critères d'évaluation, niveau de détail, ton et terminologie.",
    "2. Adapte le contenu à la demande, au contexte et aux sources réelles (extraits indexés numérotés, pièces jointes, web). Supprime les sections sans objet, ajoute celles que la demande exige.",
    "3. Ne recopie jamais les faits, chiffres, noms, dates ou constats propres à la référence : ils concernent un autre dossier.",
    "4. Ne mentionne pas ces références, ne les numérote pas, ne les ajoute pas aux sources, aucun [n] pour elles.",
    "5. Si la demande vise explicitement un bailleur, un client ou un cabinet (GIZ, BDO…), suis la référence qui le concerne en priorité.",
    "",
    ...blocks,
  ].join("\n");
}
