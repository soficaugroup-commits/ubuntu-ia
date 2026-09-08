/**
 * GET  /api/feedback  — retours déjà laissés par l'utilisateur (pour l'état des pouces).
 * POST /api/feedback  — enregistre un pouce haut/bas, sans bloquer la conversation.
 *
 * Corps POST : { conversationId, messageId, messageIndex, type, commentaire?,
 *                extraitQuestion?, extraitReponse? }
 */
import { NextResponse } from "next/server";
import { assertDocumentSecrets } from "@/lib/server/env";
import { isSessionActor, requireUser } from "@/lib/server/require-admin";
import { listOwnFeedback, upsertFeedback } from "@/lib/server/feedback";
import type { FeedbackType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asType(value: unknown): FeedbackType | null {
  return value === "positif" || value === "negatif" ? value : null;
}

export async function GET(request: Request) {
  const configured = assertDocumentSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireUser(request);
  if (!isSessionActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  try {
    const items = await listOwnFeedback(actor.id);
    return NextResponse.json(
      { feedbacks: items },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Les retours n'ont pas pu être chargés." },
      { status: 500 },
    );
  }
}

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
    messageId?: string;
    messageIndex?: number;
    type?: string;
    commentaire?: string;
    extraitQuestion?: string;
    extraitReponse?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Le retour n'a pas pu être lu." }, { status: 400 });
  }

  const type = asType(body.type);
  const messageId = body.messageId?.trim() ?? "";
  if (!type || !messageId) {
    return NextResponse.json(
      { error: "Indiquez le message et un avis positif ou négatif." },
      { status: 400 },
    );
  }

  const conversationId =
    body.conversationId && UUID.test(body.conversationId) ? body.conversationId : null;
  const messageIndex =
    typeof body.messageIndex === "number" && Number.isInteger(body.messageIndex)
      ? body.messageIndex
      : null;

  try {
    const item = await upsertFeedback({
      userId: actor.id,
      conversationId,
      messageId,
      messageIndex,
      type,
      commentaire: body.commentaire,
      extraitQuestion: body.extraitQuestion,
      extraitReponse: body.extraitReponse,
    });
    return NextResponse.json({ feedback: item });
  } catch {
    return NextResponse.json(
      { error: "Le retour n'a pas pu être enregistré." },
      { status: 500 },
    );
  }
}
