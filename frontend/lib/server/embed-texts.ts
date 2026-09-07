import {
  embeddingRequest,
  openRouterHeaders,
  resolveLlmEndpoint,
} from "@/lib/server/env";

const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 16;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const endpoint = resolveLlmEndpoint();
  const request = embeddingRequest(endpoint);

  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    vectors.push(
      ...(await embedBatch(
        endpoint.key,
        request.url,
        request.model,
        texts.slice(start, start + BATCH_SIZE),
      )),
    );
  }
  return vectors;
}

async function embedBatch(
  key: string,
  url: string,
  model: string,
  texts: string[],
): Promise<number[][]> {
  const payload = {
    method: "POST" as const,
    headers: openRouterHeaders(key),
    body: JSON.stringify({
      model,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
    cache: "no-store" as const,
  };

  let response = await fetch(url, payload);
  if (response.status === 404 && !url.endsWith("/v1/embeddings")) {
    response = await fetch(url.replace(/\/embeddings$/, "/v1/embeddings"), payload);
  }

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
  const vectors = ordered.map((item) => item.embedding);
  if (vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) {
    throw new Error("Un embedding n'a pas la dimension attendue (1536).");
  }
  return vectors;
}

function mapEmbedError(status: number, detail: string): Error {
  if (status === 401) {
    return new Error("La clé du fournisseur d'embeddings est invalide.");
  }
  if (status === 402) {
    return new Error("Le compte d'embeddings n'a plus de crédits.");
  }
  if (status === 429) {
    return new Error("Le fournisseur d'embeddings a limité les requêtes. Réessayez.");
  }
  if (status === 404 || detail.includes("not found") || detail.includes("model")) {
    return new Error(
      "Le modèle d'embeddings n'est pas disponible sur ce fournisseur.",
    );
  }
  return new Error("Le calcul des embeddings a échoué. Relancez l'indexation.");
}
