import JSZip from "jszip";
import type { FileFormat } from "@/lib/types";

export type ValidationResult = { ok: boolean; problems: string[] };

/** Parties OOXML sans lesquelles Word, PowerPoint ou Excel refusent d'ouvrir le fichier. */
const REQUIRED_PARTS: Partial<Record<FileFormat, Array<string | RegExp>>> = {
  docx: ["[Content_Types].xml", "_rels/.rels", "word/document.xml"],
  pptx: ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", /^ppt\/slides\/slide\d+\.xml$/],
  xlsx: ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", /^xl\/worksheets\/sheet\d+\.xml$/],
};

/**
 * Validation locale minimale, toujours exécutée avant livraison :
 * archive lisible, parties obligatoires présentes, XML non vide. Le worker bureautique
 * (`validate_ooxml`, `xlsx_recalc`) complète ensuite cette vérification quand il est configuré.
 */
export async function validateGenerated(format: FileFormat, bytes: Uint8Array): Promise<ValidationResult> {
  if (!bytes.length) return { ok: false, problems: ["Fichier vide."] };
  if (format === "pdf") return validatePdf(bytes);
  const required = REQUIRED_PARTS[format];
  if (!required) return { ok: true, problems: [] };

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return { ok: false, problems: ["Archive Office illisible."] };
  }
  const names = Object.keys(zip.files);
  const problems: string[] = [];
  for (const part of required) {
    const found = typeof part === "string" ? names.includes(part) : names.some((name) => part.test(name));
    if (!found) problems.push(`Partie manquante : ${String(part)}`);
  }
  for (const name of names.filter((item) => item.endsWith(".xml") || item.endsWith(".rels"))) {
    const xml = (await zip.file(name)?.async("string"))?.trimStart() ?? "";
    if (!xml.startsWith("<")) problems.push(`XML invalide : ${name}`);
  }
  if (format === "docx") {
    const body = (await zip.file("word/document.xml")?.async("string")) ?? "";
    if (!/<w:body\b/.test(body)) problems.push("Corps du document Word absent.");
  }
  return { ok: problems.length === 0, problems };
}

function validatePdf(bytes: Uint8Array): ValidationResult {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 8));
  const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 1024)));
  const problems: string[] = [];
  if (!head.startsWith("%PDF-")) problems.push("En-tête PDF absent.");
  if (!tail.includes("%%EOF")) problems.push("Fin de fichier PDF absente.");
  return { ok: problems.length === 0, problems };
}

/** Le worker bureautique n'est sollicité que s'il est déployé (sinon les jobs resteraient en file). */
export function officeWorkerEnabled(): boolean {
  return Boolean(process.env.OFFICE_WORKER_URL?.trim());
}
