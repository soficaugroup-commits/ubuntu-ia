import "server-only";
import { chatModel, resolveLlmEndpoint } from "@/lib/server/env";
import { embedTexts } from "@/lib/server/embed-texts";
import { messageText, postChatCompletion } from "@/lib/server/deep-research";
import {
  extractionInstructions,
  normalizeKey,
  parseMemoryOperations,
  scopeOf,
  selectFactsForPrompt,
  worthExtracting,
} from "@/lib/server/memory-logic";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import type { ChatMessage, MemoryFact, MemoryScope } from "@/lib/types";

/**
 * Mémoire évolutive d'Ubuntu IA.
 * Après chaque échange, un modèle léger met à jour les souvenirs de l'utilisateur
 * (préférences, profil, projets, organisations). Avant chaque réponse, seuls les
 * souvenirs utiles à la demande sont rappelés — un projet n'est rappelé que s'il est
 * concerné, pour ne jamais mélanger les dossiers. Tout est propre à chaque utilisateur.
 */

/** Plafond de souvenirs par utilisateur. */
const MAX_STORED_FACTS = 150;
/** Au-delà, les souvenirs anciens d'un même projet sont fusionnés en une synthèse. */
const GROUP_COMPACT_AT = 14;
const GROUP_KEEP_RECENT = 8;
const EXTRACT_MS = 12_000;
const COMPACT_MS = 10_000;
const VECTOR_MATCHES = 8;
const VECTOR_THRESHOLD = 0.32;
/** En dessous de ce nombre de souvenirs contextuels, inutile de calculer un embedding. */
const VECTOR_MIN_FACTS = 6;

const LEGACY_COLUMNS = "id, cle, valeur, source_conversation_id, date_creation, date_maj";
const FULL_COLUMNS = `${LEGACY_COLUMNS}, portee, sujet, importance, derniere_utilisation`;

/** null = inconnu ; false = migration 019 pas encore appliquée. */
let extendedSchema: boolean | null = null;

type MemoryRow = {
  id: string;
  cle: string;
  valeur: string;
  source_conversation_id: string | null;
  date_creation: string;
  date_maj: string;
  portee?: string | null;
  sujet?: string | null;
  importance?: number | null;
  derniere_utilisation?: string | null;
};

export async function listUserMemory(userId: string): Promise<MemoryFact[]> {
  return loadAllFacts(userId, MAX_STORED_FACTS);
}

/**
 * Bloc mémoire à injecter dans le prompt pour CETTE demande.
 * `recent` = derniers messages, pour reconnaître le projet en cours de discussion.
 */
export async function loadMemoryForPrompt(
  userId: string,
  question: string,
  recent = "",
  extra: MemoryFact[] = [],
): Promise<string> {
  const stored = await listUserMemory(userId);
  const facts = mergeByKey(stored, extra);
  if (!facts.length) return "";

  const contextual = facts.filter((fact) => {
    const scope = scopeOf(fact);
    return scope !== "preference" && scope !== "profil";
  });
  let similarIds = new Set<string>();
  if (extendedSchema && contextual.length >= VECTOR_MIN_FACTS) {
    similarIds = await similarMemoryIds(userId, `${question}\n${recent}`.slice(0, 2_000));
  }

  const selection = selectFactsForPrompt(facts, { question, recent, similarIds });
  void touchFacts(userId, selection.facts.map((fact) => fact.id));
  return selection.text;
}

/** Format historique (mode vocal) : préférences, profil et faits importants, sans sélection fine. */
export function formatMemoryForPrompt(facts: MemoryFact[]): string {
  return selectFactsForPrompt(facts, { question: "" }).text;
}

export function immediateFactsFromQuestion(question: string): MemoryFact[] {
  const text = question.trim();
  if (!text) return [];
  const now = new Date().toISOString();
  const facts: MemoryFact[] = [];
  const prefer = /\b(je préfère|j['’]aime|toujours|désormais|à l['’]avenir)\b/i.test(text);

  if (prefer && /réponses? courtes?|sois concis|plus court/i.test(text)) {
    facts.push(draftFact("preference_longueur", "Préfère des réponses courtes et concises.", now));
  }
  if (prefer && /réponses? (longues|détaill|développ)/i.test(text)) {
    facts.push(draftFact("preference_longueur", "Préfère des réponses détaillées.", now));
  }
  if (prefer && /\b(tu toie|tutoi)/i.test(text)) {
    facts.push(draftFact("preference_ton", "Souhaite être tutoyé.", now));
  }
  if (prefer && /\b(vouvoi|vousvoie)/i.test(text)) {
    facts.push(draftFact("preference_ton", "Souhaite être vouvoyé.", now));
  }
  if (prefer && /\b(word|docx|\.docx)\b/i.test(text) && /format|fichier|livrable|rapport/i.test(text)) {
    facts.push(draftFact("preference_format_rapport", "Préfère les livrables au format Word.", now));
  }
  if (prefer && /\b(excel|xlsx|classeur)\b/i.test(text) && /format|fichier|livrable/i.test(text)) {
    facts.push(draftFact("preference_format_rapport", "Préfère les livrables au format Excel.", now));
  }
  if (prefer && /\bpdf\b/i.test(text) && /format|fichier|livrable/i.test(text)) {
    facts.push(draftFact("preference_format_rapport", "Préfère les livrables au format PDF.", now));
  }
  return facts;
}

export async function persistImmediateFacts(
  userId: string,
  conversationId: string,
  facts: MemoryFact[],
): Promise<void> {
  if (!facts.length) return;
  for (const fact of facts) {
    await upsertFact(userId, {
      cle: fact.cle,
      valeur: fact.valeur,
      portee: scopeOf(fact),
      sujet: null,
      importance: 3,
      conversationId,
    });
  }
}

/**
 * Apprentissage automatique après chaque échange : le modèle relit les derniers messages
 * de l'utilisateur (et la dernière réponse comme simple contexte) et ajoute, modifie ou
 * oublie des souvenirs. Appelé en tâche de fond, hors du chemin de réponse.
 */
export async function refreshUserMemory(input: {
  userId: string;
  conversationId: string;
  messages: ChatMessage[];
}): Promise<void> {
  const spoken = lastTurns(input.messages, "user", 3);
  if (!worthExtracting(spoken)) return;
  const answer = lastTurns(input.messages, "assistant", 1).slice(0, 1_500);

  const existing = await loadAllFacts(input.userId, MAX_STORED_FACTS);
  const operations = await extractOperations(spoken, answer, existing);
  for (const op of operations) {
    try {
      if (op.action === "oublier") {
        await deleteFactByKey(input.userId, op.cle);
        continue;
      }
      await upsertFact(input.userId, {
        cle: op.cle,
        valeur: op.valeur,
        portee: op.portee,
        sujet: op.sujet,
        importance: op.importance,
        conversationId: input.conversationId,
      });
    } catch (error) {
      console.error("[mémoire] écriture", error);
    }
  }
  await compactIfNeeded(input.userId, input.conversationId);
}

export async function deleteUserMemory(
  id: string,
  actorId: string,
  asAdmin: boolean,
): Promise<boolean> {
  let query = supabaseAdmin().from("user_memory").delete().eq("id", id);
  if (!asAdmin) query = query.eq("user_id", actorId);
  const { data, error } = await query.select("id").maybeSingle();
  if (error) {
    throw new Error("Ce souvenir n'a pas pu être supprimé.");
  }
  return Boolean(data);
}

async function upsertFact(
  userId: string,
  fact: {
    cle: string;
    valeur: string;
    portee: MemoryScope;
    sujet: string | null;
    importance: number;
    conversationId: string;
  },
): Promise<void> {
  const key = normalizeKey(fact.cle);
  const text = fact.valeur.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!key || !text) return;
  const base = {
    user_id: userId,
    cle: key,
    valeur: text,
    source_conversation_id: fact.conversationId,
    date_maj: new Date().toISOString(),
  };

  if (extendedSchema !== false) {
    const embedding = await embedTexts([`${fact.sujet ?? ""} ${text}`.trim()])
      .then(([vector]) => vector)
      .catch(() => null);
    const { error } = await supabaseAdmin().from("user_memory").upsert(
      {
        ...base,
        portee: fact.portee,
        sujet: fact.sujet,
        importance: Math.min(3, Math.max(1, Math.round(fact.importance))),
        ...(embedding ? { embedding } : {}),
      },
      { onConflict: "user_id,cle" },
    );
    if (!error) {
      extendedSchema = true;
      return;
    }
    if (!isMissingColumn(error)) {
      throw new Error("La mémoire n'a pas pu être enregistrée.");
    }
    extendedSchema = false;
  }

  const { error } = await supabaseAdmin().from("user_memory").upsert(base, { onConflict: "user_id,cle" });
  if (error) {
    throw new Error("La mémoire n'a pas pu être enregistrée.");
  }
}

async function deleteFactByKey(userId: string, cle: string): Promise<void> {
  const key = normalizeKey(cle);
  if (!key) return;
  const { error } = await supabaseAdmin()
    .from("user_memory")
    .delete()
    .eq("user_id", userId)
    .eq("cle", key);
  if (error) {
    throw new Error("Ce souvenir n'a pas pu être oublié.");
  }
}

async function loadAllFacts(userId: string, limit: number): Promise<MemoryFact[]> {
  const run = (columns: string) =>
    supabaseAdmin()
      .from("user_memory")
      .select(columns)
      .eq("user_id", userId)
      .order("date_maj", { ascending: false })
      .limit(limit);

  if (extendedSchema !== false) {
    const { data, error } = await run(FULL_COLUMNS);
    if (!error) {
      extendedSchema = true;
      return ((data ?? []) as unknown as MemoryRow[]).map(mapFact);
    }
    if (!isMissingColumn(error)) throw new Error("La mémoire n'a pas pu être chargée.");
    extendedSchema = false;
  }
  const { data, error } = await run(LEGACY_COLUMNS);
  if (error) throw new Error("La mémoire n'a pas pu être chargée.");
  return ((data ?? []) as unknown as MemoryRow[]).map(mapFact);
}

async function similarMemoryIds(userId: string, text: string): Promise<Set<string>> {
  try {
    const [vector] = await embedTexts([text]);
    const { data, error } = await supabaseAdmin().rpc("match_user_memory", {
      p_user_id: userId,
      query_embedding: vector,
      match_count: VECTOR_MATCHES,
      match_threshold: VECTOR_THRESHOLD,
    });
    if (error) return new Set();
    return new Set(((data ?? []) as Array<{ id: string }>).map((row) => row.id));
  } catch (error) {
    console.error("[mémoire] similarité", error);
    return new Set();
  }
}

async function touchFacts(userId: string, ids: string[]): Promise<void> {
  if (!ids.length || !extendedSchema) return;
  const real = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!real.length) return;
  const { error } = await supabaseAdmin()
    .from("user_memory")
    .update({ derniere_utilisation: new Date().toISOString() })
    .eq("user_id", userId)
    .in("id", real);
  if (error) console.error("[mémoire] rappel", error);
}

async function extractOperations(spoken: string, answer: string, existing: MemoryFact[]) {
  try {
    const result = await postChatCompletion(
      {
        model: chatModel(resolveLlmEndpoint()),
        temperature: 0,
        max_completion_tokens: 700,
        messages: [
          { role: "system", content: extractionInstructions(existing) },
          {
            role: "user",
            content: [
              "Derniers messages de l'utilisateur :",
              spoken.slice(0, 4_000),
              answer ? `\nDernière réponse de l'assistant (contexte seulement) :\n${answer}` : "",
            ].join("\n"),
          },
        ],
      },
      EXTRACT_MS,
    );
    if (!result.ok) return [];
    return parseMemoryOperations(messageText(result.body));
  } catch (error) {
    console.error("[mémoire] extraction", error);
    return [];
  }
}

/**
 * Garde la mémoire nette : un projet trop bavard est résumé, et au-delà du plafond
 * les souvenirs les moins importants et les moins rappelés sont retirés.
 * Préférences et profil ne sont jamais retirés automatiquement.
 */
async function compactIfNeeded(userId: string, conversationId: string): Promise<void> {
  const facts = await loadAllFacts(userId, MAX_STORED_FACTS * 2);

  const groups = new Map<string, MemoryFact[]>();
  for (const fact of facts) {
    const scope = scopeOf(fact);
    if (scope === "preference" || scope === "profil") continue;
    const key = `${scope}::${(fact.sujet ?? "").toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }

  for (const [groupKey, items] of groups) {
    if (items.length < GROUP_COMPACT_AT) continue;
    const [scope, subjectKey] = groupKey.split("::") as [MemoryScope, string];
    const sorted = [...items].sort((a, b) => b.dateMaj.localeCompare(a.dateMaj));
    const fold = sorted.slice(GROUP_KEEP_RECENT).filter((fact) => !fact.cle.endsWith("_synthese"));
    if (fold.length < 2) continue;
    const resume = await summarizeFacts(fold);
    if (!resume) continue;
    const subject = items[0]?.sujet ?? null;
    const { error } = await supabaseAdmin()
      .from("user_memory")
      .delete()
      .eq("user_id", userId)
      .in("id", fold.map((fact) => fact.id));
    if (error) {
      console.error("[mémoire] compactage", error);
      continue;
    }
    await upsertFact(userId, {
      cle: normalizeKey(`${scope}_${subjectKey || "general"}_synthese`),
      valeur: resume,
      portee: scope,
      sujet: subject,
      importance: 2,
      conversationId,
    }).catch((err) => console.error("[mémoire] synthèse", err));
  }

  const leftover = await loadAllFacts(userId, MAX_STORED_FACTS * 2);
  if (leftover.length <= MAX_STORED_FACTS) return;
  const evict = leftover
    .filter((fact) => {
      const scope = scopeOf(fact);
      return scope !== "preference" && scope !== "profil";
    })
    .sort(
      (a, b) =>
        (a.importance ?? 2) - (b.importance ?? 2) ||
        (a.derniereUtilisation ?? a.dateMaj).localeCompare(b.derniereUtilisation ?? b.dateMaj),
    )
    .slice(0, leftover.length - MAX_STORED_FACTS)
    .map((fact) => fact.id);
  if (!evict.length) return;
  const { error } = await supabaseAdmin().from("user_memory").delete().eq("user_id", userId).in("id", evict);
  if (error) console.error("[mémoire] éviction", error);
}

async function summarizeFacts(facts: MemoryFact[]): Promise<string | null> {
  const blob = facts.map((fact) => `- ${fact.valeur}`).join("\n").slice(0, 3_500);
  if (!blob.trim()) return null;
  try {
    const result = await postChatCompletion(
      {
        model: chatModel(resolveLlmEndpoint()),
        temperature: 0,
        max_completion_tokens: 260,
        messages: [
          {
            role: "system",
            content:
              "Fusionne ces souvenirs d'un même sujet en 60 à 110 mots, en français. Garde les faits les plus récents en cas de contradiction. N'invente rien. Texte seul, sans liste ni titre.",
          },
          { role: "user", content: blob },
        ],
      },
      COMPACT_MS,
    );
    if (!result.ok) return null;
    const text = messageText(result.body).replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 400) : null;
  } catch (error) {
    console.error("[mémoire] synthèse", error);
    return null;
  }
}

function lastTurns(messages: ChatMessage[], role: "user" | "assistant", count: number): string {
  return messages
    .filter((item) => item.role === role && item.content.trim())
    .slice(-count)
    .map((item) => item.content.trim())
    .join("\n\n");
}

function mergeByKey(stored: MemoryFact[], extra: MemoryFact[]): MemoryFact[] {
  const byKey = new Map<string, MemoryFact>();
  for (const fact of stored) byKey.set(fact.cle, fact);
  for (const fact of extra) byKey.set(fact.cle, { ...byKey.get(fact.cle), ...fact });
  return [...byKey.values()];
}

function isMissingColumn(error: { code?: string; message?: string }): boolean {
  return error.code === "42703" || error.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(error.message ?? "");
}

function draftFact(cle: string, valeur: string, now: string): MemoryFact {
  return {
    id: cle,
    cle,
    valeur,
    portee: "preference",
    sujet: null,
    importance: 3,
    dateCreation: now,
    dateMaj: now,
  };
}

function mapFact(row: MemoryRow): MemoryFact {
  const fact: MemoryFact = {
    id: row.id,
    cle: row.cle,
    valeur: row.valeur,
    sourceConversationId: row.source_conversation_id,
    dateCreation: row.date_creation,
    dateMaj: row.date_maj,
    sujet: row.sujet ?? null,
    importance: typeof row.importance === "number" ? row.importance : undefined,
    derniereUtilisation: row.derniere_utilisation ?? null,
  };
  fact.portee = scopeOf({ cle: row.cle, portee: (row.portee ?? undefined) as MemoryScope | undefined });
  return fact;
}
