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
    livrables: deliverablesFromQuestion(text),
    contraintes: ["Ne pas inventer de fait interne."],
    infos_manquantes: missing,
    risques: [],
  };
}

/** Livrables cités dans la demande. Sans format explicite : un seul livrable générique. */
export function deliverablesFromQuestion(question: string): string[] {
  const items: string[] = [];
  if (/\b(word|docx|note)\b/i.test(question)) items.push("une note Word");
  if (/\b(powerpoint|pptx|diaporama|diapos?)\b/i.test(question)) items.push("un diaporama PowerPoint");
  if (/\b(excel|xlsx|classeur)\b/i.test(question)) items.push("un classeur Excel");
  if (/\bpdf\b/i.test(question)) items.push("un PDF");
  return items.length ? items : ["le livrable demandé"];
}

export function understandingOf(raw: unknown, fallback: string): Understanding {
  return parseUnderstanding(raw) ?? understandFromQuestion(fallback);
}
