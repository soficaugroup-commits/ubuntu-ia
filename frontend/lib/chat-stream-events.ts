import type {
  ChatStep,
  ChatStepState,
  GeneratedFile,
  GeneratedImage,
  SourceCitation,
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
