import { NextResponse } from "next/server";
import {
  getUserConversation,
  saveUserConversation,
} from "@/lib/server/conversations";
import { assertDocumentSecrets } from "@/lib/server/env";
import {
  immediateFactsFromQuestion,
  persistImmediateFacts,
  refreshUserMemory,
} from "@/lib/server/user-memory";
import { isSessionActor, requireUser } from "@/lib/server/require-admin";
import type { ChatMessage, Conversation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    conversationId?: string;
    userContent?: string;
    assistantContent?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Le tour vocal n'a pas pu être lu." }, { status: 400 });
  }

  const userContent = body.userContent?.trim() ?? "";
  const assistantContent = body.assistantContent?.trim() ?? "";
  if (!userContent && !assistantContent) {
    return NextResponse.json({ error: "Tour vocal vide." }, { status: 400 });
  }

  const conversationId =
    body.conversationId && UUID.test(body.conversationId)
      ? body.conversationId
      : crypto.randomUUID();

  const now = new Date().toISOString();
  const added: ChatMessage[] = [];
  if (userContent) {
    added.push({
      id: crypto.randomUUID(),
      role: "user",
      content: userContent,
      createdAt: now,
    });
  }
  if (assistantContent) {
    added.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content: assistantContent,
      sources: [],
      status: "answered",
      createdAt: now,
    });
  }

  try {
    const existing = await getUserConversation(actor.id, conversationId);
    const prior = existing?.messages ?? [];
    const messages = [...prior, ...added];
    const conversation: Conversation = {
      id: conversationId,
      title: existing?.title || titleFromQuestion(userContent || assistantContent),
      updatedAt: now,
      messages,
    };
    await saveUserConversation(actor.id, conversation);
    void (async () => {
      if (userContent) {
        await persistImmediateFacts(
          actor.id,
          conversationId,
          immediateFactsFromQuestion(userContent),
        );
      }
      await refreshUserMemory({
        userId: actor.id,
        conversationId,
        messages,
      });
    })().catch((error) => console.error("[voice] memory", error));
    return NextResponse.json(
      { conversationId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[voice] turn", error);
    return NextResponse.json(
      { error: "Le tour vocal n'a pas pu être enregistré." },
      { status: 500 },
    );
  }
}

function titleFromQuestion(question: string): string {
  const compact = question.trim().replace(/\s+/g, " ");
  return compact.length > 48 ? `${compact.slice(0, 45)}…` : compact;
}
