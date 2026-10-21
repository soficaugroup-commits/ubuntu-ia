import type {
  AgentTask,
  ChatStep,
  ChatStepState,
  GeneratedFile,
  GeneratedImage,
  SourceCitation,
  TaskJournalEntry,
  TaskStep,
} from "@/lib/types";

export type { ChatStep, ChatStepState };

export type ChatStreamEvent =
  | { type: "etape"; id: string; label: string; state: ChatStepState }
  | { type: "token"; content: string }
  | { type: "sources"; documents: SourceCitation[] }
  | { type: "images"; images: GeneratedImage[] }
  | { type: "files"; files: GeneratedFile[] }
  | {
      type: "fin";
      status: "answered" | "no_source" | "error";
      conversationId?: string;
      content?: string;
    }
  | { type: "erreur"; message: string };

/** Événements d'une tâche conduite pas à pas (lot B). */
export type TaskStreamEvent =
  | { type: "tache_plan"; task: AgentTask }
  | { type: "tache_etape"; step: TaskStep; phase: "debut" | "fin" }
  | { type: "tache_question"; question: string }
  | { type: "tache_validation_requise"; step: TaskStep }
  | { type: "tache_journal"; entry: TaskJournalEntry }
  | { type: "tache_fin"; task: AgentTask }
  | { type: "erreur"; message: string };

const TASK_EVENT_TYPES = new Set([
  "tache_plan",
  "tache_etape",
  "tache_question",
  "tache_validation_requise",
  "tache_journal",
  "tache_fin",
  "erreur",
]);

export function isTaskStreamEvent(value: unknown): value is TaskStreamEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && TASK_EVENT_TYPES.has(type);
}

export function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "etape" ||
    type === "token" ||
    type === "sources" ||
    type === "images" ||
    type === "files" ||
    type === "fin" ||
    type === "erreur"
  );
}
