import {
  OPENROUTER_BASE_URL,
  openRouterHeaders,
  requireOpenRouterKey,
} from "@/lib/server/env";

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 16;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const key = requireOpenRouterKey();

  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    vectors.push(...(await embedBatch(key, texts.slice(start, start + BATCH_SIZE))));
  }
  return vectors;
}

async function embedBatch(key: string, texts: string[]): Promise<number[][]> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
    method: "POST",
    headers: openRouterHeaders(key),
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw mapEmbedError(response.status, await response.text());
  }

  const body = (await response.json()) as {
    data?: { index: number; embedding: number[] }[];
  };
  const ordered = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
  if (ordered.length !== texts.length) {
    throw new Error("Le nombre d'embeddings reçu ne correspond pas aux segments.");
  }
  return ordered.map((item) => item.embedding);
}

function mapEmbedError(status: number, detail: string): Error {
  if (
    detail.includes("CLERK_OAUTH_ISSUER") ||
    detail.includes("Missing Authentication")
  ) {
    return new Error(
      "Netlify a injecté une clé de passerelle IA refusée par OpenRouter. Définissez OPENROUTER_API_KEY (sk-or-v1-…) dans les variables d'environnement Netlify, puis redéployez.",
    );
  }
  if (status === 401) {
    return new Error("La clé OpenRouter est invalide ou expirée.");
  }
  if (status === 402) {
    return new Error("Le compte OpenRouter n'a plus de crédits.");
  }
  if (status === 429) {
    return new Error("OpenRouter a limité les requêtes. Réessayez dans un instant.");
  }
  return new Error(
    "Le calcul des embeddings a échoué. Vérifiez OPENROUTER_API_KEY sur Netlify, puis relancez l'indexation.",
  );
}
