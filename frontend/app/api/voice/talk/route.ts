import { NextResponse } from "next/server";
import { assertDocumentSecrets, assertRealtimeSecrets } from "@/lib/server/env";
import { isSessionActor, requireUser } from "@/lib/server/require-admin";
import {
  streamVoiceTalk,
  transcribeWav,
  type VoiceTalkEvent,
} from "@/lib/server/voice-talk";
import type { VoiceHistoryTurn } from "@/lib/server/realtime-session";

void process.env.OPENROUTER_API_KEY;
void process.env.OPENROUTER_BASE_URL;
void process.env.REALTIME_MODEL;
void process.env.REALTIME_VOICE;
void process.env.VOICE_STT_MODEL;
void process.env.CHAT_MODEL;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export async function POST(request: Request) {
  const configured = assertDocumentSecrets() || assertRealtimeSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireUser(request);
  if (!isSessionActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  let body: { audio?: string; recentMessages?: VoiceHistoryTurn[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "L'audio n'a pas pu être lu." }, { status: 400 });
  }

  const audio = body.audio?.trim() ?? "";
  if (audio.length < 80) {
    return NextResponse.json({ error: "L'enregistrement est trop court." }, { status: 400 });
  }

  const recentMessages = (body.recentMessages ?? []).flatMap((turn) => {
    if (turn.role !== "user" && turn.role !== "assistant") return [];
    const content = turn.content?.trim() ?? "";
    if (!content) return [];
    return [{ role: turn.role, content: content.slice(0, 800) }];
  });

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: VoiceTalkEvent) => {
        if (abort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          abort.abort();
        }
      };

      void transcribeWav(audio, abort.signal)
        .then((content) => {
          if (content) send({ type: "user_transcript", content });
        })
        .catch((error) => console.error("[voice] stt", error));

      try {
        for await (const event of streamVoiceTalk(
          audio,
          actor.id,
          recentMessages,
          abort.signal,
        )) {
          if (abort.signal.aborted) break;
          send(event);
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          console.error("[voice] talk", error);
          send({
            type: "erreur",
            message: "La réponse vocale n'a pas pu être générée.",
          });
        }
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
