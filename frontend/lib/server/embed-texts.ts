import { openrouterApiKey } from "@/lib/server/env";

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const BATCH_SIZE = 16;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const key = openrouterApiKey();
  if (!key) {
    throw new Error("OPENROUTER_API_KEY n'est pas configurée sur le serveur.");
  }

  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    vectors.push(...(await embedBatch(key, texts.slice(start, start + BATCH_SIZE))));
  }
  return vectors;
}

async function embedBatch(key: string, texts: string[]): Promise<number[][]> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Échec des embeddings : ${detail.slice(0, 280)}`);
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
