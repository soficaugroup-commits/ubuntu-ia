import type { FileFormat } from "@/lib/types";

/** Format du fichier à produire, lu dans la description de l'étape ou l'objectif. */
export function formatOf(text: string): Extract<FileFormat, "docx" | "pptx" | "xlsx" | "pdf"> {
  if (/\b(pptx|powerpoint|diaporama|diapos?)\b/i.test(text)) return "pptx";
  if (/\b(xlsx|excel|classeur)\b/i.test(text)) return "xlsx";
  if (/\bpdf\b/i.test(text)) return "pdf";
  return "docx";
}

/**
 * Brouillon strictement issu des extraits. Sans extrait, le texte le dit
 * et n'ajoute aucun chiffre.
 */
export function draftFromContext(objectif: string, extraits: string[]): string {
  const title = objectif.trim().slice(0, 180) || "Livrable";
  if (!extraits.length) {
    return `# ${title}\n\nAucun extrait interne n'a été trouvé. Ce brouillon ne contient aucun fait ajouté.`;
  }
  const body = extraits
    .map((item, index) => item.trim())
    .filter(Boolean)
    .map((item, index) => `${item} [${index + 1}]`)
    .join("\n\n");
  return `# ${title}\n\n${body}`;
}
