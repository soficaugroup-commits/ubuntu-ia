import "server-only";
import { embedTexts } from "@/lib/server/embed-texts";
import {
  chatModel,
  resolveLlmEndpoint,
} from "@/lib/server/env";
import {
  messageText,
  postChatCompletion,
  WEB_TOOLS,
} from "@/lib/server/deep-research";
import { matchIndexedChunks } from "@/lib/server/indexed-search";

const MATCH_COUNT = 6;
const MATCH_THRESHOLD = 0.4;
const EXCERPT = 360;
const THINK_MS = 28_000;

type IndexedChunk = {
  document_id: string;
  contenu: string;
  titre: string;
  similarite: number;
};

export async function runVoiceTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return "Question vide.";
  if (name === "search_documents") return searchDocuments(query);
  if (name === "think_deeper") return thinkDeeper(query);
  return "Outil inconnu.";
}

async function searchDocuments(query: string): Promise<string> {
  const chunks = await retrieveChunks(query);
  if (!chunks.length) {
    return "Aucun extrait interne pertinent. N'invente rien : dis-le à l'utilisateur, ou appelle think_deeper si le sujet est public.";
  }
  return chunks
    .map((chunk, index) => {
      const excerpt = chunk.contenu.replace(/\s+/g, " ").trim().slice(0, EXCERPT);
      return `[${index + 1}] ${chunk.titre} : ${excerpt}`;
    })
    .join("\n");
}

async function thinkDeeper(query: string): Promise<string> {
  const chunks = await retrieveChunks(query).catch((error) => {
    console.error("[voice] rag", error);
    return [] as IndexedChunk[];
  });
  const excerpts = chunks.length
    ? chunks
        .map((chunk) => `${chunk.titre} : ${chunk.contenu.replace(/\s+/g, " ").trim().slice(0, EXCERPT)}`)
        .join("\n")
    : "(aucun extrait interne)";
  const endpoint = resolveLlmEndpoint();
  const result = await postChatCompletion(
    {
      model: chatModel(endpoint),
      temperature: 0.3,
      max_completion_tokens: 700,
      tools: WEB_TOOLS,
      max_tool_calls: 4,
      messages: [
        {
          role: "system",
          content:
            "Tu prépares une brève note orale pour Ubuntu IA. Réponds en français, 4 à 8 phrases, sans markdown, sans liens, sans numéros entre crochets. Les extraits internes priment s'ils concernent la question. N'invente aucun fait interne.",
        },
        {
          role: "user",
          content: `Question : ${query}\n\nExtraits internes :\n${excerpts}`,
        },
      ],
    },
    THINK_MS,
  );
  const text = messageText(result.body).replace(/\s+/g, " ").trim();
  if (text) return text;
  if (chunks.length) return searchDocuments(query);
  return "Je n'ai pas pu approfondir. Réponds avec tes connaissances, sans inventer de fait interne.";
}

async function retrieveChunks(query: string): Promise<IndexedChunk[]> {
  // Exclut la catégorie Méthodologie : jamais citée comme source.
  const [vector] = await embedTexts([query]);
  return matchIndexedChunks(vector, { count: MATCH_COUNT, threshold: MATCH_THRESHOLD });
}
