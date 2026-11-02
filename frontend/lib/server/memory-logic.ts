/**
 * Logique pure (sans réseau) de la mémoire évolutive d'Ubuntu IA.
 *
 * Chaque souvenir a une PORTÉE et, pour les projets et entités, un SUJET :
 * - preference   : comment la personne veut qu'Ubuntu IA travaille (ton, longueur, format…)
 * - profil       : qui elle est (fonction, entité, pays, langues, domaines)
 * - projet       : un dossier, un client, une mission (sujet = nom du projet)
 * - organisation : une entité du groupe, un partenaire, un bailleur (sujet = nom)
 * - contexte     : autre fait durable utile
 * Préférences et profil sont toujours rappelés ; un projet ne l'est que si la demande
 * le concerne. C'est ce qui évite de mélanger les dossiers.
 */
import type { MemoryFact, MemoryScope } from "@/lib/types";

export const MEMORY_SCOPES: MemoryScope[] = ["preference", "profil", "projet", "organisation", "contexte"];

export const SCOPE_TITLES: Record<MemoryScope, string> = {
  preference: "Préférences de travail",
  profil: "Profil",
  projet: "Projet",
  organisation: "Organisation",
  contexte: "Contexte",
};

/** Plafonds d'injection dans le prompt (coût et latence bornés). */
export const PROMPT_FACT_LIMIT = 18;
export const PROMPT_CHAR_BUDGET = 2_600;
const ALWAYS_LIMIT = 10;

export function isMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === "string" && (MEMORY_SCOPES as string[]).includes(value);
}

/** Portée d'un fait ancien (avant la migration 019), déduite de sa clé. */
export function scopeOf(fact: Pick<MemoryFact, "cle" | "portee">): MemoryScope {
  if (fact.portee && isMemoryScope(fact.portee)) return fact.portee;
  if (fact.cle.startsWith("preference_")) return "preference";
  if (fact.cle.startsWith("profil_")) return "profil";
  if (fact.cle.startsWith("projet_")) return "projet";
  if (fact.cle.startsWith("organisation_")) return "organisation";
  return "contexte";
}

export function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

export function normalizeSubject(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().slice(0, 80);
  return text || null;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const SUBJECT_STOP = new Set(["projet", "programme", "client", "groupe", "the", "les", "des", "pour", "and"]);

function subjectTokens(subject: string): string[] {
  return (fold(subject).match(/[a-z0-9]{2,}/g) ?? []).filter((word) => !SUBJECT_STOP.has(word));
}

/** La demande (ou les derniers échanges) parle-t-elle de ce sujet ? */
export function subjectMentioned(subject: string | null | undefined, text: string): boolean {
  if (!subject) return false;
  const tokens = subjectTokens(subject);
  if (!tokens.length) return false;
  const words = new Set(fold(text).match(/[a-z0-9]{2,}/g) ?? []);
  const strong = tokens.filter((token) => token.length >= 3 || /\d/.test(token));
  const needed = strong.length ? strong : tokens;
  const found = needed.filter((token) => words.has(token)).length;
  return needed.length <= 2 ? found >= 1 : found >= Math.ceil(needed.length / 2);
}

const SENSITIVE =
  /\b(sant[eé]|maladie|malade|diagnostic m[eé]dical|traitement m[eé]dical|m[eé]dicament|enceinte|grossesse|handicap|d[eé]pression|th[eé]rapie|religion|religieu|confession|musulman|chr[eé]tien|ath[eé]e|orientation sexuelle|homosexu|h[eé]t[eé]rosexu|opinion politique|parti politique|syndiqu|casier judiciaire|condamnation|mot de passe|password|code pin|iban|rib\b|num[eé]ro de carte|carte bancaire|cvv|num[eé]ro de passeport|num[eé]ro d['’]identit[eé]|npi\b|salaire|r[eé]mun[eé]ration personnelle|dette|cr[eé]dit personnel)\b/i;

/** Données à ne jamais mémoriser (santé, convictions, identifiants, finances personnelles…). */
export function isSensitiveMemory(text: string): boolean {
  return SENSITIVE.test(text);
}

export type MemoryOperation = {
  action: "ajouter" | "modifier" | "oublier";
  cle: string;
  valeur: string;
  portee: MemoryScope;
  sujet: string | null;
  importance: 1 | 2 | 3;
};

/** Lit la réponse JSON du modèle d'extraction ; ignore tout ce qui est invalide ou sensible. */
export function parseMemoryOperations(raw: string, max = 6): MemoryOperation[] {
  const json = raw.match(/\[[\s\S]*\]/)?.[0];
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: MemoryOperation[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const action =
      row.action === "oublier" || row.oublier === true
        ? "oublier"
        : row.action === "modifier"
          ? "modifier"
          : "ajouter";
    const portee = isMemoryScope(row.portee) ? row.portee : "contexte";
    const sujet = portee === "projet" || portee === "organisation" ? normalizeSubject(row.sujet) : null;
    let cle = typeof row.cle === "string" ? normalizeKey(row.cle) : "";
    const valeur = typeof row.valeur === "string" ? row.valeur.replace(/\s+/g, " ").trim().slice(0, 400) : "";
    if (!cle) continue;
    if (action !== "oublier") {
      if (!valeur || isSensitiveMemory(`${cle} ${valeur}`)) continue;
      if (!cle.startsWith(`${portee}_`) && !(portee === "contexte" && cle === "resume")) {
        cle = normalizeKey(`${portee}_${cle}`);
      }
      if ((portee === "projet" || portee === "organisation") && !sujet) continue;
    }
    const importanceRaw = Number(row.importance);
    const importance = (importanceRaw === 1 || importanceRaw === 3 ? importanceRaw : 2) as 1 | 2 | 3;
    out.push({ action, cle, valeur, portee, sujet, importance });
    if (out.length >= max) break;
  }
  return out;
}

export type PromptSelection = {
  facts: MemoryFact[];
  text: string;
};

/**
 * Choisit les souvenirs à injecter :
 * - toujours : préférences, profil (et organisations jugées importantes) ;
 * - selon la demande : projets/organisations/contexte dont le sujet est cité, ou proches
 *   sémantiquement (ids fournis par la recherche vectorielle).
 */
export function selectFactsForPrompt(
  facts: MemoryFact[],
  context: { question: string; recent?: string; similarIds?: Set<string> },
): PromptSelection {
  const haystack = `${context.question}\n${context.recent ?? ""}`;
  const similar = context.similarIds ?? new Set<string>();
  const always: MemoryFact[] = [];
  const relevant: MemoryFact[] = [];

  for (const fact of facts) {
    const scope = scopeOf(fact);
    if (scope === "preference" || scope === "profil") {
      always.push(fact);
      continue;
    }
    const mentioned = subjectMentioned(fact.sujet, haystack);
    if (mentioned || similar.has(fact.id)) {
      relevant.push(fact);
      continue;
    }
    const general = scope === "contexte" && !fact.sujet;
    if (fact.cle === "resume" || ((scope === "organisation" || general) && (fact.importance ?? 2) >= 3)) {
      always.push(fact);
    }
  }

  const byPriority = (a: MemoryFact, b: MemoryFact) =>
    (b.importance ?? 2) - (a.importance ?? 2) || b.dateMaj.localeCompare(a.dateMaj);
  const chosen = [
    ...always.sort(byPriority).slice(0, ALWAYS_LIMIT),
    ...relevant.sort(byPriority),
  ];

  const kept: MemoryFact[] = [];
  let used = 0;
  for (const fact of chosen) {
    if (kept.length >= PROMPT_FACT_LIMIT) break;
    const cost = fact.valeur.length + 8;
    if (used + cost > PROMPT_CHAR_BUDGET) continue;
    kept.push(fact);
    used += cost;
  }
  return { facts: kept, text: formatGroupedFacts(kept) };
}

/** Texte groupé par rubrique, les projets séparés les uns des autres. */
export function formatGroupedFacts(facts: MemoryFact[]): string {
  if (!facts.length) return "";
  const groups = new Map<string, string[]>();
  for (const fact of facts) {
    const scope = scopeOf(fact);
    const title =
      (scope === "projet" || scope === "organisation") && fact.sujet
        ? `${SCOPE_TITLES[scope]} « ${fact.sujet} »`
        : SCOPE_TITLES[scope];
    const lines = groups.get(title) ?? [];
    lines.push(`- ${fact.valeur}`);
    groups.set(title, lines);
  }
  return [...groups.entries()].map(([title, lines]) => `${title} :\n${lines.join("\n")}`).join("\n\n");
}

/** Consigne système du modèle d'extraction. */
export function extractionInstructions(existing: MemoryFact[]): string {
  const known = existing
    .slice(0, 60)
    .map((fact) => `${fact.cle} [${scopeOf(fact)}${fact.sujet ? ` · ${fact.sujet}` : ""}] = ${fact.valeur.slice(0, 140)}`)
    .join("\n");
  return [
    "Tu tiens la mémoire durable d'Ubuntu IA pour UN utilisateur. Tu améliores cette mémoire après chaque échange.",
    "Retiens uniquement ce que l'UTILISATEUR a dit ou confirmé. La réponse de l'assistant n'est qu'un contexte : n'en tire jamais un fait que l'utilisateur n'a pas validé.",
    "Portées :",
    "- preference : façon de travailler voulue (ton, longueur, format, langue, structure, outils, à faire / à éviter). Une correction (« non, plutôt… », « trop long ») est une préférence.",
    "- profil : fonction, entité, pays, domaines d'expertise, langues de l'utilisateur.",
    "- projet : faits durables sur un projet, client ou mission (objectifs, échéances, bailleur, livrables, décisions, interlocuteurs-fonctions). sujet = nom court du projet, obligatoire.",
    "- organisation : faits durables sur une entité, un partenaire ou un bailleur. sujet = nom, obligatoire.",
    "- contexte : autre fait durable utile qui ne rentre nulle part ailleurs.",
    "Ne retiens pas : demandes ponctuelles, contenu de documents, questions, salutations, chiffres d'un document, informations sur la vie privée de tiers, ni données sensibles (santé, convictions religieuses ou politiques, orientation, identifiants, mots de passe, coordonnées bancaires, salaire).",
    "Un fait qui en contredit ou précise un existant le MODIFIE (même clé). Si l'utilisateur demande d'oublier, action oublier avec la clé existante.",
    "Ne mélange jamais deux projets dans un même fait. Une clé = un fait. Clés en snake_case ascii, préfixées par la portée : preference_longueur, profil_fonction, projet_giz_move_echeance, organisation_bdo_attentes.",
    "importance : 3 = à rappeler souvent, 2 = utile, 1 = mineur.",
    "Réponds UNIQUEMENT par un tableau JSON (6 éléments maximum), [] si rien de durable :",
    '[{"action":"ajouter|modifier|oublier","cle":"…","valeur":"phrase courte et autonome","portee":"preference|profil|projet|organisation|contexte","sujet":"… ou null","importance":2}]',
    known ? `Mémoire actuelle :\n${known}` : "Mémoire actuelle : vide.",
  ].join("\n");
}

const TRIVIAL = /^(bonjour|bonsoir|salut|hello|merci|ok|d['’]accord|super|parfait|top|oui|non)[\s!.?]*$/i;

/** Évite un appel d'extraction pour un message sans contenu durable possible. */
export function worthExtracting(spoken: string): boolean {
  const text = spoken.trim();
  if (text.length < 15) return false;
  return !TRIVIAL.test(text);
}
