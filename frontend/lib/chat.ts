import { copy } from "@/content/fr";
import type { ChatAttachment, ChatMessage, ChatStep, ChatTools } from "@/lib/types";

export function compactTools(tools?: ChatTools): ChatTools | undefined {
  const next: ChatTools = {};
  if (tools?.image) next.image = true;
  if (tools?.canvas) next.canvas = true;
  if (tools?.file) next.file = true;
  return next.image || next.canvas || next.file ? next : undefined;
}

export function createUserMessage(
  content: string,
  attachments?: ChatAttachment[],
  tools?: ChatTools,
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content,
    attachments: attachments?.length ? attachments : undefined,
    tools: compactTools(tools),
    createdAt: new Date().toISOString(),
  };
}

export function createPendingAssistant(options?: { attachments?: boolean }): ChatMessage {
  const steps: ChatStep[] = [];
  if (options?.attachments) {
    steps.push({ id: "attachments", label: copy.chat.stepsAttachments, state: "running" });
  }
  steps.push(
    { id: "search", label: copy.chat.stepsSearch, state: "running" },
    { id: "web", label: copy.chat.stepsWeb, state: "queued" },
    { id: "write", label: copy.chat.stepsWrite, state: "queued" },
  );
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    sources: [],
    steps,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

export function titleFromQuestion(question: string): string {
  const compact = question.trim().replace(/\s+/g, " ");
  return compact.length > 48 ? `${compact.slice(0, 45)}…` : compact;
}
