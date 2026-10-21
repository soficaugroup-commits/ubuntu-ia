import { normalizeKey } from "@/lib/server/ooxml-text";
import type { DocumentTemplate, TemplateFormat } from "@/lib/types";

/**
 * Modèle cité dans la demande (« avec le modèle Offre commerciale », « sur notre trame de devis »…).
 * Correspondance sur les mots du nom ; « rédige un modèle de contrat » ne doit pas déclencher un modèle sans rapport.
 */
export function matchTemplate(
  question: string,
  templates: DocumentTemplate[],
  format?: TemplateFormat,
): DocumentTemplate | null {
  const asked = /\b(mod[eè]le|trame|gabarit|canevas|template)\b/i.test(question);
  if (!asked) return null;
  const text = ` ${normalizeKey(question).replace(/_/g, " ")} `;
  const pool = format ? templates.filter((item) => item.format === format) : templates;
  let best: { template: DocumentTemplate; score: number } | null = null;
  for (const template of pool) {
    const words = normalizeKey(template.nom).split("_").filter((word) => word.length > 2);
    if (!words.length) continue;
    const hits = words.filter((word) => text.includes(` ${word} `)).length;
    const score = hits / words.length;
    if (score >= 0.6 && (!best || score > best.score)) best = { template, score };
  }
  return best?.template ?? null;
}
