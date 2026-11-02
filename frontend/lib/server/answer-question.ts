import "server-only";
import { prepareChatAttachments, type PreparedAttachment } from "@/lib/server/chat-attachments";
import { planAgentTurn } from "@/lib/server/agent-plan";
import { advanceTask } from "@/lib/server/agent-loop/runner";
import { supabaseTaskStore } from "@/lib/server/agent-loop/store";
import { createTask } from "@/lib/server/tasks";
import { runAgentToolRound } from "@/lib/server/agent-tools";
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
import { chatModel, fileModel, resolveLlmEndpoint } from "@/lib/server/env";
import { embedTexts } from "@/lib/server/embed-texts";
import { loadDocumentSkillPrompt } from "@/lib/server/document-skills";
import { generateChatFiles } from "@/lib/server/generate-chat-file";
import { generateChatImage } from "@/lib/server/generate-image";
import {
  listTemplatesForUser,
  loadTemplateForUser,
  matchTemplate,
  templatePromptBrief,
} from "@/lib/server/templates";
import { immediateFactsFromQuestion, loadMemoryForPrompt } from "@/lib/server/user-memory";
import { matchIndexedChunks, organisationOf } from "@/lib/server/indexed-search";
import {
  findMethodologyReferences,
  methodologyPrompt,
  wantsMethodology,
  type MethodologyReference,
} from "@/lib/server/methodology";
import type {
  ChatAttachment,
  ChatTools,
  DocumentTemplate,
  FileFormat,
  TemplateFormat,
  GeneratedFile,
  GeneratedImage,
  SourceCitation,
} from "@/lib/types";
import type { ChatStepState, ChatStreamEvent } from "@/lib/chat-stream-events";
import { copy } from "@/content/fr";
import { interpolate } from "@/lib/format";
import { createVisibleAnswerFilter, stripDocumentSpec, stripInlineLinks } from "@/lib/answer-text";
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
const WEB_ANSWER_MS = 150_000;
const DOCS_ANSWER_MS = 50_000;
const TEMPLATE_WORDS = /\b(mod[eè]le|trame|gabarit|canevas|template)\b/i;

function templateFormatIn(formats: FileFormat[]): TemplateFormat | undefined {
  return formats.find((item): item is TemplateFormat => item === "docx" || item === "pptx" || item === "xlsx");
}

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
  memoryContext?: { userId: string; conversationId?: string | null },
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
  memoryContext?: { userId: string; conversationId?: string | null },
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const steps = copy.chat;
  const prior = priorTurns(question, history);
  const query = searchQuery(question, prior);
  const plan = planAgentTurn(question, tools, attachments);

  yield step("plan", steps.stepsPlan, "running");
  yield step("plan", plan.label || steps.stepsPlanDone, "done");

  if (plan.longTask && memoryContext?.userId) {
    const mission = await openMission(memoryContext.userId, memoryContext.conversationId, question);
    if (mission) {
      const text = missionText(mission.objectif, mission.plan.map((item) => item.description));
      yield { type: "tache", id: mission.id };
      yield { type: "token", content: text };
      yield { type: "fin", status: "answered", content: text };
      return;
    }
  }

  if (attachments.length) {
    yield step("attachments", steps.stepsAttachments, "running");
  }
  if (plan.needRag) {
    yield step("search", steps.stepsSearch, "running");
  } else {
    yield step("search", steps.stepsSearchSkip, "empty");
  }
  if (plan.needWeb) {
    yield step("web", steps.stepsWeb, "queued");
  }
  yield step("write", steps.stepsWrite, "queued");

  const methodologyWanted = wantsMethodology(question, {
    mode: plan.mode,
    deliverable: plan.needFile || plan.needCanvas || plan.formats.length > 0,
  });
  if (methodologyWanted) {
    yield step("methodology", steps.stepsMethodology, "running");
  }
  const recentText = prior
    .slice(-4)
    .map((turn) => turn.content)
    .join("\n")
    .slice(0, 2_000);

  const [selectedRaw, prepared, memoryText, methodology] = await Promise.all([
    plan.needRag
      ? retrieveIndexed(query, memoryContext?.userId).catch((error) => {
          console.error("[chat] rag", error);
          return [] as RetrievedChunk[];
        })
      : Promise.resolve([] as RetrievedChunk[]),
    prepareChatAttachments(attachments, question),
    memoryContext
      ? loadMemoryForPrompt(
          memoryContext.userId,
          question,
          recentText,
          immediateFactsFromQuestion(question),
        ).catch((error) => {
          console.error("[chat] memory", error);
          return "";
        })
      : Promise.resolve(""),
    methodologyWanted
      ? findMethodologyReferences(query, memoryContext?.userId)
      : Promise.resolve([] as MethodologyReference[]),
  ]);
  throwIfAborted(signal);

  if (methodologyWanted) {
    yield methodology.length
      ? step(
          "methodology",
          interpolate(steps.stepsMethodologyDone, {
            titles: methodology.map((ref) => `« ${ref.titre} »`).join(", "),
          }),
          "done",
        )
      : step("methodology", steps.stepsMethodologyEmpty, "empty");
  }

  if (attachments.length) {
    yield step("attachments", steps.stepsAttachmentsDone, "done");
  }
  let selected = selectedRaw;
  if (plan.needRag) {
    if (selected.length) {
      yield step("search", steps.stepsSearchDone, "done");
      yield step("analyze", steps.stepsAnalyze, "running");
      yield step("analyze", steps.stepsAnalyzeDone, "done");
    } else {
      yield step("search", steps.stepsSearchEmpty, "empty");
    }
  }

  let formats = plan.formats.length
    ? [...plan.formats]
    : requestedFormats(
        question,
        tools,
        prepared.map((item) => item.name),
      );
  let imageWanted =
    plan.needImage || requestImage(question, tools, attachments);
  let canvasWanted = plan.needCanvas || requestCanvas(question, tools);
  let fileWanted =
    plan.needFile ||
    requestFile(question, tools, prepared.length) ||
    formats.length > 0;

  const userId = memoryContext?.userId;
  const catalogue =
    userId && !tools.modeleId && (plan.needTools || TEMPLATE_WORDS.test(question))
      ? await listTemplatesForUser(userId).catch((error) => {
          console.error("[chat] modèles", error);
          return [] as DocumentTemplate[];
        })
      : [];
  let agentTemplateId: string | undefined;

  if (plan.needTools) {
    yield step("tools", steps.stepsTools, "running");
    const prep = await runAgentToolRound({
      question,
      history: prior,
      mode: plan.mode,
      seed: {
        image: imageWanted,
        canvas: canvasWanted,
        file: fileWanted,
        formats,
        brief: "",
      },
      templates: catalogue,
      signal,
    }).catch((error) => {
      console.error("[chat] agent-tools", error);
      return null;
    });
    throwIfAborted(signal);
    if (prep) {
      if (prep.chunks.length) {
        selected = mergeChunks(selected, prep.chunks);
        yield step("search", steps.stepsSearchDone, "done");
      }
      imageWanted = imageWanted || prep.deliverable.image;
      canvasWanted = canvasWanted || prep.deliverable.canvas;
      fileWanted = fileWanted || prep.deliverable.file;
      for (const format of prep.deliverable.formats) {
        if (!formats.includes(format)) formats.push(format);
      }
      if (fileWanted && !formats.length) formats = ["pdf"];
      agentTemplateId = prep.deliverable.templateId;
      yield step("tools", steps.stepsToolsDone, "done");
    } else {
      yield step("tools", steps.stepsToolsDone, "empty");
    }
  }

  const templateId =
    tools.modeleId ?? agentTemplateId ?? matchTemplate(question, catalogue, templateFormatIn(formats))?.id;
  const template = userId && templateId
    ? await loadTemplateForUser(userId, templateId).catch((error) => {
        console.error("[chat] modèle", error);
        return null;
      })
    : null;
  throwIfAborted(signal);
  if (template) {
    fileWanted = true;
    formats = [template.template.format, ...formats.filter((item) => item !== template.template.format && item === "pdf")];
    yield step("template", interpolate(steps.stepsTemplate, { name: template.template.nom }), "done");
  } else if (tools.modeleId) {
    yield step("template", steps.stepsTemplateUnavailable, "error");
  }

  if (plan.needWeb) {
    yield step("web", steps.stepsWeb, "running");
  }


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
    const visible = createVisibleAnswerFilter();
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
          memory: memoryText,
          methodologyBrief: methodologyPrompt(methodology),
          agentMode: plan.mode,
          useWeb: plan.needWeb,
          templateBrief: template ? templatePromptBrief(template.template) : undefined,
        },
        (text) => {
          if (!writing) {
            writing = true;
            tokens.push(step("write", steps.stepsWrite, "running"));
          }
          const shown = visible.push(text);
          if (shown) tokens.push({ type: "token", content: shown });
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
      ).then((result) => {
        const tail = visible.finish();
        if (tail) tokens.push({ type: "token", content: tail });
        return result;
      }),
    );
  } catch (error) {
    yield step("write", steps.stepsWriteDone, "error");
    throw error;
  }
  yield step("write", steps.stepsWriteDone, "done");
  throwIfAborted(signal);

  if (plan.needWeb) {
    const webHit = completion.webSources.length > 0 || completion.webUsed;
    yield step(
      "web",
      webHit ? steps.stepsWebDone : steps.stepsWebEmpty,
      webHit ? "done" : "empty",
    );
  }

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
  const preparedAnswer = stripInlineLinks(
    internal ? rawContent : stripCitationMarks(rawContent),
  );
  const sourceForFiles = preparedAnswer || rawContent.trim();
  const content = stripDocumentSpec(sourceForFiles);

  let files: GeneratedFile[] = [];
  if (fileWanted && sourceForFiles) {
    yield step("file", steps.stepsFile, "running");
    const queue = createEventQueue();
    const work = generateChatFiles({
      question,
      content: sourceForFiles,
      formats: formats.length ? formats : ["pdf"],
      attachments: prepared,
      userId: memoryContext?.userId,
      excerpts: [
        ...selected.map((chunk) => chunk.contenu),
        ...completion.webSources.map((item) => item.extrait),
        ...prepared.map((item) => item.note),
      ].filter((item) => item.trim()),
      citationCount: selected.length,
      template: template
        ? { format: template.template.format, bytes: template.bytes, nom: template.template.nom }
        : undefined,
      onProgress: (phase, format, detail) => {
        if (phase === "template-missing" && detail) {
          queue.push(step("template-missing", interpolate(steps.stepsTemplateMissing, { fields: detail }), "empty"));
        }
        if (phase === "template-fallback" && format) {
          queue.push(
            step(
              "template-fallback",
              interpolate(steps.stepsTemplateFallback, { format: formatLabel(format) }),
              "error",
            ),
          );
        }
        if (phase === "review") {
          queue.push(step("review", steps.stepsReview, "running"));
        }
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
        if (phase === "invalid" && format) {
          queue.push(
            step(
              `file-invalid-${format}`,
              interpolate(steps.stepsFileInvalid, { format: formatLabel(format) }),
              "error",
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

async function retrieveIndexed(query: string, userId?: string): Promise<RetrievedChunk[]> {
  const [vector] = await embedTexts([query]);
  return relevantChunks(query, await matchChunks(vector, userId));
}

async function matchChunks(vector: number[], userId?: string): Promise<RetrievedChunk[]> {
  // Les documents Méthodologie sont exclus : ils structurent la rédaction, ils ne sont jamais des sources.
  const organisationId = await organisationOf(userId);
  return matchIndexedChunks(vector, {
    count: MATCH_COUNT,
    threshold: MATCH_THRESHOLD,
    organisationId,
  });
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
    agentMode?: "answer" | "task" | "hybrid";
    useWeb?: boolean;
    templateBrief?: string;
    methodologyBrief?: string;
  },
  onToken: (text: string) => void,
  onActivity: (kind: "web_search" | "web_fetch") => void,
  signal?: AbortSignal,
): Promise<{ content: string; webSources: SourceCitation[]; webUsed: boolean }> {
  const textMessages = answerMessages(question, history, chunks, attachments, extras);
  const endpoint = resolveLlmEndpoint();
  const documentWork = Boolean(extras.file || extras.canvas);
  const preferred = documentWork ? fileModel(endpoint) : chatModel(endpoint);
  const models = documentWork
    ? uniqueModels(
        preferred,
        "anthropic/claude-opus-5.5",
        "anthropic/claude-fable-5.1",
        chatModel(endpoint),
      )
    : uniqueModels(preferred, "deepseek/deepseek-v4.1-flash", "~deepseek/deepseek-flash-latest");
  const reasoning = {
    effort: reasoningEffort(question, attachments.length),
    exclude: true,
  };
  const useWeb = extras.useWeb !== false;
  const tries: {
    model: string;
    extra: Record<string, unknown>;
    timeoutMs: number;
  }[] = useWeb
    ? [
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
      ]
    : [
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
    agentMode?: "answer" | "task" | "hybrid";
    useWeb?: boolean;
    templateBrief?: string;
    methodologyBrief?: string;
  },
): ChatTurn[] {
  const internalCount = chunks.length;
  const context = formatInternal(chunks);
  const attached = formatAttachments(attachments, question);
  const documentWork = Boolean(extras.file || extras.canvas);
  const documentSkills = documentWork
    ? loadDocumentSkillPrompt(extras.formats)
    : undefined;
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
        agentMode: extras.agentMode,
        documentSkills,
      }) +
        (extras.templateBrief ? `\n\n${extras.templateBrief}` : "") +
        (extras.methodologyBrief ? `\n\n${extras.methodologyBrief}` : ""),
    },
  ];

  for (const turn of history.slice(-24)) {
    if (!turn.content.trim()) continue;
    messages.push({
      role: turn.role === "assistant" ? "assistant" : "user",
      content: turn.content.trim(),
    });
  }

  const prompt = `${context}${attached}\n\nDemande : ${question.trim()}`;
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

function uniqueModels(...models: string[]): string[] {
  return [...new Set(models.filter(Boolean))];
}

function mergeChunks(
  primary: RetrievedChunk[],
  extra: RetrievedChunk[],
): RetrievedChunk[] {
  const seen = new Set(
    primary.map((chunk) => `${chunk.document_id}:${excerpt(chunk.contenu)}`),
  );
  const merged = [...primary];
  for (const chunk of extra) {
    const key = `${chunk.document_id}:${excerpt(chunk.contenu)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(chunk);
    if (merged.length >= 6) break;
  }
  return merged;
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

async function openMission(userId: string, conversationId: string | null | undefined, question: string) {
  try {
    const created = await createTask({
      userId,
      conversationId: conversationId ?? null,
      titre: question.trim().slice(0, 80) || "Mission",
      objectif: question.trim(),
    });
    const { task } = await advanceTask(supabaseTaskStore(userId), created.id, { budgetMs: 20_000 });
    return task;
  } catch (error) {
    console.error("[chat] tâche", error);
    return null;
  }
}

function missionText(objectif: string, steps: string[]): string {
  const plan = steps.map((item, index) => `${index + 1}. ${item}`).join("\n");
  return `Je prends cette mission en charge. Aucune action à conséquence n'est lancée tant que le plan n'est pas validé.\n\nObjectif : ${objectif}\n\n${plan}`;
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

function excerpt(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= EXCERPT_CHARS) return compact;
  return `${compact.slice(0, EXCERPT_CHARS - 1)}…`;
}
