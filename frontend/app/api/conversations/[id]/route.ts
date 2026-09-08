/**
 * DELETE /api/conversations/:id
 * Retire une conversation de l'historique de son auteur.
 */
import { NextResponse } from "next/server";
import { deleteUserConversation } from "@/lib/server/conversations";
import { assertDocumentSecrets } from "@/lib/server/env";
import { isSessionActor, requireUser } from "@/lib/server/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const configured = assertDocumentSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireUser(request);
  if (!isSessionActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Conversation introuvable." }, { status: 404 });
  }

  try {
    const removed = await deleteUserConversation(actor.id, id);
    if (!removed) {
      return NextResponse.json({ error: "Conversation introuvable." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "La conversation n'a pas pu être supprimée." },
      { status: 500 },
    );
  }
}
