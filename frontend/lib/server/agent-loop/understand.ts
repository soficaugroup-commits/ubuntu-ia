import { parseUnderstanding, type Understanding } from "@/lib/server/agent-loop/schema";

export type { Understanding };

/** Heuristique si le LLM est absent : reformule sans inventer d'information. */
export function understandFromQuestion(question: string): Understanding {
  const text = question.trim();
  const missing: string[] = [];
  if (/\b(son|sa|ses|leur|cette personne|le client)\b/i.test(text) && !/\b(nom|société|societe|référence|reference)\b/i.test(text)) {
    missing.push("Précisez le destinataire ou l'entité concernée.");
  }
  return {
    objectif: text.slice(0, 400),
    livrables: [],
    contraintes: ["Ne pas inventer de fait interne."],
    infos_manquantes: missing,
    risques: [],
  };
}

export function understandingOf(raw: unknown, fallback: string): Understanding {
  return parseUnderstanding(raw) ?? understandFromQuestion(fallback);
}
