import { supabaseBrowser } from "@/lib/supabase";
import type { ChatMessage } from "@/lib/types";

export type VoiceHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

export type VoiceTalkEvent =
  | { type: "user_transcript"; content: string }
  | { type: "transcript"; content: string }
  | { type: "audio"; data: string }
  | { type: "thinking" }
  | { type: "fin"; content?: string }
  | { type: "erreur"; message: string };

async function authHeaders(): Promise<HeadersInit> {
  const supabase = supabaseBrowser();
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function recentVoiceTurns(messages: ChatMessage[], limit = 8): VoiceHistoryTurn[] {
  return messages
    .filter((message) => message.content.trim())
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-limit)
    .map((message) => ({
      role: message.role,
      content: message.content.replace(/\s+/g, " ").trim().slice(0, 800),
    }));
}

export function isVoiceTalkEvent(value: unknown): value is VoiceTalkEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "user_transcript" ||
    type === "transcript" ||
    type === "audio" ||
    type === "thinking" ||
    type === "fin" ||
    type === "erreur"
  );
}

export async function streamVoiceTalk(
  audio: string,
  recentMessages: VoiceHistoryTurn[],
  signal: AbortSignal,
  onEvent: (event: VoiceTalkEvent) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch("/api/voice/talk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ audio, recentMessages }),
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return {
      ok: false,
      error: body.error || "La réponse vocale n'a pas pu être générée.",
    };
  }
  if (!response.body) return { ok: false, error: "La réponse vocale est vide." };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    if (done) buffer += decoder.decode();
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = done ? "" : (parts.pop() ?? "");
    for (const frame of parts) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();
      if (!data) continue;
      try {
        const parsed = JSON.parse(data) as unknown;
        if (isVoiceTalkEvent(parsed)) onEvent(parsed);
      } catch {
        /* chunk incomplet */
      }
    }
    if (done) break;
  }
  return { ok: true };
}

export async function saveVoiceTurn(
  conversationId: string,
  userContent: string,
  assistantContent: string,
): Promise<void> {
  if (!userContent.trim() && !assistantContent.trim()) return;
  const response = await fetch("/api/voice/turns", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({
      conversationId,
      userContent,
      assistantContent,
    }),
  });
  if (!response.ok) {
    console.error("[voice] persist", await response.text().catch(() => ""));
  }
}
