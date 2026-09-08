import { NextResponse } from "next/server";
import { streamAnswerQuestion } from "@/lib/server/answer-question";
import { saveUserConversation } from "@/lib/server/conversations";
import { assertDocumentSecrets } from "@/lib/server/env";
import {
  immediateFactsFromQuestion,
  persistImmediateFacts,
  refreshUserMemory,
} from "@/lib/server/user-memory";
import { isSessionActor, requireUser } from "@/lib/server/require-admin";
import type { ChatStreamEvent } from "@/lib/chat-stream-events";
import type {
  ChatAttachment,
  ChatMessage,
  ChatTools,
  Conversation,
  GeneratedFile,
  GeneratedImage,
  SourceCitation,
} from "@/lib/types";

void process.env.OPENROUTER_API_KEY;
void process.env.OPENROUTER_BASE_URL;
void process.env.NETLIFY_AI_GATEWAY_KEY;
void process.env.NETLIFY_AI_GATEWAY_BASE_URL;
void process.env.OPENAI_API_KEY;
void process.env.OPENAI_BASE_URL;
void process.env.CHAT_MODEL;
void process.env.IMAGE_MODEL;
void process.env.VISION_MODEL;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export async function POST(request: Request) {
  const configured = assertDocumentSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireUser(request);
  if (!isSessionActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  let body: {
    question?: string;
    conversationId?: string;
    attachments?: ChatAttachment[];
    tools?: ChatTools;
    messages?: ChatMessage[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "La question n'a pas pu être lue." },
      { status: 400 },
    );
  }

  const question = body.question?.trim() ?? "";
  if (!question) {
    return NextResponse.json(
      { error: "Saisissez une question pour interroger les documents indexés." },
      { status: 400 },
    );
  }

  const conversationId =
    body.conversationId && UUID.test(body.conversationId)
      ? body.conversationId
      : crypto.randomUUID();

  const history: { role: "user" | "assistant"; content: string }[] = [];
  for (const message of body.messages ?? []) {
    if (message.role === "user" && message.content.trim()) {
      history.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant" && message.content.trim()) {
      history.push({ role: "assistant", content: message.content });
    }
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        if (abort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          abort.abort();
        }
      };

      let content = "";
      let sources: SourceCitation[] = [];
      let images: GeneratedImage[] | undefined;
      let files: GeneratedFile[] | undefined;
      let status: "answered" | "no_source" | "error" = "answered";
      let finished = false;

      try {
        for await (const event of streamAnswerQuestion(
          question,
          history,
          {
            image: Boolean(body.tools?.image),
            canvas: Boolean(body.tools?.canvas),
            file: Boolean(body.tools?.file),
          },
          body.attachments ?? [],
          { userId: actor.id },
          abort.signal,
        )) {
          if (abort.signal.aborted) break;
          if (event.type === "token") content += event.content;
          else if (event.type === "sources") sources = event.documents;
          else if (event.type === "images") images = event.images;
          else if (event.type === "files") files = event.files;
          else if (event.type === "fin") {
            if (event.status === "answered" || event.status === "no_source") {
              status = event.status;
            } else {
              status = "error";
            }
            if (event.content) content = event.content;
            finished = true;
          } else if (event.type === "erreur") {
            status = "error";
          }
          send(
            event.type === "fin"
              ? { ...event, conversationId, status, content }
              : event,
          );
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          console.error("[chat] stream", error);
          if (content.trim()) {
            status = "answered";
            send({ type: "fin", status: "answered", conversationId, content });
          } else {
            status = "error";
            send({
              type: "fin",
              status: "error",
              conversationId,
            });
          }
          finished = true;
        }
      }

      if (!abort.signal.aborted && !finished) {
        send({ type: "fin", status, conversationId, content });
      }

      if (!abort.signal.aborted && (status === "answered" || status === "no_source")) {
        const assistant: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content,
          sources,
          images,
          files,
          status,
          createdAt: new Date().toISOString(),
        };
        const conversation: Conversation = {
          id: conversationId,
          title: titleFromQuestion(question),
          updatedAt: assistant.createdAt,
          messages: mergeTurn(
            body.messages ?? [],
            question,
            body.attachments,
            body.tools,
            assistant,
          ),
        };
        try {
          await saveUserConversation(actor.id, conversation);
        } catch (error) {
          console.error("[chat] save", error);
        }
        void (async () => {
          await persistImmediateFacts(
            actor.id,
            conversationId,
            immediateFactsFromQuestion(question),
          );
          await refreshUserMemory({
            userId: actor.id,
            conversationId,
            messages: conversation.messages,
          });
        })().catch((error) => console.error("[chat] memory", error));
      }

      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function lastUserMessageIndex(messages: ChatMessage[], question: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item.role === "user" && item.content === question) return index;
  }
  return -1;
}

function titleFromQuestion(question: string): string {
  const compact = question.trim().replace(/\s+/g, " ");
  return compact.length > 48 ? `${compact.slice(0, 45)}…` : compact;
}

function mergeTurn(
  prior: ChatMessage[],
  question: string,
  attachments: ChatAttachment[] | undefined,
  tools: ChatTools | undefined,
  assistant: ChatMessage,
): ChatMessage[] {
  const cleaned = prior.filter(
    (item) =>
      !(
        item.role === "assistant" &&
        (item.status === "pending" ||
          item.status === "error" ||
          item.status === "timeout" ||
          item.status === "stopped" ||
          item.status === "offline")
      ),
  );
  const lastUserIndex = lastUserMessageIndex(cleaned, question);
  if (lastUserIndex >= 0) {
    return [...cleaned.slice(0, lastUserIndex + 1), assistant];
  }
  return [
    ...cleaned,
    {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      attachments: attachments?.length ? attachments : undefined,
      tools:
        tools?.image || tools?.canvas || tools?.file
          ? {
              image: Boolean(tools.image),
              canvas: Boolean(tools.canvas),
              file: Boolean(tools.file),
            }
          : undefined,
      createdAt: new Date().toISOString(),
    },
    assistant,
  ];
}
