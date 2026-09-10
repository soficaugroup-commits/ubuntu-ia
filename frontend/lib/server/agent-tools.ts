import "server-only";
import { embedTexts } from "@/lib/server/embed-texts";
import {
  chatModel,
  fileModel,
  resolveLlmEndpoint,
} from "@/lib/server/env";
import {
  messageText,
  postChatCompletion,
} from "@/lib/server/deep-research";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import type { FileFormat } from "@/lib/types";
import type { AgentMode } from "@/lib/server/agent-plan";
import { loadDocumentSkillPrompt } from "@/lib/server/document-skills";

type HistoryTurn = { role: "user" | "assistant"; content: string };

type RetrievedChunk = {
  document_id: string;
  contenu: string;
  titre: string;
  type_source: "fichier" | "url";
  url_source: string | null;
  similarite: number;
};

const MATCH_COUNT = 6;
const MATCH_THRESHOLD = 0.4;
const EXCERPT = 420;
const TOOL_MS = 35_000;
const MAX_ROUNDS = 2;

export type AgentToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type AgentDeliverable = {
  image: boolean;
  canvas: boolean;
  file: boolean;
  formats: FileFormat[];
  brief: string;
};

export type AgentPrepResult = {
  chunks: RetrievedChunk[];
  deliverable: AgentDeliverable;
  notes: string[];
};

export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_documents",
      description:
        "Cherche dans les documents internes SOFICAU Ubuntu Group. À utiliser pour une procédure, une note, un règlement, Ubuntu IA, Ubuntu iTrack ou un fait interne.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Question ou mots-clés à chercher dans la base interne.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prepare_deliverable",
      description:
        "Prépare un livrable après la réponse : fichier téléchargeable (pdf, docx, xlsx, pptx…), image, ou canevas texte long. À appeler dès que la demande est une tâche de production.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["file", "image", "canvas"],
            description: "Type de livrable à produire.",
          },
          formats: {
            type: "array",
            items: {
              type: "string",
              enum: ["pdf", "docx", "xlsx", "pptx", "csv", "txt", "md", "json"],
            },
            description: "Formats de fichier si kind=file.",
          },
          brief: {
            type: "string",
            description: "Consigne courte pour le moteur de génération.",
          },
        },
        required: ["kind"],
      },
    },
  },
] as const;

const FILE_FORMATS: FileFormat[] = [
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "csv",
  "txt",
  "md",
  "json",
];

/**
 * Tour d'outils avant la rédaction : le modèle choisit search_documents / prepare_deliverable.
 */
export async function runAgentToolRound(input: {
  question: string;
  history: HistoryTurn[];
  mode: AgentMode;
  seed: AgentDeliverable;
  signal?: AbortSignal;
}): Promise<AgentPrepResult> {
  const deliverable: AgentDeliverable = { ...input.seed, formats: [...input.seed.formats] };
  const chunks: RetrievedChunk[] = [];
  const notes: string[] = [];
  const endpoint = resolveLlmEndpoint();
  const documentWork = input.seed.file || input.seed.canvas;
  const model = documentWork ? fileModel(endpoint) : chatModel(endpoint);
  const skills = documentWork
    ? loadDocumentSkillPrompt(input.seed.formats)
    : "";

  type Msg = {
    role: "system" | "user" | "assistant" | "tool";
    content?: string | null;
    tool_calls?: AgentToolCall[];
    tool_call_id?: string;
  };

  const messages: Msg[] = [
    {
      role: "system",
      content: [
        "Tu es le planificateur d'Ubuntu IA, agent hybride autonome.",
        "Analyse le message : question simple, tâche, ou les deux.",
        "Si un fait interne SOFICAU / Ubuntu est en jeu : appelle search_documents.",
        "Si un livrable (fichier, image, canevas) est attendu : appelle prepare_deliverable.",
        "Pour les documents et la mise en forme, tu t'appuies sur Claude Opus et les skills Anthropic office.",
        "Tu peux enchaîner plusieurs outils. N'invente aucun fait interne.",
        "Si aucune action n'est utile, réponds simplement OK sans outil.",
        skills ? `\n${skills}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    },
    ...input.history.slice(-8).map((turn) => ({
      role: turn.role as "user" | "assistant",
      content: turn.content.trim(),
    })),
    {
      role: "user",
      content: `Mode détecté : ${input.mode}.\nMessage : ${input.question.trim()}`,
    },
  ];

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (input.signal?.aborted) break;
    const result = await postChatCompletion(
      {
        model,
        temperature: 0.2,
        max_completion_tokens: 800,
        tools: AGENT_TOOLS,
        tool_choice: "auto",
        messages,
      },
      TOOL_MS,
      input.signal,
    ).catch((error) => {
      console.error("[agent] tools", error);
      return { ok: false, status: 0, body: {} as Record<string, unknown>, raw: "" };
    });
    if (!result.ok) break;

    const calls = messageToolCalls(result.body);
    if (!calls.length) {
      const text = messageText(result.body).trim();
      if (text) notes.push(text.slice(0, 400));
      break;
    }

    messages.push({
      role: "assistant",
      content: null,
      tool_calls: calls,
    });

    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      const output = await runAgentTool(call.function.name, args, chunks, deliverable);
      notes.push(`${call.function.name}: ${output.slice(0, 200)}`);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: output,
      });
    }
  }

  return { chunks: dedupeChunks(chunks), deliverable, notes };
}

async function runAgentTool(
  name: string,
  args: Record<string, unknown>,
  chunks: RetrievedChunk[],
  deliverable: AgentDeliverable,
): Promise<string> {
  if (name === "search_documents") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return "Requête vide.";
    const found = await retrieveChunks(query);
    chunks.push(...found);
    if (!found.length) {
      return "Aucun extrait interne pertinent. N'invente rien ; utilise le web ou tes connaissances publiques si le sujet n'est pas interne.";
    }
    return found
      .map((chunk, index) => {
        const excerpt = chunk.contenu.replace(/\s+/g, " ").trim().slice(0, EXCERPT);
        return `[${index + 1}] ${chunk.titre} : ${excerpt}`;
      })
      .join("\n");
  }

  if (name === "prepare_deliverable") {
    const kind = String(args.kind ?? "");
    const brief = typeof args.brief === "string" ? args.brief.trim() : "";
    if (brief) deliverable.brief = brief;
    if (kind === "image") {
      deliverable.image = true;
      return "Livrable image programmé. La génération visuelle suivra la réponse.";
    }
    if (kind === "canvas") {
      deliverable.canvas = true;
      return "Canevas programmé. Produis un livrable texte fini dans la réponse.";
    }
    if (kind === "file") {
      deliverable.file = true;
      const formats = Array.isArray(args.formats)
        ? args.formats
            .map((item) => String(item).toLowerCase())
            .filter((item): item is FileFormat =>
              FILE_FORMATS.includes(item as FileFormat),
            )
        : [];
      for (const format of formats) {
        if (!deliverable.formats.includes(format)) deliverable.formats.push(format);
      }
      if (!deliverable.formats.length) deliverable.formats.push("pdf");
      return `Livrable fichier programmé (${deliverable.formats.join(", ")}). Rédige le contenu complet dans la réponse.`;
    }
    return "Kind de livrable inconnu.";
  }

  return "Outil inconnu.";
}

async function retrieveChunks(query: string): Promise<RetrievedChunk[]> {
  const [vector] = await embedTexts([query]);
  const { data, error } = await supabaseAdmin().rpc("match_document_chunks", {
    query_embedding: vector,
    match_count: MATCH_COUNT,
    match_threshold: MATCH_THRESHOLD,
  });
  if (error) {
    console.error("[agent] rag", error);
    return [];
  }
  return ((data ?? []) as Array<Partial<RetrievedChunk> & {
    document_id: string;
    contenu: string;
    titre: string;
    similarite: number;
  }>)
    .filter((row) => row.contenu?.trim() && (row.similarite ?? 0) >= MATCH_THRESHOLD)
    .map((row) => ({
      document_id: row.document_id,
      contenu: row.contenu,
      titre: row.titre,
      type_source: row.type_source === "url" ? "url" : "fichier",
      url_source: row.url_source ?? null,
      similarite: row.similarite,
    }));
}

function messageToolCalls(body: Record<string, unknown>): AgentToolCall[] {
  const choices = body.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") {
    return [];
  }
  const message = (choices[0] as { message?: { tool_calls?: unknown } }).message;
  const raw = message?.tool_calls;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const row = item as {
      id?: unknown;
      type?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const name = row.function?.name;
    if (typeof name !== "string" || !name) return [];
    return [
      {
        id: typeof row.id === "string" ? row.id : `call_${index}`,
        type: "function" as const,
        function: {
          name,
          arguments:
            typeof row.function?.arguments === "string"
              ? row.function.arguments
              : "{}",
        },
      },
    ];
  });
}

function dedupeChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>();
  const out: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    const key = `${chunk.document_id}:${chunk.contenu.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chunk);
    if (out.length >= 6) break;
  }
  return out;
}
