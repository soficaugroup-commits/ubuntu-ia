import "server-only";
import {
  chatCompletionsUrl,
  chatModel,
  openRouterHeaders,
  resolveLlmEndpoint,
} from "@/lib/server/env";
import type { SourceCitation } from "@/lib/types";

const EXCERPT_CHARS = 280;

export const WEB_PLUGIN = {
  id: "web",
  max_results: 5,
};

export const WEB_TOOLS = [
  {
    type: "openrouter:web_search",
    parameters: {
      engine: "auto",
      max_results: 5,
      max_uses: 3,
      search_context_size: "medium",
    },
  },
  {
    type: "openrouter:web_fetch",
    parameters: {
      max_uses: 3,
      max_content_tokens: 20_000,
    },
  },
];

export type WebActivity = "web_search" | "web_fetch";

export function hasWebAccess(extra: Record<string, unknown>): boolean {
  return Array.isArray(extra.plugins) || Array.isArray(extra.tools);
}

export function webSearchUsed(body: Record<string, unknown>): boolean {
  if (parseWebSources(body).length) return true;
  const usage = body.usage;
  if (!usage || typeof usage !== "object") return false;
  const tools = (usage as { server_tool_use?: Record<string, unknown> }).server_tool_use;
  if (!tools || typeof tools !== "object") return false;
  return Number(tools.web_search_requests ?? 0) > 0 || Number(tools.web_fetch_requests ?? 0) > 0;
}

export function messageText(body: Record<string, unknown>): string {
  const choices = body.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") {
    return "";
  }
  const choice = choices[0] as { message?: { content?: unknown } };
  const content = choice.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const item = part as { text?: unknown; content?: unknown };
        if (typeof item.text === "string") return item.text;
        if (typeof item.content === "string") return item.content;
        return "";
      })
      .join("\n");
  }
  return "";
}

export function parseWebSources(body: Record<string, unknown>): SourceCitation[] {
  const seen = new Set<string>();
  const sources: SourceCitation[] = [];

  function push(url: string, titre: string, extrait: string) {
    const href = url.trim();
    if (!href || seen.has(href)) return;
    seen.add(href);
    sources.push({
      documentId: `web:${href}`,
      titre: titre.trim() || hostname(href),
      extrait: excerpt(extrait || href),
      type_source: "url",
      url_source: href,
      origine: "web",
    });
  }

  const choices = Array.isArray(body.choices) ? body.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const row = choice as {
      message?: Record<string, unknown>;
      delta?: Record<string, unknown>;
      annotations?: unknown;
      citations?: unknown;
    };
    collectAnnotations(row.message?.annotations, push);
    collectCitations(row.message?.citations, push);
    collectAnnotations(row.delta?.annotations, push);
    collectCitations(row.delta?.citations, push);
    collectAnnotations(row.annotations, push);
    collectCitations(row.citations, push);
  }
  collectAnnotations(body.annotations, push);
  collectCitations(body.citations, push);

  return sources.slice(0, 6);
}

export async function postChatCompletion(
  payload: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown>; raw: string }> {
  const endpoint = resolveLlmEndpoint();
  const response = await fetch(chatCompletionsUrl(endpoint), {
    method: "POST",
    headers: openRouterHeaders(endpoint.key),
    body: JSON.stringify({
      ...payload,
      stream: false,
      model: payload.model ?? chatModel(endpoint),
    }),
    cache: "no-store",
    signal: mergeAbort(timeoutMs, signal),
  });
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  return { ok: response.ok, status: response.status, body, raw };
}

export async function* streamChatCompletion(
  payload: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): AsyncGenerator<{
  ok: boolean;
  status: number;
  textDelta?: string;
  activity?: WebActivity;
  done?: boolean;
  body: Record<string, unknown>;
}> {
  const endpoint = resolveLlmEndpoint();
  const response = await fetch(chatCompletionsUrl(endpoint), {
    method: "POST",
    headers: {
      ...openRouterHeaders(endpoint.key),
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      ...payload,
      stream: true,
      model: payload.model ?? chatModel(endpoint),
    }),
    cache: "no-store",
    signal: mergeAbort(timeoutMs, signal),
  });

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let body: Record<string, unknown> = {};
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    yield { ok: false, status: response.status, body, done: true };
    return;
  }

  if (!contentType.includes("event-stream") || !response.body) {
    const raw = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    const text = messageText(body).trim();
    if (text) yield { ok: true, status: response.status, textDelta: text, body };
    yield { ok: true, status: response.status, body, done: true };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastBody: Record<string, unknown> = {};
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      if (done) buffer += decoder.decode();
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = done ? "" : (parts.pop() ?? "");
      const frames = done ? parts.filter((part) => part.trim()) : parts;
      for (const frame of frames) {
        const parsed = parseSseFrame(frame);
        if (parsed === "done") {
          yield { ok: true, status: response.status, body: lastBody, done: true };
          return;
        }
        if (!parsed) continue;
        lastBody = mergeStreamBodies(lastBody, parsed);
        const activity = streamActivity(parsed);
        const delta = deltaText(parsed);
        if (activity || delta) {
          yield {
            ok: true,
            status: response.status,
            textDelta: delta || undefined,
            activity,
            body: lastBody,
          };
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  yield { ok: true, status: response.status, body: lastBody, done: true };
}

function mergeAbort(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeout, signal]);
  }
  return signal.aborted ? signal : timeout;
}

function parseSseFrame(frame: string): Record<string, unknown> | "done" | null {
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (!dataLines.length) return null;
  const data = dataLines.join("\n").trim();
  if (!data || data === "[DONE]") return "done";
  try {
    const parsed = JSON.parse(data) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function deltaText(parsed: Record<string, unknown>): string {
  const choices = parsed.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const choice = choices[0] as {
      delta?: { content?: unknown; text?: unknown };
      message?: { content?: unknown };
      text?: unknown;
    };
    const fromDelta = contentToText(choice.delta?.content) || contentToText(choice.delta?.text);
    if (fromDelta) return fromDelta;
    const fromMessage = contentToText(choice.message?.content);
    if (fromMessage) return fromMessage;
    const fromText = contentToText(choice.text);
    if (fromText) return fromText;
  }
  return contentToText(parsed.content);
}

function contentToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const item = part as { text?: unknown; content?: unknown };
      if (typeof item.text === "string") return item.text;
      if (typeof item.content === "string") return item.content;
      return "";
    })
    .join("");
}

function streamActivity(parsed: Record<string, unknown>): WebActivity | undefined {
  const names = toolCallNames(parsed);
  if (names.some((name) => name.includes("web_fetch") || name.endsWith(":fetch"))) {
    return "web_fetch";
  }
  if (names.some((name) => name.includes("web_search") || name.includes(":web"))) {
    return "web_search";
  }
  return undefined;
}

function toolCallNames(parsed: Record<string, unknown>): string[] {
  const choice = firstChoice(parsed);
  if (!choice) return [];
  const delta = asRecord(choice.delta);
  const message = asRecord(choice.message);
  const calls = [
    ...listOf(delta?.tool_calls),
    ...listOf(message?.tool_calls),
    ...listOf(parsed.tool_calls),
  ];
  return calls.map((item) => {
    if (!item || typeof item !== "object") return "";
    const row = item as {
      type?: unknown;
      name?: unknown;
      function?: { name?: unknown };
    };
    return [row.type, row.name, row.function?.name]
      .filter((value) => typeof value === "string")
      .join(" ")
      .toLowerCase();
  });
}

function mergeStreamBodies(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current, ...next };
  const annotations = [
    ...listOf(current.annotations),
    ...listOf(next.annotations),
    ...choiceAnnotations(firstChoice(next)),
  ];
  const citations = [
    ...listOf(current.citations),
    ...listOf(next.citations),
    ...choiceCitations(firstChoice(next)),
  ];
  if (annotations.length) merged.annotations = annotations;
  if (citations.length) merged.citations = citations;

  const prevChoice = firstChoice(current);
  const incomingChoice = firstChoice(next);
  if (incomingChoice) {
    const prevMessage = asRecord(prevChoice?.message) ?? {};
    const incomingMessage = asRecord(incomingChoice.message) ?? {};
    merged.choices = [
      {
        ...(prevChoice ?? {}),
        ...incomingChoice,
        message: {
          ...prevMessage,
          ...incomingMessage,
          annotations: [
            ...listOf(prevMessage.annotations),
            ...listOf(incomingMessage.annotations),
            ...choiceAnnotations(incomingChoice),
          ],
          citations: [
            ...listOf(prevMessage.citations),
            ...listOf(incomingMessage.citations),
            ...choiceCitations(incomingChoice),
          ],
        },
      },
    ];
  }
  return merged;
}

function firstChoice(body: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!body || !Array.isArray(body.choices) || !body.choices[0] || typeof body.choices[0] !== "object") {
    return undefined;
  }
  return body.choices[0] as Record<string, unknown>;
}

function choiceAnnotations(choice: Record<string, unknown> | undefined): unknown[] {
  if (!choice) return [];
  const delta = asRecord(choice.delta);
  const message = asRecord(choice.message);
  return [
    ...listOf(delta?.annotations),
    ...listOf(message?.annotations),
    ...listOf(choice.annotations),
  ];
}

function choiceCitations(choice: Record<string, unknown> | undefined): unknown[] {
  if (!choice) return [];
  const delta = asRecord(choice.delta);
  const message = asRecord(choice.message);
  return [
    ...listOf(delta?.citations),
    ...listOf(message?.citations),
    ...listOf(choice.citations),
  ];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function collectAnnotations(
  value: unknown,
  push: (url: string, titre: string, extrait: string) => void,
) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      url?: string;
      title?: string;
      content?: string;
      url_citation?: {
        url?: string;
        title?: string;
        content?: string;
        snippet?: string;
        text?: string;
      };
    };
    const citation = row.url_citation;
    const url = citation?.url || row.url || "";
    if (!url) continue;
    push(
      url,
      citation?.title || row.title || "",
      citation?.content || citation?.snippet || citation?.text || row.content || "",
    );
  }
}

function collectCitations(
  value: unknown,
  push: (url: string, titre: string, extrait: string) => void,
) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item === "string") {
      push(item, "", "");
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as { url?: string; title?: string; snippet?: string; content?: string };
    if (typeof row.url === "string") {
      push(row.url, row.title || "", row.snippet || row.content || "");
    }
  }
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function excerpt(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= EXCERPT_CHARS) return compact;
  return `${compact.slice(0, EXCERPT_CHARS - 1)}…`;
}
