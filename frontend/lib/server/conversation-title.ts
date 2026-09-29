import "server-only";
import {
  chatCompletionsUrl,
  openRouterHeaders,
  resolveLlmEndpoint,
  titleModel,
} from "@/lib/server/env";
import { sanitizeTitle } from "@/lib/server/conversations";

const MAX_WORDS = 8;

/**
 * Demande un titre court au modèle léger.
 * Un échec renvoie null : la conversation garde son titre provisoire.
 */
export async function generateConversationTitle(question: string): Promise<string | null> {
  const subject = question.trim().slice(0, 1_000);
  if (!subject) return null;
  try {
    const endpoint = resolveLlmEndpoint();
    const response = await fetch(chatCompletionsUrl(endpoint), {
      method: "POST",
      headers: openRouterHeaders(endpoint.key),
      body: JSON.stringify({
        model: titleModel(),
        temperature: 0.2,
        max_tokens: 40,
        messages: [
          {
            role: "system",
            content:
              "Tu nommes une conversation. Réponds uniquement par un titre de 5 à 8 mots, dans la langue du message, sans guillemets ni point final.",
          },
          { role: "user", content: subject },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      console.error("[chat] titre", response.status);
      return null;
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = body.choices?.[0]?.message?.content ?? "";
    return clipTitle(raw);
  } catch (error) {
    console.error("[chat] titre", error);
    return null;
  }
}

function clipTitle(raw: string): string | null {
  const line = raw
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean);
  if (!line) return null;
  const words = line
    .replace(/^titre\s*:\s*/i, "")
    .replace(/^["«»']+|["«»'.]+$/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_WORDS);
  const title = sanitizeTitle(words.join(" "));
  return title || null;
}
