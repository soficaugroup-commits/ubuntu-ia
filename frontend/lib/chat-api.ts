import { supabaseBrowser } from "@/lib/supabase";
import {
  isChatStreamEvent,
  type ChatStreamEvent,
} from "@/lib/chat-stream-events";
import type { ChatAttachment, ChatMessage, ChatTools, Conversation } from "@/lib/types";

async function authHeaders(): Promise<HeadersInit> {
  const supabase = supabaseBrowser();
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function loadConversations(): Promise<
  { ok: true; conversations: Conversation[] } | { ok: false; error: string }
> {
  const response = await fetch("/api/conversations", {
    cache: "no-store",
    headers: await authHeaders(),
  });
  const body = (await response.json().catch(() => ({}))) as {
    conversations?: Conversation[];
    error?: string;
  };
  if (!response.ok) {
    return {
      ok: false,
      error: body.error || "L'historique n'a pas pu être chargé.",
    };
  }
  return { ok: true, conversations: body.conversations ?? [] };
}

export async function deleteConversation(id: string): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const response = await fetch(`/api/conversations/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (response.status === 404) {
    return { ok: true };
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    return {
      ok: false,
      error: body.error || "La conversation n'a pas pu être supprimée.",
    };
  }
  return { ok: true };
}

export async function streamAnswer(
  question: string,
  conversationId: string,
  messages: ChatMessage[],
  attachments: ChatAttachment[],
  signal: AbortSignal,
  tools: ChatTools = {},
  onEvent: (event: ChatStreamEvent) => void,
): Promise<{ ok: true; conversationId: string } | { ok: false; error: string; timeout?: boolean }> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(await authHeaders()),
    },
    body: JSON.stringify({
      question,
      conversationId,
      messages: messages.map((message) => {
        if (message.role === "assistant") {
          return { ...message, images: undefined, files: undefined, steps: undefined };
        }
        return {
          ...message,
          attachments: message.attachments?.map((item) => ({
            id: item.id,
            name: item.name,
            mime: item.mime,
            size: item.size,
            kind: item.kind,
          })),
        };
      }),
      attachments: attachments.map((item) => ({
        id: item.id,
        name: item.name,
        mime: item.mime,
        size: item.size,
        kind: item.kind,
        contentBase64: item.contentBase64,
      })),
      tools,
    }),
    signal,
    cache: "no-store",
  });

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("event-stream")) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return {
      ok: false,
      error: body.error || "La réponse n'a pas pu être générée.",
      timeout: response.status === 504,
    };
  }

  if (!response.body) {
    return { ok: false, error: "La réponse n'a pas pu être générée." };
  }

  let sawFin = false;
  let sawText = false;
  let finConversationId = conversationId;
  await readSse(response.body, (event) => {
    onEvent(event);
    if (event.type === "token" && event.content.trim()) sawText = true;
    if (event.type === "fin") {
      sawFin = true;
      if (event.content?.trim()) sawText = true;
      if (event.conversationId) finConversationId = event.conversationId;
    }
  });

  if (!sawFin && sawText) {
    onEvent({ type: "fin", status: "answered" });
    return { ok: true, conversationId: finConversationId };
  }
  if (!sawFin) {
    return { ok: false, error: "La réponse n'a pas pu être générée." };
  }
  return { ok: true, conversationId: finConversationId };
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = parseSseData(frame);
        if (event) onEvent(event);
      }
    }
    const tail = parseSseData(buffer);
    if (tail) onEvent(tail);
  } finally {
    reader.releaseLock();
  }
}

function parseSseData(frame: string): ChatStreamEvent | null {
  const lines = frame.split(/\r?\n/);
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    return isChatStreamEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
