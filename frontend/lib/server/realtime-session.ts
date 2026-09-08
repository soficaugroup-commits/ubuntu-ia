import "server-only";
import {
  formatMemoryForPrompt,
  listUserMemory,
} from "@/lib/server/user-memory";

export type VoiceHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

export const VOICE_TOOLS = [
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
      name: "think_deeper",
      description:
        "Analyse plus poussée : actualité, recherche web, raisonnement long, chiffres à vérifier. L'utilisateur continue d'entendre la conversation pendant cet appel.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Question complète à analyser.",
          },
        },
        required: ["query"],
      },
    },
  },
] as const;

export async function buildVoiceInstructions(
  userId: string,
  recentMessages: VoiceHistoryTurn[] = [],
): Promise<string> {
  const memory = await listUserMemory(userId)
    .then(formatMemoryForPrompt)
    .catch((error) => {
      console.error("[voice] memory", error);
      return "";
    });
  return voiceInstructions(recentMessages, memory);
}

function voiceInstructions(history: VoiceHistoryTurn[], memory: string): string {
  const parts = [
    "Tu es Ubuntu IA, l'assistant vocal de SOFICAU Ubuntu Group.",
    "Tu parles comme à l'oral : phrases courtes, naturelles, sans listes markdown, sans astérisques, sans liens, sans numéros entre crochets.",
    "Réponds dans la langue de l'utilisateur. En français si la langue n'est pas claire.",
    "Si l'utilisateur te coupe, tu t'arrêtes. Ne reste pas silencieux : commence à parler dès que tu as compris.",
    "Question simple : réponds tout de suite, sans outil.",
    "Fait interne SOFICAU, Ubuntu Group, Ubuntu IA, Ubuntu iTrack, procédure ou note : appelle search_documents.",
    "Actualité, fait public, analyse longue ou chiffres à vérifier : appelle think_deeper.",
    "N'invente aucun chiffre, procédure ou fait interne. Si l'outil ne trouve rien, dis-le simplement.",
  ];
  if (memory.trim()) {
    parts.push(
      "Mémoire durable de cet utilisateur (à respecter, jamais à inventer) :",
      memory.trim(),
    );
  }
  const recent = compactHistory(history);
  if (recent) {
    parts.push("Contexte récent de cette conversation :", recent);
  }
  return parts.join(" ");
}

function compactHistory(history: VoiceHistoryTurn[]): string {
  const turns = history
    .filter((turn) => turn.content.trim())
    .slice(-8)
    .map((turn) => {
      const role = turn.role === "user" ? "Utilisateur" : "Ubuntu IA";
      const text = turn.content.replace(/\s+/g, " ").trim().slice(0, 400);
      return `${role} : ${text}`;
    });
  const joined = turns.join("\n");
  return joined.length > 2_400 ? joined.slice(-2_400) : joined;
}
