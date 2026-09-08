import type { ChatTools, FileFormat } from "@/lib/types";

const IMAGE_WORD =
  "(image|illustration|visuel|logo|affiche|photo|infographie|pictogramme|ic[oô]ne|poster)";
const IMAGE_INTENT = new RegExp(
  String.raw`\b((g[eé]n[eè]re|cr[eé]e[rz]?|dessine|illustre|imagine|fais|faites|pr[eé]pare)[- ]?(moi\s+)?(une?\s+)?${IMAGE_WORD}|(je veux|j['’]aimerais|peux-tu|pourrais-tu)\s+(me\s+)?((faire|cr[eé]er|g[eé]n[eé]rer|dessiner)\s+)?(une?\s+)?${IMAGE_WORD}|(generate|create|draw|make)\s+(an?\s+)?(image|illustration|logo|poster|icon))\b`,
  "i",
);

const CANVAS_INTENT =
  /\b(canevas|canvas)\b|\b((r[eé]dige|pr[eé]pare|cr[eé]e[rz]?)\s+(moi\s+)?(un|une)\s+(document|livrable|note de service|compte[- ]rendu|brief|m[eé]mo|plan d['’]action|cahier des charges|pr[eé]sentation|mod[eè]le|contrat|politique|proc[eé]dure|script|programme))\b/i;

const COMPLEX_INTENT =
  /\b(analyse|explique|compare|d[eé]veloppe|pourquoi|comment|code|calcul|d[eé]montre|planifie|r[eé]dige|optimise|d[eé]bug|refactor|architecture|preuve|mod[eè]le)\b/i;

const FILE_INTENT =
  /\b(pdf|docx?|xlsx?|pptx?|csv|powerpoint|excel|word|classeur|diapos?|pr[eé]sentation|t[eé]l[eé]chargeable|t[eé]l[eé]charge[rz]?|exporte[rz]?|export(er)?|fichier (word|excel|pdf|powerpoint))\b/i;

const EDIT_INTENT =
  /\b(modifie[rz]?|corrige[rz]?|mets? [àa] jour|actualise[rz]?|ajoute[rz]?|retire[rz]?|change[rz]?|compl[eè]te[rz]?|convertis|transforme[rz]?|adapte[rz]?|mets? en forme|applique[rz]?|reproduis|inspire[- ]toi|habillage)\b/i;

const STYLE_TRANSFER =
  /\b(style|design|mise en forme|mod[eè]le|template|charte|habillage|applique|reproduis|inspire[- ]toi)\b/i;

const PHOTO_TRANSFORM = new RegExp(
  String.raw`\b(place[- ]?(moi|le|la|nous|cette personne)|mets?(ez)?[- ]?(moi|me|le|la|nous)|int[eè]gre[- ]?moi|pose[- ]?moi|remets[- ]?moi|change(?:r|z)? (le |mon |la )?(fond|d[eé]cor|arri[eè]re[- ]?plan)|enl[eè]ve(?:r|z)? (le )?fond|d[eé]toure|retouche|photoshop|dans un (cadre|bureau|studio|d[eé]cor)|cadre professionnel(?:le)?|portrait professionnel|mise en situation|fond (blanc|noir|neutre|studio|bureau|professionnel)|en studio|photo professionnelle)\b`,
  "i",
);

export function requestImage(
  question: string,
  tools?: ChatTools,
  attachments: { kind?: string; mime?: string }[] = [],
): boolean {
  if (tools?.image) return true;
  if (IMAGE_INTENT.test(question)) return true;
  const hasPhoto = attachments.some(
    (item) => item.kind === "image" || (item.mime ?? "").startsWith("image/"),
  );
  return hasPhoto && PHOTO_TRANSFORM.test(question);
}

export function requestCanvas(question: string, tools?: ChatTools): boolean {
  return Boolean(tools?.canvas) || CANVAS_INTENT.test(question);
}

export function requestFile(
  question: string,
  tools?: ChatTools,
  attachmentCount = 0,
): boolean {
  if (tools?.file) return true;
  if (FILE_INTENT.test(question)) return true;
  return attachmentCount > 0 && EDIT_INTENT.test(question);
}

export function requestedFormats(
  question: string,
  tools?: ChatTools,
  attachmentNames: string[] = [],
): FileFormat[] {
  const text = question.toLowerCase();
  const found: FileFormat[] = [];
  const add = (format: FileFormat) => {
    if (!found.includes(format)) found.push(format);
  };

  if (/\bpdf\b/.test(text)) add("pdf");
  if (/\b(docx?|word|document word)\b/.test(text)) add("docx");
  if (/\b(xlsx?|excel|classeur|feuille de calcul)\b/.test(text)) add("xlsx");
  if (/\b(pptx?|powerpoint|diapos?|pr[eé]sentation)\b/.test(text)) add("pptx");
  if (/\bcsv\b/.test(text)) add("csv");
  if (/\b(json)\b/.test(text)) add("json");
  if (/\b(markdown|\.md)\b/.test(text)) add("md");
  if (/\b(txt|texte brut)\b/.test(text)) add("txt");

  if (!found.length && STYLE_TRANSFER.test(question) && attachmentNames.length) {
    add("docx");
  }

  if (!found.length && (tools?.file || FILE_INTENT.test(question))) {
    for (const name of attachmentNames) {
      const format = formatFromName(name);
      if (format) add(format);
    }
    if (!found.length) add(STYLE_TRANSFER.test(question) ? "docx" : "pdf");
  }

  if (!found.length && attachmentNames.length && EDIT_INTENT.test(question)) {
    for (const name of attachmentNames) {
      const format = formatFromName(name);
      if (format) add(format);
    }
    if (!found.length) add("pdf");
  }

  return found;
}

export function formatFromName(name: string): FileFormat | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) return "docx";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm")) {
    return "xlsx";
  }
  if (lower.endsWith(".pptx") || lower.endsWith(".ppt")) return "pptx";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "md";
  if (lower.endsWith(".txt")) return "txt";
  return undefined;
}

export function reasoningEffort(
  question: string,
  attachmentCount: number,
): "low" | "medium" | "high" {
  if (attachmentCount > 0 || question.length > 240 || COMPLEX_INTENT.test(question)) {
    return question.length > 600 || attachmentCount > 2 ? "high" : "medium";
  }
  return "low";
}
