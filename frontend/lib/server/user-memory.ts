import "server-only";
import {
  chatModel,
  resolveLlmEndpoint,
} from "@/lib/server/env";
import { messageText, postChatCompletion } from "@/lib/server/deep-research";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import type { ChatMessage, MemoryFact } from "@/lib/types";

/** Faits visibles / stockés après compactage. */
const MAX_STORED_FACTS = 20;
/** Seuil au-delà duquel on fusionne les vieux faits en un résumé. */
const COMPACT_AT = 16;
/** Faits non-préférences conservés tels quels lors d'un compactage. */
const KEEP_RECENT = 6;
/** Injection prompt : nombre et budget caractères, pour borner coût et latence. */
const PROMPT_FACT_LIMIT = 10;
const PROMPT_CHAR_BUDGET = 1_200;
const RESUME_KEY = "resume";
const EXTRACT_MS = 8_000;
const COMPACT_MS = 8_000;
const DURABLE_HINT =
  /\b(je préfère|j['’]aime|j['’]aimerais que|toujours|désormais|à l['’]avenir|mon projet|notre projet|on travaille sur|appelle-moi|ne (plus|jamais)|oublie|vouvoie|tutoi|souviens-toi|retiens|habitude|consigne)\b/i;

type MemoryRow = {
  id: string;
  cle: string;
  valeur: string;
  source_conversation_id: string | null;
  date_creation: string;
  date_maj: string;
};

export async function listUserMemory(userId: string): Promise<MemoryFact[]> {
  const { data, error } = await supabaseAdmin()
    .from("user_memory")
    .select("id, cle, valeur, source_conversation_id, date_creation, date_maj")
    .eq("user_id", userId)
    .order("date_maj", { ascending: false })
    .limit(MAX_STORED_FACTS);
  if (error) {
    throw new Error("La mémoire n'a pas pu être chargée.");
  }
  return ((data ?? []) as MemoryRow[]).map(mapFact);
}

export function formatMemoryForPrompt(facts: MemoryFact[]): string {
  if (!facts.length) return "";
  const pinned = facts.filter((fact) => isPreference(fact.cle));
  const others = facts
    .filter((fact) => !isPreference(fact.cle))
    .sort((a, b) => b.dateMaj.localeCompare(a.dateMaj));
  const lines: string[] = [];
  let used = 0;
  for (const fact of [...pinned, ...others]) {
    if (lines.length >= PROMPT_FACT_LIMIT) break;
    const line = `- ${fact.cle} : ${fact.valeur}`;
    if (used + line.length > PROMPT_CHAR_BUDGET) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
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
    await upsertFact(userId, fact.cle, fact.valeur, conversationId);
  }
  await compactIfNeeded(userId, conversationId);
}

export async function refreshUserMemory(input: {
  userId: string;
  conversationId: string;
  messages: ChatMessage[];
}): Promise<void> {
  const spoken = lastUserTurns(input.messages, 3);
  if (!spoken.trim()) return;
  if (!DURABLE_HINT.test(spoken)) {
    await compactIfNeeded(input.userId, input.conversationId);
    return;
  }

  const existing = await listUserMemory(input.userId);
  const extracted = await extractDurableFacts(
    spoken,
    existing.map((fact) => fact.cle),
  );
  for (const item of extracted) {
    if (item.oublier) {
      await deleteFactByKey(input.userId, item.cle);
      continue;
    }
    if (!item.cle || !item.valeur) continue;
    await upsertFact(input.userId, item.cle, item.valeur, input.conversationId);
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
  cle: string,
  valeur: string,
  conversationId: string,
): Promise<void> {
  const key = normalizeKey(cle);
  const text = valeur.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!key || !text) return;
  const { error } = await supabaseAdmin().from("user_memory").upsert(
    {
      user_id: userId,
      cle: key,
      valeur: text,
      source_conversation_id: conversationId,
      date_maj: new Date().toISOString(),
    },
    { onConflict: "user_id,cle" },
  );
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

async function compactIfNeeded(userId: string, conversationId: string): Promise<void> {
  const facts = await loadAllFacts(userId);
  if (facts.length < COMPACT_AT) return;

  const rest = facts
    .filter((fact) => !isPreference(fact.cle))
    .sort((a, b) => b.dateMaj.localeCompare(a.dateMaj));
  const keep = rest.filter((fact) => fact.cle !== RESUME_KEY).slice(0, KEEP_RECENT);
  const keepIds = new Set(keep.map((fact) => fact.id));
  const fold = rest.filter((fact) => !keepIds.has(fact.id));

  if (fold.length >= 2) {
    const resume = await summarizeFacts(fold);
    if (resume) {
      const foldIds = fold.map((fact) => fact.id);
      const { error: removed } = await supabaseAdmin()
        .from("user_memory")
        .delete()
        .eq("user_id", userId)
        .in("id", foldIds);
      if (removed) {
        console.error("[memory] compact delete", removed);
      } else {
        await upsertFact(userId, RESUME_KEY, resume, conversationId);
      }
    }
  }

  const leftover = await loadAllFacts(userId);
  if (leftover.length <= MAX_STORED_FACTS) return;
  const evict = leftover
    .filter((fact) => !isPreference(fact.cle) && fact.cle !== RESUME_KEY)
    .sort((a, b) => a.dateMaj.localeCompare(b.dateMaj))
    .slice(0, leftover.length - MAX_STORED_FACTS)
    .map((fact) => fact.id);
  if (!evict.length) return;
  const { error } = await supabaseAdmin()
    .from("user_memory")
    .delete()
    .eq("user_id", userId)
    .in("id", evict);
  if (error) console.error("[memory] evict", error);
}

async function loadAllFacts(userId: string): Promise<MemoryFact[]> {
  const { data, error } = await supabaseAdmin()
    .from("user_memory")
    .select("id, cle, valeur, source_conversation_id, date_creation, date_maj")
    .eq("user_id", userId)
    .order("date_maj", { ascending: false });
  if (error) {
    throw new Error("La mémoire n'a pas pu être chargée.");
  }
  return ((data ?? []) as MemoryRow[]).map(mapFact);
}

async function summarizeFacts(facts: MemoryFact[]): Promise<string | null> {
  const blob = facts
    .map((fact) => `${fact.cle} : ${fact.valeur}`)
    .join("\n")
    .slice(0, 3_500);
  if (!blob.trim()) return null;
  if (blob.length < 240) {
    return facts
      .map((fact) => fact.valeur.trim())
      .filter(Boolean)
      .join(" ")
      .slice(0, 600);
  }
  try {
    const result = await postChatCompletion(
      {
        model: chatModel(resolveLlmEndpoint()),
        temperature: 0,
        max_completion_tokens: 220,
        messages: [
          {
            role: "system",
            content:
              "Résume ces faits durables en 80 à 120 mots, en français. Fusionne les doublons. N'invente rien. Texte seul, sans liste ni titre.",
          },
          { role: "user", content: blob },
        ],
      },
      COMPACT_MS,
    );
    if (!result.ok) return blob.slice(0, 600);
    const text = messageText(result.body).replace(/\s+/g, " ").trim();
    return (text || blob).slice(0, 600);
  } catch (error) {
    console.error("[memory] compact", error);
    return blob.slice(0, 600);
  }
}

async function extractDurableFacts(
  spoken: string,
  existingKeys: string[],
): Promise<Array<{ cle: string; valeur: string; oublier?: boolean }>> {
  const reuse = existingKeys.length
    ? ` Réutilise de préférence une clé déjà connue (${existingKeys.slice(0, 20).join(", ")}) plutôt que d'en créer une nouvelle.`
    : "";
  try {
    const result = await postChatCompletion(
      {
        model: chatModel(resolveLlmEndpoint()),
        temperature: 0,
        max_completion_tokens: 400,
        messages: [
          {
            role: "system",
            content:
              "Tu extraies uniquement des faits durables explicitement dits par l'utilisateur : préférences, projets en cours, habitudes de formulation, consignes durables. Ignore les détails ponctuels, les questions, et tout ce qui n'est pas dit. N'invente rien. Réponds par un JSON array uniquement : [{\"cle\":\"preference_longueur\",\"valeur\":\"…\",\"oublier\":false}]. Si rien à retenir, []. cle en snake_case ascii, sans accent." +
              reuse,
          },
          { role: "user", content: spoken.slice(0, 4000) },
        ],
      },
      EXTRACT_MS,
    );
    if (!result.ok) return [];
    return parseFacts(messageText(result.body));
  } catch (error) {
    console.error("[memory] extract", error);
    return [];
  }
}

function isPreference(cle: string): boolean {
  return cle.startsWith("preference_");
}

function parseFacts(raw: string): Array<{ cle: string; valeur: string; oublier?: boolean }> {
  const json = raw.match(/\[[\s\S]*\]/)?.[0];
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as { cle?: unknown; valeur?: unknown; oublier?: unknown };
      const cle = typeof row.cle === "string" ? normalizeKey(row.cle) : "";
      const valeur = typeof row.valeur === "string" ? row.valeur.trim() : "";
      if (!cle) return [];
      return [{ cle, valeur, oublier: row.oublier === true }];
    });
  } catch {
    return [];
  }
}

function lastUserTurns(messages: ChatMessage[], count: number): string {
  return messages
    .filter((item) => item.role === "user" && item.content.trim())
    .slice(-count)
    .map((item) => item.content.trim())
    .join("\n\n");
}

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

function draftFact(cle: string, valeur: string, now: string): MemoryFact {
  return {
    id: cle,
    cle,
    valeur,
    dateCreation: now,
    dateMaj: now,
  };
}

function mapFact(row: MemoryRow): MemoryFact {
  return {
    id: row.id,
    cle: row.cle,
    valeur: row.valeur,
    sourceConversationId: row.source_conversation_id,
    dateCreation: row.date_creation,
    dateMaj: row.date_maj,
  };
}
