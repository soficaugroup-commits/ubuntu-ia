import "server-only";
import { prepareChatAttachments, type PreparedAttachment } from "@/lib/server/chat-attachments";
import { isStyleTransfer, pickStyleAttachment } from "@/lib/server/design-dna";
import {
  hasWebAccess,
  messageText,
  parseWebSources,
  postChatCompletion,
  streamChatCompletion,
  webSearchUsed,
  WEB_PLUGIN,
  WEB_TOOLS,
} from "@/lib/server/deep-research";
import { chatModel, resolveLlmEndpoint } from "@/lib/server/env";
import { embedTexts } from "@/lib/server/embed-texts";
import { generateChatFiles } from "@/lib/server/generate-chat-file";
import { generateChatImage } from "@/lib/server/generate-image";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import {
  formatMemoryForPrompt,
  immediateFactsFromQuestion,
  listUserMemory,
} from "@/lib/server/user-memory";
import type { MemoryFact } from "@/lib/types";
import type {
  ChatAttachment,
  ChatTools,
  FileFormat,
  GeneratedFile,
  GeneratedImage,
  SourceCitation,
} from "@/lib/types";
import type { ChatStepState, ChatStreamEvent } from "@/lib/chat-stream-events";
import { copy } from "@/content/fr";
import { interpolate } from "@/lib/format";
import { stripInlineLinks } from "@/lib/answer-text";
import {
  astraSystemPrompt,
  reasoningEffort,
  requestCanvas,
  requestFile,
  requestImage,
  requestedFormats,
} from "@/lib/server/model-capabilities";

const MATCH_COUNT = 8;
const MATCH_THRESHOLD = 0.4;
const STRONG_MATCH = 0.52;
const WEAK_MATCH = 0.4;
const INTERNAL_TOPIC =
  /\b(soficau|ubuntu group|ubuntu ia|proc[eé]dure interne|note de service|r[eè]glement int[eé]rieur)\b/i;
const EXCERPT_CHARS = 280;
const WEB_ANSWER_MS = 70_000;
const DOCS_ANSWER_MS = 50_000;

export type RetrievedChunk = {
  document_id: string;
  contenu: string;
  titre: string;
  type_source: "fichier" | "url";
  url_source: string | null;
  similarite: number;
};

export type HistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ChatAnswer = {
  status: "answered" | "no_source";
  content: string;
  sources: SourceCitation[];
  images?: GeneratedImage[];
  files?: GeneratedFile[];
};

export async function answerQuestion(
  question: string,
  history: HistoryTurn[] = [],
  tools: ChatTools = {},
  attachments: ChatAttachment[] = [],
  memoryContext?: { userId: string },
  signal?: AbortSignal,
): Promise<ChatAnswer> {
  let content = "";
  let sources: SourceCitation[] = [];
  let images: GeneratedImage[] | undefined;
  let files: GeneratedFile[] | undefined;
  let status: ChatAnswer["status"] = "answered";
  for await (const event of streamAnswerQuestion(
    question,
    history,
    tools,
    attachments,
    memoryContext,
    signal,
  )) {
    if (event.type === "token") content += event.content;
    else if (event.type === "sources") sources = event.documents;
    else if (event.type === "images") images = event.images;
    else if (event.type === "files") files = event.files;
    else if (event.type === "fin") {
      if (event.status === "answered" || event.status === "no_source") {
        status = event.status;
      }
      if (event.content) content = event.content;
    } else if (event.type === "erreur") {
      throw new Error(event.message);
    }
  }
  return { status, content, sources, images, files };
}

export async function* streamAnswerQuestion(
  question: string,
  history: HistoryTurn[] = [],
  tools: ChatTools = {},
  attachments: ChatAttachment[] = [],
  memoryContext?: { userId: string },
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const steps = copy.chat;
  const prior = priorTurns(question, history);
  const query = searchQuery(question, prior);

  if (attachments.length) {
    yield step("attachments", steps.stepsAttachments, "running");
  }
  yield step("search", steps.stepsSearch, "running");
  yield step("web", steps.stepsWeb, "queued");
  yield step("write", steps.stepsWrite, "queued");

  const [selected, prepared, storedMemory] = await Promise.all([
    retrieveIndexed(query).catch((error) => {
      console.error("[chat] rag", error);
      return [] as RetrievedChunk[];
    }),
    prepareChatAttachments(attachments, question),
    memoryContext
      ? listUserMemory(memoryContext.userId).catch((error) => {
          console.error("[chat] memory", error);
          return [] as MemoryFact[];
        })
      : Promise.resolve([] as MemoryFact[]),
  ]);
  throwIfAborted(signal);

  if (attachments.length) {
    yield step("attachments", steps.stepsAttachmentsDone, "done");
  }
  if (selected.length) {
    yield step("search", steps.stepsSearchDone, "done");
    yield step("analyze", steps.stepsAnalyze, "running");
    yield step("analyze", steps.stepsAnalyzeDone, "done");
  } else {
    yield step("search", steps.stepsSearchEmpty, "empty");
  }

  yield step("web", steps.stepsWeb, "running");

  const spokenFacts = immediateFactsFromQuestion(question);
  const memory = mergeFacts(storedMemory, spokenFacts);
  const imageWanted = requestImage(question, tools, attachments);
  const canvasWanted = requestCanvas(question, tools);
  const formats = requestedFormats(
    question,
    tools,
    prepared.map((item) => item.name),
  );
  const fileWanted = requestFile(question, tools, prepared.length) || formats.length > 0;

  const imagePromise = imageWanted
    ? generateChatImage(
        imagePrompt(question, selected, prepared),
        prepared.filter((item) => item.kind === "image" && item.dataUrl).map((item) => item.dataUrl as string),
      ).catch((error) => {
        console.error("[chat] image", error);
        return null;
      })
    : Promise.resolve(null);
  if (imageWanted) {
    yield step("image", steps.stepsImage, "running");
  }

  let completion: { content: string; webSources: SourceCitation[]; webUsed: boolean };
  try {
    const tokens = createEventQueue();
    let writing = false;
    completion = yield* tokens.drainUntil(
      completeAnswer(
        question,
        prior,
        selected,
        prepared,
        {
          image: imageWanted,
          canvas: canvasWanted || fileWanted,
          file: fileWanted,
          formats,
          memory: formatMemoryForPrompt(memory),
        },
        (text) => {
          if (!writing) {
            writing = true;
            tokens.push(step("write", steps.stepsWrite, "running"));
          }
          tokens.push({ type: "token", content: text });
        },
        (activity) => {
          tokens.push(
            step(
              "web",
              activity === "web_fetch" ? steps.stepsWebFetch : steps.stepsWeb,
              "running",
            ),
          );
        },
        signal,
      ),
    );
  } catch (error) {
    yield step("write", steps.stepsWriteDone, "error");
    throw error;
  }
  yield step("write", steps.stepsWriteDone, "done");
  throwIfAborted(signal);

  const webHit = completion.webSources.length > 0 || completion.webUsed;
  yield step(
    "web",
    webHit ? steps.stepsWebDone : steps.stepsWebEmpty,
    webHit ? "done" : "empty",
  );

  const image = await imagePromise;
  if (imageWanted) {
    yield step(
      "image",
      image ? steps.stepsImageDone : steps.stepsImageError,
      image ? "done" : "error",
    );
  }

  const internal = selected.length > 0;
  const sources = [...toCitations(selected), ...completion.webSources];
  const images = image ? [image] : undefined;
  const rawContent =
    imageWanted && !image
      ? [
          completion.content,
          copy.chat.imageFailed,
        ]
          .filter(Boolean)
          .join("\n\n")
      : completion.content;
  const stripped = stripInlineLinks(
    internal ? rawContent : stripCitationMarks(rawContent),
  );
  const content = stripped || rawContent.trim();

  let files: GeneratedFile[] = [];
  if (fileWanted && content) {
    yield step("file", steps.stepsFile, "running");
    const queue = createEventQueue();
    const work = generateChatFiles({
      question,
      content,
      formats: formats.length ? formats : ["pdf"],
      attachments: prepared,
      onProgress: (phase, format) => {
        if (phase === "content") {
          queue.push(step("file", steps.stepsFileContent, "running"));
        }
        if (phase === "build" && format) {
          queue.push(
            step(
              "file",
              interpolate(steps.stepsFileBuild, { format: formatLabel(format) }),
              "running",
            ),
          );
        }
      },
    }).catch((error) => {
      console.error("[chat] files", error);
      return [] as GeneratedFile[];
    });
    files = yield* queue.drainUntil(work);
    yield step(
      "file",
      files.length ? steps.stepsFileDone : steps.stepsFileError,
      files.length ? "done" : "error",
    );
  }

  if (!content && !images?.length && !files.length) {
    yield { type: "fin", status: "no_source", content: "" };
    return;
  }

  const finalContent =
    content || "L'image a été générée à partir de votre consigne.";
  if (sources.length) {
    yield { type: "sources", documents: sources };
  }
  if (images?.length) {
    yield { type: "images", images };
  }
  if (files.length) {
    yield { type: "files", files };
  }
  yield { type: "fin", status: "answered", content: finalContent };
}

function step(id: string, label: string, state: ChatStepState): ChatStreamEvent {
  return { type: "etape", id, label, state };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error("stopped");
    error.name = "AbortError";
    throw error;
  }
}

function formatLabel(format: FileFormat): string {
  return copy.chat.fileKind[format] ?? format.toUpperCase();
}

function createEventQueue() {
  const events: ChatStreamEvent[] = [];
  const waiters: Array<() => void> = [];
  function wake() {
    while (waiters.length) waiters.shift()?.();
  }
  return {
    push(event: ChatStreamEvent) {
      events.push(event);
      wake();
    },
    async *drainUntil<T>(done: Promise<T>): AsyncGenerator<ChatStreamEvent, T> {
      let outcome: { type: "ok"; value: T } | { type: "err"; error: unknown } | undefined;
      void done.then(
        (value) => {
          outcome = { type: "ok", value };
          wake();
        },
        (error) => {
          outcome = { type: "err", error };
          wake();
        },
      );
      while (!outcome) {
        while (events.length) yield events.shift()!;
        if (outcome) break;
        await new Promise<void>((resolve) => {
          if (outcome || events.length) {
            resolve();
            return;
          }
          waiters.push(resolve);
        });
      }
      while (events.length) yield events.shift()!;
      if (!outcome) {
        throw new Error("La génération du fichier a échoué.");
      }
      if (outcome.type === "err") throw outcome.error;
      return outcome.value;
    },
  };
}

function priorTurns(question: string, history: HistoryTurn[]): HistoryTurn[] {
  const trimmed = history.filter((turn) => turn.content.trim());
  const last = trimmed.at(-1);
  if (last?.role === "user" && last.content.trim() === question.trim()) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

function searchQuery(question: string, history: HistoryTurn[]): string {
  const words = question.trim().split(/\s+/).filter(Boolean);
  if (words.length > 6) return question.trim();
  const previous = [...history]
    .reverse()
    .find((turn) => turn.role === "user" && turn.content.trim() !== question.trim());
  if (!previous) return question.trim();
  return `${previous.content.trim()}\n${question.trim()}`;
}

async function retrieveIndexed(query: string): Promise<RetrievedChunk[]> {
  const [vector] = await embedTexts([query]);
  return relevantChunks(query, await matchChunks(vector));
}

async function matchChunks(vector: number[]): Promise<RetrievedChunk[]> {
  const { data, error } = await supabaseAdmin().rpc("match_document_chunks", {
    query_embedding: vector,
    match_count: MATCH_COUNT,
    match_threshold: MATCH_THRESHOLD,
  });
  if (error) {
    throw new Error(
      `La recherche dans les documents indexés a échoué${error.message ? ` : ${error.message}` : "."}`,
    );
  }
  const rows = (data ?? []) as RetrievedChunk[];
  return rows.filter((row) => row.contenu?.trim());
}

async function completeAnswer(
  question: string,
  history: HistoryTurn[],
  chunks: RetrievedChunk[],
  attachments: PreparedAttachment[],
  extras: {
    image: boolean;
    canvas: boolean;
    file: boolean;
    formats: FileFormat[];
    memory?: string;
  },
  onToken: (text: string) => void,
  onActivity: (kind: "web_search" | "web_fetch") => void,
  signal?: AbortSignal,
): Promise<{ content: string; webSources: SourceCitation[]; webUsed: boolean }> {
  const textMessages = answerMessages(question, history, chunks, attachments, extras);
  const models = uniqueModels(chatModel(resolveLlmEndpoint()));
  const preferred = models[0];
  const reasoning = {
    effort: reasoningEffort(question, attachments.length),
    exclude: true,
  };
  const tries: {
    model: string;
    extra: Record<string, unknown>;
    timeoutMs: number;
  }[] = [
    {
      model: preferred,
      extra: {
        tools: WEB_TOOLS,
        max_tool_calls: 8,
        reasoning,
        max_completion_tokens: 16_000,
        temperature: 0.4,
      },
      timeoutMs: WEB_ANSWER_MS,
    },
    {
      model: preferred,
      extra: {
        plugins: [WEB_PLUGIN],
        reasoning,
        max_completion_tokens: 16_000,
        temperature: 0.4,
      },
      timeoutMs: WEB_ANSWER_MS,
    },
    {
      model: preferred,
      extra: { reasoning, max_completion_tokens: 16_000, temperature: 0.4 },
      timeoutMs: DOCS_ANSWER_MS,
    },
    ...models.slice(1).map((model) => ({
      model,
      extra: { max_completion_tokens: 8_000, temperature: 0.4 } as Record<string, unknown>,
      timeoutMs: DOCS_ANSWER_MS,
    })),
  ];

  for (const { model, extra, timeoutMs } of tries) {
    throwIfAborted(signal);
    try {
      let acc = "";
      let lastBody: Record<string, unknown> = {};
      let released = false;
      try {
        for await (const chunk of streamChatCompletion(
          { model, messages: textMessages, ...extra },
          timeoutMs,
          signal,
        )) {
          if (!chunk.ok) break;
          lastBody = chunk.body;
          if (chunk.activity) onActivity(chunk.activity);
          if (!chunk.textDelta) continue;
          acc += chunk.textDelta;
          if (!acc.trim()) continue;
          if (!released) {
            released = true;
            onToken(acc);
          } else {
            onToken(chunk.textDelta);
          }
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        console.error("[chat] stream", model, extra, error);
      }

      if (acc.trim()) {
        return webResult(acc, lastBody, extra);
      }

      const result = await postChatCompletion(
        { model, messages: textMessages, ...extra },
        timeoutMs,
        signal,
      ).catch((error) => {
        if (signal?.aborted) throw error;
        console.error("[chat] json", model, extra, error);
        return { ok: false, status: 0, body: {} as Record<string, unknown>, raw: "" };
      });
      if (!result.ok) continue;
      const text = messageText(result.body).trim();
      if (!text) continue;
      onToken(text);
      return webResult(text, result.body, extra);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.error("[chat] complete", model, extra, error);
    }
  }

  return lastResortAnswer(question, history, onToken, signal);
}

function webResult(
  content: string,
  body: Record<string, unknown>,
  extra: Record<string, unknown>,
): { content: string; webSources: SourceCitation[]; webUsed: boolean } {
  if (!hasWebAccess(extra)) {
    return { content, webSources: [], webUsed: false };
  }
  const webSources = parseWebSources(body);
  return {
    content,
    webSources,
    webUsed: webSources.length > 0 || webSearchUsed(body),
  };
}

async function lastResortAnswer(
  question: string,
  history: HistoryTurn[],
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<{ content: string; webSources: SourceCitation[]; webUsed: boolean }> {
  const endpoint = resolveLlmEndpoint();
  const models = uniqueModels(chatModel(endpoint));
  const messages = [
    {
      role: "system",
      content:
        "Tu es Ubuntu IA. Réponds clairement à la question, en français si la langue n'est pas évidente. N'inclus aucun lien Markdown.",
    },
    ...history.slice(-8).map((turn) => ({
      role: turn.role,
      content: turn.content.trim(),
    })),
    { role: "user", content: question.trim() },
  ];
  for (const model of models) {
    throwIfAborted(signal);
    try {
      const result = await postChatCompletion(
        { model, messages, max_completion_tokens: 8_000, temperature: 0.4 },
        DOCS_ANSWER_MS,
        signal,
      );
      const text = result.ok ? messageText(result.body).trim() : "";
      if (!text) continue;
      onToken(text);
      return { content: text, webSources: [], webUsed: false };
    } catch (error) {
      if (signal?.aborted) throw error;
      console.error("[chat] last-resort", model, error);
    }
  }
  return { content: "", webSources: [], webUsed: false };
}

type ChatTurn = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
        | { type: "file"; file: { filename: string; file_data: string } }
      >;
};

function answerMessages(
  question: string,
  history: HistoryTurn[],
  chunks: RetrievedChunk[],
  attachments: PreparedAttachment[],
  extras: {
    image: boolean;
    canvas: boolean;
    file: boolean;
    formats: FileFormat[];
    memory?: string;
  },
): ChatTurn[] {
  const internalCount = chunks.length;
  const context = formatInternal(chunks);
  const attached = formatAttachments(attachments, question);
  const messages: ChatTurn[] = [
    {
      role: "system",
      content: astraSystemPrompt({
        internalCount,
        canvas: extras.canvas,
        image: extras.image,
        file: extras.file,
        formats: extras.formats,
        memory: extras.memory,
      }),
    },
  ];

  for (const turn of history.slice(-24)) {
    if (!turn.content.trim()) continue;
    messages.push({
      role: turn.role === "assistant" ? "assistant" : "user",
      content: turn.content.trim(),
    });
  }

  const prompt = `${context}${attached}\n\nQuestion : ${question.trim()}`;
  const parts: Exclude<ChatTurn["content"], string> = [{ type: "text", text: prompt }];
  for (const item of attachments) {
    if (item.dataUrl) {
      parts.push({ type: "image_url", image_url: { url: item.dataUrl } });
    }
    if (item.fileData) {
      parts.push({
        type: "file",
        file: { filename: item.name, file_data: item.fileData },
      });
    }
  }

  messages.push({
    role: "user",
    content: parts.length > 1 ? parts : prompt,
  });
  return messages;
}

function formatAttachments(attachments: PreparedAttachment[], question = ""): string {
  if (!attachments.length) return "";
  const style = pickStyleAttachment(question, attachments);
  const body = attachments
    .map((item, index) => {
      const role =
        style && item === style
          ? "modèle de STYLE"
          : attachments.length > 1
            ? "CONTENU"
            : item.kind === "image"
              ? "image"
              : "fichier";
      return `Pièce ${index + 1} (${role} — ${item.name}) :\n${item.note.trim()}`;
    })
    .join("\n\n");
  const hint = isStyleTransfer(question)
    ? "\nTransposition d'habillage : le modèle de STYLE donne uniquement couleurs, polices, logos et grille. Le CONTENU reste intact (sauf synthèse assumée vers des diapositives). Ne pas réinjecter le texte d'un PDF ou d'une image de référence.\n"
    : "";
  return `\nPièces jointes analysées :\n\n${body}\n${hint}`;
}

function formatInternal(chunks: RetrievedChunk[]): string {
  if (!chunks.length) {
    return "";
  }
  const body = chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.titre}\n${chunk.contenu.trim()}`,
    )
    .join("\n\n");
  return `Extraits indexés :\n\n${body}\n`;
}

function imagePrompt(
  question: string,
  chunks: RetrievedChunk[],
  attachments: PreparedAttachment[],
): string {
  const photos = attachments.filter((item) => item.kind === "image" && item.dataUrl);
  if (photos.length) {
    return [
      "Édition photographique à partir de la photo jointe.",
      "Conserve fidèlement le visage, l'identité, la couleur de peau, la coupe, l'âge et les vêtements d'origine, sauf consigne contraire.",
      `Demande : ${question.trim()}`,
      "Rendu : photographie réaliste, nette, lumière naturelle professionnelle, sans texte superposé.",
    ].join(" ");
  }
  const hints = [
    ...chunks.slice(0, 2).map((chunk) => chunk.titre),
    ...attachments.slice(0, 2).map((item) => item.name),
  ]
    .filter(Boolean)
    .join(" ; ");
  const base = question.trim();
  if (!hints) return base;
  return `${base}\nContexte : ${hints}`;
}

function uniqueModels(preferred: string): string[] {
  return [...new Set([preferred, "openai/gpt-6-astra", "gpt-6-astra"])];
}

function selectChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>();
  const selected: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    const key = `${chunk.document_id}:${excerpt(chunk.contenu)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(chunk);
    if (selected.length >= 4) break;
  }
  return selected;
}

function relevantChunks(question: string, chunks: RetrievedChunk[]): RetrievedChunk[] {
  const forceInternal = INTERNAL_TOPIC.test(question);
  return selectChunks(
    chunks.filter((chunk) => isIndexedRelevant(question, chunk, forceInternal)),
  );
}

function isIndexedRelevant(
  question: string,
  chunk: RetrievedChunk,
  forceInternal: boolean,
): boolean {
  const similarity = chunk.similarite ?? 0;
  if (similarity >= STRONG_MATCH) return true;
  if (similarity < WEAK_MATCH && !forceInternal) return false;
  const overlap = tokenOverlap(question, `${chunk.titre} ${chunk.contenu}`);
  if (forceInternal) return similarity >= 0.36 && overlap >= 1;
  return overlap >= 2 || (overlap >= 1 && similarity >= 0.46);
}

const STOP_WORDS = new Set([
  "les", "une", "des", "dans", "pour", "par", "sur", "avec", "sans", "que", "qui",
  "quoi", "dont", "est", "sont", "pas", "plus", "tres", "comment", "pourquoi",
  "quand", "quel", "quelle", "quels", "quelles", "cette", "ces", "mon", "mes",
  "ton", "son", "nous", "vous", "ils", "etre", "avoir", "fait", "faire", "peux",
  "peut", "veux", "the", "and", "for", "with", "from",
]);

function tokenOverlap(left: string, right: string): number {
  const a = significantTokens(left);
  const b = significantTokens(right);
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count += 1;
  }
  return count;
}

function significantTokens(text: string): Set<string> {
  const words =
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return new Set(words.filter((word) => !STOP_WORDS.has(word)));
}

function stripCitationMarks(text: string): string {
  return text.replace(/\s*\[(\d{1,2})\]/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

function toCitations(chunks: RetrievedChunk[]): SourceCitation[] {
  const seen = new Set<string>();
  const sources: SourceCitation[] = [];
  for (const chunk of chunks) {
    const extrait = excerpt(chunk.contenu);
    const key = `${chunk.document_id}:${extrait}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      documentId: chunk.document_id,
      titre: chunk.titre,
      extrait,
      type_source: chunk.type_source === "url" ? "url" : "fichier",
      url_source: chunk.url_source,
      origine: "index",
    });
    if (sources.length >= 4) break;
  }
  return sources;
}

function mergeFacts(stored: MemoryFact[], spoken: MemoryFact[]): MemoryFact[] {
  const byKey = new Map<string, MemoryFact>();
  for (const fact of stored) byKey.set(fact.cle, fact);
  for (const fact of spoken) byKey.set(fact.cle, fact);
  return [...byKey.values()];
}

function excerpt(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= EXCERPT_CHARS) return compact;
  return `${compact.slice(0, EXCERPT_CHARS - 1)}…`;
}
