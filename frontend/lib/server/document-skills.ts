import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FileFormat } from "@/lib/types";

const MAX_SKILL_CHARS = 6_000;
const MAX_COMPANION_CHARS = 4_000;
const MAX_BRIDGE_CHARS = 7_500;

const FORMAT_SKILLS: Partial<Record<FileFormat, string>> = {
  docx: "docx",
  pdf: "pdf",
  pptx: "pptx",
  xlsx: "xlsx",
  csv: "xlsx",
};

/** Guides complémentaires issus de claude-office-skills (hors SKILL.md). */
const COMPANIONS: Record<string, string[]> = {
  docx: ["docx-js.md", "ooxml.md"],
  pptx: ["html2pptx.md", "ooxml.md"],
  pdf: ["FORMS.md", "REFERENCE.md"],
  xlsx: [],
};

/** Pont Ubuntu IA — toujours disponible même si les SKILL.md ne sont pas sur le disque (Netlify). */
const FALLBACK_BRIDGE = `
# Livrables fichiers Ubuntu IA (skills Claude Office)

Source workflows : claude-office-skills (PPTX, DOCX, XLSX, PDF) + pont Ubuntu IA.

Trois couches : CONTENU (texte, chiffres, formules — intacts) ; STRUCTURE (titres, sections, tableaux, diapositives — respectée) ; HABILLAGE (couleurs, polices, logos — seul libre).

Pipeline : classer STYLE vs CONTENU ; extraire la charte (design-dna) ; appliquer l'habillage ; nettoyer la spec ; vérifier la non-régression. Un PDF/image est figé : style seulement, jamais réinjecter son texte.

Spec : markdown + fence ubuntu-ia-doc → { title, subtitle, sections, charts, design }. Graphes uniquement si chiffres déjà présents. design : primaire, accent, fond, texte, policeTitre, policeCorps (hex sans #).

Word : HeadingLevel ; listes via numbering BULLET (jamais • littéral) ; tableaux WidthType.DXA ; ShadingType.CLEAR ; pas de \\n dans un paragraphe ; page de garde marine ; tracked changes / OOXML si édition.

PowerPoint : layout avant slides ; canvas 10"×5.625" ; hex sans # ; bullet: true ; graphes addChart ; palette 17405B, AD8859, 3D6A82, C4A574 ; sandwich couverture/conclusion marines, contenu canvas E8EEF2 ; synthèse texte→diapositives assumée ; HTML-to-PPTX pour mises en page riches.

Excel : Arial ; totaux en formules SUM ; feuille Synthèse + données sur classeur neuf ; classeur existant restylé sans toucher valeurs/formules ; modèles financiers zéro erreur.

PDF : garde marine + cercles or ; pages contenu canvas ; Helvetica/WinAnsi ; formulaires / fusion si demandé.

Marque : marine 17405B, or AD8859, canvas E8EEF2.
`.trim();

const FALLBACK_BY_SKILL: Record<string, string> = {
  docx: `
# Skill Claude Office — docx
Créer / éditer .docx : titres HeadingLevel, listes numbering, tableaux DXA, ShadingType.CLEAR, jamais • littéral ni \\n dans un paragraphe. Édition : unpack OOXML, redlining/commentaires si demandé. Produis markdown + ubuntu-ia-doc ; le moteur TypeScript génère le binaire.
`.trim(),
  pptx: `
# Skill Claude Office — pptx
Diapositives : une idée par slide. Layout avant contenu. Listes bullet:true. Hex 6 chiffres sans #. Graphes natifs si données. Couverture + conclusion. HTML/CSS → PPTX pour mises en page complexes. Signale la synthèse texte→slides.
`.trim(),
  xlsx: `
# Skill Claude Office — xlsx
Classeur : Synthèse (KPI) puis feuilles données. Totaux = formules SUM, jamais figés. Couleurs input vs formule. Ne jamais altérer formules/valeurs d'un classeur existant lors d'un restyle. Validation zéro erreur.
`.trim(),
  pdf: `
# Skill Claude Office — pdf
PDF professionnel : garde + pages contenu. Structure claire. Accents WinAnsi. Formulaires fillable / fusion / extraction si la demande l'exige. Design via tokens ubuntu-ia-doc.
`.trim(),
};

/**
 * Charge les skills Claude Office (tfriedel/claude-office-skills + pont Ubuntu IA)
 * pour guider la rédaction et le design des livrables.
 * Le rendu binaire reste dans generate-chat-*.ts.
 */
export function loadDocumentSkillPrompt(formats: FileFormat[] = []): string {
  const parts: string[] = [
    "Tu rédiges le contenu et le design des documents en suivant les skills Claude Office ci-dessous",
    "(workflows PPTX, DOCX, XLSX, PDF avec automatisation — pack claude-office-skills).",
    "Le moteur Ubuntu IA convertit ta réponse (markdown + fence ubuntu-ia-doc) en fichier OOXML/PDF.",
    "Respecte strictement les règles de structure et d'habillage. N'invente pas de scripts Python : produis le livrable textuel demandé.",
    "Avant de proposer une structure, applique le contrôle skills : s'il existe une règle skill pour le format, suis-la exactement.",
  ];

  const system = readSkillFile(["skills-system.md"]);
  if (system) {
    parts.push(
      "## Système de skills (contrôle obligatoire)",
      truncate(stripFrontmatter(system), 2_500),
    );
  }

  const bridge =
    readSkillCandidates([
      [".cursor", "skills", "ubuntu-ia-docx", "SKILL.md"],
      ["..", ".cursor", "skills", "ubuntu-ia-docx", "SKILL.md"],
    ]) ?? FALLBACK_BRIDGE;
  parts.push(
    "## Skill pont Ubuntu IA",
    truncate(stripFrontmatter(bridge), MAX_BRIDGE_CHARS),
  );

  const wanted = new Set<string>();
  for (const format of formats.length
    ? formats
    : (["pdf", "docx", "pptx", "xlsx"] as FileFormat[])) {
    const skill = FORMAT_SKILLS[format];
    if (skill) wanted.add(skill);
  }
  if (!wanted.size) {
    for (const skill of Object.keys(FALLBACK_BY_SKILL)) wanted.add(skill);
  }

  for (const skill of wanted) {
    const body =
      readClaudeOfficeFile(skill, "SKILL.md") ??
      readSkillCandidates([
        [".agents", "skills", skill, "SKILL.md"],
        ["..", ".agents", "skills", skill, "SKILL.md"],
      ]) ??
      FALLBACK_BY_SKILL[skill];
    if (!body) continue;
    parts.push(
      `## Skill Claude Office — ${skill}`,
      truncate(excerptSkillGuidance(stripFrontmatter(body)), MAX_SKILL_CHARS),
    );

    for (const companion of COMPANIONS[skill] ?? []) {
      const companionBody = readClaudeOfficeFile(skill, companion);
      if (!companionBody) continue;
      parts.push(
        `## Guide ${skill}/${companion}`,
        truncate(
          excerptSkillGuidance(stripFrontmatter(companionBody)),
          MAX_COMPANION_CHARS,
        ),
      );
    }
  }

  return parts.join("\n\n");
}

function readClaudeOfficeFile(skill: string, fileName: string): string | null {
  return readSkillCandidates([
    ["content", "claude-office-skills", skill, fileName],
    ["frontend", "content", "claude-office-skills", skill, fileName],
    [".agents", "skills", "claude-office", skill, fileName],
    ["..", ".agents", "skills", "claude-office", skill, fileName],
    ["..", "frontend", "content", "claude-office-skills", skill, fileName],
  ]);
}

function readSkillFile(parts: string[]): string | null {
  return readSkillCandidates([
    ["content", "claude-office-skills", ...parts],
    ["frontend", "content", "claude-office-skills", ...parts],
    [".agents", "skills", "claude-office", ...parts],
    ["..", ".agents", "skills", "claude-office", ...parts],
    ["..", "frontend", "content", "claude-office-skills", ...parts],
  ]);
}

function readSkillCandidates(relPaths: string[][]): string | null {
  const roots = [process.cwd(), resolve(process.cwd(), "..")];
  for (const root of roots) {
    for (const parts of relPaths) {
      const path = resolve(root, ...parts);
      if (!existsSync(path)) continue;
      try {
        return readFileSync(path, "utf8");
      } catch {
        /* next */
      }
    }
  }
  return null;
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

function excerptSkillGuidance(markdown: string): string {
  return markdown
    .replace(/```(?:bash|python|js|javascript|ts|typescript)[\s\S]*?```/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
