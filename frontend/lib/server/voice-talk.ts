import "server-only";
import {
  chatCompletionsUrl,
  openRouterHeaders,
  realtimeModel,
  realtimeVoice,
  resolveLlmEndpoint,
  transcriptionsUrl,
  voiceSttModel,
} from "@/lib/server/env";
import {
  buildVoiceInstructions,
  VOICE_TOOLS,
  type VoiceHistoryTurn,
} from "@/lib/server/realtime-session";
import { runVoiceTool } from "@/lib/server/voice-tools";

export type VoiceTalkEvent =
  | { type: "user_transcript"; content: string }
  | { type: "transcript"; content: string }
  | { type: "audio"; data: string }
  | { type: "thinking" }
  | { type: "fin"; content: string }
  | { type: "erreur"; message: string };

const VOICE_MS = 45_000;
const STT_MS = 12_000;
const FALLBACK_MODELS = ["openai/gpt-audio-mini", "openai/gpt-audio"];

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: unknown;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export async function* streamVoiceTalk(
  audioWavBase64: string,
  userId: string,
  recentMessages: VoiceHistoryTurn[],
  signal?: AbortSignal,
): AsyncGenerator<VoiceTalkEvent> {
  const instructions = await buildVoiceInstructions(userId, recentMessages);
  const messages: ChatMessage[] = [
    { role: "system", content: instructions },
    ...recentMessages.slice(-8).map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Réponds à voix haute à ce message vocal.",
        },
        {
          type: "input_audio",
          input_audio: { data: audioWavBase64, format: "wav" },
        },
      ],
    },
  ];

  const first = yield* streamAudioTurn(messages, signal);
  if (first.kind === "error") {
    yield { type: "erreur", message: first.message };
    return;
  }
  if (first.kind === "tools") {
    yield { type: "thinking" };
    const toolMessages: ChatMessage[] = [
      ...messages,
      { role: "assistant", tool_calls: first.calls, content: null },
    ];
    for (const call of first.calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      const output = await runVoiceTool(call.function.name, args);
      toolMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: output,
      });
    }
    const second = yield* streamAudioTurn(toolMessages, signal);
    if (second.kind === "error") {
      yield { type: "erreur", message: second.message };
      return;
    }
    yield { type: "fin", content: second.transcript || first.transcript };
    return;
  }

  yield { type: "fin", content: first.transcript };
}

export async function transcribeWav(audioWavBase64: string, signal?: AbortSignal): Promise<string> {
  const endpoint = resolveLlmEndpoint();
  const response = await fetch(transcriptionsUrl(endpoint), {
    method: "POST",
    headers: openRouterHeaders(endpoint.key),
    body: JSON.stringify({
      model: voiceSttModel(),
      language: "fr",
      input_audio: { data: audioWavBase64, format: "wav" },
    }),
    cache: "no-store",
    signal: mergeAbort(STT_MS, signal),
  });
  const body = (await response.json().catch(() => ({}))) as { text?: string };
  return (body.text ?? "").replace(/\s+/g, " ").trim();
}

async function* streamAudioTurn(
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<
  VoiceTalkEvent,
  { kind: "audio"; transcript: string } | { kind: "tools"; calls: ToolCall[]; transcript: string } | { kind: "error"; message: string }
> {
  const models = uniqueModels(realtimeModel(), ...FALLBACK_MODELS);
  let lastError = "La réponse vocale n'a pas pu être générée.";
  for (const model of models) {
    throwIfAborted(signal);
    try {
      const result = yield* streamOneAudioModel(model, messages, signal);
      if (result.kind !== "error") return result;
      lastError = result.message;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error instanceof Error ? error.message : lastError;
      console.error("[voice] audio", model, error);
    }
  }
  return { kind: "error", message: lastError };
}

async function* streamOneAudioModel(
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<
  VoiceTalkEvent,
  { kind: "audio"; transcript: string } | { kind: "tools"; calls: ToolCall[]; transcript: string } | { kind: "error"; message: string }
> {
  const endpoint = resolveLlmEndpoint();
  const response = await fetch(chatCompletionsUrl(endpoint), {
    method: "POST",
    headers: {
      ...openRouterHeaders(endpoint.key),
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      modalities: ["text", "audio"],
      audio: { voice: realtimeVoice(), format: "pcm16" },
      tools: VOICE_TOOLS,
      tool_choice: "auto",
      temperature: 0.5,
    }),
    cache: "no-store",
    signal: mergeAbort(VOICE_MS, signal),
  });

  if (!response.ok || !response.body) {
    const raw = await response.text().catch(() => "");
    return { kind: "error", message: audioErrorMessage(raw, response.status) };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let transcript = "";
  const tools = new Map<number, ToolCall>();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      if (done) buffer += decoder.decode();
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = done ? "" : (parts.pop() ?? "");
      for (const frame of done ? parts.filter((part) => part.trim()) : parts) {
        const parsed = parseSseFrame(frame);
        if (parsed === "done") {
          const calls = [...tools.values()].filter((item) => item.function.name);
          if (calls.length) return { kind: "tools", calls, transcript };
          return { kind: "audio", transcript };
        }
        if (!parsed) continue;
        const audio = audioDelta(parsed);
        if (audio.data) yield { type: "audio", data: audio.data };
        if (audio.transcript) {
          transcript += audio.transcript;
          yield { type: "transcript", content: audio.transcript };
        }
        const text = textDelta(parsed);
        if (text) {
          transcript += text;
          yield { type: "transcript", content: text };
        }
        mergeToolDeltas(tools, parsed);
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  const calls = [...tools.values()].filter((item) => item.function.name);
  if (calls.length) return { kind: "tools", calls, transcript };
  return { kind: "audio", transcript };
}

function audioDelta(parsed: Record<string, unknown>): { data?: string; transcript?: string } {
  const choice = firstChoice(parsed);
  const delta = asRecord(choice?.delta) ?? asRecord(choice?.message);
  const audio = asRecord(delta?.audio);
  if (!audio) return {};
  return {
    data: typeof audio.data === "string" ? audio.data : undefined,
    transcript: typeof audio.transcript === "string" ? audio.transcript : undefined,
  };
}

function textDelta(parsed: Record<string, unknown>): string {
  const choice = firstChoice(parsed);
  const delta = asRecord(choice?.delta);
  const content = delta?.content;
  return typeof content === "string" ? content : "";
}

function mergeToolDeltas(target: Map<number, ToolCall>, parsed: Record<string, unknown>) {
  const choice = firstChoice(parsed);
  const delta = asRecord(choice?.delta) ?? asRecord(choice?.message);
  const calls = delta?.tool_calls;
  if (!Array.isArray(calls)) return;
  for (const item of calls) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    };
    const index = typeof row.index === "number" ? row.index : target.size;
    const current = target.get(index) ?? {
      id: row.id || `call_${index}`,
      type: "function" as const,
      function: { name: "", arguments: "" },
    };
    if (row.id) current.id = row.id;
    if (row.function?.name) current.function.name += row.function.name;
    if (row.function?.arguments) current.function.arguments += row.function.arguments;
    target.set(index, current);
  }
}

function firstChoice(parsed: Record<string, unknown>): Record<string, unknown> | null {
  const choices = parsed.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  return choices[0] as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function parseSseFrame(frame: string): Record<string, unknown> | "done" | null {
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  const data = dataLines.join("\n").trim();
  if (!data || data === "[DONE]") return "done";
  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function uniqueModels(...models: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const model of models) {
    if (!model || seen.has(model)) continue;
    seen.add(model);
    next.push(model);
  }
  return next;
}

function mergeAbort(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([timeout, signal]);
  return signal.aborted ? signal : timeout;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("stopped");
}

function audioErrorMessage(raw: string, status: number): string {
  try {
    const body = JSON.parse(raw) as { error?: { message?: string } };
    if (body.error?.message?.trim()) return body.error.message.trim();
  } catch {
    /* corps non JSON */
  }
  if (status === 401 || status === 403) {
    return "La clé OpenRouter du mode vocal est refusée.";
  }
  return "La réponse vocale n'a pas pu être générée.";
}
