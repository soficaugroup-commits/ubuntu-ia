import "server-only";
import { chatModel, resolveLlmEndpoint } from "@/lib/server/env";
import { messageText, postChatCompletion } from "@/lib/server/deep-research";
import type { DocumentSpec } from "@/lib/server/document-spec";
import type { ReviewAlert } from "@/lib/types";

const VERIFY_MS = 20_000;

/** Vérificateur LLM : n'invente rien ; liste seulement les faits internes absents des extraits. */
export async function verifyInternalClaims(
  spec: DocumentSpec,
  excerpts: string[],
  signal?: AbortSignal,
): Promise<ReviewAlert[]> {
  const endpoint = resolveLlmEndpoint();
  const livrable = JSON.stringify({
    titre: spec.title,
    sections: spec.sections.map((section) => ({
      titre: section.title,
      texte: [...section.body, ...section.bullets, ...(section.numbered ?? [])],
      tableau: section.table,
    })),
  }).slice(0, 12_000);
  const sources = excerpts
    .map((item, index) => `[${index + 1}] ${item.trim().slice(0, 800)}`)
    .join("\n")
    .slice(0, 10_000);
  const result = await postChatCompletion(
    {
      model: chatModel(endpoint),
      temperature: 0,
      max_completion_tokens: 600,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Tu es le vérificateur d'Ubuntu IA. Compare le livrable aux extraits. Réponds uniquement par un JSON {\"alertes\":[{\"type\":\"fait_non_etaye\",\"extrait\":\"…\",\"explication\":\"…\"}]}. Ne signale que des procédures, règles ou chiffres internes absents des extraits. Si tout est étayé, renvoie {\"alertes\":[]}.",
        },
        {
          role: "user",
          content: `EXTRAITS :\n${sources || "(aucun)"}\n\nLIVRABLE :\n${livrable}`,
        },
      ],
    },
    VERIFY_MS,
    signal,
  );
  if (!result.ok) {
    console.error("[review] vérificateur HTTP", result.status);
    return [];
  }
  return parseAlerts(messageText(result.body));
}

function parseAlerts(raw: string): ReviewAlert[] {
  const text = raw.trim();
  const json = text.startsWith("{") ? text : /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as { alertes?: unknown };
    if (!Array.isArray(parsed.alertes)) return [];
    return parsed.alertes.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const extrait = typeof row.extrait === "string" ? row.extrait.trim() : "";
      const explication = typeof row.explication === "string" ? row.explication.trim() : "";
      if (!extrait || !explication) return [];
      return [{ type: "fait_non_etaye" as const, extrait: extrait.slice(0, 240), explication: explication.slice(0, 400) }];
    });
  } catch {
    return [];
  }
}
